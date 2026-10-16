import { randomUUID } from 'node:crypto';

import type { SqlExecutor } from '../database/sql-client';
import type { Game, GameStatus } from '../domain/game/game';
import type { PlayerId } from '../domain/game/game-id';
import {
  commissionBpsForStake,
  DEFAULT_GAME_COMMISSION_SCHEDULE,
  isValidCommissionSchedule,
  planGameSettlement,
  type GameCommissionTier,
  reservedPerPlayer,
  settledParticipants,
  victoryTypeOf,
  type GameSettlementPlan,
} from '../domain/rules/game-settlement';
import { isValidGameStake, StakeNotCoveredAtStartError } from '../domain/rules/stake';
import type { UserId } from '../domain/users/user';
import type { Logger } from '../utils/logger';
import { lockWalletBalances } from './wallet-reservations';

/**
 * Engagement et règlement des mises des parties ORDINAIRES (D-074, D-080), exécutés DANS la
 * transaction SQL qui écrit la partie (`insertGameRows` / `updateGameRows`) : la partie
 * démarre si et seulement si les mises sont engagées, et elle se termine si et seulement si
 * elle est réglée. Un échec annule l'écriture de la partie avec ses mouvements (ROLLBACK).
 *
 * - DÉMARRAGE (waiting → in_progress, ou partie insérée déjà démarrée) : ligne
 *   `game_settlements` RESERVED (taux de la tranche de la mise FIGÉ), puis ENGAGEMENT de 2 × M
 *   pour chaque joueur (`wallet_reservations` ACTIVE avec `game_id`). Aucun débit et aucun
 *   changement de `wallets` (D-080) : solde et disponible affichés restent identiques pendant
 *   toute la partie ; l'engagement borne seulement les dépenses (`lockWalletBalances`).
 *   Disponible (hors autres engagements) insuffisant → StakeNotCoveredAtStartError, rien
 *   n'est écrit.
 * - FIN (→ finished) : ligne verrouillée ; RESERVED seulement (sinon déjà réglée : rien) :
 *   victoire → perte due débitée chez chaque PERDANT (`game_stake`), gain net au gagnant
 *   (`game_winnings`), commission au compte de la plateforme (`platform_ledger`) ;
 *   engagements clos (CAPTURED pour les perdants, RELEASED pour les autres) ; sans gagnant →
 *   tout est libéré, commission 0.
 *
 * Non concernées (aucune ligne, aucun mouvement) : tables de tournoi (jetons de tournoi,
 * D-054), parties sans mise valide, parties démarrées avant la migration 0029.
 *
 * Ordre de verrouillage : ligne `games` (écriture de la partie), `game_settlements`,
 * réservations, portefeuilles par identifiant croissant. Les fonctions du compte de jeu
 * (retrait, inscription à un tournoi) ne prennent que le portefeuille : aucun cycle.
 */
export interface GameStakeLedger {
  /**
   * Appelé après l'écriture des lignes de la partie, dans la même transaction.
   * `previousStatus` : statut enregistré avant l'écriture (null pour une insertion).
   */
  afterGameWrite(tx: SqlExecutor, game: Game, previousStatus: GameStatus | null): Promise<void>;
}

export const GAME_COMMISSION_SETTING_KEY = 'game_commission_schedule';

/** Barème en vigueur : paramètre enregistré, sinon le barème initial. */
export async function readGameCommissionSchedule(
  db: SqlExecutor,
): Promise<readonly GameCommissionTier[]> {
  const { rows } = await db.query<{ value: unknown }>(
    'SELECT value FROM system_settings WHERE key = $1',
    [GAME_COMMISSION_SETTING_KEY],
  );
  const value = rows[0]?.value;
  return isValidCommissionSchedule(value) ? value : DEFAULT_GAME_COMMISSION_SCHEDULE;
}

interface SettlementRow {
  game_id: string;
  stake: string | number;
  reserved_per_player: string | number;
  commission_bps: number;
  status: 'RESERVED' | 'SETTLED' | 'VOID';
}

interface GameReservationRow {
  id: string;
  wallet_id: UserId;
  amount: string | number;
}

const iso = (d: Date) => d.toISOString();
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class PostgresGameStakeLedger implements GameStakeLedger {
  private readonly clock: () => Date;

  constructor(private readonly options: { logger?: Logger; clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  async afterGameWrite(
    tx: SqlExecutor,
    game: Game,
    previousStatus: GameStatus | null,
  ): Promise<void> {
    if (game.status === 'waiting') return;
    const now = this.clock();
    if (previousStatus === null || previousStatus === 'waiting') {
      await this.open(tx, game, now);
    }
    if (game.status === 'finished' && previousStatus !== 'finished') {
      await this.settle(tx, game, now);
    }
  }

  /** Engagement au démarrage : une seule fois par partie (clé primaire `game_id`). */
  private async open(tx: SqlExecutor, game: Game, now: Date): Promise<void> {
    const stake = game.stakeAmount;
    // Partie de tournoi (rattachement explicite, D-106) : comptes FICTIFS seulement (D-111),
    // jamais d'engagement ni de règlement sur le compte de jeu réel.
    if (game.tournamentId !== undefined) return;
    if (!game.sessionId || !isValidGameStake(stake)) return;
    const tournament = await tx.query('SELECT 1 FROM tournament_sessions WHERE session_id = $1', [
      game.sessionId,
    ]);
    if (tournament.rows.length > 0) return;

    const commissionBps = commissionBpsForStake(await readGameCommissionSchedule(tx), stake);
    const perPlayer = reservedPerPlayer(stake);
    const inserted = await tx.query(
      `INSERT INTO game_settlements (game_id, session_id, stake, reserved_per_player,
         commission_bps, status, opened_at)
       VALUES ($1, $2, $3, $4, $5, 'RESERVED', $6)
       ON CONFLICT (game_id) DO NOTHING
       RETURNING game_id`,
      [game.id, game.sessionId, stake, perPlayer, commissionBps, iso(game.startedAt ?? now)],
    );
    if (inserted.rows.length === 0) return; // déjà ouvert (reprise)

    const playerIds = game.players.map((p) => p.playerId as string).sort(byId);
    for (const playerId of playerIds) {
      const userId = playerId as UserId;
      // Disponible déjà diminué des engagements d'autres parties, lu sous verrou.
      const { available } = await lockWalletBalances(tx, userId, now);
      if (available < perPlayer) {
        throw new StakeNotCoveredAtStartError(playerId as PlayerId, stake);
      }
      // Engagement seulement : ni `wallets.balance` ni `wallets.reserved` ne changent (D-080).
      await tx.query(
        `INSERT INTO wallet_reservations (id, wallet_id, game_id, amount, currency, status,
           created_at)
         VALUES ($1, $2, $3, $4, 'XAF', 'ACTIVE', $5)`,
        [randomUUID(), userId, game.id, perPlayer, iso(now)],
      );
    }
    this.options.logger?.info('GAME_STAKES_COMMITTED', {
      gameId: game.id,
      sessionId: game.sessionId,
      stake,
      perPlayer,
      players: playerIds.length,
      commissionBps,
    });
  }

  /** Règlement à la fin : une seule fois (ligne verrouillée, statut RESERVED). */
  private async settle(tx: SqlExecutor, game: Game, now: Date): Promise<void> {
    const { rows } = await tx.query<SettlementRow>(
      'SELECT * FROM game_settlements WHERE game_id = $1 FOR UPDATE',
      [game.id],
    );
    const settlement = rows[0];
    if (!settlement || settlement.status !== 'RESERVED') return;
    const stake = Number(settlement.stake);
    const reservations = (
      await tx.query<GameReservationRow>(
        `SELECT id, wallet_id, amount FROM wallet_reservations
         WHERE game_id = $1 AND status = 'ACTIVE' ORDER BY wallet_id FOR UPDATE`,
        [game.id],
      )
    ).rows;

    const victoryType = victoryTypeOf(game);
    const winnerId = game.result?.winnerId;
    if (!victoryType || !winnerId) {
      for (const r of reservations) await this.release(tx, r, now);
      await tx.query(
        `UPDATE game_settlements
         SET status = 'VOID', outcome = 'NO_WINNER', participants = $2, unit_amount = 0,
             gross_amount = 0, commission_amount = 0, net_gain = 0, void_reason = $3,
             settled_at = $4
         WHERE game_id = $1`,
        [game.id, settledParticipants(game).length, game.endReason ?? 'NO_WINNER', iso(now)],
      );
      this.options.logger?.info('GAME_SETTLED_WITHOUT_WINNER', {
        gameId: game.id,
        endReason: game.endReason,
        released: reservations.length,
      });
      return;
    }

    const reserved = new Map(reservations.map((r) => [r.wallet_id as string, r]));
    const participants = settledParticipants(game);
    for (const id of participants) {
      // Invariant : tout joueur présent au démarrage a sa réservation. Sinon : ROLLBACK.
      if (!reserved.has(id)) {
        throw new Error(`Réservation absente pour ${id} (partie ${game.id})`);
      }
    }
    const plan = planGameSettlement({
      stake,
      commissionBps: settlement.commission_bps,
      winnerId,
      participants,
      victoryType,
    });
    for (const r of reservations) {
      if (plan.loserIds.includes(r.wallet_id as string as PlayerId)) {
        await this.capture(tx, game, r, plan.unitAmount, now);
      } else {
        await this.release(tx, r, now); // gagnant (garde sa mise) ou fuyard (R-05) : aucun débit
      }
    }
    await this.creditWinner(tx, game, plan, now);
    if (plan.commissionAmount > 0) {
      await tx.query(
        `INSERT INTO platform_ledger (id, game_id, kind, amount, fee_bps, currency, created_at)
         VALUES ($1, $2, 'GAME_COMMISSION', $3, $4, 'XAF', $5)`,
        [randomUUID(), game.id, plan.commissionAmount, plan.appliedCommissionBps, iso(now)],
      );
    }
    await tx.query(
      `UPDATE game_settlements
       SET status = 'SETTLED', outcome = $2, winner_id = $3, participants = $4,
           unit_amount = $5, gross_amount = $6, commission_amount = $7, net_gain = $8,
           applied_commission_bps = $9, settled_at = $10
       WHERE game_id = $1`,
      [
        game.id,
        plan.victoryType,
        plan.winnerId,
        plan.participants.length,
        plan.unitAmount,
        plan.grossAmount,
        plan.commissionAmount,
        plan.netGain,
        plan.appliedCommissionBps,
        iso(now),
      ],
    );
    this.options.logger?.info('GAME_SETTLED', {
      gameId: game.id,
      winnerId: plan.winnerId,
      victoryType: plan.victoryType,
      participants: plan.participants.length,
      unitAmount: plan.unitAmount,
      grossAmount: plan.grossAmount,
      commissionBps: plan.commissionBps,
      appliedCommissionBps: plan.appliedCommissionBps,
      commissionAmount: plan.commissionAmount,
      netGain: plan.netGain,
    });
  }

  /** Libère un engagement : rien n'avait été débité ni bloqué dans `wallets` (D-080). */
  private async release(tx: SqlExecutor, r: GameReservationRow, now: Date): Promise<void> {
    await tx.query(
      `UPDATE wallet_reservations SET status = 'RELEASED', released_at = $2 WHERE id = $1`,
      [r.id, iso(now)],
    );
  }

  /**
   * Débite la perte due par un perdant (M ou 2M ≤ engagé) : transaction `game_stake`, solde
   * diminué de la perte seulement. L'engagement couvrait 2M sans toucher `wallets.reserved` :
   * rien d'autre à libérer. Le solde couvre la perte : toute dépense pendant la partie a été
   * bornée par l'engagement (sinon la contrainte `balance >= 0` annule le règlement).
   */
  private async capture(
    tx: SqlExecutor,
    game: Game,
    r: GameReservationRow,
    amount: number,
    now: Date,
  ): Promise<void> {
    await lockWalletBalances(tx, r.wallet_id, now);
    const transactionId = randomUUID();
    await tx.query(
      `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
         game_id, created_at, updated_at, completed_at)
       VALUES ($1, $2, 'game_stake', 'succeeded', $3, $4, $5, $6, $6, $6)`,
      [transactionId, r.wallet_id, amount, `game-stake:${game.id}`, game.id, iso(now)],
    );
    await tx.query(
      'UPDATE wallets SET balance = balance - $2, updated_at = $3 WHERE user_id = $1',
      [r.wallet_id, amount, iso(now)],
    );
    await tx.query(
      `UPDATE wallet_reservations SET status = 'CAPTURED', captured_at = $2,
         capture_transaction_id = $3, captured_amount = $4
       WHERE id = $1`,
      [r.id, iso(now), transactionId, amount],
    );
  }

  /** Gain net du gagnant (aucune ligne si la commission absorbe tout : taux de 100 %). */
  private async creditWinner(
    tx: SqlExecutor,
    game: Game,
    plan: GameSettlementPlan,
    now: Date,
  ): Promise<void> {
    if (plan.netGain <= 0) return;
    const userId = plan.winnerId as string as UserId;
    await lockWalletBalances(tx, userId, now);
    await tx.query(
      `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
         game_id, created_at, updated_at, completed_at)
       VALUES ($1, $2, 'game_winnings', 'succeeded', $3, $4, $5, $6, $6, $6)`,
      [randomUUID(), userId, plan.netGain, `game-winnings:${game.id}`, game.id, iso(now)],
    );
    await tx.query(
      'UPDATE wallets SET balance = balance + $2, updated_at = $3 WHERE user_id = $1',
      [userId, plan.netGain, iso(now)],
    );
  }
}
