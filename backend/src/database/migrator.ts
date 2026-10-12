import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { SqlClient } from './sql-client';

/** `backend/migrations/`, depuis `src/database/` comme depuis `dist/database/`. */
export const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

/** Clé du verrou consultatif : deux instances ne migrent jamais en même temps. */
const MIGRATION_LOCK_KEY = 728_302_001;

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
  /**
   * Empreinte des octets bruts du fichier, acceptée en plus de `checksum` pour une migration
   * déjà appliquée : les premières étaient enregistrées ainsi (LF ou CRLF selon l'extraction).
   */
  rawChecksum?: string;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f)).sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(join(dir, name), 'utf8');
      // Empreinte sur des fins de ligne LF : une extraction Git en CRLF (Windows, autocrlf)
      // ne doit pas faire passer une migration appliquée pour modifiée.
      const checksum = sha256(sql.replace(/\r\n/g, '\n'));
      return { name, sql, checksum, rawChecksum: sha256(sql) };
    }),
  );
}

/**
 * Applique les migrations manquantes, dans l'ordre, en UNE transaction :
 * soit toutes passent, soit la base reste inchangée (DDL transactionnel de
 * PostgreSQL). Une migration déjà appliquée ne doit jamais être modifiée :
 * son empreinte est vérifiée et une différence bloque la migration.
 *
 * Conséquence : pas de `CREATE INDEX CONCURRENTLY` ici (interdit dans une transaction).
 *
 * @returns les noms des migrations appliquées par cet appel.
 */
export async function runMigrations(
  client: SqlClient,
  migrations: readonly Migration[],
): Promise<string[]> {
  return client.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    await tx.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await tx.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    const known = new Set(migrations.map((m) => m.name));
    const unknown = [...applied.keys()].filter((name) => !known.has(name));
    if (unknown.length > 0) {
      throw new Error(`Migrations appliquées absentes du code : ${unknown.join(', ')}`);
    }

    const done: string[] = [];
    for (const migration of migrations) {
      const checksum = applied.get(migration.name);
      if (checksum !== undefined) {
        if (checksum !== migration.checksum && checksum !== migration.rawChecksum) {
          throw new Error(`Migration déjà appliquée puis modifiée : ${migration.name}`);
        }
        continue;
      }
      await tx.query(migration.sql);
      await tx.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        migration.name,
        migration.checksum,
      ]);
      done.push(migration.name);
    }
    return done;
  });
}

/**
 * Migrations du code non encore appliquées, SANS rien modifier (lecture seule). Une base
 * jamais migrée (aucune table `schema_migrations`) les renvoie toutes.
 */
export async function pendingMigrations(
  client: SqlClient,
  migrations: readonly Migration[],
): Promise<string[]> {
  const { rows: exists } = await client.query<{ present: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present",
  );
  if (!exists[0]?.present) return migrations.map((m) => m.name);
  const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  return migrations.map((m) => m.name).filter((name) => !applied.has(name));
}
