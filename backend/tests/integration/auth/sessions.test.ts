import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { newUserId } from '../../../src/domain/users/user';
import { createErrorHandler } from '../../../src/middleware/error-handler';
import { createRequireAuth, getAuth } from '../../../src/middleware/require-auth';
import { silentLogger } from '../../../src/utils/logger';
import {
  activeTokenCount,
  createAuthTestApp,
  login,
  registerAndLogin,
  REFRESH_TTL_SECONDS,
  TEST_JWT_SECRET,
  type AuthTestContext,
} from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

let database: TestDatabase;
let ctx: AuthTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  ctx = createAuthTestApp(database.sql);
});
afterEach(() => database.reset());

const refresh = (refreshToken: unknown) =>
  request(ctx.app).post('/api/auth/refresh').send({ refreshToken });
const logout = (refreshToken: unknown) =>
  request(ctx.app).post('/api/auth/logout').send({ refreshToken });
const me = (token?: string) => {
  const req = request(ctx.app).get('/api/auth/me');
  return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
};

/** JWT signé avec le vrai secret, pour tester ce que requireAuth fait d'un contenu choisi. */
function signedToken(claims: { sub: string; sid: string; role?: string }, expiresIn = 900) {
  return jwt.sign(
    {
      role: claims.role ?? 'user',
      sid: claims.sid,
      iat: Date.parse('2026-10-07T10:00:00Z') / 1000,
    },
    TEST_JWT_SECRET,
    { subject: claims.sub, issuer: 'le-ter-api', audience: 'le-ter-app', expiresIn },
  );
}

describe('Session unique (R-32)', () => {
  it('TEST 1 — un login crée une session active', async () => {
    const a = await registerAndLogin(ctx.app);
    expect(await activeTokenCount(database.sql, a.userId)).toBe(1);
    await me(a.accessToken).expect(200);
  });

  it('TEST 2 — un second login (autre appareil) révoque la session A ; B est active', async () => {
    const deviceA = await registerAndLogin(ctx.app);
    const deviceB = await login(ctx.app, deviceA.email, deviceA.password);

    expect(await activeTokenCount(database.sql, deviceA.userId)).toBe(1);
    // L'access token de A est refusé immédiatement, sans attendre son expiration.
    await me(deviceA.accessToken).expect(401);
    await me(deviceB.accessToken).expect(200);
  });

  it('TEST 3 — le refresh token de la session A est rejeté', async () => {
    const deviceA = await registerAndLogin(ctx.app);
    await login(ctx.app, deviceA.email, deviceA.password);

    const res = await refresh(deviceA.refreshToken).expect(401);
    expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('TEST 4 — le refresh token de la session B fonctionne', async () => {
    const deviceA = await registerAndLogin(ctx.app);
    const deviceB = await login(ctx.app, deviceA.email, deviceA.password);
    await refresh(deviceB.refreshToken).expect(200);
  });

  it('TEST 5 — deux logins simultanés du même utilisateur : une seule session active', async () => {
    const user = await registerAndLogin(ctx.app);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(ctx.app)
          .post('/api/auth/login')
          .send({ email: user.email, password: user.password }),
      ),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await activeTokenCount(database.sql, user.userId)).toBe(1);
    const usable = await Promise.all(results.map((r) => refresh(r.body.refreshToken)));
    expect(usable.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('TEST 6 — deux refresh simultanés avec le même jeton : un seul réussit', async () => {
    const user = await registerAndLogin(ctx.app);
    const results = await Promise.all([refresh(user.refreshToken), refresh(user.refreshToken)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await activeTokenCount(database.sql, user.userId)).toBe(1);
  });

  it('TEST 7 — deux utilisateurs différents ont chacun leur session, indépendantes', async () => {
    const a = await registerAndLogin(ctx.app);
    const b = await registerAndLogin(ctx.app);
    await login(ctx.app, b.email, b.password); // nouveau login de B : A n'est pas touché

    expect(await activeTokenCount(database.sql, a.userId)).toBe(1);
    expect(await activeTokenCount(database.sql, b.userId)).toBe(1);
    await me(a.accessToken).expect(200);
    await refresh(a.refreshToken).expect(200);
  });

  it('la base refuse deux jetons actifs pour un même utilisateur (index unique partiel)', async () => {
    const user = await registerAndLogin(ctx.app);
    await expect(
      database.sql.query(
        `INSERT INTO refresh_tokens (id, user_id, session_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, $3, 'h', now(), now() + interval '1 day')`,
        [newUserId(), user.userId, newUserId()],
      ),
    ).rejects.toThrow();
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotation : nouveaux jetons, ancien refresh token inutilisable, nouveau accepté', async () => {
    const user = await registerAndLogin(ctx.app);
    const rotated = await refresh(user.refreshToken).expect(200);

    expect(Object.keys(rotated.body).sort()).toEqual(['accessToken', 'refreshToken']);
    expect(rotated.body.refreshToken).not.toBe(user.refreshToken);
    await refresh(user.refreshToken).expect(401);
    await refresh(rotated.body.refreshToken).expect(200);
    await me(rotated.body.accessToken).expect(200);
  });

  it('la rotation garde la même session : l’access token précédent reste valide', async () => {
    const user = await registerAndLogin(ctx.app);
    await refresh(user.refreshToken).expect(200);
    await me(user.accessToken).expect(200);
  });

  it.each([
    ['inconnu', 'A'.repeat(43)],
    ['mal formé', 'pas-un-jeton'],
    ['de mauvais type', 12],
  ])('rejette un jeton %s', async (_label, token) => {
    const res = await refresh(token);
    expect([400, 401]).toContain(res.status);
  });

  it('rejette un jeton expiré', async () => {
    const user = await registerAndLogin(ctx.app);
    ctx.advance(REFRESH_TTL_SECONDS * 1000 + 1);
    await refresh(user.refreshToken).expect(401);
  });

  it('rejette le jeton d’un compte désactivé ou supprimé', async () => {
    const disabled = await registerAndLogin(ctx.app);
    const deleted = await registerAndLogin(ctx.app);
    await database.sql.query("UPDATE users SET status = 'disabled' WHERE id = $1", [
      disabled.userId,
    ]);
    await database.sql.query('DELETE FROM users WHERE id = $1', [deleted.userId]);

    await refresh(disabled.refreshToken).expect(401);
    await refresh(deleted.refreshToken).expect(401);
  });

  it('ne journalise jamais les jetons', async () => {
    const user = await registerAndLogin(ctx.app);
    const rotated = await refresh(user.refreshToken).expect(200);
    await refresh(user.refreshToken).expect(401);
    const logs = JSON.stringify(ctx.logLines);
    for (const secret of [user.refreshToken, rotated.body.refreshToken, rotated.body.accessToken]) {
      expect(logs).not.toContain(secret);
    }
    expect(ctx.logLines).toContainEqual(
      expect.objectContaining({ message: 'refresh rejected', reason: 'revoked' }),
    );
  });
});

describe('POST /api/auth/logout', () => {
  it('révoque la session : refresh et access token sont ensuite rejetés', async () => {
    const user = await registerAndLogin(ctx.app);
    await logout(user.refreshToken).expect(204);

    await refresh(user.refreshToken).expect(401);
    await me(user.accessToken).expect(401);
    expect(await activeTokenCount(database.sql, user.userId)).toBe(0);
  });

  it('un second logout (ou un jeton inconnu) est sans effet et répond 204', async () => {
    const user = await registerAndLogin(ctx.app);
    await logout(user.refreshToken).expect(204);
    await logout(user.refreshToken).expect(204);
    await logout('B'.repeat(43)).expect(204);
  });

  it('ne crée aucune nouvelle session', async () => {
    const user = await registerAndLogin(ctx.app);
    await logout(user.refreshToken).expect(204);
    const { rows } = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1',
      [user.userId],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('exige le refresh token dans le corps', async () => {
    await request(ctx.app).post('/api/auth/logout').send({}).expect(400);
  });
});

describe('GET /api/auth/me', () => {
  it('renvoie l’utilisateur du JWT', async () => {
    const user = await registerAndLogin(ctx.app);
    const res = await me(user.accessToken).expect(200);
    expect(res.body.user.id).toBe(user.userId);
    expect(res.body.user).not.toHaveProperty('passwordHash');
    // Numéro d'ordre du joueur sur la plateforme (D-133), affiché dans le HUD de l'app.
    const { rows } = await database.sql.query<{ player_number: string }>(
      'SELECT player_number FROM users WHERE id = $1',
      [user.userId],
    );
    expect(res.body.user.playerNumber).toBe(Number(rows[0]?.player_number));
  });

  it.each([
    ['absent', undefined],
    ['mal formé', 'abc'],
    ['invalide', 'aaa.bbb.ccc'],
  ])('401 avec un token %s', async (_label, token) => {
    const res = await me(token).expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('401 avec un token expiré (15 min)', async () => {
    const user = await registerAndLogin(ctx.app);
    ctx.advance(15 * 60 * 1000 + 1000);
    await me(user.accessToken).expect(401);
  });

  it('401 si `sub` n’est pas un UUID', async () => {
    await me(signedToken({ sub: 'admin', sid: newUserId() })).expect(401);
  });

  it('401 pour un utilisateur inexistant (jeton bien signé)', async () => {
    await me(signedToken({ sub: newUserId(), sid: newUserId() })).expect(401);
  });

  it('401 pour un utilisateur désactivé', async () => {
    const user = await registerAndLogin(ctx.app);
    await database.sql.query("UPDATE users SET status = 'disabled' WHERE id = $1", [user.userId]);
    await me(user.accessToken).expect(401);
  });

  it('ne journalise pas l’en-tête Authorization', async () => {
    await me('aaa.bbb.ccc').expect(401);
    expect(JSON.stringify(ctx.logLines)).not.toContain('aaa.bbb.ccc');
    expect(ctx.logLines).toContainEqual(
      expect.objectContaining({ message: 'auth rejected', reason: 'token_invalid' }),
    );
  });
});

describe('requireAuth', () => {
  /** Route protégée de test qui renvoie l'identité vue par le serveur. */
  function protectedApp() {
    const app = express();
    app.use(express.json());
    app.post('/whoami', createRequireAuth(ctx.auth, silentLogger), (req, res) => {
      res.json({
        userId: getAuth(res).userId,
        bodyUserId: (req.body as { userId?: string } | undefined)?.userId,
      });
    });
    app.use(createErrorHandler(silentLogger));
    return app;
  }

  it.each([
    ['sans en-tête Authorization', undefined],
    ['sans « Bearer »', 'Token abc.def.ghi'],
    ['avec un schéma incorrect', 'Basic dXNlcjpwYXNz'],
    ['avec « Bearer » vide', 'Bearer '],
  ])('rejette une requête %s', async (_label, header) => {
    const req = request(protectedApp()).post('/whoami');
    await (header ? req.set('Authorization', header) : req).expect(401);
  });

  it('expose l’identité extraite du JWT', async () => {
    const user = await registerAndLogin(ctx.app);
    const res = await request(protectedApp())
      .post('/whoami')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(res.body.userId).toBe(user.userId);
  });

  it('ANTI-USURPATION — un userId envoyé par le client est ignoré : seule compte l’identité du JWT', async () => {
    const userA = await registerAndLogin(ctx.app);
    const userB = await registerAndLogin(ctx.app);

    const res = await request(protectedApp())
      .post('/whoami')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ userId: userB.userId, playerId: userB.userId })
      .expect(200);
    expect(res.body).toEqual({ userId: userA.userId, bodyUserId: userB.userId });

    const meRes = await request(ctx.app)
      .get(`/api/auth/me?userId=${userB.userId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .set('X-User-Id', userB.userId)
      .send({ userId: userB.userId })
      .expect(200);
    expect(meRes.body.user.id).toBe(userA.userId);
  });
});

describe('Aucun mode invité (R-10)', () => {
  it('aucune route invitée et aucune identité par défaut', async () => {
    for (const path of ['/api/auth/guest', '/api/auth/anonymous', '/api/auth/login/guest']) {
      expect((await request(ctx.app).post(path).send({})).status).toBe(404);
    }
    // Sans jeton, aucune identité de repli : 401.
    await me().expect(401);
    // Un login sans identifiants ne crée pas de compte temporaire.
    await request(ctx.app).post('/api/auth/login').send({}).expect(400);
    const { rows } = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM users',
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('la base n’accepte que le rôle « user » : pas de rôle invité', async () => {
    const user = await registerAndLogin(ctx.app);
    await expect(
      database.sql.query("UPDATE users SET role = 'guest' WHERE id = $1", [user.userId]),
    ).rejects.toThrow();
  });

  it('le code source du backend ne contient aucune notion d’invité ou d’anonyme', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else {
          files.push(path);
        }
      }
    };
    walk(join(__dirname, '../../../src'));
    walk(join(__dirname, '../../../migrations'));
    const offenders = files.filter((f) => /guest|anonymous|visitor/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
