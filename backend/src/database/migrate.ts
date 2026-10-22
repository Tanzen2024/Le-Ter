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

/**
 * Message lisible d'une erreur PostgreSQL. Une connexion refusée arrive en `AggregateError`
 * (une tentative par adresse, IPv6 puis IPv4) dont le `message` est vide : on détaille
 * chaque tentative. Le code SQLSTATE, `detail` et `hint` de `pg` sont ajoutés s'ils existent.
 */
function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) {
    return err.errors.map(describeError).join(' ; ');
  }
  if (!(err instanceof Error)) return String(err);
  const { code, detail, hint } = err as Error & { code?: string; detail?: string; hint?: string };
  return [
    code ? `[${code}] ${err.message || err.name}` : err.message || err.name,
    detail && `détail : ${detail}`,
    hint && `piste : ${hint}`,
  ]
    .filter(Boolean)
    .join(' — ');
}

main().catch((err: unknown) => {
  console.error('Échec de la migration :', describeError(err));
  process.exit(1);
});
