import { connectDatabase, disconnectDatabase } from '../config/database';
import { loadEnvFile, readEnv } from '../config/env';
import { connectRedis, disconnectRedis, type RedisConnections } from '../config/redis';
import { parseGameId } from '../domain/game/game-id';
import { createGameService } from '../services/game/create-game-service';
import { createLogger } from '../utils/logger';

/**
 * `npm run game:finish -- <gameId>` : termine une partie SANS résultat de jeu (action
 * administrative), via GameService.finishGame. Aucune écriture directe en base : la file
 * de la partie, la version et la diffusion `game:finished` (Redis si configuré) sont
 * respectées. Ses joueurs sont libérés pour une nouvelle partie (R-18), et la ronde
 * Poursuivre/Quitter de la session s'ouvre (D-034, échéance = fin + 15 s).
 *
 * Utile tant qu'aucun jeu de règles n'est adopté : une partie démarrée ne peut pas encore
 * se terminer par le jeu. Les règles d'abandon ou de suspension restent ouvertes (R-19, R-25).
 */
async function main(): Promise<void> {
  loadEnvFile();
  const env = readEnv();
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL non défini');
  }
  const gameId = parseGameId(process.argv[2]);
  const logger = createLogger({ action: 'ADMIN_FINISH_GAME' });

  const sql = await connectDatabase(env.databaseUrl);
  let redis: RedisConnections | undefined;
  try {
    if (env.redisUrl) {
      redis = await connectRedis(env.redisUrl, (err) =>
        logger.error('Erreur Redis', { error: err.message }),
      );
    }
    const { games, sessions } = createGameService({ sql, redis, logger });
    const game = await games.finishGame(gameId);
    console.log(`Partie ${game.id} : ${game.status} (version ${game.version})`);
    if (game.sessionId) {
      // Ouvre la ronde de décision avant de rendre la main (le serveur la reprendrait sinon).
      const session = await sessions.syncSession(game.sessionId);
      console.log(
        `Session ${session.id} : décision jusqu'à ${session.round?.deadlineAt.toISOString()}`,
      );
      sessions.stopTimers();
    }
  } finally {
    await disconnectRedis();
    await disconnectDatabase();
  }
}

main().catch((err: unknown) => {
  console.error('Échec :', err instanceof Error ? err.message : err);
  process.exit(1);
});
