import request from 'supertest';

import {
  activeTokenCount,
  createAuthTestApp,
  NO_RATE_LIMITS,
  validRegistration,
  type AuthTestContext,
} from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Email facultatif des joueurs, connexion par téléphone, code de récupération et
 * « Mot de passe oublié ? » (D-135), de bout en bout : HTTP → AuthService → PostgreSQL migré.
 */
let database: TestDatabase;
let ctx: AuthTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
  // Démarrage à froid payé ici (voir register-login.test.ts).
  await request(createAuthTestApp(database.sql).app)
    .post('/api/auth/register')
    .send(validRegistration());
  await database.reset();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  ctx = createAuthTestApp(database.sql);
});
afterEach(() => database.reset());

const post = (path: string, body: object) => request(ctx.app).post(path).send(body);

/** Inscription SANS email : renvoie le pays, le numéro national et le code reçu. */
async function playerWithoutEmail(overrides: Record<string, unknown> = {}) {
  const body = validRegistration({ email: '', ...overrides });
  const res = await post('/api/auth/register', body).expect(201);
  return {
    id: res.body.user.id as string,
    country: body.country as string,
    phone: body.phone as string,
    password: body.password as string,
    code: res.body.recoveryCode as string,
  };
}

const verify = (p: { country: string; phone: string }, code: string) =>
  post('/api/auth/recovery/verify', { country: p.country, phone: p.phone, code });

describe('inscription : téléphone obligatoire, email facultatif (D-135)', () => {
  it('joueur sans email : email NULL en base (jamais inventé), code de récupération renvoyé', async () => {
    const p = await playerWithoutEmail();
    expect(p.code).toMatch(/^LT(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    const { rows } = await database.sql.query<Record<string, unknown>>(
      'SELECT email, recovery_code_hash FROM users WHERE id = $1',
      [p.id],
    );
    expect(rows[0]?.email).toBeNull();
    // Empreinte bcrypt seulement, jamais le code en clair.
    expect(rows[0]?.recovery_code_hash).toMatch(/^\$2[aby]\$/);
    expect(JSON.stringify(rows[0])).not.toContain(p.code.replace(/-/g, '').slice(2));
  });

  it('joueur avec email : accepté, email enregistré', async () => {
    const body = validRegistration();
    const res = await post('/api/auth/register', body).expect(201);
    expect(res.body.user.email).toBe(body.email);
    expect(res.body.user.hasRecoveryCode).toBe(true);
  });

  it('deux joueurs sans email : aucun conflit d’email', async () => {
    await playerWithoutEmail();
    await playerWithoutEmail();
  });

  it('téléphone toujours obligatoire', async () => {
    const res = await post('/api/auth/register', validRegistration({ phone: '' })).expect(400);
    expect(res.body.fields.phone).toBeDefined();
  });

  it('administrateur sans email : refusé par la base ; avec email : accepté', async () => {
    const p = await playerWithoutEmail();
    await expect(
      database.sql.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [p.id]),
    ).rejects.toThrow(/users_admin_email_required/);
    const withEmail = await post('/api/auth/register', validRegistration()).expect(201);
    await database.sql.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [
      withEmail.body.user.id,
    ]);
  });

  it('le code n’est renvoyé par aucune autre route (/me)', async () => {
    const p = await playerWithoutEmail();
    const login = await post('/api/auth/login', p).expect(200);
    const me = await request(ctx.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(JSON.stringify(me.body)).not.toContain(p.code);
    expect(me.body.user).toMatchObject({ email: null, hasRecoveryCode: true });
  });
});

describe('connexion par téléphone (D-135)', () => {
  it('pays + numéro + mot de passe : connecté ; email toujours accepté', async () => {
    const p = await playerWithoutEmail();
    const res = await post('/api/auth/login', p).expect(200);
    expect(res.body.user.id).toBe(p.id);
    const body = validRegistration();
    await post('/api/auth/register', body).expect(201);
    await post('/api/auth/login', { email: body.email, password: body.password }).expect(200);
  });

  it('mauvais mot de passe ou numéro inconnu : même erreur', async () => {
    const p = await playerWithoutEmail();
    const wrong = await post('/api/auth/login', { ...p, password: 'Mauvais123' }).expect(401);
    const unknown = await post('/api/auth/login', { ...p, phone: '670000999' }).expect(401);
    expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(unknown.body.message).toBe(wrong.body.message);
  });
});

describe('« Mot de passe oublié ? » : téléphone + code → nouveau mot de passe (D-135)', () => {
  it('parcours complet : ancien mot de passe refusé, nouveau accepté, sessions fermées, nouveau code', async () => {
    const p = await playerWithoutEmail();
    const session = await post('/api/auth/login', p).expect(200);
    // Saisie libre : minuscules et espaces acceptés.
    const granted = await verify(p, p.code.toLowerCase().replace(/-/g, ' ')).expect(200);
    expect(granted.body).toEqual({ resetToken: expect.any(String), expiresAt: expect.any(String) });

    const reset = await post('/api/auth/recovery/reset', {
      resetToken: granted.body.resetToken,
      newPassword: 'Nouveau456',
      confirmPassword: 'Nouveau456',
    }).expect(200);
    expect(reset.body.recoveryCode).toMatch(/^LT-/);
    expect(reset.body.recoveryCode).not.toBe(p.code);

    await post('/api/auth/login', p).expect(401);
    await post('/api/auth/login', { ...p, password: 'Nouveau456' }).expect(200);
    // L'ancienne session ne sert plus.
    await request(ctx.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.body.refreshToken })
      .expect(401);
    const { rows } = await database.sql.query<{ revoked_reason: string }>(
      `SELECT revoked_reason FROM refresh_tokens WHERE user_id = $1 AND revoked_reason = 'password_reset'`,
      [p.id],
    );
    expect(rows).toHaveLength(1);
    // Ancien code utilisé : refusé ; le nouveau fonctionne.
    await verify(p, p.code).expect(400);
    await verify(p, reset.body.recoveryCode).expect(200);
  });

  it('autorisation à usage unique et limitée dans le temps', async () => {
    const p = await playerWithoutEmail();
    const granted = await verify(p, p.code).expect(200);
    const body = { resetToken: granted.body.resetToken, newPassword: 'Nouveau456', confirmPassword: 'Nouveau456' };
    await post('/api/auth/recovery/reset', body).expect(200);
    const again = await post('/api/auth/recovery/reset', body).expect(400);
    expect(again.body.code).toBe('RESET_GRANT_INVALID');

    const q = await playerWithoutEmail();
    const late = await verify(q, q.code).expect(200);
    ctx.advance(11 * 60_000);
    await post('/api/auth/recovery/reset', { ...body, resetToken: late.body.resetToken }).expect(400);
  });

  it('mauvais code, numéro inconnu, compte sans code : MÊME refus, rien n’est révélé', async () => {
    const p = await playerWithoutEmail();
    const wrong = await verify(p, 'LT-0000-0000-0000').expect(400);
    const unknown = await verify({ country: 'CM', phone: '670009999' }, p.code).expect(400);
    await database.sql.query('UPDATE users SET recovery_code_hash = NULL WHERE id = $1', [p.id]);
    const noCode = await verify(p, p.code).expect(400);
    for (const res of [unknown, noCode]) {
      expect(res.body).toEqual(wrong.body);
    }
    expect(wrong.body.code).toBe('RECOVERY_FAILED');
  });

  it('le numéro seul ne suffit jamais : sans code, aucune réinitialisation', async () => {
    const p = await playerWithoutEmail();
    const res = await post('/api/auth/recovery/verify', { country: p.country, phone: p.phone }).expect(400);
    expect(res.body.fields.code).toBeDefined();
    await post('/api/auth/recovery/reset', {
      resetToken: 'x'.repeat(43),
      newPassword: 'Nouveau456',
      confirmPassword: 'Nouveau456',
    }).expect(400);
  });

  it('5 codes faux : compte bloqué 15 min, même avec le bon code ; débloqué ensuite', async () => {
    const p = await playerWithoutEmail();
    for (let i = 0; i < 5; i++) await verify(p, 'LT-0000-0000-0000').expect(400);
    await verify(p, p.code).expect(400);
    ctx.advance(16 * 60_000);
    await verify(p, p.code).expect(200);
  });

  it('limitation par numéro : 429 au-delà du seuil', async () => {
    ctx = createAuthTestApp(database.sql, {
      rateLimits: { ...NO_RATE_LIMITS, recoveryPerPhone: { windowMs: 60_000, max: 2 } },
    });
    const p = await playerWithoutEmail();
    await verify(p, 'LT-0000-0000-0000').expect(400);
    await verify(p, 'LT-0000-0000-0000').expect(400);
    const limited = await verify(p, p.code).expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
  });

  it('aucun code, jeton ni mot de passe dans les journaux', async () => {
    const p = await playerWithoutEmail();
    const granted = await verify(p, p.code).expect(200);
    const reset = await post('/api/auth/recovery/reset', {
      resetToken: granted.body.resetToken,
      newPassword: 'Nouveau456',
      confirmPassword: 'Nouveau456',
    }).expect(200);
    const logs = JSON.stringify(ctx.logLines);
    for (const secret of [p.code, reset.body.recoveryCode, granted.body.resetToken, 'Nouveau456']) {
      expect(logs).not.toContain(secret);
    }
  });
});

describe('« Mot de passe oublié ? » : téléphone OU email (D-142)', () => {
  it('email du compte + code : autorisation, puis nouveau mot de passe', async () => {
    const body = validRegistration();
    const res = await post('/api/auth/register', body).expect(201);
    // Saisie libre de l'email : casse et espaces ignorés, comme à la connexion.
    const granted = await post('/api/auth/recovery/verify', {
      email: ` ${String(body.email).toUpperCase()} `,
      code: res.body.recoveryCode,
    }).expect(200);
    await post('/api/auth/recovery/reset', {
      resetToken: granted.body.resetToken,
      newPassword: 'Nouveau456',
      confirmPassword: 'Nouveau456',
    }).expect(200);
    await post('/api/auth/login', { email: body.email, password: 'Nouveau456' }).expect(200);
  });

  it('email inconnu : MÊME refus qu’un mauvais code', async () => {
    const body = validRegistration();
    const res = await post('/api/auth/register', body).expect(201);
    const wrong = await post('/api/auth/recovery/verify', {
      email: body.email,
      code: 'LT-0000-0000-0000',
    }).expect(400);
    const unknown = await post('/api/auth/recovery/verify', {
      email: 'inconnu@example.com',
      code: res.body.recoveryCode,
    }).expect(400);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body.code).toBe('RECOVERY_FAILED');
  });

  it('ni téléphone ni email : 400 sur le champ identifiant', async () => {
    const res = await post('/api/auth/recovery/verify', { code: 'LT-0000-0000-0000' }).expect(400);
    expect(res.body.fields.phone).toBeDefined();
  });

  it('limitation : un email ajouté au numéro ne crée pas de nouveau compteur', async () => {
    ctx = createAuthTestApp(database.sql, {
      rateLimits: { ...NO_RATE_LIMITS, recoveryPerPhone: { windowMs: 60_000, max: 2 } },
    });
    const p = await playerWithoutEmail();
    const bad = 'LT-0000-0000-0000';
    await post('/api/auth/recovery/verify', { ...p, email: 'a@x.fr', code: bad }).expect(400);
    await post('/api/auth/recovery/verify', { ...p, email: 'b@x.fr', code: bad }).expect(400);
    await post('/api/auth/recovery/verify', { ...p, email: 'c@x.fr', code: p.code }).expect(429);
  });
});

describe('nouveau code depuis le Profil (D-135)', () => {
  it('mot de passe actuel exigé ; ancien code invalidé, nouveau valable', async () => {
    const p = await playerWithoutEmail();
    const { body } = await post('/api/auth/login', p).expect(200);
    const auth = { Authorization: `Bearer ${body.accessToken}` };
    const refused = await request(ctx.app)
      .post('/api/auth/recovery-code')
      .set(auth)
      .send({ currentPassword: 'Mauvais123' })
      .expect(400);
    expect(refused.body.code).toBe('INVALID_CURRENT_PASSWORD');
    const res = await request(ctx.app)
      .post('/api/auth/recovery-code')
      .set(auth)
      .send({ currentPassword: p.password })
      .expect(200);
    await verify(p, p.code).expect(400);
    await verify(p, res.body.recoveryCode).expect(200);
    // La session courante reste ouverte.
    expect(await activeTokenCount(database.sql, p.id)).toBe(1);
  });

  it('non authentifié : 401', async () => {
    await post('/api/auth/recovery-code', { currentPassword: 'Secret123' }).expect(401);
  });
});

describe('changement normal du mot de passe : sans code (D-135)', () => {
  it('ancien mot de passe correct → 204 ; incorrect ou confirmation différente → 400', async () => {
    const p = await playerWithoutEmail();
    const { body } = await post('/api/auth/login', p).expect(200);
    const change = (payload: object) =>
      request(ctx.app)
        .post('/api/auth/password')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send(payload);
    await change({ currentPassword: 'Mauvais123', newPassword: 'Nouveau456', confirmPassword: 'Nouveau456' }).expect(400);
    await change({ currentPassword: p.password, newPassword: 'Nouveau456', confirmPassword: 'Autre4567' }).expect(400);
    await change({ currentPassword: p.password, newPassword: 'Nouveau456', confirmPassword: 'Nouveau456' }).expect(204);
  });
});
