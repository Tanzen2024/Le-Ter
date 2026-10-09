import type { PlayerId } from '../game/game-id';
import type { SessionId } from './session';

/**
 * Événements d'une session (D-033, D-034), même enveloppe que ceux d'une partie : rattachés à
 * UNE session, ordonnés par (version, sequence). Aucune carte n'y figure jamais.
 */
export type SessionEventType =
  | 'session:created'
  | 'session:player_joined'
  /** payload.reason : `leave` (choix du joueur) ou `auto_leave` (sans réponse à l'échéance). */
  | 'session:player_left'
  | 'session:closed'
  /**
   * Dernier départ d'une session sans aucune partie terminée (Q1, D-037) : la session et sa
   * partie en attente sont supprimées.
   */
  | 'session:deleted'
  /** Fin d'une partie : ronde Poursuivre/Quitter ouverte (gameId, deadlineAt, playerIds). */
  | 'session:decision_started'
  /** Un joueur a choisi Poursuivre (`continue`) ou Quitter (`leave`). */
  | 'session:decision'
  /** Échéance atteinte sans réponse : le joueur quitte automatiquement la session. */
  | 'session:auto_leave'
  /** Ronde résolue : joueurs restants (candidats à la partie suivante). */
  | 'session:decision_closed';

export interface SessionEvent<TPayload = Record<string, unknown>> {
  eventId: string;
  sessionId: SessionId;
  /** Version de la session après la mutation qui a produit l'événement. */
  version: number;
  /** Rang de l'événement dans sa mutation (un départ peut produire left puis closed). */
  sequence: number;
  type: SessionEventType;
  occurredAt: string;
  actorId?: PlayerId;
  payload: TPayload;
}

export interface SessionEventDraft {
  type: SessionEventType;
  payload?: Record<string, unknown>;
}
