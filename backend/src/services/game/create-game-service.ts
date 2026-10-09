import type { TournamentId } from '../../domain/tournaments/tournament';
import type { RedisConnections } from '../../config/redis';
import type { SqlClient } from '../../database/sql-client';
import { PostgresGameRepository } from '../../repositories/postgres-game.repository';
import { PostgresBehaviorHistoryRepository } from '../../repositories/postgres-behavior-history.repository';
import { PostgresDetectionRepository } from '../../repositories/postgres-detection.repository';
import { PostgresDetectionSettingsRepository } from '../../repositories/postgres-detection-settings.repository';
import { PostgresGeolocationRepository } from '../../repositories/postgres-geolocation.repository';
import { PostgresSessionRepository } from '../../repositories/postgres-session.repository';
import { PostgresTournamentRepository } from '../../repositories/postgres-tournament.repository';
import { createBehaviorAnalyzers } from '../detection/behavior-analyzers';
import { DetectionService } from '../detection/detection.service';
import { DetectionSettingsService } from '../detection/detection-settings.service';
import { createGeoAnalyzers } from '../detection/geo-analyzers';
import { GeolocationService } from '../detection/geolocation.service';
import type { Logger } from '../../utils/logger';
import { InMemoryGameEventHub } from '../../websocket/in-memory-game-event-hub';
import { PubSubGameEventBus } from '../../websocket/pubsub-game-event-bus';
import { RedisPubSubTransport } from '../../websocket/pubsub-transport';
import {
  InMemorySessionEventHub,
  PubSubSessionEventPublisher,
  type SessionEventPublisher,
} from '../../websocket/session-event-publisher';
import { NotificationService } from '../notifications/notification.service';
import { SessionService } from '../sessions/session.service';
import {
  tournamentSessionAdmission,
  tournamentTableContinuation,
} from '../tournaments/tournament-admission';
import { TournamentScheduler } from '../tournaments/tournament-scheduler';
import { TournamentService } from '../tournaments/tournament.service';
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
  detection: DetectionService;
  geolocation: GeolocationService;
  detectionSettings: DetectionSettingsService;
  tournaments: TournamentService;
  tournamentScheduler: TournamentScheduler;
  notifications: NotificationService;
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
  const tournamentRepository = new PostgresTournamentRepository(options.sql);
  // TournamentService est construit après SessionService : appel résolu à l'exécution.
  const settlePending = (id: TournamentId): Promise<number> => tournaments.settlePendingGames(id);
  const sessions = new SessionService({
    sessions: sessionRepository,
    games,
    publisher: sessionEvents,
    logger: options.logger,
    timers: sessionTimers,
    // Tables de tournoi réservées aux participants du tournoi en cours (D-051, D-054).
    // Seuil de participation (D-063) : jetons lus après règlement des parties terminées.
    admission: tournamentSessionAdmission(tournamentRepository, undefined, settlePending),
    // Plus de nouvelle partie aux tables d'un tournoi terminé (D-056) ; joueurs sous le seuil
    // écartés de la partie suivante (D-063).
    continuation: tournamentTableContinuation(tournamentRepository, undefined, settlePending),
  });
  const supervisor = new DeadlineSupervisor({ games, sessions, logger: options.logger });
  // Détection de potentielle collusion (R-36, D-044) : observe les fins de partie, en
  // arrière-plan ; le moteur ne dépend pas d'elle. Inactive pour toute partie dont la table
  // n'a pas activé `suspicionDetectionEnabled`.
  // Étape 2 (D-046) : positions GPS et analyses géographiques ; étape 3 (D-047) : analyses
  // comportementales sur l'historique surveillé. Aucun score (étape 4).
  // Interrupteur GLOBAL (D-053), relu dans PostgreSQL à chaque consultation : désactivé
  // (défaut), aucune analyse, aucun score, aucune alerte, aucune position acceptée.
  const detectionSettings = new DetectionSettingsService({
    repository: new PostgresDetectionSettingsRepository(options.sql),
    logger: options.logger,
  });
  const geolocationRepository = new PostgresGeolocationRepository(options.sql);
  const detection = new DetectionService({
    repository: new PostgresDetectionRepository(options.sql),
    globalSwitch: detectionSettings,
    logger: options.logger,
    analyzers: [
      ...createGeoAnalyzers(geolocationRepository),
      ...createBehaviorAnalyzers(new PostgresBehaviorHistoryRepository(options.sql), repository),
    ],
  });
  games.onGameFinished((game) => detection.observeFinishedGame(game));
  const geolocation = new GeolocationService({
    repository: geolocationRepository,
    globalSwitch: detectionSettings,
    logger: options.logger,
  });
  // Tournois (D-054) : jetons de tournoi réglés à la fin de chaque partie d'une table de
  // tournoi ; échéances (début, fin, résultats, gains) appliquées par le planificateur.
  const tournaments = new TournamentService({
    tournaments: tournamentRepository,
    sessions,
    games,
    logger: options.logger,
  });
  games.onGameFinished((game) => tournaments.observeFinishedGame(game));
  const tournamentScheduler = new TournamentScheduler({
    tournaments,
    repository: tournamentRepository,
    logger: options.logger,
  });
  const notifications = new NotificationService(tournamentRepository);
  return {
    tournaments,
    tournamentScheduler,
    notifications,
    games,
    sessions,
    timers,
    sessionTimers,
    supervisor,
    detection,
    geolocation,
    detectionSettings,
  };
}
