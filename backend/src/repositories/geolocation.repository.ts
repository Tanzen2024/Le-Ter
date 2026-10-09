import type { PositionSample } from '../domain/detection/geo';
import type { GameId, PlayerId } from '../domain/game/game-id';
import type { GameStatus } from '../domain/game/game';

/** Ce qu'il faut savoir d'une partie avant d'accepter ou de lire une position. */
export interface GeolocationAccess {
  status: GameStatus;
  /** `suspicionDetectionEnabled` de la table de la partie (D-043). */
  enabled: boolean;
  isPlayer: boolean;
  playerIds: PlayerId[];
}

/**
 * Positions GPS de la détection (R-36, étape 2, D-046). Toutes les opérations prennent un
 * `gameId` explicite ; la base refuse en plus toute position d'une partie désactivée ou
 * d'un joueur étranger à la partie (migration 0014).
 */
export interface GeolocationRepository {
  /** `null` si la partie n'existe pas. */
  findAccess(gameId: GameId, playerId: PlayerId): Promise<GeolocationAccess | null>;

  /** Lève GeolocationDisabledError si la détection est désactivée pour la partie. */
  insertPosition(sample: PositionSample & { id: string; receivedAt: Date }): Promise<void>;

  /** Dernière position de chaque joueur de la partie. */
  latestPositions(gameId: GameId): Promise<PositionSample[]>;

  /** Toutes les positions de la partie, de la plus ancienne à la plus récente. */
  listPositions(gameId: GameId): Promise<PositionSample[]>;

  /**
   * Nombre d'AUTRES parties surveillées (détection activée) où cette paire exacte a reçu
   * un signal PROXIMITY depuis `since`. Une partie non surveillée n'y figure jamais.
   */
  countOtherProximityGames(
    gameId: GameId,
    pair: readonly [PlayerId, PlayerId],
    since: Date,
  ): Promise<number>;

  /**
   * Supprime les positions expirées : partie terminée avant `cutoff`, ou position capturée
   * avant `cutoff`. Renvoie le nombre de positions supprimées.
   */
  purgeExpired(cutoff: Date): Promise<number>;
}
