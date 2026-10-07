import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { loadEnvFile, readEnv } from './config/env';

async function main(): Promise<void> {
  loadEnvFile();
  const env = readEnv();

  if (env.mongodbUri) {
    await connectDatabase(env.mongodbUri);
    console.log('MongoDB connectée');
  } else {
    console.warn('MONGODB_URI non défini : démarrage sans base de données');
  }

  const server = createApp().listen(env.port, () => {
    console.log(`API Le Ter démarrée sur le port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal} reçu, arrêt du serveur`);
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('Échec du démarrage :', err);
  process.exit(1);
});
