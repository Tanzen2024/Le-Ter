import { isActive, isForwardTransition, type Game } from '../domain/game/game';
import {
  GameNotFoundError,
  GameVersionConflictError,
  InvalidStatusTransitionError,
} from '../domain/game/game-errors';
import { newGameId, type GameId, type PlayerId } from '../domain/game/game-id';
import {
  DuplicateCreationKeyError,
  type GameRepository,
  type DealDeadline,
  type StartDeadline,
  type TurnDeadline,
} from './game.repository';

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
    if (game.creationKey && (await this.findByCreationKey(game.creatorId, game.creationKey))) {
      throw new DuplicateCreationKeyError(game.creatorId, game.creationKey);
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
    if (!isForwardTransition(stored.status, game.status)) {
      throw new InvalidStatusTransitionError(game.id, stored.status, game.status);
    }
    this.games.set(game.id, structuredClone(game));
  }

  async findActiveByPlayer(playerId: PlayerId): Promise<Game[]> {
    return [...this.games.values()]
      .filter((g) => isActive(g) && g.players.some((p) => p.playerId === playerId))
      .map((g) => structuredClone(g));
  }

  /** R-18 n'est pas garantie ici en concurrence : c'est l'index PostgreSQL qui la garantit. */
  async findByCreationKey(creatorId: PlayerId, creationKey: string): Promise<Game | null> {
    const game = [...this.games.values()].find(
      (g) => g.creatorId === creatorId && g.creationKey === creationKey,
    );
    return game ? structuredClone(game) : null;
  }

  async findTurnDeadlines(): Promise<TurnDeadline[]> {
    return [...this.games.values()]
      .filter((g) => g.status === 'in_progress' && g.turnDeadlineAt)
      .map((g) => ({
        gameId: g.id,
        deadlineAt: g.turnDeadlineAt as Date,
        timedOut: Boolean(g.turnTimedOutAt),
      }))
      .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime());
  }

  async findDealDeadlines(): Promise<DealDeadline[]> {
    return [...this.games.values()]
      .filter((g) => g.status === 'in_progress' && g.dealEndsAt)
      .map((g) => ({ gameId: g.id, deadlineAt: g.dealEndsAt as Date }))
      .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime());
  }

  async findStartDeadlines(): Promise<StartDeadline[]> {
    return [...this.games.values()]
      .filter((g) => g.status === 'waiting' && g.startDeadlineAt)
      .map((g) => ({ gameId: g.id, deadlineAt: g.startDeadlineAt as Date }))
      .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime());
  }
}
