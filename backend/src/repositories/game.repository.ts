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
export interface GameRepository {
  /** Génère un nouvel identifiant de partie (UUID, D-023). */
  nextId(): GameId;

  findById(gameId: GameId): Promise<Game | null>;

  insert(game: Game): Promise<void>;

  /**
   * Enregistre `game` seulement si la version stockée vaut `expectedVersion`.
   * Sinon lève GameVersionConflictError. En PostgreSQL :
   * UPDATE games SET … WHERE id = $1 AND version = $expectedVersion (0 ligne = conflit).
   */
  save(game: Game, expectedVersion: number): Promise<void>;

  /** Parties non terminées dont le joueur est membre (reconnexion, reprise). */
  findActiveByPlayer(playerId: PlayerId): Promise<Game[]>;
}
