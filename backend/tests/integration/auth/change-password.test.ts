import request from 'supertest';

import {
  activeTokenCount,
  createAuthTestApp,
  login,
  NO_RATE_LIMITS,
  registerAndLogin,
  type AuthTestContext,
} from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * POST /api/auth/password : changement du mot de passe de l'utilisateur authentifié.
 * Mot de passe actuel vérifié (bcrypt), politique de l'inscription, hash dans PostgreSQL,
 * session courante conservée (R-32 : c'est la seule), rien de sensible journalisé.
 */
let database: TestDatabase;
let ctx: AuthTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
  await registerAndLogin(createAuthTestApp(database.sql).app);
  await database.reset();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  ctx = createAuthTestApp(database.sql);
});
afterEach(() => database.reset());

const NEW_PASSWORD = 'Nouveau456';

const change = (accessToken: string | undefined, body: Record<string, unknown>) => {
  const req = request(ctx.app).post('/api/auth/password');
  return (accessToken ? req.set('Authorization', `Bearer ${accessToken}`) : req).send(body);
};

const passwordHashOf = async (userId: string) =>
  (
    await database.sql.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId],
    )
  ).rows[0]!.password_hash;

describe('POST /api/auth/password', () => {
  it('succès : 204, hash remplacé en base, reconnexion avec le nouveau, ancien refusé', async () => {
    const session = await registerAndLogin(ctx.app);
    const before = await passwordHashOf(session.userId);

    const res = await change(session.accessToken, {
      currentPassword: session.password,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');

    const after = await passwordHashOf(session.userId);
    expect(after).not.toBe(before);
    expect(after).toMatch(/^\$2[aby]\$/); // bcrypt, jamais le mot de passe en clair
    expect(after).not.toContain(NEW_PASSWORD);

    await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: session.email, password: session.password })
      .expect(401);
    await login(ctx.app, session.email, NEW_PASSWORD);
  });

  it('sessions : la session courante reste valide, une seule session active', async () => {
    const session = await registerAndLogin(ctx.app);
    await change(session.accessToken, {
      currentPassword: session.password,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    }).expect(204);
    // Pas de déconnexion : jeton d'accès et jeton de renouvellement toujours acceptés.
    await request(ctx.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    const refreshed = await request(ctx.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    expect(await activeTokenCount(database.sql, session.userId)).toBe(1);
  });

  it('mot de passe actuel incorrect : 400 INVALID_CURRENT_PASSWORD, rien ne change', async () => {
    const session = await registerAndLogin(ctx.app);
    const before = await passwordHashOf(session.userId);
    const res = await change(session.accessToken, {
      currentPassword: 'Mauvais999',
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'INVALID_CURRENT_PASSWORD',
      fields: { currentPassword: 'Le mot de passe actuel est incorrect.' },
    });
    expect(await passwordHashOf(session.userId)).toBe(before);
    // L'utilisateur n'est pas déconnecté.
    await request(ctx.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
  });

  it('confirmation différente, mot de passe non conforme, identique, champs manquants : 400', async () => {
    const session = await registerAndLogin(ctx.app);
    const before = await passwordHashOf(session.userId);
    const cases: [Record<string, unknown>, string][] = [
      [
        {
          currentPassword: session.password,
          newPassword: NEW_PASSWORD,
          confirmPassword: 'Autre789',
        },
        'confirmPassword',
      ],
      [
        { currentPassword: session.password, newPassword: 'court1', confirmPassword: 'court1' },
        'newPassword',
      ],
      [
        {
          currentPassword: session.password,
          newPassword: 'sanschiffre',
          confirmPassword: 'sanschiffre',
        },
        'newPassword',
      ],
      [
        {
          currentPassword: session.password,
          newPassword: session.password,
          confirmPassword: session.password,
        },
        'newPassword',
      ],
      [{}, 'currentPassword'],
    ];
    for (const [body, field] of cases) {
      const res = await change(session.accessToken, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.fields).toHaveProperty(field);
    }
    expect(await passwordHashOf(session.userId)).toBe(before);
  });

  it('non authentifié : 401 sans jeton ou avec un jeton invalide', async () => {
    const body = {
      currentPassword: 'Secret123',
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    };
    expect((await change(undefined, body)).status).toBe(401);
    expect((await change('pas-un-jeton', body)).status).toBe(401);
  });

  it('identité du JWT seulement : un userId envoyé dans le corps est ignoré', async () => {
    const victim = await registerAndLogin(ctx.app);
    const attacker = await registerAndLogin(ctx.app);
    const victimHash = await passwordHashOf(victim.userId);
    await change(attacker.accessToken, {
      userId: victim.userId,
      currentPassword: attacker.password,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    }).expect(204);
    expect(await passwordHashOf(victim.userId)).toBe(victimHash);
    await login(ctx.app, attacker.email, NEW_PASSWORD);
  });

  it('aucun mot de passe ni hash dans les journaux', async () => {
    const session = await registerAndLogin(ctx.app);
    await change(session.accessToken, {
      currentPassword: 'Mauvais999',
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    }).expect(400);
    await change(session.accessToken, {
      currentPassword: session.password,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    }).expect(204);
    const logs = JSON.stringify(ctx.logLines);
    for (const secret of [session.password, NEW_PASSWORD, 'Mauvais999', '$2']) {
      expect(logs).not.toContain(secret);
    }
    expect(
      ctx.logLines.some((l) => l.msg === 'password changed' || l.message === 'password changed'),
    ).toBe(true);
  });

  it('limite de tentatives par utilisateur (429)', async () => {
    ctx = createAuthTestApp(database.sql, {
      rateLimits: { ...NO_RATE_LIMITS, passwordChange: { windowMs: 60_000, max: 2 } },
    });
    const session = await registerAndLogin(ctx.app);
    const wrong = {
      currentPassword: 'Mauvais999',
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    };
    await change(session.accessToken, wrong).expect(400);
    await change(session.accessToken, wrong).expect(400);
    const limited = await change(session.accessToken, wrong);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
  });
});
