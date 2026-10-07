import { Pool, type PoolConfig } from 'pg';

import { createPgSqlClient, type SqlClient } from '../database/sql-client';

/**
 * - `disconnected` : aucune base configurée (DATABASE_URL vide) ;
 * - `connected` : la base répond ;
 * - `unavailable` : une base est configurée mais ne répond pas.
 */
export type DatabaseStatus = 'disconnected' | 'connected' | 'unavailable';

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

let pool: Pool | undefined;

/**
 * Réglages du pool. Sans délais, une base qui ne répond plus bloquerait pour
 * toujours la commande en cours, donc la file de sa partie (KeyedSerialQueue).
 * Les valeurs sont des choix techniques de départ, à ajuster en charge (D-027).
 */
export function poolConfig(url: string): PoolConfig {
  return {
    connectionString: url,
    max: 10,
    // Attente maximale d'une connexion libre (pool saturé) ou de son ouverture.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // Côté serveur : une requête ou une transaction oubliée est interrompue.
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 10_000,
    // Côté client : protège aussi d'un réseau coupé sans réponse du serveur.
    query_timeout: 15_000,
  };
}

export interface ConnectDatabaseOptions {
  /** Remplace des réglages du pool (ex. migrations : pas de limite de durée). */
  overrides?: Partial<PoolConfig>;
  /** Erreur d'une connexion inactive du pool (redémarrage de PostgreSQL…). */
  onError?: (err: Error) => void;
}

/** Ouvre le pool PostgreSQL et vérifie que la base répond. */
export async function connectDatabase(
  url: string,
  { overrides, onError }: ConnectDatabaseOptions = {},
): Promise<SqlClient> {
  if (pool) {
    throw new Error('Base PostgreSQL déjà connectée');
  }
  const created = new Pool({ ...poolConfig(url), ...overrides });
  // Sans écouteur, l'erreur d'une connexion inactive arrêterait le processus.
  created.on(
    'error',
    onError ?? ((err) => console.error('Erreur PostgreSQL (connexion inactive) :', err.message)),
  );
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
