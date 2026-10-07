import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { AuthService } from '../../../src/services/auth/auth.service';
import { createAuthService } from '../../../src/services/auth/create-auth-service';
import { silentLogger } from '../../../src/utils/logger';
import { activeTokenCount, TEST_JWT_SECRET } from '../../fixtures/auth';

/**
 * Concurrence des sessions sur un VRAI PostgreSQL (verrous de ligne, plusieurs
 * connexions). PGlite n'a qu'une connexion et sérialise tout : il ne peut pas
 * prouver l'absence de course. Suite exécutée quand TEST_DATABASE_URL est défini, ex. :
 *
 *   TEST_DATABASE_URL=postgres://le_ter:le_ter@localhost:5433/le_ter npm test
 *
 * Elle travaille dans un schéma temporaire, supprimé à la fin : la base de
 * développement n'est pas modifiée.
 */
const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;

// Base réelle partagée avec les autres suites lancées en parallèle : 5 s ne suffisent pas toujours.
jest.setTimeout(30_000);

describeWithPostgres('Sessions sur PostgreSQL réel (concurrence R-32)', () => {
  const schema = `auth_test_${randomUUID().replace(/-/g, '')}`;
  let pool: Pool;
  let sql: SqlClient;
  let auth: AuthService;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 12, options: `-c search_path=${schema}` });
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
    auth = createAuthService(
      sql,
      {
        jwtSecret: TEST_JWT_SECRET,
        accessTokenTtlSeconds: 900,
        refreshTokenTtlSeconds: 3600,
        bcryptCost: 4,
      },
      silentLogger,
    );
  }, 60_000);

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  let sequence = 0;
  async function newAccount() {
    sequence += 1;
    const input = {
      firstName: 'Concurrent',
      lastName: 'Test',
      email: `concurrent${sequence}@example.com`,
      username: `concurrent_${sequence}`,
      phone: `+23769${String(sequence).padStart(7, '0')}`,
      password: 'Secret123',
    };
    const user = await auth.register(input);
    return { ...input, userId: user.id };
  }

  it('10 logins simultanés du même utilisateur : une seule session active, aucune erreur', async () => {
    const account = await newAccount();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        auth.login({ email: account.email, password: account.password }),
      ),
    );

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await activeTokenCount(sql, account.userId)).toBe(1);
  });

  it('10 refresh simultanés avec le même jeton : exactement un succès', async () => {
    const account = await newAccount();
    const { refreshToken } = await auth.login({ email: account.email, password: account.password });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => auth.refresh(refreshToken)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await activeTokenCount(sql, account.userId)).toBe(1);
  });

  it('logins et refresh entremêlés : jamais deux sessions actives', async () => {
    const account = await newAccount();
    const { refreshToken } = await auth.login({ email: account.email, password: account.password });
    const results = await Promise.allSettled([
      auth.refresh(refreshToken),
      auth.login({ email: account.email, password: account.password }),
      auth.refresh(refreshToken),
      auth.login({ email: account.email, password: account.password }),
      auth.logout(refreshToken),
    ]);

    // Les échecs éventuels sont des refus de jeton, jamais des pannes (contrainte, verrou).
    for (const r of results) {
      if (r.status === 'rejected') {
        expect((r.reason as Error).name).toBe('InvalidRefreshTokenError');
      }
    }
    expect(await activeTokenCount(sql, account.userId)).toBe(1);
  });

  it('deux utilisateurs se connectant en même temps ne se bloquent pas', async () => {
    const [a, b] = [await newAccount(), await newAccount()];
    await Promise.all([
      auth.login({ email: a.email, password: a.password }),
      auth.login({ email: b.email, password: b.password }),
    ]);
    expect(await activeTokenCount(sql, a.userId)).toBe(1);
    expect(await activeTokenCount(sql, b.userId)).toBe(1);
  });

  it('inscriptions simultanées identiques : un seul compte', async () => {
    sequence += 1;
    const input = {
      firstName: 'Double',
      lastName: 'Test',
      email: `double${sequence}@example.com`,
      username: `double_${sequence}`,
      phone: `+23768${String(sequence).padStart(7, '0')}`,
      password: 'Secret123',
    };
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => auth.register(input)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect((r.reason as Error).name).toBe('RegistrationConflictError');
      }
    }
  });
});
