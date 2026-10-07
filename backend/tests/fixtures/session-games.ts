import type { SqlClient } from '../../src/database/sql-client';
import type { GameId, PlayerId } from '../../src/domain/game/game-id';
import { PostgresGameRepository } from '../../src/repositories/postgres-game.repository';
import { PostgresSessionRepository } from '../../src/repositories/postgres-session.repository';
import {
  GameService,
  type GameServiceDependencies,
  type ParticipationPolicy,
} from '../../src/services/game/game.service';
import { singleActiveGameParticipation } from '../../src/services/game/participation-policies';
import { SessionTimerRegistry } from '../../src/services/game/game-timer-registry';
import { DeadlineSupervisor } from '../../src/services/timers/deadline-supervisor';
import {
  SessionService,
  type NewSessionOptions,
} from '../../src/services/sessions/session.service';
import { silentLogger } from '../../src/utils/logger';
import { InMemorySessionEventHub } from '../../src/websocket/session-event-publisher';
import { defaultTestRandom } from './random';

/**
 * Une « instance » du backend sur PostgreSQL, assemblée comme en production
 * (create-game-service.ts), avec des raccourcis qui suivent le parcours RÉEL (D-033) :
 * créer une partie ouvre une session ; rejoindre une partie passe d'abord par sa session.
 */
export function createSessionGameInstance(
  sql: SqlClient,
  deps: Omit<
    GameServiceDependencies,
    'repository' | 'participationPolicy' | 'logger' | 'sessionSeats'
  > & {
    participationPolicy?: (repository: PostgresGameRepository) => ParticipationPolicy;
    /** Délai Poursuivre/Quitter (10 s par défaut, D-034). */
    decisionWindowMs?: number;
  },
) {
  const repository = new PostgresGameRepository(sql);
  const sessionRepository = new PostgresSessionRepository(sql);
  const games = new GameService({
    ...deps,
    random: deps.random ?? defaultTestRandom(),
    repository,
    participationPolicy: (deps.participationPolicy ?? singleActiveGameParticipation)(repository),
    sessionSeats: sessionRepository,
    logger: silentLogger,
  });
  const sessionEvents = new InMemorySessionEventHub();
  const sessionTimers = new SessionTimerRegistry();
  const sessions = new SessionService({
    sessions: sessionRepository,
    games,
    publisher: sessionEvents,
    logger: silentLogger,
    clock: deps.clock,
    timers: sessionTimers,
    decisionWindowMs: deps.decisionWindowMs,
  });
  const supervisor = new DeadlineSupervisor({
    games,
    sessions,
    logger: silentLogger,
    clock: deps.clock,
  });

  return {
    games,
    sessions,
    sessionEvents,
    timers: deps.timers,
    sessionTimers,
    supervisor,
    /** Arrêt de l'instance : ses timers en mémoire disparaissent (rien n'est écrit). */
    stop() {
      supervisor.stop();
      deps.timers.cancelAll();
      sessionTimers.cancelAll();
    },
    /** Attend les commandes déjà lancées en arrière-plan (avant de supprimer la base). */
    idle: () => sessions.idle(),
    /** Nouvelle session et sa première partie (créateur = J1). */
    async createGame(creatorId: PlayerId, options: NewSessionOptions) {
      return (await sessions.createSession(creatorId, options)).game;
    },
    async createGameIdempotent(creatorId: PlayerId, options: NewSessionOptions) {
      const { game, replayed } = await sessions.createSession(creatorId, options);
      return { game, replayed };
    },
    /** Rejoint la session de la partie, puis la partie. */
    async joinGame(gameId: GameId, playerId: PlayerId) {
      const game = await repository.findById(gameId);
      if (game?.sessionId) {
        await sessions.joinSession(game.sessionId, playerId);
      }
      return games.joinGame(gameId, playerId);
    },
    startGame: (gameId: GameId, actorId: PlayerId) => games.startGame(gameId, actorId),
    finishGame: (gameId: GameId) => games.finishGame(gameId),
    getGameForPlayer: (gameId: GameId, playerId: PlayerId) =>
      games.getGameForPlayer(gameId, playerId),
    subscribe: games.subscribe.bind(games),
  };
}
