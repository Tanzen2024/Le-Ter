import { randomUUID } from 'node:crypto';

import {
  isPgError,
  PG_UNIQUE_VIOLATION,
  type SqlClient,
  type SqlExecutor,
} from '../database/sql-client';
import type { GameId, PlayerId } from '../domain/game/game-id';
import type { SessionId } from '../domain/sessions/session';
import {
  AlreadyRegisteredError,
  BLOCKING_STATUSES,
  DEFAULT_TOURNAMENT_SETTINGS,
  PRE_REGISTRATION_STATUSES,
  REGISTRATION_LIMIT_STATUSES,
  TournamentOverlapError,
  WAITING_STATUSES,
  type CancellationReason,
  type PrizeRule,
  type RankingMethod,
  type RankingTieBreak,
  type Tournament,
  type TournamentGameTally,
  type TournamentId,
  type TournamentPlayerAccount,
  type TournamentRegistration,
  type TournamentSettings,
  type TournamentSettlementRule,
  type TournamentStatus,
} from '../domain/tournaments/tournament';
import type { UserId } from '../domain/users/user';
import type {
  ActiveRegistration,
  AdminTournamentListItem,
  AppNotification,
  NotificationDraft,
  RegistrationListItem,
  ResultDraft,
  ResultsHistoryItem,
  TournamentGameSettlement,
  TournamentRepository,
  TournamentResultRow,
  TournamentUnitOfWork,
  TournamentPayoutState,
} from './tournament.repository';
import {
  captureReservation,
  creditTournamentPrize,
  releaseReservation,
  reserveFunds,
  type WalletReservation,
} from './wallet-reservations';
import { queryTournamentLedgerFacts } from './postgres-admin-query.repository';
import type { TournamentLedgerFacts } from './admin-query.repository';
import type {
  TournamentPayout,
  TournamentPayoutDraft,
} from '../domain/tournaments/tournament-payouts';

const PG_EXCLUSION_VIOLATION = '23P01';
const OVERLAP_CONSTRAINT = 'tournaments_no_overlap';
const REGISTRATION_UNIQUE = 'tournament_registrations_unique';

/** Statuts considérés « en cours ou en clôture » (tournoi mis en avant en priorité). */
const LIVE: TournamentStatus[] = [
  'STARTING',
  'IN_PROGRESS',
  'CALCULATING_RESULTS',
  'RESULTS_VALIDATED',
  'DISTRIBUTING_PRIZES',
];
const UPCOMING: TournamentStatus[] = ['SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];

/** Clé du verrou consultatif de la planification des tournois (D-059), distincte du migrateur. */
const TOURNAMENT_SCHEDULE_LOCK_KEY = 728_302_059;

type Num = string | number;
const num = (v: Num | null | undefined) => (v === null || v === undefined ? undefined : Number(v));
const date = (v: Date | string | null | undefined) => (v ? new Date(v) : undefined);
const iso = (d: Date | undefined) => d?.toISOString() ?? null;

interface TournamentRow {
  id: TournamentId;
  version: number;
  status: TournamentStatus;
  creator_type: 'ADMIN' | 'PLAYER';
  creator_id: UserId | null;
  timezone: string;
  starts_at: Date;
  ends_at: Date;
  registration_opens_at: Date | null;
  registration_closes_at: Date | null;
  blocked_until: Date | null;
  entry_fee: Num;
  currency: 'XAF';
  minimum_players: number;
  maximum_players: number | null;
  platform_fee_bps: number | null;
  ranking_tokens_weight_bps: number | null;
  ranking_games_weight_bps: number | null;
  ranking_method: RankingMethod | null;
  ranking_games_reference: number | null;
  settlement_rule: TournamentSettlementRule | null;
  initial_tournament_tokens: number;
  stake_per_game: number;
  token_setup_frozen_at: Date | null;
  cancellation_reason: CancellationReason | null;
  cancelled_at: Date | null;
  published_at: Date | null;
  approved_by: UserId | null;
  started_at: Date | null;
  results_at: Date | null;
  completed_at: Date | null;
  participants: number | null;
  gross_pool: Num | null;
  platform_fee: Num | null;
  prize_pool: Num | null;
  unallocated_prize: Num | null;
  created_at: Date;
  updated_at: Date;
  prize_rules: PrizeRule[] | null;
}

const SELECT_TOURNAMENT = `SELECT t.*,
  (SELECT COALESCE(json_agg(json_build_object('rank', r.rank, 'shareBps', r.share_bps)
     ORDER BY r.rank), '[]'::json)
   FROM tournament_prize_rules r WHERE r.tournament_id = t.id) AS prize_rules
  FROM tournaments t`;

function toTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    version: Number(row.version),
    status: row.status,
    creatorType: row.creator_type,
    ...(row.creator_id && { creatorId: row.creator_id }),
    timezone: row.timezone,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    ...(row.registration_opens_at && { registrationOpensAt: date(row.registration_opens_at) }),
    ...(row.registration_closes_at && { registrationClosesAt: date(row.registration_closes_at) }),
    ...(row.blocked_until && { blockedUntil: date(row.blocked_until) }),
    entryFee: Number(row.entry_fee),
    currency: row.currency,
    minimumPlayers: Number(row.minimum_players),
    ...(row.maximum_players !== null && { maximumPlayers: Number(row.maximum_players) }),
    ...(row.platform_fee_bps !== null && { platformFeeBps: Number(row.platform_fee_bps) }),
    ...(row.ranking_tokens_weight_bps !== null &&
      row.ranking_games_weight_bps !== null && {
        rankingWeights: {
          tokensBps: Number(row.ranking_tokens_weight_bps),
          gamesBps: Number(row.ranking_games_weight_bps),
        },
      }),
    ...(row.ranking_method && { rankingMethod: row.ranking_method }),
    ...(row.ranking_games_reference !== null && {
      rankingGamesReference: Number(row.ranking_games_reference),
    }),
    ...(row.settlement_rule && { settlementRule: row.settlement_rule }),
    initialTournamentTokens: Number(row.initial_tournament_tokens),
    stakePerGame: Number(row.stake_per_game),
    ...(row.token_setup_frozen_at && { tokenSetupFrozenAt: date(row.token_setup_frozen_at) }),
    prizeRules: (row.prize_rules ?? []).map((r) => ({
      rank: Number(r.rank),
      shareBps: Number(r.shareBps),
    })),
    ...(row.cancellation_reason && { cancellationReason: row.cancellation_reason }),
    ...(row.cancelled_at && { cancelledAt: date(row.cancelled_at) }),
    ...(row.published_at && { publishedAt: date(row.published_at) }),
    ...(row.approved_by && { approvedBy: row.approved_by }),
    ...(row.started_at && { startedAt: date(row.started_at) }),
    ...(row.results_at && { resultsAt: date(row.results_at) }),
    ...(row.completed_at && { completedAt: date(row.completed_at) }),
    ...(row.participants !== null && { participants: Number(row.participants) }),
    ...(row.gross_pool !== null && { grossPool: num(row.gross_pool) }),
    ...(row.platform_fee !== null && { platformFee: num(row.platform_fee) }),
    ...(row.prize_pool !== null && { prizePool: num(row.prize_pool) }),
    ...(row.unallocated_prize !== null && { unallocatedPrize: num(row.unallocated_prize) }),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

interface RegistrationRow {
  id: string;
  tournament_id: TournamentId;
  user_id: UserId;
  status: TournamentRegistration['status'];
  registered_at: Date;
  cancelled_at: Date | null;
}

function toRegistration(row: RegistrationRow): TournamentRegistration {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    userId: row.user_id,
    status: row.status,
    registeredAt: new Date(row.registered_at),
    ...(row.cancelled_at && { cancelledAt: new Date(row.cancelled_at) }),
  };
}

interface AccountRow {
  id: string;
  tournament_id: TournamentId;
  player_id: UserId;
  registration_id: string;
  registered_at: Date;
  initial_tokens: number;
  current_tokens: number;
  games_played: number;
  games_won: number;
  rank: number | null;
  prize_amount: Num;
  status: TournamentPlayerAccount['status'];
  finished_at: Date | null;
  username?: string;
}

function toAccount(row: AccountRow): TournamentPlayerAccount {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    playerId: row.player_id,
    registrationId: row.registration_id,
    registeredAt: new Date(row.registered_at),
    initialTokens: Number(row.initial_tokens),
    currentTokens: Number(row.current_tokens),
    gamesPlayed: Number(row.games_played),
    gamesWon: Number(row.games_won),
    ...(row.rank !== null && { rank: Number(row.rank) }),
    prizeAmount: Number(row.prize_amount),
    status: row.status,
    ...(row.finished_at && { finishedAt: new Date(row.finished_at) }),
  };
}

interface ReservationRow {
  id: string;
  wallet_id: UserId;
  tournament_id: string;
  registration_id: string;
  amount: Num;
  currency: 'XAF';
  status: WalletReservation['status'];
  capture_transaction_id: string | null;
  created_at: Date;
  captured_at: Date | null;
  released_at: Date | null;
}

function toReservation(row: ReservationRow): WalletReservation {
  return {
    id: row.id,
    walletId: row.wallet_id,
    tournamentId: row.tournament_id,
    registrationId: row.registration_id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    ...(row.capture_transaction_id && { captureTransactionId: row.capture_transaction_id }),
    createdAt: new Date(row.created_at),
    ...(row.captured_at && { capturedAt: new Date(row.captured_at) }),
    ...(row.released_at && { releasedAt: new Date(row.released_at) }),
  };
}

interface ResultRow {
  tournament_id: TournamentId;
  rank: number;
  player_id: UserId;
  username: string;
  initial_tokens: number;
  remaining_tokens: number;
  games_played: number;
  games_won: number;
  prize_share_bps: number;
  prize_amount: Num;
  prize_transaction_id: string | null;
  paid_at: Date | null;
  score: Num | null;
  created_at: Date;
  ranking_method: RankingMethod | null;
  tokens_ratio: Num | null;
  games_ratio: Num | null;
  tokens_weight_bps: number | null;
  games_weight_bps: number | null;
  games_reference: number | null;
  tie_break: RankingTieBreak | null;
  registered_at: Date | null;
}

function toResultRow(r: ResultRow): TournamentResultRow {
  return {
    tournamentId: r.tournament_id,
    rank: Number(r.rank),
    playerId: r.player_id,
    username: r.username,
    initialTokens: Number(r.initial_tokens),
    remainingTokens: Number(r.remaining_tokens),
    gamesPlayed: Number(r.games_played),
    gamesWon: Number(r.games_won),
    ...(r.score !== null && { score: Number(r.score) }),
    prizeShareBps: Number(r.prize_share_bps),
    prizeAmount: Number(r.prize_amount),
    ...(r.prize_transaction_id && { prizeTransactionId: r.prize_transaction_id }),
    ...(r.paid_at && { paidAt: new Date(r.paid_at) }),
    createdAt: new Date(r.created_at),
    ...(r.ranking_method && { rankingMethod: r.ranking_method }),
    ...(r.tokens_ratio !== null && { tokensRatio: Number(r.tokens_ratio) }),
    ...(r.games_ratio !== null && { gamesRatio: Number(r.games_ratio) }),
    ...(r.tokens_weight_bps !== null && { tokensWeightBps: Number(r.tokens_weight_bps) }),
    ...(r.games_weight_bps !== null && { gamesWeightBps: Number(r.games_weight_bps) }),
    ...(r.games_reference !== null && { gamesReference: Number(r.games_reference) }),
    ...(r.tie_break && { tieBreak: r.tie_break }),
    ...(r.registered_at && { registeredAt: new Date(r.registered_at) }),
  };
}

interface PayoutRow {
  tournament_id: TournamentId;
  rank: number;
  player_id: string;
  amount: Num;
  idempotency_key: string;
  status: TournamentPayout['status'];
  wallet_transaction_id: string | null;
  attempts: number;
  last_error: string | null;
  last_attempt_at: Date | null;
  created_at: Date;
  credited_at: Date | null;
}

function toPayout(r: PayoutRow): TournamentPayout {
  return {
    tournamentId: r.tournament_id,
    rank: Number(r.rank),
    playerId: r.player_id,
    amount: Number(r.amount),
    idempotencyKey: r.idempotency_key,
    status: r.status,
    ...(r.wallet_transaction_id && { walletTransactionId: r.wallet_transaction_id }),
    attempts: Number(r.attempts),
    ...(r.last_error && { lastError: r.last_error }),
    ...(r.last_attempt_at && { lastAttemptAt: new Date(r.last_attempt_at) }),
    createdAt: new Date(r.created_at),
    ...(r.credited_at && { creditedAt: new Date(r.credited_at) }),
  };
}

const SETTING_KEYS: Record<keyof TournamentSettings, string> = {
  platformFeePercent: 'tournament_platform_fee_percent',
  initialTokensCoefficient: 'tournament_initial_tokens_coefficient',
  stakePerGameCoefficient: 'tournament_stake_per_game_coefficient',
  maximumPendingTournamentsPerPlayer: 'maximum_pending_tournaments_per_player',
  tournamentTransitionMinutes: 'tournament_transition_minutes',
  rankingTokensWeightPercent: 'tournament_ranking_tokens_weight_percent',
  rankingGamesWeightPercent: 'tournament_ranking_games_weight_percent',
  tournamentMinimumPlayers: 'tournament_minimum_players',
  tournamentMaximumPlayers: 'tournament_maximum_players',
  tournamentMinimumDurationMinutes: 'tournament_minimum_duration_minutes',
  tournamentMaximumDurationMinutes: 'tournament_maximum_duration_minutes',
  tournamentMinimumEntryFee: 'tournament_minimum_entry_fee',
};

/**
 * Bilan par joueur des parties réglées d'un tournoi (D-106), toutes ses tables confondues :
 * seules les parties TERMINÉES, rattachées à CE tournoi (`games.tournament_id`) et réglées
 * SETTLED comptent (ni partie ordinaire, ni partie d'un autre tournoi, ni partie annulée ou
 * VOID). Les participants d'une partie sont les clés de `transfers` (un compte par joueur
 * assis, écrit une seule fois au règlement) : chaque partie compte une fois par joueur.
 */
async function tallySettledGames(
  db: SqlExecutor,
  id: TournamentId,
): Promise<Map<string, TournamentGameTally>> {
  const { rows } = await db.query<{
    player_id: string;
    games_played: number;
    games_won: number;
    token_delta: number;
  }>(
    `SELECT e.key AS player_id,
            count(DISTINCT tg.game_id)::int AS games_played,
            count(DISTINCT tg.game_id) FILTER (WHERE tg.winner_id::text = e.key)::int
              AS games_won,
            COALESCE(sum(e.value::int), 0)::int AS token_delta
       FROM tournament_games tg
       JOIN games g ON g.id = tg.game_id AND g.tournament_id = tg.tournament_id
        AND g.status = 'finished'
      CROSS JOIN LATERAL jsonb_each_text(tg.transfers) e
      WHERE tg.tournament_id = $1 AND tg.status = 'SETTLED'
      GROUP BY e.key`,
    [id],
  );
  return new Map(
    rows.map((r) => [
      r.player_id,
      {
        gamesPlayed: Number(r.games_played),
        gamesWon: Number(r.games_won),
        tokenDelta: Number(r.token_delta),
      },
    ]),
  );
}

async function readSettings(db: SqlExecutor): Promise<TournamentSettings> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM system_settings WHERE key = ANY($1::text[])`,
    [Object.values(SETTING_KEYS)],
  );
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const settings = { ...DEFAULT_TOURNAMENT_SETTINGS };
  for (const [field, key] of Object.entries(SETTING_KEYS) as [keyof TournamentSettings, string][]) {
    const value = byKey.get(key);
    if (typeof value === 'number' && Number.isFinite(value)) settings[field] = value;
    // JSON `null` enregistré : aucun plafond de joueurs (∞).
    else if (value === null && field === 'tournamentMaximumPlayers') settings[field] = null;
  }
  return settings;
}

function translateWrite(err: unknown): unknown {
  if (isPgError(err, PG_EXCLUSION_VIOLATION) && constraintOf(err) === OVERLAP_CONSTRAINT) {
    return new TournamentOverlapError();
  }
  return err;
}

function constraintOf(err: unknown): string | undefined {
  const c = (err as { constraint?: unknown }).constraint;
  return typeof c === 'string' ? c : undefined;
}

class PostgresTournamentUnitOfWork implements TournamentUnitOfWork {
  constructor(private readonly tx: SqlExecutor) {}

  async lockTournament(id: TournamentId): Promise<Tournament | null> {
    const locked = await this.tx.query<{ id: string }>(
      'SELECT id FROM tournaments WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!locked.rows[0]) return null;
    const { rows } = await this.tx.query<TournamentRow>(`${SELECT_TOURNAMENT} WHERE t.id = $1`, [
      id,
    ]);
    return rows[0] ? toTournament(rows[0]) : null;
  }

  async insertTournament(t: Tournament): Promise<void> {
    try {
      await this.tx.query(
        `INSERT INTO tournaments (id, version, status, creator_type,
           creator_id, timezone, starts_at, ends_at, registration_opens_at,
           registration_closes_at, blocked_until, entry_fee, currency, minimum_players,
           maximum_players, platform_fee_bps, initial_tournament_tokens, stake_per_game,
           published_at, approved_by, created_at, updated_at, ranking_tokens_weight_bps,
           ranking_games_weight_bps)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'XAF', $12, $13, $14,
           $15, $16, $17, $18, $19, $19, $20, $21)`,
        [
          t.id,
          t.status,
          t.creatorType,
          t.creatorId ?? null,
          t.timezone,
          t.startsAt.toISOString(),
          t.endsAt.toISOString(),
          iso(t.registrationOpensAt),
          iso(t.registrationClosesAt),
          iso(t.blockedUntil),
          t.entryFee,
          t.minimumPlayers,
          t.maximumPlayers ?? null,
          t.platformFeeBps ?? null,
          t.initialTournamentTokens,
          t.stakePerGame,
          iso(t.publishedAt),
          t.approvedBy ?? null,
          t.createdAt.toISOString(),
          t.rankingWeights?.tokensBps ?? null,
          t.rankingWeights?.gamesBps ?? null,
        ],
      );
    } catch (err) {
      throw translateWrite(err);
    }
    await this.writePrizeRules(t);
  }

  async saveTournament(t: Tournament): Promise<Tournament> {
    try {
      await this.tx.query(
        `UPDATE tournaments SET version = version + 1, status = $2,
           timezone = $3, starts_at = $4, ends_at = $5, registration_opens_at = $6,
           registration_closes_at = $7, blocked_until = $8, entry_fee = $9,
           minimum_players = $10, maximum_players = $11, platform_fee_bps = $12,
           initial_tournament_tokens = $13, stake_per_game = $14, cancellation_reason = $15,
           cancelled_at = $16, published_at = $17, approved_by = $18, started_at = $19,
           results_at = $20, completed_at = $21, participants = $22, gross_pool = $23,
           platform_fee = $24, prize_pool = $25, unallocated_prize = $26, updated_at = $27,
           ranking_tokens_weight_bps = $28, ranking_games_weight_bps = $29,
           ranking_method = $30, ranking_games_reference = $31, settlement_rule = $32
         WHERE id = $1`,
        [
          t.id,
          t.status,
          t.timezone,
          t.startsAt.toISOString(),
          t.endsAt.toISOString(),
          iso(t.registrationOpensAt),
          iso(t.registrationClosesAt),
          iso(t.blockedUntil),
          t.entryFee,
          t.minimumPlayers,
          t.maximumPlayers ?? null,
          t.platformFeeBps ?? null,
          t.initialTournamentTokens,
          t.stakePerGame,
          t.cancellationReason ?? null,
          iso(t.cancelledAt),
          iso(t.publishedAt),
          t.approvedBy ?? null,
          iso(t.startedAt),
          iso(t.resultsAt),
          iso(t.completedAt),
          t.participants ?? null,
          t.grossPool ?? null,
          t.platformFee ?? null,
          t.prizePool ?? null,
          t.unallocatedPrize ?? null,
          t.updatedAt.toISOString(),
          t.rankingWeights?.tokensBps ?? null,
          t.rankingWeights?.gamesBps ?? null,
          t.rankingMethod ?? null,
          t.rankingGamesReference ?? null,
          t.settlementRule ?? null,
        ],
      );
    } catch (err) {
      throw translateWrite(err);
    }
    await this.writePrizeRules(t);
    return { ...t, version: t.version + 1 };
  }

  private async writePrizeRules(t: Tournament): Promise<void> {
    await this.tx.query('DELETE FROM tournament_prize_rules WHERE tournament_id = $1', [t.id]);
    for (const rule of t.prizeRules) {
      await this.tx.query(
        'INSERT INTO tournament_prize_rules (tournament_id, rank, share_bps) VALUES ($1, $2, $3)',
        [t.id, rule.rank, rule.shareBps],
      );
    }
  }

  async countActiveRegistrations(id: TournamentId): Promise<number> {
    return countActiveRegistrations(this.tx, id);
  }

  async countPendingByCreator(creatorId: UserId): Promise<number> {
    const { rows } = await this.tx.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM tournaments
       WHERE creator_id = $1 AND status IN ('DRAFT', 'PENDING_APPROVAL')`,
      [creatorId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async lockSchedule(): Promise<void> {
    await this.tx.query('SELECT pg_advisory_xact_lock($1)', [TOURNAMENT_SCHEDULE_LOCK_KEY]);
  }

  /** Miroir SQL de `countsTowardRegistrationLimit` (domaine, D-113). */
  async countWaitingTournaments(now: Date, excludeId?: TournamentId): Promise<number> {
    const { rows } = await this.tx.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM tournaments
       WHERE (status = ANY($1::text[])
              OR (status = ANY($2::text[])
                  AND COALESCE(registration_closes_at, starts_at) > $3::timestamptz))
         AND ($4::uuid IS NULL OR id <> $4::uuid)`,
      [REGISTRATION_LIMIT_STATUSES, PRE_REGISTRATION_STATUSES, now.toISOString(), excludeId ?? null],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Même définition que `tournaments_no_overlap` : tstzrange '[)' qui se recouvrent. */
  async findOverlappingPublished(
    slot: { startsAt: Date; blockedUntil: Date },
    excludeId?: TournamentId,
  ): Promise<TournamentId | null> {
    const { rows } = await this.tx.query<{ id: TournamentId }>(
      `SELECT id FROM tournaments
       WHERE status = ANY($1::text[])
         AND starts_at < $3::timestamptz AND blocked_until > $2::timestamptz
         AND ($4::uuid IS NULL OR id <> $4::uuid)
       ORDER BY starts_at, id
       LIMIT 1`,
      [
        BLOCKING_STATUSES,
        slot.startsAt.toISOString(),
        slot.blockedUntil.toISOString(),
        excludeId ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  }

  async freezeTokenSetup(
    id: TournamentId,
    tokens: { initialTournamentTokens: number; stakePerGame: number },
    at: Date,
  ): Promise<void> {
    await this.tx.query(
      `UPDATE tournaments SET version = version + 1, initial_tournament_tokens = $2,
         stake_per_game = $3, token_setup_frozen_at = $4, updated_at = $4
       WHERE id = $1`,
      [id, tokens.initialTournamentTokens, tokens.stakePerGame, at.toISOString()],
    );
  }

  async unfreezeTokenSetup(id: TournamentId): Promise<void> {
    await this.tx.query(
      `UPDATE tournaments SET version = version + 1, token_setup_frozen_at = NULL WHERE id = $1`,
      [id],
    );
  }

  async findRegistration(id: TournamentId, userId: UserId): Promise<TournamentRegistration | null> {
    const { rows } = await this.tx.query<RegistrationRow>(
      `SELECT * FROM tournament_registrations WHERE tournament_id = $1 AND user_id = $2
       FOR UPDATE`,
      [id, userId],
    );
    return rows[0] ? toRegistration(rows[0]) : null;
  }

  async upsertRegistration(r: TournamentRegistration): Promise<TournamentRegistration> {
    try {
      const { rows } = await this.tx.query<RegistrationRow>(
        `INSERT INTO tournament_registrations (id, tournament_id, user_id, status, registered_at)
         VALUES ($1, $2, $3, 'REGISTERED', $4)
         ON CONFLICT (tournament_id, user_id) DO UPDATE
           SET status = 'REGISTERED', registered_at = EXCLUDED.registered_at, cancelled_at = NULL
           WHERE tournament_registrations.status = 'CANCELLED'
         RETURNING *`,
        [r.id, r.tournamentId, r.userId, r.registeredAt.toISOString()],
      );
      if (!rows[0]) throw new AlreadyRegisteredError(r.tournamentId);
      return toRegistration(rows[0]);
    } catch (err) {
      if (isPgError(err, PG_UNIQUE_VIOLATION) && constraintOf(err) === REGISTRATION_UNIQUE) {
        throw new AlreadyRegisteredError(r.tournamentId);
      }
      throw err;
    }
  }

  async cancelRegistration(registrationId: string, now: Date): Promise<void> {
    await this.tx.query(
      `UPDATE tournament_registrations SET status = 'CANCELLED', cancelled_at = $2 WHERE id = $1`,
      [registrationId, now.toISOString()],
    );
  }

  async listActiveRegistrations(id: TournamentId): Promise<ActiveRegistration[]> {
    const { rows } = await this.tx.query<RegistrationRow & { reservation_id: string | null }>(
      `SELECT r.*, w.id AS reservation_id FROM tournament_registrations r
       LEFT JOIN wallet_reservations w
         ON w.registration_id = r.id AND w.status IN ('ACTIVE', 'CAPTURED')
       WHERE r.tournament_id = $1 AND r.status = 'REGISTERED'
       ORDER BY r.registered_at, r.id`,
      [id],
    );
    const result: ActiveRegistration[] = [];
    for (const row of rows) {
      const reservation = row.reservation_id
        ? await this.tx.query<ReservationRow>('SELECT * FROM wallet_reservations WHERE id = $1', [
            row.reservation_id,
          ])
        : null;
      result.push({
        registration: toRegistration(row),
        reservation: reservation?.rows[0] ? toReservation(reservation.rows[0]) : null,
      });
    }
    return result;
  }

  reserve(input: {
    userId: UserId;
    tournamentId: TournamentId;
    registrationId: string;
    amount: number;
    now: Date;
  }): Promise<WalletReservation> {
    return reserveFunds(this.tx, input);
  }

  async release(reservationId: string, now: Date): Promise<boolean> {
    return (await releaseReservation(this.tx, reservationId, now)).changed;
  }

  async countCapturedReservations(id: TournamentId): Promise<number> {
    const { rows } = await this.tx.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM wallet_reservations
       WHERE tournament_id = $1 AND status = 'CAPTURED'`,
      [id],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async capture(reservationId: string, now: Date): Promise<boolean> {
    return (await captureReservation(this.tx, reservationId, now)).changed;
  }

  creditPrize(input: { userId: UserId; amount: number; idempotencyKey: string; now: Date }) {
    return creditTournamentPrize(this.tx, input);
  }

  async recordPlatformEntry(entry: {
    tournamentId: TournamentId;
    kind: 'TOURNAMENT_PLATFORM_FEE' | 'UNALLOCATED_PRIZE';
    amount: number;
    feeBps?: number;
    now: Date;
  }): Promise<void> {
    await this.tx.query(
      `INSERT INTO platform_ledger (id, tournament_id, kind, amount, fee_bps, currency, created_at)
       VALUES ($1, $2, $3, $4, $5, 'XAF', $6)
       ON CONFLICT ON CONSTRAINT platform_ledger_once DO NOTHING`,
      [
        randomUUID(),
        entry.tournamentId,
        entry.kind,
        entry.amount,
        entry.feeBps ?? null,
        entry.now.toISOString(),
      ],
    );
  }

  async insertAccounts(accounts: TournamentPlayerAccount[], now: Date): Promise<void> {
    for (const a of accounts) {
      await this.tx.query(
        `INSERT INTO tournament_player_accounts (id, tournament_id, player_id, registration_id,
           registered_at, initial_tokens, current_tokens, games_played, games_won, prize_amount,
           status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0, $8, $9, $9)
         ON CONFLICT ON CONSTRAINT tournament_player_accounts_once DO NOTHING`,
        [
          a.id,
          a.tournamentId,
          a.playerId,
          a.registrationId,
          a.registeredAt.toISOString(),
          a.initialTokens,
          a.currentTokens,
          a.status,
          now.toISOString(),
        ],
      );
    }
  }

  async lockAccounts(id: TournamentId, playerIds: readonly string[]) {
    const { rows } = await this.tx.query<AccountRow>(
      `SELECT * FROM tournament_player_accounts
       WHERE tournament_id = $1 AND player_id = ANY($2::uuid[])
       ORDER BY player_id FOR UPDATE`,
      [id, [...playerIds]],
    );
    return rows.map(toAccount);
  }

  async listAccounts(id: TournamentId): Promise<TournamentPlayerAccount[]> {
    const { rows } = await this.tx.query<AccountRow>(
      'SELECT * FROM tournament_player_accounts WHERE tournament_id = $1 FOR UPDATE',
      [id],
    );
    return rows.map(toAccount);
  }

  async updateAccount(a: TournamentPlayerAccount, now: Date): Promise<void> {
    await this.tx.query(
      `UPDATE tournament_player_accounts SET current_tokens = $2, games_played = $3,
         games_won = $4, rank = $5, prize_amount = $6, status = $7, updated_at = $8,
         finished_at = $9
       WHERE id = $1`,
      [
        a.id,
        a.currentTokens,
        a.gamesPlayed,
        a.gamesWon,
        a.rank ?? null,
        a.prizeAmount,
        a.status,
        now.toISOString(),
        iso(a.finishedAt),
      ],
    );
  }

  async insertGameSettlement(s: TournamentGameSettlement): Promise<boolean> {
    const { rowCount } = await this.tx.query(
      `INSERT INTO tournament_games (game_id, tournament_id, session_id, status, winner_id, stake,
         pot, transfers, void_reason, settled_at, settlement_rule, victory_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
       ON CONFLICT (game_id) DO NOTHING`,
      [
        s.gameId,
        s.tournamentId,
        s.sessionId,
        s.status,
        s.winnerId ?? null,
        s.stake,
        s.pot,
        JSON.stringify(s.transfers),
        s.voidReason ?? null,
        s.settledAt.toISOString(),
        s.settlementRule,
        s.victoryType ?? null,
      ],
    );
    return rowCount > 0;
  }

  async dissolveAccounts(id: TournamentId, now: Date): Promise<number> {
    // Idempotent : seuls les comptes clos (classement publié) et pas encore dissous.
    const { rowCount } = await this.tx.query(
      `UPDATE tournament_player_accounts
          SET status = 'DISSOLVED', dissolved_at = $2, updated_at = $2
        WHERE tournament_id = $1 AND finished_at IS NOT NULL AND dissolved_at IS NULL`,
      [id, now.toISOString()],
    );
    return rowCount;
  }

  async countActiveGames(id: TournamentId): Promise<number> {
    const { rows } = await this.tx.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM games g
       WHERE g.tournament_id = $1 AND g.status = 'in_progress'`,
      [id],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async countUnsettledFinishedGames(id: TournamentId): Promise<number> {
    const { rows } = await this.tx.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM games g
       WHERE g.tournament_id = $1 AND g.status = 'finished'
         AND NOT EXISTS (SELECT 1 FROM tournament_games tg WHERE tg.game_id = g.id)`,
      [id],
    );
    return Number(rows[0]?.count ?? 0);
  }

  tallySettledGames(id: TournamentId): Promise<Map<string, TournamentGameTally>> {
    return tallySettledGames(this.tx, id);
  }

  async insertResults(id: TournamentId, rows: ResultDraft[], now: Date): Promise<void> {
    for (const r of rows) {
      await this.tx.query(
        `INSERT INTO tournament_results (tournament_id, rank, player_id, initial_tokens,
           remaining_tokens, games_played, games_won, prize_share_bps, prize_amount, created_at,
           score, ranking_method, tokens_ratio, games_ratio, tokens_weight_bps,
           games_weight_bps, games_reference, tie_break, registered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
           $18, $19)
         ON CONFLICT (tournament_id, rank) DO NOTHING`,
        [
          id,
          r.rank,
          r.playerId,
          r.initialTokens,
          r.remainingTokens,
          r.gamesPlayed,
          r.gamesWon,
          r.shareBps,
          r.amount,
          now.toISOString(),
          r.score ?? null,
          r.audit?.rankingMethod ?? null,
          r.audit?.tokensRatio ?? null,
          r.audit?.gamesRatio ?? null,
          r.audit?.tokensWeightBps ?? null,
          r.audit?.gamesWeightBps ?? null,
          r.audit?.gamesReference ?? null,
          r.audit?.tieBreak ?? null,
          iso(r.registeredAt),
        ],
      );
    }
  }

  async lockUnpaidResults(id: TournamentId): Promise<ResultDraft[]> {
    const { rows } = await this.tx.query<{
      rank: number;
      player_id: UserId;
      initial_tokens: number;
      remaining_tokens: number;
      games_played: number;
      games_won: number;
      prize_share_bps: number;
      prize_amount: Num;
      score: Num | null;
    }>(
      `SELECT * FROM tournament_results
       WHERE tournament_id = $1 AND prize_amount > 0 AND paid_at IS NULL
       ORDER BY rank FOR UPDATE`,
      [id],
    );
    return rows.map((r) => ({
      rank: Number(r.rank),
      playerId: r.player_id,
      initialTokens: Number(r.initial_tokens),
      remainingTokens: Number(r.remaining_tokens),
      gamesPlayed: Number(r.games_played),
      gamesWon: Number(r.games_won),
      ...(r.score !== null && { score: Number(r.score) }),
      shareBps: Number(r.prize_share_bps),
      amount: Number(r.prize_amount),
    }));
  }

  async markResultPaid(id: TournamentId, rank: number, transactionId: string, now: Date) {
    await this.tx.query(
      `UPDATE tournament_results SET prize_transaction_id = $3, paid_at = $4
       WHERE tournament_id = $1 AND rank = $2 AND paid_at IS NULL`,
      [id, rank, transactionId, now.toISOString()],
    );
  }

  async listResultPrizes(id: TournamentId) {
    const { rows } = await this.tx.query<{ rank: number; player_id: string; prize_amount: Num }>(
      `SELECT rank, player_id, prize_amount FROM tournament_results
       WHERE tournament_id = $1 ORDER BY rank`,
      [id],
    );
    return rows.map((r) => ({
      rank: Number(r.rank),
      playerId: r.player_id,
      prizeAmount: Number(r.prize_amount),
    }));
  }

  async insertPayouts(id: TournamentId, drafts: TournamentPayoutDraft[], now: Date) {
    for (const d of drafts) {
      await this.tx.query(
        `INSERT INTO tournament_payouts (tournament_id, rank, player_id, amount,
           idempotency_key, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
         ON CONFLICT (tournament_id, rank) DO NOTHING`,
        [id, d.rank, d.playerId, d.amount, d.idempotencyKey, now.toISOString()],
      );
    }
  }

  async lockPayouts(id: TournamentId): Promise<TournamentPayout[]> {
    const { rows } = await this.tx.query<PayoutRow>(
      'SELECT * FROM tournament_payouts WHERE tournament_id = $1 ORDER BY rank FOR UPDATE',
      [id],
    );
    return rows.map(toPayout);
  }

  async lockNextPayout(id: TournamentId, retryBefore: Date): Promise<TournamentPayout | null> {
    const { rows } = await this.tx.query<PayoutRow>(
      `SELECT * FROM tournament_payouts
       WHERE tournament_id = $1
         AND (status = 'PENDING'
              OR (status = 'FAILED' AND (last_attempt_at IS NULL OR last_attempt_at <= $2)))
       ORDER BY rank LIMIT 1 FOR UPDATE`,
      [id, retryBefore.toISOString()],
    );
    return rows[0] ? toPayout(rows[0]) : null;
  }

  async markPayoutCredited(id: TournamentId, rank: number, transactionId: string, now: Date) {
    const { rowCount } = await this.tx.query(
      `UPDATE tournament_payouts SET status = 'CREDITED', wallet_transaction_id = $3,
         credited_at = $4, last_attempt_at = $4, attempts = attempts + 1
       WHERE tournament_id = $1 AND rank = $2 AND status <> 'CREDITED'`,
      [id, rank, transactionId, now.toISOString()],
    );
    if (rowCount !== 1) {
      throw new Error(`Versement introuvable ou déjà crédité (tournoi ${id}, rang ${rank})`);
    }
  }

  async recordPayoutFailure(id: TournamentId, rank: number, error: string, now: Date) {
    await this.tx.query(
      `UPDATE tournament_payouts SET status = 'FAILED', attempts = attempts + 1,
         last_error = $3, last_attempt_at = $4
       WHERE tournament_id = $1 AND rank = $2 AND status <> 'CREDITED'`,
      [id, rank, error.slice(0, 500), now.toISOString()],
    );
  }

  async ledgerFacts(id: TournamentId): Promise<TournamentLedgerFacts | null> {
    const [facts] = await queryTournamentLedgerFacts(this.tx, id);
    return facts ?? null;
  }

  async markPayoutPlanValidated(id: TournamentId, now: Date) {
    await this.tx.query(
      `UPDATE tournaments SET payout_plan_validated_at = COALESCE(payout_plan_validated_at, $2),
         payout_blocked_at = NULL, payout_block_reasons = NULL
       WHERE id = $1`,
      [id, now.toISOString()],
    );
  }

  async blockPayouts(id: TournamentId, reasons: string[], now: Date) {
    await this.tx.query(
      `UPDATE tournaments SET payout_blocked_at = COALESCE(payout_blocked_at, $3),
         payout_block_reasons = $2::text[]
       WHERE id = $1`,
      [id, reasons, now.toISOString()],
    );
  }

  async notify(notifications: NotificationDraft[], now: Date): Promise<void> {
    for (const n of notifications) {
      await this.tx.query(
        `INSERT INTO notifications (id, user_id, type, payload, dedupe_key, created_at, available_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT notifications_once DO NOTHING`,
        [
          randomUUID(),
          n.userId,
          n.type,
          JSON.stringify(n.payload),
          n.dedupeKey,
          now.toISOString(),
          n.availableAt?.toISOString() ?? null,
        ],
      );
    }
  }

  readSettings(): Promise<TournamentSettings> {
    return readSettings(this.tx);
  }

  async writeSettings(settings: TournamentSettings, actorId: UserId, now: Date): Promise<void> {
    for (const [field, key] of Object.entries(SETTING_KEYS) as [
      keyof TournamentSettings,
      string,
    ][]) {
      await this.tx.query(
        `INSERT INTO system_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by`,
        [key, JSON.stringify(settings[field]), now.toISOString(), actorId],
      );
    }
  }

  async audit(entry: {
    actorId: UserId;
    action: string;
    tournamentId?: TournamentId;
    details: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    await this.tx.query(
      `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        randomUUID(),
        entry.actorId,
        entry.action,
        entry.tournamentId ? 'TOURNAMENT' : 'SYSTEM_SETTING',
        entry.tournamentId ?? null,
        JSON.stringify(entry.details),
        entry.now.toISOString(),
      ],
    );
  }
}

async function countActiveRegistrations(db: SqlExecutor, id: TournamentId): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM tournament_registrations
     WHERE tournament_id = $1 AND status = 'REGISTERED'`,
    [id],
  );
  return Number(rows[0]?.count ?? 0);
}

export class PostgresTournamentRepository implements TournamentRepository {
  constructor(private readonly db: SqlClient) {}

  transaction<T>(work: (uow: TournamentUnitOfWork) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new PostgresTournamentUnitOfWork(tx)));
  }

  async findById(id: TournamentId): Promise<Tournament | null> {
    const { rows } = await this.db.query<TournamentRow>(`${SELECT_TOURNAMENT} WHERE t.id = $1`, [
      id,
    ]);
    return rows[0] ? toTournament(rows[0]) : null;
  }

  async findFeatured(now: Date, recentSince: Date): Promise<Tournament | null> {
    const { rows } = await this.db.query<TournamentRow>(
      `${SELECT_TOURNAMENT}
       WHERE t.status = ANY($1::text[])
          OR (t.status = ANY($2::text[]) AND t.ends_at > $3)
          OR (t.status IN ('COMPLETED', 'CANCELLED') AND t.published_at IS NOT NULL
              AND COALESCE(t.completed_at, t.cancelled_at) > $4)
       ORDER BY
         CASE WHEN t.status = ANY($1::text[]) THEN 0
              WHEN t.status = ANY($2::text[]) THEN 1 ELSE 2 END,
         CASE WHEN t.status IN ('COMPLETED', 'CANCELLED') THEN NULL ELSE t.starts_at END
           ASC NULLS LAST,
         COALESCE(t.completed_at, t.cancelled_at) DESC NULLS LAST,
         t.id
       LIMIT 1`,
      [LIVE, UPCOMING, now.toISOString(), recentSince.toISOString()],
    );
    return rows[0] ? toTournament(rows[0]) : null;
  }

  async findNextRegistered(userId: UserId, now: Date): Promise<Tournament | null> {
    const { rows } = await this.db.query<TournamentRow>(
      `${SELECT_TOURNAMENT}
       JOIN tournament_registrations reg ON reg.tournament_id = t.id
       WHERE reg.user_id = $1 AND reg.status = 'REGISTERED'
         AND t.status = ANY($2::text[])
         AND t.starts_at > $3
       ORDER BY t.starts_at ASC, t.id
       LIMIT 1`,
      [userId, WAITING_STATUSES, now.toISOString()],
    );
    return rows[0] ? toTournament(rows[0]) : null;
  }

  async list(filter: {
    statuses?: TournamentStatus[];
    creatorId?: UserId;
    limit: number;
  }): Promise<Tournament[]> {
    const { rows } = await this.db.query<TournamentRow>(
      `${SELECT_TOURNAMENT}
       WHERE ($1::text[] IS NULL OR t.status = ANY($1::text[]))
         AND ($2::uuid IS NULL OR t.creator_id = $2)
       ORDER BY t.starts_at DESC, t.id LIMIT $3`,
      [filter.statuses ?? null, filter.creatorId ?? null, filter.limit],
    );
    return rows.map(toTournament);
  }

  async listPublished(filter: {
    scope: 'current' | 'history';
    limit: number;
    visibleSince?: Date;
  }): Promise<Tournament[]> {
    const history = filter.scope === 'history';
    const since = history && filter.visibleSince ? filter.visibleSince.toISOString() : null;
    const { rows } = await this.db.query<TournamentRow>(
      `${SELECT_TOURNAMENT}
       WHERE (t.published_at IS NOT NULL OR t.status = 'PENDING_APPROVAL')
         AND t.status = ANY($1::text[])
         AND ($3::timestamptz IS NULL
              OR (t.status = 'COMPLETED' AND t.ends_at > $3)
              OR (t.status = 'CANCELLED' AND t.cancelled_at > $3))
       ORDER BY t.starts_at ${history ? 'DESC' : 'ASC'}, t.id
       LIMIT $2`,
      [
        history ? ['COMPLETED', 'CANCELLED'] : ['PENDING_APPROVAL', ...UPCOMING, ...LIVE],
        filter.limit,
        since,
      ],
    );
    return rows.map(toTournament);
  }

  async listForAdmin(filter: {
    statuses?: TournamentStatus[];
    limit: number;
  }): Promise<AdminTournamentListItem[]> {
    const { rows } = await this.db.query<
      TournamentRow & { registered_count: number; creator_name: string | null }
    >(
      `SELECT t.*,
         (SELECT COALESCE(json_agg(json_build_object('rank', r.rank, 'shareBps', r.share_bps)
            ORDER BY r.rank), '[]'::json)
          FROM tournament_prize_rules r WHERE r.tournament_id = t.id) AS prize_rules,
         (SELECT count(*)::int FROM tournament_registrations g
          WHERE g.tournament_id = t.id AND g.status = 'REGISTERED') AS registered_count,
         u.username AS creator_name
       FROM tournaments t LEFT JOIN users u ON u.id = t.creator_id
       WHERE ($1::text[] IS NULL OR t.status = ANY($1::text[]))
       ORDER BY t.created_at DESC, t.id LIMIT $2`,
      [filter.statuses ?? null, filter.limit],
    );
    return rows.map((row) => ({
      tournament: toTournament(row),
      registeredCount: Number(row.registered_count),
      ...(row.creator_name && { creatorName: row.creator_name }),
    }));
  }

  async findDue(now: Date): Promise<TournamentId[]> {
    const { rows } = await this.db.query<{ id: TournamentId }>(
      `SELECT id FROM tournaments WHERE
          (status = 'SCHEDULED' AND COALESCE(registration_opens_at, published_at) <= $1)
       OR (status = 'REGISTRATION_OPEN' AND registration_closes_at <= $1)
       OR (status IN ('DRAFT', 'PENDING_APPROVAL', 'REGISTRATION_CLOSED') AND starts_at <= $1)
       OR (status = 'IN_PROGRESS' AND ends_at <= $1)
       OR status IN ('STARTING', 'CALCULATING_RESULTS', 'RESULTS_VALIDATED', 'DISTRIBUTING_PRIZES')
       ORDER BY starts_at LIMIT 100`,
      [now.toISOString()],
    );
    return rows.map((r) => r.id);
  }

  countActiveRegistrations(id: TournamentId): Promise<number> {
    return countActiveRegistrations(this.db, id);
  }

  async findRegistration(
    id: TournamentId,
    userId: UserId | PlayerId,
  ): Promise<TournamentRegistration | null> {
    const { rows } = await this.db.query<RegistrationRow>(
      'SELECT * FROM tournament_registrations WHERE tournament_id = $1 AND user_id = $2',
      [id, userId],
    );
    return rows[0] ? toRegistration(rows[0]) : null;
  }

  async findActiveReservation(registrationId: string): Promise<WalletReservation | null> {
    const { rows } = await this.db.query<ReservationRow>(
      `SELECT * FROM wallet_reservations WHERE registration_id = $1
       AND status IN ('ACTIVE', 'CAPTURED')`,
      [registrationId],
    );
    return rows[0] ? toReservation(rows[0]) : null;
  }

  async listRegistrations(id: TournamentId): Promise<RegistrationListItem[]> {
    const { rows } = await this.db.query<
      RegistrationRow & {
        username: string;
        reservation_id: string | null;
        amount: Num | null;
        reservation_status: WalletReservation['status'] | null;
      }
    >(
      `SELECT r.*, u.username, w.id AS reservation_id, w.amount, w.status AS reservation_status
       FROM tournament_registrations r JOIN users u ON u.id = r.user_id
       LEFT JOIN LATERAL (SELECT * FROM wallet_reservations x WHERE x.registration_id = r.id
         ORDER BY x.created_at DESC LIMIT 1) w ON true
       WHERE r.tournament_id = $1 ORDER BY r.registered_at, r.id`,
      [id],
    );
    return rows.map((row) => ({
      registration: toRegistration(row),
      username: row.username,
      ...(row.reservation_id && {
        reservation: {
          id: row.reservation_id,
          amount: Number(row.amount),
          status: row.reservation_status!,
        },
      }),
    }));
  }

  async findAccount(
    id: TournamentId,
    playerId: UserId | PlayerId,
  ): Promise<TournamentPlayerAccount | null> {
    const { rows } = await this.db.query<AccountRow>(
      'SELECT * FROM tournament_player_accounts WHERE tournament_id = $1 AND player_id = $2',
      [id, playerId],
    );
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async listAccountsWithNames(id: TournamentId) {
    const { rows } = await this.db.query<AccountRow & { username: string }>(
      `SELECT a.*, u.username FROM tournament_player_accounts a JOIN users u ON u.id = a.player_id
       WHERE a.tournament_id = $1`,
      [id],
    );
    return rows.map((r) => ({ ...toAccount(r), username: r.username }));
  }

  tallySettledGames(id: TournamentId): Promise<Map<string, TournamentGameTally>> {
    return tallySettledGames(this.db, id);
  }

  async findPayoutState(id: TournamentId): Promise<TournamentPayoutState> {
    const [payouts, tournament] = await Promise.all([
      this.db.query<PayoutRow & { username: string }>(
        `SELECT p.*, u.username FROM tournament_payouts p JOIN users u ON u.id = p.player_id
         WHERE p.tournament_id = $1 ORDER BY p.rank`,
        [id],
      ),
      this.db.query<{
        payout_plan_validated_at: Date | null;
        payout_blocked_at: Date | null;
        payout_block_reasons: string[] | null;
      }>(
        `SELECT payout_plan_validated_at, payout_blocked_at, payout_block_reasons
         FROM tournaments WHERE id = $1`,
        [id],
      ),
    ]);
    const t = tournament.rows[0];
    return {
      payouts: payouts.rows.map((r) => ({ ...toPayout(r), username: r.username })),
      ...(t?.payout_plan_validated_at && { planValidatedAt: new Date(t.payout_plan_validated_at) }),
      ...(t?.payout_blocked_at && { blockedAt: new Date(t.payout_blocked_at) }),
      blockReasons: t?.payout_block_reasons ?? [],
    };
  }

  async listResults(id: TournamentId): Promise<TournamentResultRow[]> {
    const { rows } = await this.db.query<ResultRow>(
      `SELECT r.*, u.username FROM tournament_results r JOIN users u ON u.id = r.player_id
       WHERE r.tournament_id = $1 ORDER BY r.rank`,
      [id],
    );
    return rows.map(toResultRow);
  }

  async listResultsHistory(
    userId: UserId,
    page: { limit: number; before?: Date },
  ): Promise<ResultsHistoryItem[]> {
    const { rows } = await this.db.query<
      TournamentRow & { my_rank: number; my_score: Num | null; published_at_results: Date }
    >(
      `SELECT t.*,
         (SELECT COALESCE(json_agg(json_build_object('rank', pr.rank, 'shareBps', pr.share_bps)
            ORDER BY pr.rank), '[]'::json)
          FROM tournament_prize_rules pr WHERE pr.tournament_id = t.id) AS prize_rules,
         r.rank AS my_rank, r.score AS my_score, r.created_at AS published_at_results
       FROM tournament_results r JOIN tournaments t ON t.id = r.tournament_id
       WHERE r.player_id = $1
         AND t.status IN ('RESULTS_VALIDATED', 'DISTRIBUTING_PRIZES', 'COMPLETED')
         AND ($3::timestamptz IS NULL OR t.ends_at < $3)
       ORDER BY t.ends_at DESC, t.id
       LIMIT $2`,
      [userId, page.limit, iso(page.before)],
    );
    return rows.map((row) => ({
      tournament: toTournament(row),
      myRank: Number(row.my_rank),
      ...(row.my_score !== null && { myScore: Number(row.my_score) }),
      resultsPublishedAt: new Date(row.published_at_results),
    }));
  }

  async listIdleTables(
    id: TournamentId,
  ): Promise<{ sessionId: SessionId; playerIds: PlayerId[] }[]> {
    const { rows } = await this.db.query<{ session_id: SessionId; player_ids: PlayerId[] }>(
      `SELECT s.id AS session_id,
         ARRAY(SELECT sp.player_id FROM session_players sp
               WHERE sp.session_id = s.id AND sp.active ORDER BY sp.player_id) AS player_ids
       FROM tournament_sessions ts JOIN sessions s ON s.id = ts.session_id AND s.status = 'open'
       WHERE ts.tournament_id = $1
         AND NOT EXISTS (SELECT 1 FROM games g WHERE g.session_id = s.id
                         AND g.status = 'in_progress')
       ORDER BY ts.created_at, ts.id`,
      [id],
    );
    return rows
      .map((r) => ({ sessionId: r.session_id, playerIds: [...(r.player_ids ?? [])] }))
      .filter((r) => r.playerIds.length > 0);
  }

  async findJoinableSessions(id: TournamentId, limit: number): Promise<SessionId[]> {
    // D-065 : la table la plus remplie d'abord (démarrage au plus tôt), puis la plus ancienne.
    const { rows } = await this.db.query<{ session_id: SessionId }>(
      `SELECT ts.session_id FROM tournament_sessions ts
       JOIN sessions s ON s.id = ts.session_id AND s.status = 'open'
       CROSS JOIN LATERAL (SELECT count(*) AS seated FROM session_players sp
                           WHERE sp.session_id = s.id AND sp.active) occupancy
       WHERE ts.tournament_id = $1
         AND EXISTS (SELECT 1 FROM games g WHERE g.session_id = s.id AND g.status = 'waiting')
         AND occupancy.seated < s.max_players
       ORDER BY occupancy.seated DESC, ts.created_at, ts.id
       LIMIT $2`,
      [id, limit],
    );
    return rows.map((r) => r.session_id);
  }

  async findTournamentOfSession(sessionId: SessionId): Promise<TournamentId | null> {
    const { rows } = await this.db.query<{ tournament_id: TournamentId }>(
      'SELECT tournament_id FROM tournament_sessions WHERE session_id = $1',
      [sessionId],
    );
    return rows[0]?.tournament_id ?? null;
  }

  async findUnsettledFinishedGames(limit: number) {
    const { rows } = await this.db.query<{ game_id: GameId; tournament_id: TournamentId }>(
      `SELECT g.id AS game_id, g.tournament_id FROM games g
       JOIN tournaments t ON t.id = g.tournament_id
       WHERE g.status = 'finished' AND t.status IN ('IN_PROGRESS', 'CALCULATING_RESULTS')
         AND NOT EXISTS (SELECT 1 FROM tournament_games tg WHERE tg.game_id = g.id)
       ORDER BY g.finished_at LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({ gameId: r.game_id, tournamentId: r.tournament_id }));
  }

  readSettings(): Promise<TournamentSettings> {
    return readSettings(this.db);
  }

  async listNotifications(userId: UserId, limit: number, now: Date): Promise<AppNotification[]> {
    // Notification différée (D-117) : invisible avant `available_at`, puis datée de cet instant.
    const { rows } = await this.db.query<{
      id: string;
      type: AppNotification['type'];
      payload: Record<string, unknown>;
      created_at: Date;
      read_at: Date | null;
    }>(
      `SELECT id, type, payload, COALESCE(available_at, created_at) AS created_at, read_at
         FROM notifications
        WHERE user_id = $1 AND (available_at IS NULL OR available_at <= $3)
        ORDER BY COALESCE(available_at, created_at) DESC, id LIMIT $2`,
      [userId, limit, now.toISOString()],
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      payload: r.payload,
      createdAt: new Date(r.created_at),
      ...(r.read_at && { readAt: new Date(r.read_at) }),
    }));
  }

  async markNotificationRead(userId: UserId, notificationId: string, now: Date): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, $3)
        WHERE id = $1 AND user_id = $2 AND (available_at IS NULL OR available_at <= $3)`,
      [notificationId, userId, now.toISOString()],
    );
    return rowCount > 0;
  }
}
