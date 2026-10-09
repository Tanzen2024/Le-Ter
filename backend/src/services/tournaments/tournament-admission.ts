import type { PlayerId } from '../../domain/game/game-id';
import type { SessionId } from '../../domain/sessions/session';
import {
  canPlayTournamentGame,
  TournamentAccessDeniedError,
  type TournamentId,
} from '../../domain/tournaments/tournament';
import type { UserId } from '../../domain/users/user';
import type { TournamentRepository } from '../../repositories/tournament.repository';
import type {
  SessionAdmissionPolicy,
  SessionContinuationPolicy,
} from '../sessions/session.service';

/**
 * Règlement des parties terminées d'un tournoi encore non réglées (TournamentService,
 * idempotent). Appelé AVANT toute lecture de jetons pour une décision d'accès : sans lui, une
 * partie tout juste finie (règlement en arrière-plan) laisserait lire un solde périmé.
 * Fourni après coup : TournamentService est construit après SessionService.
 */
export type SettlePendingGames = (tournamentId: TournamentId) => Promise<unknown>;

/**
 * Accès direct à une session (POST /api/sessions/:id/join, D-051, D-054) : une table de
 * tournoi n'admet qu'un PARTICIPANT du tournoi EN COURS (compte de tournoi créé à la capture)
 * au-dessus du seuil de participation (D-063). Une table ordinaire n'est pas concernée. Ne
 * dépend que du dépôt : elle est fournie à SessionService, construit avant TournamentService.
 */
export function tournamentSessionAdmission(
  tournaments: TournamentRepository,
  clock: () => Date = () => new Date(),
  settlePending?: SettlePendingGames,
): SessionAdmissionPolicy {
  return {
    async assertCanJoin(sessionId: SessionId, playerId: PlayerId): Promise<void> {
      const tournamentId = await tournaments.findTournamentOfSession(sessionId);
      if (!tournamentId) return;
      const t = await tournaments.findById(tournamentId);
      const live =
        t !== null && t.status === 'IN_PROGRESS' && clock().getTime() < t.endsAt.getTime();
      if (live) await settlePending?.(tournamentId);
      const account = live ? await tournaments.findAccount(tournamentId, playerId) : null;
      if (!t || !account || !canPlayTournamentGame(account.currentTokens, t.stakePerGame)) {
        throw new TournamentAccessDeniedError(sessionId);
      }
    },
  };
}

/**
 * Nouvelles parties aux tables d'un tournoi (D-056) : permises seulement pendant le tournoi
 * (IN_PROGRESS et avant `ends_at`). Après, aucune partie n'est créée (elle ne compterait pas) ;
 * les parties déjà commencées se terminent et sont réglées dans le délai de grâce de D-054.
 * Les joueurs encore assis sont informés une fois par table (notification dédoublonnée).
 * Une table ordinaire n'est pas concernée.
 */
export function tournamentTableContinuation(
  tournaments: TournamentRepository,
  clock: () => Date = () => new Date(),
  settlePending?: SettlePendingGames,
): SessionContinuationPolicy {
  return {
    async allowsNewGame(sessionId: SessionId): Promise<boolean> {
      const tournamentId = await tournaments.findTournamentOfSession(sessionId);
      if (!tournamentId) return true;
      const t = await tournaments.findById(tournamentId);
      return t !== null && t.status === 'IN_PROGRESS' && clock().getTime() < t.endsAt.getTime();
    },
    /**
     * Seuil de participation (D-063) à chaque partie suivante d'une table de tournoi : la
     * partie précédente est d'abord réglée (jetons à jour), puis tout joueur présent sous le
     * seuil, ou sans compte du tournoi, est écarté (il quitte la table, reste classé).
     */
    async playersBarredFromNextGame(sessionId: SessionId, playerIds: PlayerId[]) {
      const tournamentId = await tournaments.findTournamentOfSession(sessionId);
      if (!tournamentId) return [];
      const t = await tournaments.findById(tournamentId);
      if (!t) return [];
      await settlePending?.(tournamentId);
      const barred: PlayerId[] = [];
      for (const playerId of playerIds) {
        const account = await tournaments.findAccount(tournamentId, playerId);
        if (!account || !canPlayTournamentGame(account.currentTokens, t.stakePerGame)) {
          barred.push(playerId);
        }
      }
      return barred;
    },
    async onNewGameRefused(sessionId: SessionId, playerIds: PlayerId[]): Promise<void> {
      const tournamentId = await tournaments.findTournamentOfSession(sessionId);
      if (!tournamentId) return;
      const t = await tournaments.findById(tournamentId);
      if (!t) return;
      await tournaments.transaction((uow) =>
        uow.notify(
          playerIds.map((playerId) => ({
            userId: playerId as string as UserId,
            type: 'TOURNAMENT_TABLE_CLOSED' as const,
            dedupeKey: `table-closed:${sessionId}`,
            payload: { tournamentId, startsAt: t.startsAt.toISOString(), sessionId },
          })),
          clock(),
        ),
      );
    },
  };
}
