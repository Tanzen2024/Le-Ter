import request from 'supertest';

import {
  NO_ADMIN_LOGIN_LIMITS,
  adminLogin,
  asAdmin,
  createAdmin,
  createAdminTestApp,
} from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Connexion et session d'administration (D-061) : rôle `admin` exigé AVANT toute session,
 * session dédiée bornée côté serveur (8 h absolues, 30 min d'inactivité), déconnexion
 * effective, garde de TOUTES les routes /api/admin/*, audit des connexions.
 */
jest.setTimeout(PGLITE_TIMEOUT_MS);

let database: TestDatabase;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);

afterAll(() => database.close());
afterEach(() => database.reset());

const MINUTE = 60_000;

async function auditRows(action?: string) {
  const { rows } = await database.sql.query<{
    action: string;
    actor_id: string | null;
    target_type: string;
    target_id: string | null;
    outcome: string;
    details: Record<string, unknown>;
  }>(
    `SELECT action, actor_id, target_type, target_id, outcome, details FROM admin_audit_log
     ${action ? 'WHERE action = $1' : ''} ORDER BY created_at, id`,
    action ? [action] : [],
  );
  return rows;
}

describe('accès aux routes /api/admin/*', () => {
  it('sans jeton : 401', async () => {
    const { app } = createAdminTestApp(database.sql);
    const res = await request(app).get('/api/admin/dashboard').expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('jeton d’un joueur : 403, quelle que soit la route admin (nouvelle ou existante)', async () => {
    const { app } = createAdminTestApp(database.sql);
    const player = await registerAndLogin(app);
    for (const path of [
      '/api/admin/dashboard',
      '/api/admin/settings/detection',
      '/api/admin/tournaments',
    ]) {
      const res = await asAdmin(app, player.accessToken).get(path);
      expect(res.status).toBe(403);
    }
  });

  it('compte admin connecté par l’application mobile (session joueur) : 401 ADMIN_SESSION_REQUIRED', async () => {
    const { app } = createAdminTestApp(database.sql);
    const account = await registerAndLogin(app);
    await database.sql.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [account.userId]);
    for (const path of [
      '/api/admin/dashboard',
      '/api/admin/settings/detection',
      '/api/admin/tournaments',
    ]) {
      const res = await asAdmin(app, account.accessToken).get(path);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('ADMIN_SESSION_REQUIRED');
    }
  });

  it('administration non configurée : 503 sur toutes les routes admin', async () => {
    const { app } = createAdminTestApp(database.sql, { extra: { admin: undefined } });
    await request(app).post('/api/admin/auth/login').send({}).expect(503);
    await request(app).get('/api/admin/tournaments').expect(503);
  });
});

describe('POST /api/admin/auth/login', () => {
  it('administrateur : session dédiée, rôle présenté SUPER_ADMIN, audit ADMIN_LOGIN_SUCCEEDED', async () => {
    const { app } = createAdminTestApp(database.sql);
    const admin = await createAdmin(app, database.sql);
    const session = await asAdmin(app, admin.accessToken)
      .get('/api/admin/auth/session')
      .expect(200);
    expect(session.body.displayRole).toBe('SUPER_ADMIN');
    expect(session.body.user.role).toBe('admin');
    expect(session.body.session.absoluteLifetimeSeconds).toBe(8 * 3600);
    expect(session.body.session.idleTimeoutSeconds).toBe(30 * 60);
    expect(JSON.stringify(session.body)).not.toMatch(/token|password/i);

    const [succeeded] = await auditRows('ADMIN_LOGIN_SUCCEEDED');
    expect(succeeded).toMatchObject({ actor_id: admin.userId, outcome: 'SUCCESS' });
  });

  it('compte joueur aux bons identifiants : refusé comme un mauvais mot de passe, sans révoquer sa session mobile', async () => {
    const { app } = createAdminTestApp(database.sql);
    const player = await registerAndLogin(app);
    const refused = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: player.email, password: player.password })
      .expect(401);
    const wrong = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: player.email, password: 'Mauvais123' })
      .expect(401);
    expect(refused.body).toEqual(wrong.body);
    // La session mobile du joueur reste valable.
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);

    const failures = await auditRows('ADMIN_LOGIN_FAILED');
    // Horloge figée : même horodatage, l'ordre des deux lignes n'est pas garanti.
    expect(failures.map((f) => f.details.reason).sort()).toEqual([
      'invalid_credentials',
      'not_admin',
    ]);
    expect(failures.every((f) => f.actor_id === null && f.outcome === 'FAILURE')).toBe(true);
    expect(failures.every((f) => f.target_id === player.userId)).toBe(true);
  });

  it('compte inconnu : échec audité sans acteur ni cible, sans email ni mot de passe dans le journal', async () => {
    const { app } = createAdminTestApp(database.sql);
    await request(app)
      .post('/api/admin/auth/login')
      .send({ email: 'inconnu@example.com', password: 'Secret123' })
      .expect(401);
    const [failure] = await auditRows('ADMIN_LOGIN_FAILED');
    expect(failure).toMatchObject({
      actor_id: null,
      target_type: 'ADMIN_ACCOUNT',
      target_id: null,
      details: { reason: 'unknown_account' },
    });
    expect(JSON.stringify(await auditRows())).not.toMatch(/inconnu@example|Secret123/);
  });

  it('tentatives répétées : 429 au-delà de la limite par compte', async () => {
    const { app } = createAdminTestApp(database.sql, {
      loginLimits: { ...NO_ADMIN_LOGIN_LIMITS, perAccount: { windowMs: 60_000, max: 2 } },
    });
    const body = { email: 'cible@example.com', password: 'Mauvais123' };
    await request(app).post('/api/admin/auth/login').send(body).expect(401);
    await request(app).post('/api/admin/auth/login').send(body).expect(401);
    const res = await request(app).post('/api/admin/auth/login').send(body).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('la connexion admin remplace la session précédente du compte (R-32) et termine l’ancienne session admin', async () => {
    const { app } = createAdminTestApp(database.sql);
    const first = await createAdmin(app, database.sql);
    const second = await adminLogin(app, first.email, first.password);
    await asAdmin(app, first.accessToken).get('/api/admin/dashboard').expect(401);
    await asAdmin(app, second.accessToken).get('/api/admin/dashboard').expect(200);
    const { rows } = await database.sql.query<{ end_reason: string | null }>(
      'SELECT end_reason FROM admin_sessions ORDER BY started_at, session_id',
    );
    expect(rows.map((r) => r.end_reason).sort()).toEqual(['REPLACED', null].sort());
  });
});

describe('expiration de la session d’administration', () => {
  it('30 minutes sans activité : 401 ADMIN_SESSION_EXPIRED, jetons révoqués, audit', async () => {
    const ctx = createAdminTestApp(database.sql);
    const admin = await createAdmin(ctx.app, database.sql);
    ctx.advance(10 * MINUTE); // l'access token (15 min) reste valide
    await asAdmin(ctx.app, admin.accessToken).get('/api/admin/dashboard').expect(200);
    ctx.advance(4 * MINUTE);
    await asAdmin(ctx.app, admin.accessToken).get('/api/admin/dashboard').expect(200);

    // 30 min d'inactivité : on rafraîchit l'access token pour isoler la règle d'inactivité.
    ctx.advance(30 * MINUTE);
    const refreshed = await request(ctx.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: admin.refreshToken })
      .expect(200);
    const res = await asAdmin(ctx.app, refreshed.body.accessToken).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_SESSION_EXPIRED');
    // Déconnexion effective : le jeton est désormais refusé partout, plus de rafraîchissement.
    await request(ctx.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(401);
    await request(ctx.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
    const [expired] = await auditRows('ADMIN_SESSION_EXPIRED');
    expect(expired).toMatchObject({ actor_id: admin.userId, details: { reason: 'IDLE_TIMEOUT' } });
  });

  it('8 heures au plus, même avec une activité continue ; le refresh token ne dépasse jamais la borne', async () => {
    const ctx = createAdminTestApp(database.sql);
    const admin = await createAdmin(ctx.app, database.sql);
    let tokens = { accessToken: admin.accessToken, refreshToken: admin.refreshToken };
    for (let elapsed = 0; elapsed < 8 * 60 - 20; elapsed += 20) {
      ctx.advance(20 * MINUTE);
      const res = await request(ctx.app)
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);
      tokens = res.body;
      await asAdmin(ctx.app, tokens.accessToken).get('/api/admin/auth/session').expect(200);
    }
    const { rows } = await database.sql.query<{ expires_at: Date; session_expires_at: Date }>(
      `SELECT expires_at, session_expires_at FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [admin.userId],
    );
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.expires_at).getTime()).toBeLessThanOrEqual(
      new Date(rows[0]!.session_expires_at).getTime(),
    );

    ctx.advance(20 * MINUTE); // 8 h 00 atteintes
    const res = await asAdmin(ctx.app, tokens.accessToken).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
    expect(['ADMIN_SESSION_EXPIRED', 'UNAUTHENTICATED']).toContain(res.body.code);
  });

  it('les sessions des joueurs ne sont pas bornées (comportement mobile inchangé)', async () => {
    const ctx = createAdminTestApp(database.sql);
    const player = await registerAndLogin(ctx.app);
    const { rows } = await database.sql.query<{ session_expires_at: Date | null }>(
      'SELECT session_expires_at FROM refresh_tokens WHERE user_id = $1',
      [player.userId],
    );
    expect(rows).toEqual([{ session_expires_at: null }]);
  });
});

describe('POST /api/admin/auth/logout', () => {
  it('déconnexion effective et auditée ; le jeton ne donne plus accès', async () => {
    const { app } = createAdminTestApp(database.sql);
    const admin = await createAdmin(app, database.sql);
    await asAdmin(app, admin.accessToken).post('/api/admin/auth/logout').expect(204);
    await asAdmin(app, admin.accessToken).get('/api/admin/dashboard').expect(401);
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: admin.refreshToken })
      .expect(401);
    const [logout] = await auditRows('ADMIN_LOGOUT');
    expect(logout).toMatchObject({ actor_id: admin.userId, outcome: 'SUCCESS' });
  });
});

describe('intégrité du journal d’audit', () => {
  it('UPDATE et DELETE sont refusés par la base', async () => {
    const { app } = createAdminTestApp(database.sql);
    await createAdmin(app, database.sql);
    await expect(
      database.sql.query(`UPDATE admin_audit_log SET outcome = 'FAILURE'`),
    ).rejects.toThrow(/ajout seul/);
    await expect(database.sql.query('DELETE FROM admin_audit_log')).rejects.toThrow(/ajout seul/);
    expect((await auditRows()).length).toBeGreaterThan(0);
  });

  it('un acteur absent n’est accepté que pour un échec de connexion', async () => {
    await expect(
      database.sql.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, created_at)
         VALUES (gen_random_uuid(), NULL, 'USER_VIEWED', 'USER', gen_random_uuid(), now())`,
      ),
    ).rejects.toThrow();
  });
});
