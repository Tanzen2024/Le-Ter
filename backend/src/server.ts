import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { loadEnvFile, readEnv } from './config/env';
import { connectRedis, disconnectRedis } from './config/redis';
import { createLogger } from './utils/logger';

async function main(): Promise<void> {
  loadEnvFile();
  const env = readEnv();
  const logger = createLogger();

  // PostgreSQL : source de vérité. Une base configurée mais injoignable bloque le démarrage.
  if (env.databaseUrl) {
    await connectDatabase(env.databaseUrl);
    logger.info('PostgreSQL connecté');
  } else {
    logger.warn('DATABASE_URL non défini : démarrage sans base de données');
  }

  // Redis : infrastructure volatile. Il est requis au démarrage s'il est configuré,
  // puis une coupure est tolérée (reconnexion automatique, diffusion locale).
  if (env.redisUrl) {
    await connectRedis(env.redisUrl, (err) => logger.error('Erreur Redis', { error: err.message }));
    logger.info('Redis connecté');
  } else {
    logger.warn('REDIS_URL non défini : diffusion des événements limitée à cette instance');
  }

  const server = createApp().listen(env.port, () => {
    logger.info(`API Le Ter démarrée sur le port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal: string): void => {
    logger.info(`${signal} reçu, arrêt du serveur`);
    server.close(() => {
      void Promise.allSettled([disconnectRedis(), disconnectDatabase()]).finally(() =>
        process.exit(0),
      );
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('Échec du démarrage :', err instanceof Error ? err.message : err);
  process.exit(1);
});
