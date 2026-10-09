import type { GameId, PlayerId } from './game-id';

/**
 * Événements de domaine. Ils sont toujours rattachés à une partie et diffusés dans
 * sa seule salle `game:{gameId}`, sauf `game:hand_dealt`, privé.
 */
export type GameEventType =
  | 'game:created'
  | 'game:player_joined'
  /**
   * Partie en attente : un joueur a quitté la session, donc la partie (R-19, D-037).
   * payload : playerId, firstPlayerId et creatorId (éventuellement remplacés).
   */
  | 'game:player_left'
  | 'game:started'
  | 'game:hand_dealt'
  | 'game:card_played'
  | 'game:trick_completed'
  | 'game:turn_changed'
  | 'game:player_fled'
  | 'game:finished'
  /** Prise de contrôle (carte supérieure de même couleur, spec §2.4). */
  | 'game:control_changed'
  /** Échéance du tour dépassée, constatée par le serveur (TURN_TIMEOUT, D-034). */
  | 'game:turn_timeout'
  /** Carte jouée automatiquement après TURN_TIMEOUT (stratégie à spécifier, D-034). */
  | 'game:auto_card_played'
  /** Égalité de priorité des mains instantanées : partie annulée, rejouée aussitôt (D-035). */
  | 'game:instant_win_tie'
  /** Début du 5e tour automatique : l'unique carte de chaque joueur est jouée (D-035). */
  | 'game:last_trick_automatic';

/**
 * Enveloppe commune à tous les événements. Le `gameId` est obligatoire :
 * un événement sans partie ne peut pas être routé.
 */
export interface GameEvent<TPayload = Record<string, unknown>> {
  eventId: string;
  gameId: GameId;
  /**
   * Version de la partie après la commande qui a produit l'événement. Une commande
   * peut produire plusieurs événements : ils partagent alors la même version.
   */
  version: number;
  /**
   * Rang de l'événement parmi ceux de sa commande (0, 1, 2…). Le client applique un
   * événement si (version, sequence) dépasse le dernier couple appliqué, et relit
   * l'état si `version` dépasse sa version + 1. Les événements privés gardent leur
   * rang global : un joueur peut donc voir des rangs non contigus.
   */
  sequence: number;
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
