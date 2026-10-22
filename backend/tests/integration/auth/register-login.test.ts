import request from 'supertest';

import { AccessTokenService } from '../../../src/services/auth/access-token.service';
import {
  ACCESS_TTL_SECONDS,
  activeTokenCount,
  createAuthTestApp,
  login,
  registerAndLogin,
  TEST_JWT_SECRET,
  validRegistration,
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
  // Démarrage à froid (premier appel HTTP, premier bcrypt, premières requêtes PGlite : ~330 ms
  // seul, plusieurs secondes sous la charge de la suite complète) payé ICI, avec le délai de
  // PGLITE_TIMEOUT_MS, et non par le premier test et son délai de 5 s. Le délai des tests
  // n'est pas augmenté ; la base est vidée ensuite (aucun état partagé). Voir
  // docs/data-architecture.md (« Mémoire des workers Jest »).
  await registerAndLogin(createAuthTestApp(database.sql).app);
  await database.reset();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  ctx = createAuthTestApp(database.sql);
});
afterEach(() => database.reset());

const register = (body: unknown) =>
  request(ctx.app)
    .post('/api/auth/register')
    .send(body as object);

describe('POST /api/auth/register (R-15)', () => {
  it('crée le compte et renvoie uniquement le DTO public', async () => {
    const body = validRegistration({
      email: '  Awa.Test@Example.com ',
      phone: '+237 699 00 11 22',
    });
    const res = await register(body).expect(201);

    expect(res.body.user).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      playerNumber: expect.any(Number),
      firstName: 'Awa',
      lastName: 'Ndiaye',
      email: 'awa.test@example.com',
      username: body.username,
      phone: '+237699001122',
      phoneVerified: false,
      hasRecoveryCode: true,
      role: 'user',
      createdAt: expect.any(String),
    });
    // Code de récupération (D-135) : renvoyé une fois, dans cette réponse seulement.
    expect(res.body.recoveryCode).toMatch(/^LT(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|Secret123/i);
  });

  it('ne stocke jamais le mot de passe ni sa confirmation en clair', async () => {
    const res = await register(validRegistration()).expect(201);
    const { rows } = await database.sql.query<Record<string, unknown>>(
      'SELECT * FROM users WHERE id = $1',
      [res.body.user.id],
    );
    expect(rows[0]?.password_hash).toMatch(/^\$2[aby]\$/);
    expect(JSON.stringify(rows[0])).not.toContain('Secret123');
    expect(rows[0]).not.toHaveProperty('confirm_password');
  });

  it('refuse les champs manquants avec un message par champ', async () => {
    const res = await register({}).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.fields)).toHaveLength(7); // 6 champs + pays (email facultatif)
  });

  it.each([
    ['email', 'invalide'],
    ['phone', '600001122'],
    ['username', 'a b'],
    ['password', 'faible'],
  ])('refuse un %s invalide', async (field, value) => {
    const body = { ...validRegistration(), [field]: value };
    if (field === 'password') {
      body.confirmPassword = value;
    }
    const res = await register(body).expect(400);
    expect(res.body.fields).toHaveProperty(field);
  });

  it('refuse une confirmation différente', async () => {
    const res = await register(validRegistration({ confirmPassword: 'Autre1234' })).expect(400);
    expect(res.body.fields).toEqual({ confirmPassword: 'Les mots de passe ne correspondent pas.' });
  });

  it('pays + numéro national : E.164 reconstruit par le serveur ; indicatif étranger refusé', async () => {
    const res = await register(validRegistration({ country: 'CM', phone: '6 92 13 02 71' })).expect(
      201,
    );
    expect(res.body.user.phone).toBe('+237692130271');

    const foreign = await register(validRegistration({ country: 'CM', phone: '+33612345678' }));
    expect(foreign.status).toBe(400);
    expect(foreign.body.fields).toEqual({ phone: 'Numéro invalide pour le pays sélectionné.' });

    const noCountry = await register(validRegistration({ country: undefined }));
    expect(noCountry.status).toBe(400);
    expect(noCountry.body.fields).toEqual({ country: 'Ce champ est obligatoire.' });
  });

  it('refuse un email, un pseudo (sans tenir compte de la casse) ou un téléphone déjà utilisés', async () => {
    const first = validRegistration();
    await register(first).expect(201);

    const sameEmail = await register(validRegistration({ email: first.email.toUpperCase() }));
    const sameUsername = await register(
      validRegistration({ username: first.username.toUpperCase() }),
    );
    const samePhone = await register(validRegistration({ phone: first.phone }));

    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.fields).toEqual({ email: 'Cet email est déjà utilisé.' });
    expect(sameUsername.body.fields).toEqual({ username: 'Ce pseudo est déjà pris.' });
    expect(samePhone.body.fields).toEqual({ phone: 'Ce numéro de téléphone est déjà utilisé.' });
  });

  it('deux inscriptions simultanées identiques : un seul compte', async () => {
    const body = validRegistration();
    const results = await Promise.all([register(body), register(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('ignore id, rôle et vérification du téléphone envoyés par le client', async () => {
    const forcedId = '00000000-0000-4000-8000-000000000001';
    const res = await register(
      validRegistration({ id: forcedId, userId: forcedId, role: 'admin', phoneVerified: true }),
    ).expect(201);
    expect(res.body.user).toMatchObject({ role: 'user', phoneVerified: false });
    expect(res.body.user.id).not.toBe(forcedId);
  });

  it('numéro d’ordre (D-133) : attribué par la base dans l’ordre des inscriptions, unique', async () => {
    const first = await register(validRegistration()).expect(201);
    const second = await register(validRegistration()).expect(201);
    const a = first.body.user.playerNumber;
    const b = second.body.user.playerNumber;
    expect(Number.isSafeInteger(a) && a > 0).toBe(true);
    expect(b).toBeGreaterThan(a);
    const { rows } = await database.sql.query<{ player_number: string }>(
      'SELECT player_number FROM users WHERE id = $1',
      [first.body.user.id],
    );
    expect(Number(rows[0]?.player_number)).toBe(a);
  });

  it('numéro d’ordre : jamais choisi par le client, immuable en base', async () => {
    const res = await register(validRegistration({ playerNumber: 1, player_number: 1 })).expect(
      201,
    );
    const other = await register(validRegistration()).expect(201);
    // Le numéro envoyé est ignoré : deux comptes n'ont jamais le même numéro.
    expect(res.body.user.playerNumber).not.toBe(other.body.user.playerNumber);
    await expect(
      database.sql.query('UPDATE users SET player_number = player_number + 1000 WHERE id = $1', [
        res.body.user.id,
      ]),
    ).rejects.toThrow(/immuable/);
  });

  it('numéro d’ordre : deux inscriptions simultanées reçoivent deux numéros distincts', async () => {
    const results = await Promise.all([
      register(validRegistration()),
      register(validRegistration()),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const numbers = results.map((r) => r.body.user.playerNumber);
    expect(new Set(numbers).size).toBe(2);
  });

  it('ne journalise jamais le mot de passe', async () => {
    await register(validRegistration()).expect(201);
    await register(validRegistration({ password: 'Secret123', confirmPassword: 'x' })).expect(400);
    expect(JSON.stringify(ctx.logLines)).not.toContain('Secret123');
    expect(ctx.logLines).toContainEqual(expect.objectContaining({ message: 'register succeeded' }));
  });
});

describe('POST /api/auth/login', () => {
  it('connecte avec email + mot de passe et renvoie user, accessToken, refreshToken', async () => {
    const body = validRegistration();
    const registered = await register(body).expect(201);
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: body.email.toUpperCase(), password: body.password })
      .expect(200);

    expect(res.body.user).toEqual(registered.body.user);
    expect(res.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const claims = new AccessTokenService(TEST_JWT_SECRET, ACCESS_TTL_SECONDS).verify(
      res.body.accessToken,
      new Date('2026-10-07T10:00:00Z'),
    );
    expect(claims.userId).toBe(registered.body.user.id);
    expect(await activeTokenCount(database.sql, claims.userId)).toBe(1);
  });

  it('le pseudo n’est pas un identifiant de connexion', async () => {
    const body = validRegistration();
    await register(body).expect(201);
    await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: body.username, password: body.password })
      .expect(401);
  });

  it('mauvais mot de passe et email inconnu : même erreur générique', async () => {
    const { email } = await registerAndLogin(ctx.app);
    const wrongPassword = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email, password: 'Mauvais123' })
      .expect(401);
    const unknownEmail = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'personne@example.com', password: 'Mauvais123' })
      .expect(401);

    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body).toEqual({
      error: 'Unauthorized',
      code: 'INVALID_CREDENTIALS',
      message: 'Email ou mot de passe incorrect.',
    });
  });

  it('un nouveau login révoque la session précédente (R-32)', async () => {
    const first = await registerAndLogin(ctx.app);
    await login(ctx.app, first.email, first.password);

    const { rows } = await database.sql.query<{ revoked_reason: string | null }>(
      'SELECT revoked_reason FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at, id',
      [first.userId],
    );
    expect(rows.map((r) => r.revoked_reason).sort()).toEqual(['new_login', null]);
    expect(ctx.logLines).toContainEqual(
      expect.objectContaining({ message: 'previous session revoked', userId: first.userId }),
    );
  });

  it('un compte désactivé ne peut pas se connecter', async () => {
    const user = await registerAndLogin(ctx.app);
    await database.sql.query("UPDATE users SET status = 'disabled' WHERE id = $1", [user.userId]);
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(403);
    expect(res.body.code).toBe('ACCOUNT_DISABLED');
  });

  it('ne journalise ni mot de passe ni jeton', async () => {
    const user = await registerAndLogin(ctx.app);
    const logs = JSON.stringify(ctx.logLines);
    expect(logs).not.toContain(user.password);
    expect(logs).not.toContain(user.accessToken);
    expect(logs).not.toContain(user.refreshToken);
  });

  it('limite les tentatives de connexion par compte (429)', async () => {
    const limited = createAuthTestApp(database.sql, {
      rateLimits: {
        register: { windowMs: 60_000, max: 100 },
        loginPerAccount: { windowMs: 60_000, max: 3 },
        loginPerIp: { windowMs: 60_000, max: 100 },
        refresh: { windowMs: 60_000, max: 100 },
      },
    });
    const attempt = () =>
      request(limited.app)
        .post('/api/auth/login')
        .send({ email: 'cible@example.com', password: 'Mauvais123' });
    for (let i = 0; i < 3; i++) {
      await attempt().expect(401);
    }
    await attempt().expect(429);
  });
});
