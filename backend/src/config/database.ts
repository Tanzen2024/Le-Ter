import { Pool } from 'pg';

import { createPgSqlClient, type SqlClient } from '../database/sql-client';

/**
 * - `disconnected` : aucune base configurée (DATABASE_URL vide) ;
 * - `connected` : la base répond ;
 * - `unavailable` : une base est configurée mais ne répond pas.
 */
export type DatabaseStatus = 'disconnected' | 'connected' | 'unavailable';

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

let pool: Pool | undefined;

/** Ouvre le pool PostgreSQL et vérifie que la base répond. */
export async function connectDatabase(url: string): Promise<SqlClient> {
  if (pool) {
    throw new Error('Base PostgreSQL déjà connectée');
  }
  const created = new Pool({ connectionString: url });
  // Sans écouteur, l'erreur d'une connexion inactive arrêterait le processus.
  created.on('error', (err) => {
    console.error('Erreur PostgreSQL (connexion inactive) :', err.message);
  });
  try {
    await created.query('SELECT 1');
  } catch (err) {
    await created.end().catch(() => undefined);
    throw err;
  }
  pool = created;
  return createPgSqlClient(created);
}

export async function disconnectDatabase(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.end();
}

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  if (!pool) {
    return 'disconnected';
  }
  try {
    await withTimeout(pool.query('SELECT 1'), HEALTH_CHECK_TIMEOUT_MS);
    return 'connected';
  } catch {
    return 'unavailable';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
