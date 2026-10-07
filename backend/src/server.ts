import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { loadEnvFile, readEnv } from './config/env';
import { connectRedis, disconnectRedis, type RedisConnections } from './config/redis';
import type { SqlClient } from './database/sql-client';
import type { AuthService } from './services/auth/auth.service';
import { createAuthService } from './services/auth/create-auth-service';
import { createGameService } from './services/game/create-game-service';
import type { GameService } from './services/game/game.service';
import type { GameTimerRegistry, SessionTimerRegistry } from './services/game/game-timer-registry';
import type { DeadlineSupervisor } from './services/timers/deadline-supervisor';
import type { SessionService } from './services/sessions/session.service';
import { createLogger } from './utils/logger';

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
  if (sql && auth) {
    ({ games, sessions, timers, sessionTimers, supervisor } = createGameService({
      sql,
      redis,
      logger,
    }));
    // Timers persistants (D-034) : reconstruits depuis PostgreSQL avant d'accepter du trafic.
    await supervisor.start();
    logger.info('Parties disponibles');
  } else {
    logger.warn('Parties désactivées : base et authentification sont requises');
  }

  const server = createApp({ logger, auth, games, sessions }).listen(env.port, () => {
    logger.info(`API Le Ter démarrée sur le port ${env.port} (${env.nodeEnv})`);
  });

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
    timers?.cancelAll();
    sessionTimers?.cancelAll();
    server.closeIdleConnections();
    server.close(() => {
      // Les commandes système en cours (timeout, départ automatique) se terminent avant la
      // fermeture de la base ; les échéances restantes seront reprises au redémarrage.
      void Promise.resolve(sessions?.idle())
        .catch(() => undefined)
        .then(() => Promise.allSettled([disconnectRedis(), disconnectDatabase()]))
        .finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('Échec du démarrage :', err instanceof Error ? err.message : err);
  process.exit(1);
});
