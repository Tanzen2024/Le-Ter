import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { loadEnvFile, readEnv } from './config/env';
import { connectRedis, disconnectRedis, type RedisConnections } from './config/redis';
import { loadMigrations, pendingMigrations } from './database/migrator';
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
import type { GameCommissionSettingsService } from './services/game/game-commission-settings.service';
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
import type { PaymentReconciler } from './services/payments/payment-reconciler';
import type { PaymentService } from './services/payments/payment.service';
import { createWalletService } from './services/wallet/create-wallet-service';
import { createWithdrawalServices } from './services/withdrawals/create-withdrawal-service';
import { createPlatformFinanceServices } from './services/platform-finance/create-platform-finance-services';
import { readPlatformPayoutEnv } from './config/platform-payout-env';
import { WithdrawalAdminService } from './services/withdrawals/withdrawal-admin.service';
import {
  resolveWithdrawalAvailability,
  WITHDRAWAL_MIGRATIONS,
} from './services/withdrawals/withdrawal-availability';
import type { WithdrawalReconciler } from './services/withdrawals/withdrawal-reconciler';
import type { WithdrawalService } from './services/withdrawals/withdrawal.service';
import { PostgresAdminAuditRepository } from './repositories/postgres-admin-audit.repository';
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
  let gameCommissionSettings: GameCommissionSettingsService | undefined;
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
      gameCommissionSettings,
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
  let paymentReconciler: PaymentReconciler | undefined;
  let withdrawals: WithdrawalService | undefined;
  let withdrawalReconciler: WithdrawalReconciler | undefined;
  let platformFinance: ReturnType<typeof createPlatformFinanceServices> | undefined;
  if (sql && auth) {
    const paymentServices = createPaymentServices({ sql, logger, cinetpay: env.cinetpay });
    payments = paymentServices.payments;
    paymentReconciler = paymentServices.reconciler;
    // Schéma : une migration en attente ne bloque pas le démarrage, mais les retraits restent
    // indisponibles tant que les leurs ne sont pas appliquées (`npm run db:migrate`).
    const pending = await pendingMigrations(sql, await loadMigrations());
    if (pending.length > 0) {
      logger.warn('Migrations non appliquées : exécuter npm run db:migrate', { pending });
    }
    // Retraits (D-075, D-077) : indisponibles, sandbox ou production, décidé au démarrage.
    // Les identifiants CinetPay seuls n'autorisent JAMAIS un transfert.
    const availability = resolveWithdrawalAvailability({
      nodeEnv: env.nodeEnv,
      cinetpay: env.cinetpay,
      schemaReady: !WITHDRAWAL_MIGRATIONS.some((name) => pending.includes(name)),
    });
    ({ withdrawals, reconciler: withdrawalReconciler } = createWithdrawalServices({
      sql,
      logger,
      cinetpay: env.cinetpay,
      client: paymentServices.client,
      availability,
    }));
    const withdrawalService = withdrawals;
    // Retraits des revenus de la plateforme (D-078) : exécution désactivée par défaut, décidée
    // ici une fois pour toutes (PLATFORM_PAYOUTS_ENABLED + transferts D-077 + URL dédiée).
    platformFinance = createPlatformFinanceServices({
      sql,
      logger,
      env: readPlatformPayoutEnv(),
      cinetpay: env.cinetpay,
      client: paymentServices.client,
      transferAvailability: availability,
    });
    const execution = platformFinance.payouts.execution;
    if (execution.enabled) {
      logger.warn('Retraits de la plateforme : EXÉCUTION ACTIVÉE', { mode: execution.mode });
    } else {
      logger.info('Retraits de la plateforme : exécution désactivée', { reason: execution.reason });
    }
    if (platformFinance.payouts.canLookup) {
      // Reprise après redémarrage et relecture ; aucun envoi tant que l'exécution est désactivée.
      platformFinance.executor.start();
    }
    wallet = createWalletService({
      sql,
      logger,
      gateway: paymentServices.gateway,
      withdrawalAvailability: () => withdrawalService.availability,
    });
    if (withdrawalReconciler) {
      // Retraits ouverts relus dans PostgreSQL (reprise après redémarrage), puis à intervalle,
      // même quand les nouveaux transferts sont désactivés (relecture seulement).
      withdrawalReconciler.start();
    }
    const { mode, reason, warnings } = withdrawalService.availability;
    if (mode === 'live') {
      logger.info('Retraits Mobile Money actifs en PRODUCTION (fonds réels)', { warnings });
    } else if (mode === 'sandbox') {
      logger.warn('Retraits Mobile Money en SANDBOX : transferts simulés, aucun fonds réel', {
        warnings,
      });
    } else {
      logger.warn('Nouveaux retraits indisponibles', {
        reason,
        warnings,
        reconciliation: withdrawalReconciler !== undefined,
      });
    }
    if (env.cinetpay) {
      // Jamais la clé ni le mot de passe : seulement l'environnement CinetPay utilisé.
      logger.info('CinetPay configuré (achats)', { cinetpayBaseUrl: env.cinetpay.baseUrl });
      // Paiements en attente relus dans PostgreSQL, puis revérifiés à intervalle régulier.
      paymentReconciler?.start();
      logger.info('Réconciliation des paiements active', {
        intervalMs: env.cinetpay.reconcileIntervalMs,
      });
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
      ...(withdrawals && { withdrawals: withdrawals.availability }),
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
    withdrawals,
    withdrawalAdmin:
      sql && withdrawals
        ? new WithdrawalAdminService({
            withdrawals,
            audit: new PostgresAdminAuditRepository(sql),
            logger,
          })
        : undefined,
    platformFinance: platformFinance && {
      payouts: platformFinance.payouts,
      treasury: platformFinance.treasury,
    },
    chat,
    geolocation,
    detectionAdmin,
    detectionSettings,
    gameCommissionSettings,
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
    paymentReconciler?.stop();
    withdrawalReconciler?.stop();
    platformFinance?.executor.stop();
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
        // Vérification de paiement en cours : terminée (ou annulée par ROLLBACK) avant la
        // fermeture de la base ; un paiement non traité sera repris au redémarrage.
        paymentReconciler?.idle(),
        // Relecture de retrait en cours : terminée avant la fermeture de la base.
        withdrawalReconciler?.idle(),
        platformFinance?.executor.idle(),
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
