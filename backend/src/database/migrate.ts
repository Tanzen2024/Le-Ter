import { connectDatabase, disconnectDatabase } from '../config/database';
import { loadEnvFile, readEnv } from '../config/env';
import { loadMigrations, runMigrations } from './migrator';

/** `npm run db:migrate` : applique les migrations de `backend/migrations/`. */
async function main(): Promise<void> {
  loadEnvFile();
  const { databaseUrl } = readEnv();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL non défini : aucune base à migrer');
  }

  // Une migration (index sur une grande table) peut légitimement être longue.
  const client = await connectDatabase(databaseUrl, {
    overrides: { statement_timeout: 0, query_timeout: 0 },
  });
  try {
    const applied = await runMigrations(client, await loadMigrations());
    console.log(
      applied.length > 0 ? `Migrations appliquées : ${applied.join(', ')}` : 'Schéma à jour',
    );
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err: unknown) => {
  console.error('Échec de la migration :', err instanceof Error ? err.message : err);
  process.exit(1);
});
