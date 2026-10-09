import type { Pool, PoolClient } from 'pg';

import { createPgSqlClient } from '../../../src/database/sql-client';

/**
 * Libération des connexions par `transaction` : toujours rendue au pool, et DÉTRUITE
 * (release(err)) quand le ROLLBACK échoue, car elle peut alors porter une requête encore
 * en cours côté serveur (délai client dépassé) qui bloquerait l'emprunteur suivant.
 */
function fakePool(failOn: Partial<Record<string, Error>> = {}) {
  const release = jest.fn();
  const statements: string[] = [];
  const connection = {
    query: jest.fn(async (text: string) => {
      statements.push(text);
      const err = failOn[text];
      if (err) throw err;
      return { rows: [], rowCount: 0 };
    }),
    release,
  } as unknown as PoolClient;
  const pool = { connect: jest.fn(async () => connection) } as unknown as Pool;
  return { sql: createPgSqlClient(pool), release, statements };
}

describe('createPgSqlClient().transaction — libération des connexions', () => {
  it('succès : COMMIT puis connexion rendue au pool', async () => {
    const p = fakePool();
    await expect(p.sql.transaction(async (tx) => (await tx.query('SELECT 1'), 42))).resolves.toBe(
      42,
    );
    expect(p.statements).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(p.release).toHaveBeenCalledTimes(1);
    expect(p.release).toHaveBeenCalledWith(undefined);
  });

  it('échec du travail, ROLLBACK réussi : connexion saine rendue au pool', async () => {
    const p = fakePool({ 'SELECT 1': new Error('canceling statement due to statement timeout') });
    await expect(p.sql.transaction((tx) => tx.query('SELECT 1'))).rejects.toThrow(
      'statement timeout',
    );
    expect(p.statements).toEqual(['BEGIN', 'SELECT 1', 'ROLLBACK']);
    expect(p.release).toHaveBeenCalledWith(undefined);
  });

  it("ROLLBACK en échec (délai client) : l'erreur d'origine remonte, la connexion est détruite", async () => {
    const rollbackErr = new Error('Query read timeout');
    const p = fakePool({
      'SELECT 1': new Error('Query read timeout'),
      ROLLBACK: rollbackErr,
    });
    await expect(p.sql.transaction((tx) => tx.query('SELECT 1'))).rejects.toThrow(
      'Query read timeout',
    );
    expect(p.release).toHaveBeenCalledTimes(1);
    expect(p.release).toHaveBeenCalledWith(rollbackErr);
  });
});
