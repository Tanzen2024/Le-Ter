import type { SessionId } from '../../domain/sessions/session';
import type { TournamentId } from '../../domain/tournaments/tournament';
import type { RedisConnections } from '../../config/redis';
import type { SqlClient } from '../../database/sql-client';
import { PostgresGameStakeLedger } from '../../repositories/game-stake-ledger';
import { PostgresGameRepository } from '../../repositories/postgres-game.repository';
import { PostgresGameSettlementReader } from '../../repositories/postgres-game-settlement.repository';
import { PostgresBehaviorHistoryRepository } from '../../repositories/postgres-behavior-history.repository';
import { PostgresDetectionRepository } from '../../repositories/postgres-detection.repository';
import { PostgresDetectionSettingsRepository } from '../../repositories/postgres-detection-settings.repository';
import { PostgresGeolocationRepository } from '../../repositories/postgres-geolocation.repository';
import { PostgresSessionRepository } from '../../repositories/postgres-session.repository';
import { PostgresTournamentRepository } from '../../repositories/postgres-tournament.repository';
import { PostgresWalletRepository } from '../../repositories/postgres-wallet.repository';
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
import { PostgresGameCommissionSettingsRepository } from '../../repositories/postgres-game-commission-settings.repository';
import { GameCommissionSettingsService } from './game-commission-settings.service';
import { GameService } from './game.service';
import { GameTimerRegistry, SessionTimerRegistry } from './game-timer-registry';
import { singleActiveGameParticipation } from './participation-policies';
import {
  allSessionAdmissions,
  allSessionContinuations,
  walletGameStakePolicy,
  walletSessionStakeAdmission,
  walletStakeContinuation,
} from './stake-policies';

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
  gameCommissionSettings: GameCommissionSettingsService;
  tournaments: TournamentService;
  tournamentScheduler: TournamentScheduler;
  notifications: NotificationService;
} {
  // Séquestre et règlement des mises (D-074), dans la transaction de chaque écriture de
  // partie : démarrage = mises réservées, fin = partie réglée (ou tout ou rien).
  const stakeLedger = new PostgresGameStakeLedger({ logger: options.logger });
  const repository = new PostgresGameRepository(options.sql, { stakeLedger });
  const sessionRepository = new PostgresSessionRepository(options.sql, { stakeLedger });
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
  const tournamentRepository = new PostgresTournamentRepository(options.sql);
  // Mise des parties ordinaires (D-073) : mise > 0 et solde disponible ≥ 2 × mise, relus en
  // base ; les tables de tournoi (jetons de tournoi) ne sont pas concernées.
  const stakeDeps = {
    wallets: new PostgresWalletRepository(options.sql),
    tournamentOfSession: (id: SessionId) => tournamentRepository.findTournamentOfSession(id),
  };
  const games = new GameService({
    repository,
    publisher: bus,
    subscriber: bus,
    timers,
    // R-18 : une seule partie active par joueur (garantie en base, migration 0004).
    participationPolicy: singleActiveGameParticipation(repository),
    stakePolicy: walletGameStakePolicy(stakeDeps),
    sessionSeats: sessionRepository,
    settlements: new PostgresGameSettlementReader(options.sql),
    logger: options.logger,
  });
  // Interrupteur GLOBAL de la détection (D-053) : lu par la création des tables (D-081) et par
  // la détection elle-même (plus bas).
  const detectionSettings = new DetectionSettingsService({
    repository: new PostgresDetectionSettingsRepository(options.sql),
    logger: options.logger,
  });
  const sessionTimers = new SessionTimerRegistry();
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
    // Tables ordinaires : solde ≥ 2 × la mise de la table avant d'occuper un siège (D-073).
    admission: allSessionAdmissions(
      tournamentSessionAdmission(tournamentRepository, undefined, settlePending),
      walletSessionStakeAdmission({
        ...stakeDeps,
        lastStakeOfSession: async (id) => {
          const last = await sessionRepository.findLastGame(id);
          const game = last ? await games.findGame(last.gameId) : null;
          // Partie sans mise (antérieure à D-073) : `undefined`, refusée comme invalide.
          return game ? game.stakeAmount : null;
        },
      }),
    ),
    // Plus de nouvelle partie aux tables d'un tournoi terminé (D-056) ; joueurs sous le seuil
    // écartés de la partie suivante (D-063).
    // Tables ordinaires : joueurs dont le solde ne couvre plus 2 × la mise écartés (D-073).
    continuation: allSessionContinuations(
      tournamentTableContinuation(tournamentRepository, undefined, settlePending),
      walletStakeContinuation(stakeDeps),
    ),
    detectionSwitch: detectionSettings,
  });
  const supervisor = new DeadlineSupervisor({ games, sessions, logger: options.logger });
  // Détection de potentielle collusion (R-36, D-044) : observe les fins de partie, en
  // arrière-plan ; le moteur ne dépend pas d'elle. Inactive pour toute partie dont la table
  // n'a pas activé `suspicionDetectionEnabled`.
  // Étape 2 (D-046) : positions GPS et analyses géographiques ; étape 3 (D-047) : analyses
  // comportementales sur l'historique surveillé. Aucun score (étape 4).
  // Interrupteur GLOBAL (D-053), relu dans PostgreSQL à chaque consultation : désactivé
  // (défaut), aucune analyse, aucun score, aucune alerte, aucune position acceptée.
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
    // Commission sur les gains des parties (D-074), lue par le séquestre à chaque démarrage.
    gameCommissionSettings: new GameCommissionSettingsService({
      repository: new PostgresGameCommissionSettingsRepository(options.sql),
      logger: options.logger,
    }),
  };
}
