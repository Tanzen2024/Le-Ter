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
  /**
   * Distribution confirmée par le serveur (D-102, COMPLETE_DEAL) : fin de la phase de
   * distribution et début du premier tour. payload : nextPlayerId, trickNumber,
   * turnStartedAt, turnDeadlineAt.
   */
  | 'game:deal_completed'
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
  | 'game:last_trick_automatic'
  /** GARAM TIA (D-119) : carte prise à la tête du terre. payload : playerId, cardId, total. */
  | 'game:card_drawn'
  /**
   * GARAM TIA : tirage terminé, « Impossible » (`cardId` : la carte qui ferait dépasser 21,
   * restée au terre) ou terre vide (`cardId` absent).
   */
  | 'game:draw_impossible'
  /**
   * GARAM TIA (D-145) : le joueur qui a la main ne peut prendre aucune carte et annonce « Je passe » ;
   * la main passe au suivant à l'échéance de son tour. payload : playerId, cardId éventuel.
   */
  | 'game:player_passed'
  /** GARAM TIA : manche nulle, rejouée aussitôt dans la même partie (§3.12, §3.15). */
  | 'game:garam_tie'
  /** GARAM TIA : réponse d'un joueur à la proposition de doubler la mise (§3.15). */
  | 'game:stake_vote'
  /** GARAM TIA : proposition close ; payload : stakeAmount retenu, doubled. */
  | 'game:stake_vote_closed'
  /** GARAM TIA : joueurs retirés, solde insuffisant pour la mise de la manche (§3.16). */
  | 'game:players_withdrawn';

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
