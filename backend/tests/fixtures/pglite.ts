import { PGlite } from '@electric-sql/pglite';

import { loadMigrations, runMigrations } from '../../src/database/migrator';
import type { SqlClient, SqlExecutor } from '../../src/database/sql-client';

/**
 * PostgreSQL embarqué (PGlite : le vrai moteur PostgreSQL compilé en WASM, en
 * mémoire). Les tests exécutent donc le SQL réel des dépôts et des migrations,
 * sans serveur ni Docker.
 */
export function pgliteSqlClient(db: PGlite): SqlClient {
  const executor = (target: Pick<PGlite, 'query' | 'exec'>): SqlExecutor => ({
    async query<Row extends object>(text: string, params?: readonly unknown[]) {
      // Comme `pg` : sans paramètre, protocole simple (plusieurs instructions possibles,
      // ex. un fichier de migration) ; avec paramètres, requête préparée.
      if (!params || params.length === 0) {
        const last = (await target.exec(text)).at(-1);
        return { rows: (last?.rows ?? []) as Row[], rowCount: last?.affectedRows ?? 0 };
      }
      const result = await target.query<Row>(text, params as unknown[]);
      return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
    },
  });
  return {
    ...executor(db),
    transaction: (work) => db.transaction((tx) => work(executor(tx))),
  };
}

export interface TestDatabase {
  db: PGlite;
  sql: SqlClient;
  /** Vide les tables métier entre deux tests (le schéma reste en place). */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Base neuve avec toutes les migrations de `backend/migrations/` appliquées. */
export async function createMigratedDatabase(): Promise<TestDatabase> {
  const db = new PGlite();
  const sql = pgliteSqlClient(db);
  await runMigrations(sql, await loadMigrations());
  return {
    db,
    sql,
    reset: async () => {
      await db.exec('TRUNCATE games CASCADE');
    },
    close: () => db.close(),
  };
}
