import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { UserId } from '../../../src/domain/users/user';
import { createAuthService } from '../../../src/services/auth/create-auth-service';
import { createComplaintServices } from '../../../src/services/complaints/create-complaint-services';
import { silentLogger } from '../../../src/utils/logger';
import { TEST_JWT_SECRET } from '../../fixtures/auth';
import { FakeLanguageModel } from '../../fixtures/complaints';

/**
 * Réclamations sur un VRAI PostgreSQL (plusieurs connexions, verrous réels) : ce que PGlite, qui
 * sérialise tout sur une connexion, ne peut pas prouver. Exécutée seulement avec
 * TEST_DATABASE_URL, dans un schéma temporaire supprimé à la fin (jamais la base `le_ter`) :
 *
 *   TEST_DATABASE_URL=postgres://le_ter:le_ter@localhost:5433/le_ter_test npm test -- postgres-complaints
 */
const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
jest.setTimeout(60_000);

describeWithPostgres('Réclamations sur PostgreSQL réel (D-114)', () => {
  const schema = `complaints_test_${randomUUID().replace(/-/g, '')}`;
  let pool: Pool;
  let sql: SqlClient;
  let sequence = 0;
  const clock = () => new Date('2026-10-16T08:00:00Z');

  beforeAll(async () => {
    if (/\/le_ter(\?|$)/.test(url ?? '')) {
      throw new Error(
        'TEST_DATABASE_URL ne doit pas désigner la base le_ter : utilisez une base de test.',
      );
    }
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 12, options: `-c search_path=${schema}` });
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
  }, 120_000);

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  async function newPlayer(role: 'user' | 'admin' = 'user'): Promise<UserId> {
    sequence += 1;
    const auth = createAuthService(
      sql,
      {
        jwtSecret: TEST_JWT_SECRET,
        accessTokenTtlSeconds: 900,
        refreshTokenTtlSeconds: 3600,
        bcryptCost: 4,
      },
      silentLogger,
    );
    const user = await auth.register({
      firstName: 'Reclam',
      lastName: 'Test',
      email: `reclam${sequence}@example.com`,
      username: `reclam_${sequence}`,
      phone: `+23768${String(sequence).padStart(7, '0')}`,
      password: 'Secret123',
    });
    if (role === 'admin')
      await sql.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [user.id]);
    return user.id as UserId;
  }

  const input = (n = 0) => ({
    category: 'PAYMENT' as const,
    title: 'Recharge non créditée',
    description: `Paiement validé par l'opérateur mais pas de jetons (${n}).`,
    links: {},
  });

  it('10 créations simultanées avec la même clé : un seul dossier, une seule notification', async () => {
    const services = createComplaintServices({ sql, logger: silentLogger, clock });
    const player = await newPlayer();
    const k = `key-${randomUUID()}`;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => services.complaints.create(player, input(), k)),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const ids = new Set(
      results.map(
        (r) => (r as PromiseFulfilledResult<{ complaint: { id: string } }>).value.complaint.id,
      ),
    );
    expect(ids.size).toBe(1);
    await services.analyzer.idle();
    const { rows } = await sql.query<{ complaints: number; notifications: number }>(
      `SELECT (SELECT count(*)::int FROM complaints WHERE user_id = $1) AS complaints,
              (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND payload->>'event' = 'CREATED') AS notifications`,
      [player],
    );
    expect(rows[0]).toEqual({ complaints: 1, notifications: 1 });
  });

  it('la limite de dossiers actifs tient sous concurrence', async () => {
    const services = createComplaintServices({ sql, logger: silentLogger, clock });
    const player = await newPlayer();
    const results = await Promise.allSettled(
      Array.from({ length: 14 }, (_, i) =>
        services.complaints.create(player, input(i), `key-${randomUUID()}`),
      ),
    );
    await services.analyzer.idle();
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const { rows } = await sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM complaints WHERE user_id = $1',
      [player],
    );
    expect(rows[0]?.n).toBe(10);
  });

  it('deux instances analysent le même dossier en même temps : un seul appel au modèle', async () => {
    const seed = createComplaintServices({ sql, logger: silentLogger, clock });
    const player = await newPlayer();
    const { complaint } = await seed.complaints.create(player, input(), `key-${randomUUID()}`);
    await seed.analyzer.idle();
    await sql.query(
      `UPDATE complaints SET status = 'OPEN', ai_analysis_status = 'PENDING', analysis_claimed_at = NULL,
         ai_summary = NULL, updated_at = '2026-10-16T07:00:00Z' WHERE id = $1`,
      [complaint.id],
    );
    const models = [new FakeLanguageModel(), new FakeLanguageModel(), new FakeLanguageModel()];
    for (const m of models)
      m.fallback = JSON.stringify({ summary: 'Le joueur déclare une recharge non créditée.' });
    const instances = models.map((model) =>
      createComplaintServices({ sql, logger: silentLogger, model, clock }),
    );
    await Promise.all(
      instances.flatMap((i) => [i.analyzer.analyze(complaint.id), i.analyzer.sweep()]),
    );
    await Promise.all(instances.map((i) => i.analyzer.idle()));
    expect(models.reduce((n, m) => n + m.requests.length, 0)).toBe(1);
    const { rows } = await sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM complaint_events WHERE complaint_id = $1 AND type = 'AI_ANALYSIS_COMPLETED'`,
      [complaint.id],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('deux décisions concurrentes contradictoires : une seule appliquée, auditée une fois', async () => {
    const services = createComplaintServices({ sql, logger: silentLogger, clock });
    const player = await newPlayer();
    const [adminA, adminB] = [await newPlayer('admin'), await newPlayer('admin')];
    const { complaint } = await services.complaints.create(player, input(), `key-${randomUUID()}`);
    await services.analyzer.idle();
    const results = await Promise.allSettled([
      services.complaints.adminChangeStatus(adminA, complaint.id, {
        status: 'RESOLVED',
        expectedStatus: 'IN_REVIEW',
        decision: 'Crédit appliqué par le service des paiements.',
      }),
      services.complaints.adminChangeStatus(adminB, complaint.id, {
        status: 'REJECTED',
        expectedStatus: 'IN_REVIEW',
        decision: 'Aucun paiement retrouvé chez l’opérateur.',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const { rows } = await sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin_audit_log WHERE target_id = $1 AND action = 'COMPLAINT_STATUS_CHANGED'`,
      [complaint.id],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("l'historique est en ajout seul et une notification n'existe qu'une fois par événement", async () => {
    const services = createComplaintServices({ sql, logger: silentLogger, clock });
    const player = await newPlayer();
    const { complaint } = await services.complaints.create(player, input(), `key-${randomUUID()}`);
    await services.analyzer.idle();
    await expect(
      sql.query('DELETE FROM complaint_events WHERE complaint_id = $1', [complaint.id]),
    ).rejects.toThrow(/ajout seul/);
    const { rows } = await sql.query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM notifications WHERE user_id = $1 LIMIT 1`,
      [player],
    );
    const dedupe = rows[0]!.dedupe_key;
    const replay = await sql.query(
      `INSERT INTO notifications (id, user_id, type, payload, dedupe_key, created_at)
       VALUES ($1, $2, 'COMPLAINT_UPDATE', '{}'::jsonb, $3, now()) ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      [randomUUID(), player, dedupe],
    );
    expect(replay.rowCount).toBe(0);
  });
});
