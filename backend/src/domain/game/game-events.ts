import type { GameId, PlayerId } from './game-id';

/**
 * Événements de domaine. Ils sont toujours rattachés à une partie et diffusés dans
 * sa seule salle `game:{gameId}`, sauf `game:hand_dealt`, privé.
 */
export type GameEventType =
  | 'game:created'
  | 'game:player_joined'
  | 'game:started'
  | 'game:hand_dealt'
  | 'game:card_played'
  | 'game:trick_completed'
  | 'game:turn_changed'
  | 'game:player_fled'
  | 'game:finished'
  | 'game:turn_timeout';

/**
 * Enveloppe commune à tous les événements. Le `gameId` est obligatoire :
 * un événement sans partie ne peut pas être routé.
 */
export interface GameEvent<TPayload = Record<string, unknown>> {
  eventId: string;
  gameId: GameId;
  /** Version de la partie après l'événement : le client ignore toute version déjà vue. */
  version: number;
  type: GameEventType;
  occurredAt: string;
  /** Joueur à l'origine de l'événement, absent pour une action système (timer…). */
  actorId?: PlayerId;
  payload: TPayload;
}

/** Événement produit par le moteur, avant numérotation et diffusion par le service. */
export interface GameEventDraft {
  type: GameEventType;
  payload?: Record<string, unknown>;
  /** Si défini, l'événement est privé et n'est envoyé qu'à ce joueur. */
  recipientId?: PlayerId;
}
