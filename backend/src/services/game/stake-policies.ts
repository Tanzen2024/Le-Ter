import type { Game } from '../../domain/game/game';
import type { PlayerId } from '../../domain/game/game-id';
import {
  hasBalanceForStake,
  InsufficientBalanceForStakeError,
  InvalidGameStakeError,
  isValidGameStake,
} from '../../domain/rules/stake';
import type { SessionId } from '../../domain/sessions/session';
import type { UserId } from '../../domain/users/user';
import type {
  SessionAdmissionPolicy,
  SessionContinuationPolicy,
} from '../sessions/session.service';
import type { GameStakePolicy } from './game.service';

/**
 * Mise des parties ORDINAIRES (D-073) : une partie n'est créée ou rejointe que si sa mise est
 * un entier > 0 et si le solde DISPONIBLE du joueur (compte de jeu, solde − réservations de
 * tournoi) est au moins le double de la mise. Mise et solde sont relus côté serveur (partie
 * enregistrée, PostgreSQL), jamais pris dans la requête.
 *
 * Aucun mouvement de jetons n'est effectué : la mise reste indicative tant que son règlement
 * n'est pas défini (D-039, R-13, R-37). Les tables de tournoi en sont exclues : elles se jouent
 * en jetons de tournoi, avec leur propre seuil (D-063).
 */
export interface StakeBalanceReader {
  getBalances(userId: UserId): Promise<{ available: number }>;
}

export interface StakePolicyDependencies {
  wallets: StakeBalanceReader;
  /** Tournoi auquel la session appartient, ou null pour une table ordinaire. */
  tournamentOfSession(sessionId: SessionId): Promise<unknown>;
}

async function isTournamentTable(
  deps: StakePolicyDependencies,
  sessionId: SessionId | undefined,
): Promise<boolean> {
  return sessionId !== undefined && (await deps.tournamentOfSession(sessionId)) !== null;
}

/** Refus explicite si la mise est invalide ou le solde disponible insuffisant. */
async function assertStakeCovered(
  wallets: StakeBalanceReader,
  playerId: PlayerId,
  stake: unknown,
): Promise<void> {
  if (!isValidGameStake(stake)) throw new InvalidGameStakeError(stake);
  const { available } = await wallets.getBalances(playerId as string as UserId);
  if (!hasBalanceForStake(available, stake)) throw new InsufficientBalanceForStakeError(stake);
}

/** Création et participation (GameService) : mise de LA partie, solde du joueur. */
export function walletGameStakePolicy(deps: StakePolicyDependencies): GameStakePolicy {
  return {
    async assertCanStake(playerId: PlayerId, game: Game): Promise<void> {
      if (await isTournamentTable(deps, game.sessionId)) return;
      await assertStakeCovered(deps.wallets, playerId, game.stakeAmount);
    },
  };
}

/**
 * Arrivée à une table ordinaire (POST /api/sessions/:id/join) : vérifiée AVANT d'occuper un
 * siège, avec la mise de la dernière partie de la table (celle qu'il rejoindra, ou que la
 * suivante reprendra). Sans elle, un joueur refusé à l'entrée de la partie resterait assis.
 */
export function walletSessionStakeAdmission(
  deps: StakePolicyDependencies & {
    /** Mise de la dernière partie de la session ; `null` : aucune partie. */
    lastStakeOfSession(sessionId: SessionId): Promise<number | undefined | null>;
  },
): SessionAdmissionPolicy {
  return {
    async assertCanJoin(sessionId: SessionId, playerId: PlayerId): Promise<void> {
      if (await isTournamentTable(deps, sessionId)) return;
      const stake = await deps.lastStakeOfSession(sessionId);
      if (stake === null) return; // aucune partie : l'entrée dans la partie sera vérifiée
      await assertStakeCovered(deps.wallets, playerId, stake);
    },
  };
}

/**
 * Partie suivante d'une table ordinaire (« Poursuivre », D-042) : elle reprend la mise de la
 * précédente. Les joueurs dont le solde disponible ne couvre plus 2 × la mise sont écartés
 * (ils quittent la table par le chemin normal) ; une mise invalide (table antérieure à
 * D-073) écarte tout le monde : aucune partie n'est créée sans mise.
 */
export function walletStakeContinuation(deps: StakePolicyDependencies): SessionContinuationPolicy {
  return {
    allowsNewGame: async () => true,
    async playersBarredFromNextGame(sessionId, playerIds, previous) {
      if (await isTournamentTable(deps, sessionId)) return [];
      const barred: PlayerId[] = [];
      for (const playerId of playerIds) {
        try {
          await assertStakeCovered(deps.wallets, playerId, previous.stakeAmount);
        } catch (err) {
          if (
            !(err instanceof InvalidGameStakeError) &&
            !(err instanceof InsufficientBalanceForStakeError)
          ) {
            throw err;
          }
          barred.push(playerId);
        }
      }
      return barred;
    },
  };
}

/** Toutes les politiques d'arrivée doivent accepter (la première qui refuse lève). */
export function allSessionAdmissions(
  ...policies: SessionAdmissionPolicy[]
): SessionAdmissionPolicy {
  return {
    async assertCanJoin(sessionId, playerId) {
      for (const policy of policies) await policy.assertCanJoin(sessionId, playerId);
    },
  };
}

/**
 * Politiques de continuation combinées : une nouvelle partie n'est permise que si toutes la
 * permettent ; un joueur écarté par l'une est écarté ; chaque refus est signalé par sa politique.
 */
export function allSessionContinuations(
  ...policies: SessionContinuationPolicy[]
): SessionContinuationPolicy {
  return {
    async allowsNewGame(sessionId) {
      for (const policy of policies) {
        if (!(await policy.allowsNewGame(sessionId))) return false;
      }
      return true;
    },
    async onNewGameRefused(sessionId, playerIds) {
      for (const policy of policies) await policy.onNewGameRefused?.(sessionId, playerIds);
    },
    async playersBarredFromNextGame(sessionId, playerIds, previous) {
      const barred = new Set<PlayerId>();
      for (const policy of policies) {
        const ids = (await policy.playersBarredFromNextGame?.(sessionId, playerIds, previous)) ?? [];
        ids.forEach((id) => barred.add(id));
      }
      return playerIds.filter((id) => barred.has(id));
    },
  };
}
