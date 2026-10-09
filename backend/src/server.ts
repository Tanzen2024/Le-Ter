import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { loadEnvFile, readEnv } from './config/env';
import { connectRedis, disconnectRedis, type RedisConnections } from './config/redis';
import type { SqlClient } from './database/sql-client';
import type { AuthService } from './services/auth/auth.service';
import { createAdminServices } from './services/admin/create-admin-services';
import { createAuthService } from './services/auth/create-auth-service';
import { createGameService } from './services/game/create-game-service';
import type { GameService } from './services/game/game.service';
import type { GameTimerRegistry, SessionTimerRegistry } from './services/game/game-timer-registry';
import type { DetectionService } from './services/detection/detection.service';
import { DetectionAdminService } from './services/detection/detection-admin.service';
import type { DetectionSettingsService } from './services/detection/detection-settings.service';
import type { GeolocationService } from './services/detection/geolocation.service';
import { PostgresDetectionAdminRepository } from './repositories/postgres-detection-admin.repository';
import type { DeadlineSupervisor } from './services/timers/deadline-supervisor';
import type { SessionService } from './services/sessions/session.service';
import type { NotificationService } from './services/notifications/notification.service';
import type { TournamentScheduler } from './services/tournaments/tournament-scheduler';
import type { TournamentService } from './services/tournaments/tournament.service';
import type { ChatService } from './services/chat/chat.service';
import { createChatService } from './services/chat/create-chat-service';
import { createPaymentServices } from './services/payments/create-payment-service';
import type { PaymentService } from './services/payments/payment.service';
import { createWalletService } from './services/wallet/create-wallet-service';
import type { WalletService } from './services/wallet/wallet.service';
import { createLogger } from './utils/logger';
import { attachRealtimeGateway, type RealtimeGateway } from './websocket/realtime-gateway';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  loadEnvFile();
  const env = readEnv();
  const logger = createLogger();

  // PostgreSQL : source de vérité. Une base configurée mais injoignable bloque le démarrage.
  let sql: SqlClient | undefined;
  if (env.databaseUrl) {
    sql = await connectDatabase(env.databaseUrl, {
      onError: (err) =>
        logger.error('Erreur PostgreSQL (connexion inactive)', { error: err.message }),
    });
    logger.info('PostgreSQL connecté');
  } else {
    logger.warn('DATABASE_URL non défini : démarrage sans base de données');
  }

  // Redis : infrastructure volatile. Il est requis au démarrage s'il est configuré,
  // puis une coupure est tolérée (reconnexion automatique, diffusion locale).
  let redis: RedisConnections | undefined;
  if (env.redisUrl) {
    redis = await connectRedis(env.redisUrl, (err) =>
      logger.error('Erreur Redis', { error: err.message }),
    );
    logger.info('Redis connecté');
  } else {
    logger.warn('REDIS_URL non défini : diffusion des événements limitée à cette instance');
  }

  // Authentification : PostgreSQL seulement, jamais Redis (D-029).
  let auth: AuthService | undefined;
  const { jwtSecret } = env.auth;
  if (sql && jwtSecret) {
    auth = createAuthService(sql, { ...env.auth, jwtSecret }, logger);
  } else {
    logger.warn('Authentification désactivée : DATABASE_URL et JWT_SECRET sont requis');
  }

  // Parties : GameService est l'unique point d'entrée des mutations (D-030).
  let games: GameService | undefined;
  let timers: GameTimerRegistry | undefined;
  let sessions: SessionService | undefined;
  let sessionTimers: SessionTimerRegistry | undefined;
  let supervisor: DeadlineSupervisor | undefined;
  let detection: DetectionService | undefined;
  let geolocation: GeolocationService | undefined;
  let detectionSettings: DetectionSettingsService | undefined;
  let tournaments: TournamentService | undefined;
  let tournamentScheduler: TournamentScheduler | undefined;
  let notifications: NotificationService | undefined;
  if (sql && auth) {
    ({
      games,
      sessions,
      timers,
      sessionTimers,
      supervisor,
      detection,
      geolocation,
      detectionSettings,
      tournaments,
      tournamentScheduler,
      notifications,
    } = createGameService({
      sql,
      redis,
      logger,
    }));
    // Timers persistants (D-034) : reconstruits depuis PostgreSQL avant d'accepter du trafic.
    await supervisor.start();
    // Tournois (D-054) : échéances et reprises relues dans PostgreSQL à chaque tick.
    tournamentScheduler.start();
    logger.info('Parties disponibles');
  } else {
    logger.warn('Parties désactivées : base et authentification sont requises');
  }

  // Compte de jeu (D-040) : PostgreSQL. Achats par CinetPay v1 s'il est configuré (D-050) ;
  // sinon aucun fournisseur : achats et retraits refusés proprement.
  let wallet: WalletService | undefined;
  let payments: PaymentService | undefined;
  if (sql && auth) {
    const paymentServices = createPaymentServices({ sql, logger, cinetpay: env.cinetpay });
    payments = paymentServices.payments;
    wallet = createWalletService({ sql, logger, gateway: paymentServices.gateway });
    if (env.cinetpay) {
      // Jamais la clé ni le mot de passe : seulement l'environnement CinetPay utilisé.
      logger.info('CinetPay configuré (achats)', { cinetpayBaseUrl: env.cinetpay.baseUrl });
    } else {
      logger.warn('Mobile Money non configuré : achats et retraits refusés proprement');
    }
  }

  // Chat de partie (D-045) : indépendant de GameService ; PostgreSQL + diffusion Redis.
  let chat: ChatService | undefined;
  if (sql && auth && games) {
    chat = createChatService({ sql, redis, logger });
  }

  // Positions GPS de la détection (D-046) : supprimées au plus tard 24 h après la partie.
  const stopPositionRetention = geolocation?.startRetention();

  // Administration de la détection (D-049) : rôle admin seulement ; aucune action sur le jeu.
  const detectionAdmin =
    sql && auth
      ? new DetectionAdminService({
          repository: new PostgresDetectionAdminRepository(sql),
          logger,
        })
      : undefined;

  // Plateforme d'administration (D-061) : session admin bornée, lectures, audit.
  const adminServices =
    sql && auth
      ? createAdminServices({ sql, auth, logger, payments, redis: redis?.client })
      : undefined;
  const admin = adminServices && {
    ...adminServices,
    system: {
      nodeEnv: env.nodeEnv,
      cinetpay: env.cinetpay
        ? env.cinetpay.apiKey.startsWith('sk_live_')
          ? ('production' as const)
          : ('sandbox' as const)
        : null,
    },
  };
  if (env.trustProxy !== undefined) {
    logger.info('Proxys de confiance configurés', { trustProxy: env.trustProxy });
  }

  const server = createApp({
    logger,
    auth,
    admin,
    trustProxy: env.trustProxy,
    games,
    sessions,
    wallet,
    payments,
    paymentOptions: env.cinetpay ? { appReturnUrl: env.cinetpay.appReturnUrl } : undefined,
    chat,
    geolocation,
    detectionAdmin,
    detectionSettings,
    tournaments,
    notifications,
  }).listen(env.port, () => {
    logger.info(`API Le Ter démarrée sur le port ${env.port} (${env.nodeEnv})`);
  });

  // Temps réel (D-045) : WebSocket sur le même serveur HTTP, chemin /ws.
  let realtime: RealtimeGateway | undefined;
  if (auth && chat) {
    realtime = attachRealtimeGateway(server, { auth, chat, logger });
    logger.info('Temps réel disponible sur /ws');
  }

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info(`${signal} reçu, arrêt du serveur`);
    // Une connexion qui ne se ferme pas ne doit pas bloquer l'arrêt (redéploiement).
    setTimeout(() => {
      logger.error('Arrêt propre trop long, arrêt forcé');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    supervisor?.stop();
    tournamentScheduler?.stop();
    stopPositionRetention?.();
    timers?.cancelAll();
    games?.cancelStartTimers();
    sessionTimers?.cancelAll();
    void realtime?.close();
    server.closeIdleConnections();
    server.close(() => {
      // Les commandes système en cours (timeout, départ automatique) se terminent avant la
      // fermeture de la base ; les échéances restantes seront reprises au redémarrage.
      void Promise.allSettled([
        sessions?.idle(),
        detection?.idle(),
        tournamentScheduler?.idle(),
        tournaments?.idle(),
      ])
        .catch(() => undefined)
        .then(() => Promise.allSettled([disconnectRedis(), disconnectDatabase()]))
        .finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('Échec du démarrage :', err);

  if (err instanceof Error) {
    console.error('Message :', err.message);
    console.error('Stack :', err.stack);
    console.error('Cause :', err.cause);
  }

  process.exit(1);
});
