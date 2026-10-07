import type { Pool } from 'pg';

/**
 * Accès SQL minimal dont dépendent les dépôts. Il isole les dépôts du pilote :
 * `pg.Pool` en production, PGlite (PostgreSQL embarqué) dans les tests.
 *
 * Les requêtes sont toujours paramétrées ($1, $2…) : aucune valeur n'est
 * concaténée dans le texte SQL.
 */
export interface SqlExecutor {
  query<Row extends object = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
}

export interface SqlResult<Row> {
  rows: Row[];
  /** Lignes insérées, modifiées ou supprimées. */
  rowCount: number;
}

export interface SqlClient extends SqlExecutor {
  /**
   * Exécute `work` dans une transaction sur une seule connexion : COMMIT si la
   * promesse est tenue, ROLLBACK si elle est rejetée.
   */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/** Codes d'erreur PostgreSQL utilisés par les dépôts. */
export const PG_UNIQUE_VIOLATION = '23505';

export function isPgError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;
}

export function createPgSqlClient(pool: Pool): SqlClient {
  return {
    async query<Row extends object>(text: string, params?: readonly unknown[]) {
      const result = await pool.query<Row>(text, params as unknown[] | undefined);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },

    async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const connection = await pool.connect();
      const tx: SqlExecutor = {
        async query<Row extends object>(text: string, params?: readonly unknown[]) {
          const result = await connection.query<Row>(text, params as unknown[] | undefined);
          return { rows: result.rows, rowCount: result.rowCount ?? 0 };
        },
      };
      try {
        await connection.query('BEGIN');
        const value = await work(tx);
        await connection.query('COMMIT');
        return value;
      } catch (err) {
        await connection.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        connection.release();
      }
    },
  };
}
