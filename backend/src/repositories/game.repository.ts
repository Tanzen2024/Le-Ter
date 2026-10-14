import type { Game } from '../domain/game/game';
import type { GameId, PlayerId } from '../domain/game/game-id';

/**
 * Persistance des parties (port). Implémentations : PostgresGameRepository
 * (production, D-022) et InMemoryGameRepository (tests, développement).
 * Le moteur et GameService ne dépendent que de ce contrat.
 *
 * Contrat d'isolation : chaque appel renvoie une copie indépendante. Modifier
 * l'objet reçu ne modifie jamais l'état stocké tant que `save` n'est pas appelé.
 */
/**
 * Une partie de ce créateur porte déjà cette clé d'idempotence (création rejouée en
 * même temps). GameService relit alors la partie existante au lieu d'en créer une autre.
 */
export class DuplicateCreationKeyError extends Error {
  constructor(
    readonly creatorId: PlayerId,
    readonly creationKey: string,
  ) {
    super(`Clé de création déjà utilisée par ${creatorId}`);
    this.name = 'DuplicateCreationKeyError';
  }
}

/** Échéance de tour persistée d'une partie en cours (reconstruction des timers, D-034). */
export interface TurnDeadline {
  gameId: GameId;
  deadlineAt: Date;
  /** TURN_TIMEOUT déjà constaté : il ne reste que le coup automatique à jouer. */
  timedOut: boolean;
}

/** Fin persistée de la phase de distribution d'une partie en cours (D-102). */
export interface DealDeadline {
  gameId: GameId;
  deadlineAt: Date;
}

/** Échéance de démarrage automatique persistée d'une partie en attente (D-065). */
export interface StartDeadline {
  gameId: GameId;
  deadlineAt: Date;
}

export interface GameRepository {
  /** Génère un nouvel identifiant de partie (UUID, D-023). */
  nextId(): GameId;

  findById(gameId: GameId): Promise<Game | null>;

  /**
   * Lève DuplicateCreationKeyError si `game.creationKey` est déjà utilisée par ce créateur,
   * et ParticipationRefusedError si un joueur est déjà membre d'une autre partie active (R-18).
   */
  insert(game: Game): Promise<void>;

  /**
   * Enregistre `game` seulement si la version stockée vaut `expectedVersion`.
   * Sinon lève GameVersionConflictError. En PostgreSQL :
   * UPDATE games SET … WHERE id = $1 AND version = $expectedVersion (0 ligne = conflit).
   */
  save(game: Game, expectedVersion: number): Promise<void>;

  /** Parties non terminées dont le joueur est membre (reconnexion, reprise). */
  findActiveByPlayer(playerId: PlayerId): Promise<Game[]>;

  /** Partie créée par ce joueur avec cette clé d'idempotence, ou null. */
  findByCreationKey(creatorId: PlayerId, creationKey: string): Promise<Game | null>;

  /** Parties en cours ayant une échéance de tour, la plus proche d'abord. */
  findTurnDeadlines(): Promise<TurnDeadline[]>;

  /** Parties en cours dont la distribution n'est pas confirmée (D-102), la plus proche d'abord. */
  findDealDeadlines(): Promise<DealDeadline[]>;

  /** Parties en attente ayant une échéance de démarrage (D-065), la plus proche d'abord. */
  findStartDeadlines(): Promise<StartDeadline[]>;
}
