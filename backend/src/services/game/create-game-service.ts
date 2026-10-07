import type { RedisConnections } from '../../config/redis';
import type { SqlClient } from '../../database/sql-client';
import { PostgresGameRepository } from '../../repositories/postgres-game.repository';
import { PostgresSessionRepository } from '../../repositories/postgres-session.repository';
import type { Logger } from '../../utils/logger';
import { InMemoryGameEventHub } from '../../websocket/in-memory-game-event-hub';
import { PubSubGameEventBus } from '../../websocket/pubsub-game-event-bus';
import { RedisPubSubTransport } from '../../websocket/pubsub-transport';
import {
  InMemorySessionEventHub,
  PubSubSessionEventPublisher,
  type SessionEventPublisher,
} from '../../websocket/session-event-publisher';
import { SessionService } from '../sessions/session.service';
import { DeadlineSupervisor } from '../timers/deadline-supervisor';
import { GameService } from './game.service';
import { GameTimerRegistry, SessionTimerRegistry } from './game-timer-registry';
import { singleActiveGameParticipation } from './participation-policies';

/**
 * Assemble GameService pour le serveur (D-030) :
 *
 *   GameService → PostgresGameRepository → PostgreSQL (source de vérité)
 *   GameService → PubSubGameEventBus → Redis Pub/Sub (InMemoryGameEventHub sans Redis)
 *
 * Règles du jeu : OFFICIAL_TER_RULES (D-035, socle de vérité des 52 décisions), par défaut
 * dans GameService. La stratégie de coup automatique après TURN_TIMEOUT (tours 1 à 4) est
 * D-036 par défaut dans GameService (`autoCardSelection`) ; le 5e tour se joue toujours automatiquement.
 *
 * Les timers (tour, décision) sont reconstruits depuis PostgreSQL par `supervisor.start()`.
 */
export function createGameService(options: {
  sql: SqlClient;
  redis?: RedisConnections;
  logger: Logger;
}): {
  games: GameService;
  sessions: SessionService;
  timers: GameTimerRegistry;
  sessionTimers: SessionTimerRegistry;
  supervisor: DeadlineSupervisor;
} {
  const repository = new PostgresGameRepository(options.sql);
  const sessionRepository = new PostgresSessionRepository(options.sql);
  const transport = options.redis
    ? new RedisPubSubTransport(options.redis.client, options.redis.subscriber)
    : undefined;
  const bus = transport
    ? new PubSubGameEventBus(transport, options.logger)
    : new InMemoryGameEventHub();
  const localSessionEvents = new InMemorySessionEventHub();
  const sessionEvents: SessionEventPublisher = transport
    ? new PubSubSessionEventPublisher(transport, localSessionEvents, options.logger)
    : localSessionEvents;
  const timers = new GameTimerRegistry();
  const games = new GameService({
    repository,
    publisher: bus,
    subscriber: bus,
    timers,
    // R-18 : une seule partie active par joueur (garantie en base, migration 0004).
    participationPolicy: singleActiveGameParticipation(repository),
    sessionSeats: sessionRepository,
    logger: options.logger,
  });
  const sessionTimers = new SessionTimerRegistry();
  const sessions = new SessionService({
    sessions: sessionRepository,
    games,
    publisher: sessionEvents,
    logger: options.logger,
    timers: sessionTimers,
  });
  const supervisor = new DeadlineSupervisor({ games, sessions, logger: options.logger });
  return { games, sessions, timers, sessionTimers, supervisor };
}
