import { isActive, type Game } from '../domain/game/game';
import { GameNotFoundError, GameVersionConflictError } from '../domain/game/game-errors';
import { newGameId, type GameId, type PlayerId } from '../domain/game/game-id';
import type { GameRepository } from './game.repository';

/**
 * Implémentation en mémoire, pour les tests et le développement sans PostgreSQL.
 * Les copies profondes (structuredClone) garantissent qu'aucune référence
 * n'est partagée entre l'appelant, le stockage et les autres parties.
 */
export class InMemoryGameRepository implements GameRepository {
  private readonly games = new Map<GameId, Game>();

  nextId(): GameId {
    return newGameId();
  }

  async findById(gameId: GameId): Promise<Game | null> {
    const game = this.games.get(gameId);
    return game ? structuredClone(game) : null;
  }

  async insert(game: Game): Promise<void> {
    if (this.games.has(game.id)) {
      throw new Error(`Partie déjà existante : ${game.id}`);
    }
    this.games.set(game.id, structuredClone(game));
  }

  async save(game: Game, expectedVersion: number): Promise<void> {
    const stored = this.games.get(game.id);
    if (!stored) {
      throw new GameNotFoundError(game.id);
    }
    if (stored.version !== expectedVersion) {
      throw new GameVersionConflictError(game.id, expectedVersion, stored.version);
    }
    this.games.set(game.id, structuredClone(game));
  }

  async findActiveByPlayer(playerId: PlayerId): Promise<Game[]> {
    return [...this.games.values()]
      .filter((g) => isActive(g) && g.players.some((p) => p.playerId === playerId))
      .map((g) => structuredClone(g));
  }
}
