import { randomUUID } from 'node:crypto';

import request from 'supertest';

import type { UserId } from '../../../src/domain/users/user';
import { PostgresReferralRepository } from '../../../src/repositories/postgres-referral.repository';
import { PostgresWalletRepository } from '../../../src/repositories/postgres-wallet.repository';
import { createReferralService } from '../../../src/services/referrals/create-referral-service';
import type { ReferralService } from '../../../src/services/referrals/referral.service';
import { createLogger } from '../../../src/utils/logger';
import {
  asAdmin,
  createAdmin,
  createAdminTestApp,
  type AdminTestContext,
} from '../../fixtures/admin';
import { registerAndLogin, validRegistration } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Programme de parrainage (D-161), de bout en bout sur PostgreSQL (PGlite) : code personnel,
 * attribution atomique à l'inscription, qualification individuelle par les achats CONFIRMÉS
 * (règlement réel du compte de jeu, aucun paiement réel), paliers progressifs crédités une
 * seule fois, suspension, administration.
 */
jest.setTimeout(120_000);

const DOWNLOAD_URL = 'https://le-ter.example/telecharger';

let database: TestDatabase;
let ctx: AdminTestContext;
let referrals: ReferralService;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

function makeService(rewardsEnabled = true) {
  return createReferralService({
    sql: database.sql,
    logger: createLogger({}, () => undefined),
    env: { downloadUrl: DOWNLOAD_URL, tickMs: 60_000, rewardsEnabled },
    clock: () => ctx.now(),
  });
}

beforeEach(() => {
  referrals = makeService();
  ctx = createAdminTestApp(database.sql, { extra: { referrals } });
});
afterEach(async () => {
  referrals.stop();
  await database.reset();
  // Campagne remise à son état initial : recréée avec les règles de D-161 à la première lecture
  // (TRUNCATE ne passe pas par les déclencheurs « ajout seul » des versions de règles).
  await database.sql.query('TRUNCATE referral_rule_versions, referral_campaigns CASCADE');
});

// --- Outils ----------------------------------------------------------------------------------

async function myProgram(token: string) {
  const res = await request(ctx.app)
    .get('/api/referrals/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body;
}

async function newReferrer() {
  const account = await registerAndLogin(ctx.app);
  const program = await myProgram(account.accessToken);
  return { ...account, code: program.code as string };
}

async function registerReferee(code: string, overrides: Record<string, unknown> = {}) {
  const body = validRegistration({ referralCode: code, ...overrides });
  const res = await request(ctx.app).post('/api/auth/register').send(body).expect(201);
  return res.body.user.id as string;
}

const wallets = () => new PostgresWalletRepository(database.sql);

/** Achat réglé par le code COMMUN du compte de jeu (celui de CinetPay), jamais un crédit direct. */
async function deposit(userId: string, tokens: number, outcome: 'succeeded' | 'failed' | 'pending') {
  const id = randomUUID();
  await wallets().createPendingDeposit({
    id,
    userId: userId as UserId,
    kind: 'deposit',
    status: 'pending',
    tokens,
    idempotencyKey: randomUUID(),
    createdAt: ctx.now(),
    updatedAt: ctx.now(),
  });
  if (outcome === 'succeeded') await wallets().settle(id, { status: 'succeeded' }, ctx.now());
  if (outcome === 'failed') {
    await wallets().settle(id, { status: 'failed', failureCode: 'PAYMENT_FAILED' }, ctx.now());
  }
  return id;
}

async function qualifiedReferees(code: string, count: number) {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = await registerReferee(code);
    await deposit(id, 1000, 'succeeded');
    ids.push(id);
  }
  return ids;
}

async function rewardsOf(referrerId: string) {
  const { rows } = await database.sql.query<{ tier: number; amount: string; rules_version: number }>(
    'SELECT tier, amount, rules_version FROM referral_rewards WHERE referrer_id = $1 ORDER BY tier',
    [referrerId],
  );
  return rows.map((r) => ({ tier: r.tier, amount: Number(r.amount), version: r.rules_version }));
}

async function referralCredits(referrerId: string) {
  const { rows } = await database.sql.query<{ total: string; n: number }>(
    `SELECT COALESCE(sum(tokens), 0) AS total, count(*)::int AS n FROM wallet_transactions
     WHERE user_id = $1 AND kind = 'referral_reward' AND status = 'succeeded'`,
    [referrerId],
  );
  return { total: Number(rows[0]!.total), count: rows[0]!.n };
}

const balance = (userId: string) => wallets().getBalance(userId as UserId);

// --- Code personnel et attribution -----------------------------------------------------------

describe('code personnel', () => {
  it('donne à chaque joueur un code unique, stable, sans identifiant interne (1)', async () => {
    const a = await registerAndLogin(ctx.app);
    const b = await registerAndLogin(ctx.app);
    const first = await myProgram(a.accessToken);
    const again = await myProgram(a.accessToken);
    const other = await myProgram(b.accessToken);
    expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(again.code).toBe(first.code);
    expect(other.code).not.toBe(first.code);
    expect(first.code).not.toContain(a.userId.slice(0, 8).toUpperCase());
    // Lien de téléchargement : seul le code est transporté.
    expect(first.links.invite).toBe(`${DOWNLOAD_URL}?ref=${first.code}`);
    expect(first.links.app).toBe(`leter://register?ref=${first.code}`);
  });

  it('montre un état vide utile avant le premier filleul (25)', async () => {
    const a = await registerAndLogin(ctx.app);
    const program = await myProgram(a.accessToken);
    expect(program.referees).toEqual([]);
    expect(program.summary).toEqual({
      attributed: 0,
      qualified: 0,
      counted: 0,
      tiersReached: 0,
      tokensCredited: 0,
    });
    expect(program.nextTier).toEqual({ tier: 1, referralsRequired: 10, remaining: 10, reward: 5000 });
    expect(program.campaign.status).toBe('ACTIVE');
    expect(program.campaign.rules).toMatchObject({
      referralsPerTier: 10,
      qualificationThreshold: 1000,
      rewardPerTier: 5000,
      maxTiers: null,
    });
  });
});

describe('attribution à l’inscription', () => {
  it('rattache le nouveau compte au bon parrain, code venu d’un lien ou saisi (2, 3, 4)', async () => {
    const j = await newReferrer();
    const other = await newReferrer();
    const viaLink = await registerReferee(j.code, { referralSource: 'LINK' });
    // Saisie manuelle : minuscules et tirets acceptés.
    const typed = await registerReferee(`${j.code.slice(0, 4).toLowerCase()}-${j.code.slice(4)}`);
    const { rows } = await database.sql.query<{ referee_id: string; referrer_id: string; source: string }>(
      'SELECT referee_id, referrer_id, source FROM referral_attributions ORDER BY source',
    );
    expect(rows).toEqual([
      { referee_id: viaLink, referrer_id: j.userId, source: 'LINK' },
      { referee_id: typed, referrer_id: j.userId, source: 'MANUAL' },
    ]);
    const program = await myProgram(j.accessToken);
    expect(program.summary.attributed).toBe(2);
    expect((await myProgram(other.accessToken)).summary.attributed).toBe(0);
  });

  it('refuse un code inconnu ou mal formé sans créer de compte ni d’attribution (5)', async () => {
    const before = await database.sql.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
    const unknown = await request(ctx.app)
      .post('/api/auth/register')
      .send(validRegistration({ referralCode: 'ABCDEFGH' }))
      .expect(422);
    expect(unknown.body.code).toBe('INVALID_REFERRAL_CODE');
    expect(unknown.body.fields.referralCode).toBeDefined();
    const malformed = await request(ctx.app)
      .post('/api/auth/register')
      .send(validRegistration({ referralCode: 'x' }))
      .expect(400);
    expect(malformed.body.fields.referralCode).toBeDefined();
    const after = await database.sql.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    const { rows } = await database.sql.query('SELECT 1 FROM referral_attributions');
    expect(rows).toHaveLength(0);
  });

  it('n’exige aucun code de parrainage', async () => {
    await request(ctx.app).post('/api/auth/register').send(validRegistration()).expect(201);
  });

  it('un compte existant ne devient jamais filleul ; ni auto-parrainage ni second parrain (6, 7, 8)', async () => {
    const j = await newReferrer();
    const existing = await registerAndLogin(ctx.app);
    const insert = (referrer: string, referee: string, at: string) =>
      database.sql.query(
        `INSERT INTO referral_attributions (id, campaign_id, referrer_id, referee_id, referral_code,
           source, attributed_at)
         SELECT $1, id, $2, $3, (SELECT code FROM referral_codes WHERE user_id = $2), 'MANUAL', $4
         FROM referral_campaigns`,
        [randomUUID(), referrer, referee, at],
      );
    // Aucune route ne permet d'appliquer un code après coup ; la base le refuse aussi.
    await expect(insert(j.userId, existing.userId, ctx.now().toISOString())).rejects.toThrow();
    const created = await database.sql.query<{ created_at: Date }>(
      'SELECT created_at FROM users WHERE id = $1',
      [j.userId],
    );
    await expect(
      insert(j.userId, j.userId, new Date(created.rows[0]!.created_at).toISOString()),
    ).rejects.toThrow();
    const referee = await registerReferee(j.code);
    const other = await newReferrer();
    const refereeCreated = await database.sql.query<{ created_at: Date }>(
      'SELECT created_at FROM users WHERE id = $1',
      [referee],
    );
    await expect(
      insert(other.userId, referee, new Date(refereeCreated.rows[0]!.created_at).toISOString()),
    ).rejects.toThrow();
  });

  it('verrouille le parrain après l’inscription (9)', async () => {
    const j = await newReferrer();
    const other = await newReferrer();
    const referee = await registerReferee(j.code);
    await expect(
      database.sql.query('UPDATE referral_attributions SET referrer_id = $1 WHERE referee_id = $2', [
        other.userId,
        referee,
      ]),
    ).rejects.toThrow(/verrouillé/);
    await expect(
      database.sql.query('DELETE FROM referral_attributions WHERE referee_id = $1', [referee]),
    ).rejects.toThrow();
    // Aucune route joueur n'écrit le parrainage.
    for (const path of ['/api/referrals/me', '/api/referrals/attribution', '/api/referrals/rewards']) {
      const res = await request(ctx.app)
        .post(path)
        .set('Authorization', `Bearer ${j.accessToken}`)
        .send({ referrerId: other.userId, amount: 5000, qualified: true });
      expect(res.status).toBe(404);
    }
  });
});

// --- Qualification individuelle --------------------------------------------------------------

describe('qualification individuelle', () => {
  it('additionne les achats confirmés d’un même filleul, sans compensation entre filleuls (12, 13, 14, 15)', async () => {
    const j = await newReferrer();
    const a = await registerReferee(j.code);
    const b = await registerReferee(j.code);
    const c = await registerReferee(j.code);
    await deposit(a, 600, 'succeeded');
    await deposit(a, 400, 'succeeded');
    await deposit(b, 1500, 'succeeded');
    await deposit(c, 900, 'succeeded');
    // En attente ou échoués : jamais comptés.
    await deposit(c, 5000, 'pending');
    await deposit(c, 5000, 'failed');
    await referrals.processQueue();
    const program = await myProgram(j.accessToken);
    const byId = Object.fromEntries(program.referees.map((r: { id: string }) => [r.id, r]));
    const attributions = await database.sql.query<{ id: string; referee_id: string }>(
      'SELECT id, referee_id FROM referral_attributions',
    );
    const view = (referee: string) => byId[attributions.rows.find((r) => r.referee_id === referee)!.id];
    expect(view(a)).toMatchObject({ status: 'QUALIFIED', progress: 1000, threshold: 1000 });
    // Le montant au-delà du seuil n'est pas révélé au parrain.
    expect(view(b)).toMatchObject({ status: 'QUALIFIED', progress: 1000 });
    expect(view(c)).toMatchObject({ status: 'IN_PROGRESS', progress: 900 });
    expect(program.summary).toMatchObject({ attributed: 3, qualified: 2, counted: 2 });
    expect(await rewardsOf(j.userId)).toEqual([]);
  });

  it('neuf filleuls qualifiés : aucune récompense ; dix : 5 000 jetons (10, 11, 16)', async () => {
    const j = await newReferrer();
    await qualifiedReferees(j.code, 9);
    await referrals.processQueue();
    expect(await rewardsOf(j.userId)).toEqual([]);
    expect((await myProgram(j.accessToken)).nextTier).toMatchObject({ remaining: 1, reward: 5000 });

    await qualifiedReferees(j.code, 1);
    await referrals.processQueue();
    expect(await rewardsOf(j.userId)).toEqual([{ tier: 1, amount: 5000, version: 1 }]);
    expect(await referralCredits(j.userId)).toEqual({ total: 5000, count: 1 });
    expect(await balance(j.userId)).toBe(5000);
    const notification = await database.sql.query<{ payload: { amount: number } }>(
      `SELECT payload FROM notifications WHERE user_id = $1 AND type = 'REFERRAL_REWARD_CREDITED'`,
      [j.userId],
    );
    expect(notification.rows.map((r) => r.payload.amount)).toEqual([5000]);
    const program = await myProgram(j.accessToken);
    expect(program.summary).toMatchObject({ counted: 10, tiersReached: 1, tokensCredited: 5000 });
    expect(program.rewards).toHaveLength(1);
    // La section reste disponible après la récompense (26).
    expect(program.nextTier).toEqual({ tier: 2, referralsRequired: 20, remaining: 10, reward: 5000 });
  });
});

// --- Paliers progressifs ---------------------------------------------------------------------

describe('paliers progressifs', () => {
  it('19 → 5 000 ; 20 → 10 000 ; 29 → 10 000 ; 30 → 15 000 (17, 18, 19, 20)', async () => {
    const j = await newReferrer();
    const step = async (count: number, expectedTotal: number) => {
      await qualifiedReferees(j.code, count);
      await referrals.processQueue();
      expect((await referralCredits(j.userId)).total).toBe(expectedTotal);
    };
    await step(19, 5000);
    await step(1, 10000);
    await step(9, 10000);
    await step(1, 15000);
    expect(await rewardsOf(j.userId)).toEqual([
      { tier: 1, amount: 5000, version: 1 },
      { tier: 2, amount: 5000, version: 1 },
      { tier: 3, amount: 5000, version: 1 },
    ]);
    expect(await balance(j.userId)).toBe(15000);
    const program = await myProgram(j.accessToken);
    expect(program.summary).toMatchObject({ counted: 30, tiersReached: 3, tokensCredited: 15000 });
    expect(program.nextTier).toMatchObject({ tier: 4, referralsRequired: 40, remaining: 10 });
  });

  it('deux parrains atteignent chacun le même palier : chacun est crédité une fois', async () => {
    const a = await newReferrer();
    const b = await newReferrer();
    await qualifiedReferees(a.code, 10);
    await referrals.processQueue();
    await qualifiedReferees(b.code, 10);
    await referrals.processQueue();
    expect(await rewardsOf(a.userId)).toEqual([{ tier: 1, amount: 5000, version: 1 }]);
    expect(await rewardsOf(b.userId)).toEqual([{ tier: 1, amount: 5000, version: 1 }]);
    expect(await balance(a.userId)).toBe(5000);
    expect(await balance(b.userId)).toBe(5000);
  });

  it('événements répétés, évaluations concurrentes et redémarrage : chaque palier une seule fois (21, 22, 23)', async () => {
    const j = await newReferrer();
    const ids = await qualifiedReferees(j.code, 10);
    // Notification rejouée : le règlement est idempotent (aucun second crédit d'achat).
    const { rows } = await database.sql.query<{ id: string }>(
      `SELECT id FROM wallet_transactions WHERE user_id = $1 AND kind = 'deposit'`,
      [ids[0]],
    );
    await wallets().settle(rows[0]!.id, { status: 'succeeded' }, ctx.now());
    expect(await balance(ids[0]!)).toBe(1000);

    const repository = new PostgresReferralRepository(database.sql);
    await Promise.all([
      referrals.processQueue(),
      repository.evaluate(j.userId as UserId, ctx.now()),
      repository.evaluate(j.userId as UserId, ctx.now()),
      repository.evaluate(j.userId as UserId, ctx.now()),
    ]);
    // « Redémarrage » : nouvelle instance, file relue dans PostgreSQL.
    const restarted = makeService();
    await restarted.processQueue();
    await myProgram(j.accessToken);
    expect(await referralCredits(j.userId)).toEqual({ total: 5000, count: 1 });
    expect(await rewardsOf(j.userId)).toHaveLength(1);

    // La base refuse un second crédit du même palier, quel que soit le chemin.
    await expect(
      database.sql.transaction(async (tx) => {
        const tid = randomUUID();
        await tx.query(
          `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
             created_at, updated_at, completed_at)
           VALUES ($1, $2, 'referral_reward', 'succeeded', 5000, $3, now(), now(), now())`,
          [tid, j.userId, `forged-${tid}`],
        );
      }),
    ).rejects.toThrow(/sans palier/);
  });

  it('un nouveau règlement ne réécrit pas les paliers acquis (versionnement)', async () => {
    const j = await newReferrer();
    const admin = await createAdmin(ctx.app, database.sql);
    await qualifiedReferees(j.code, 10);
    await referrals.processQueue();
    await asAdmin(ctx.app, admin.accessToken)
      .patch('/api/admin/referrals/campaign/rules')
      .send({
        referralsPerTier: 5,
        qualificationThreshold: 1000,
        rewardPerTier: 3000,
        maxTiers: null,
        reason: 'Campagne de fin d’année',
      })
      .expect(200);
    await qualifiedReferees(j.code, 5);
    await referrals.processQueue();
    expect(await rewardsOf(j.userId)).toEqual([
      { tier: 1, amount: 5000, version: 1 },
      { tier: 2, amount: 3000, version: 2 },
    ]);
  });
});

// --- Crédit des paliers désactivé (D-169, REFERRAL_REWARDS_ENABLED) ----------------------------

describe('crédit des paliers désactivé (défaut prudent, R-42 / R-34)', () => {
  it('10 filleuls qualifiés : aucun jeton créé, palier retenu puis crédité une seule fois à l’activation', async () => {
    const disabled = makeService(false);
    ctx = createAdminTestApp(database.sql, { extra: { referrals: disabled } });
    const j = await newReferrer();
    await qualifiedReferees(j.code, 10);
    await disabled.processQueue();
    // Évaluations concurrentes et lecture du joueur : toujours aucun crédit.
    const repository = new PostgresReferralRepository(database.sql, { rewardsEnabled: false });
    await Promise.all([
      repository.evaluate(j.userId as UserId, ctx.now()),
      repository.evaluate(j.userId as UserId, ctx.now()),
    ]);
    const program = await myProgram(j.accessToken);
    expect(program.summary.counted).toBe(10);
    expect(program.withheldTiers).toBe(1);
    expect(program.rewards).toEqual([]);
    expect(await rewardsOf(j.userId)).toEqual([]);
    expect(await referralCredits(j.userId)).toEqual({ total: 0, count: 0 });
    expect(await balance(j.userId)).toBe(0);
    disabled.stop();

    // File vide : sans remise en file, le palier retenu ne serait jamais crédité.
    expect(await repository.isQueued(j.userId as UserId)).toBe(false);

    // Activation (décision R-42 / R-34 prise), au redémarrage : le palier dû est remis en file
    // puis crédité, une seule fois malgré des évaluations concurrentes.
    const enabled = makeService(true);
    await enabled.resumeWithheld();
    expect(await repository.isQueued(j.userId as UserId)).toBe(true);
    await Promise.all([
      enabled.processQueue(),
      new PostgresReferralRepository(database.sql).evaluate(j.userId as UserId, ctx.now()),
      new PostgresReferralRepository(database.sql).evaluate(j.userId as UserId, ctx.now()),
    ]);
    await enabled.resumeWithheld();
    await enabled.processQueue();
    expect(await referralCredits(j.userId)).toEqual({ total: 5000, count: 1 });
    expect(await balance(j.userId)).toBe(5000);
    enabled.stop();
  });

  it('les achats des filleuls restent crédités normalement (le verrou ne touche que la récompense)', async () => {
    const disabled = makeService(false);
    ctx = createAdminTestApp(database.sql, { extra: { referrals: disabled } });
    const j = await newReferrer();
    const [referee] = await qualifiedReferees(j.code, 1);
    await disabled.processQueue();
    expect(await balance(referee!)).toBe(1000);
    disabled.stop();
  });
});

// --- Suspension et administration ------------------------------------------------------------

describe('campagne et administration', () => {
  it('suspension : visible, récompenses conservées, paliers crédités à la reprise (31, 32)', async () => {
    const j = await newReferrer();
    const admin = asAdmin(ctx.app, (await createAdmin(ctx.app, database.sql)).accessToken);
    await qualifiedReferees(j.code, 10);
    await referrals.processQueue();
    await admin
      .post('/api/admin/referrals/campaign/status', { status: 'SUSPENDED', reason: 'Contrôle' })
      .expect(200);
    // Nouvelle attribution refusée tant que la campagne est suspendue.
    const refused = await request(ctx.app)
      .post('/api/auth/register')
      .send(validRegistration({ referralCode: j.code }))
      .expect(422);
    expect(refused.body.code).toBe('REFERRAL_CAMPAIGN_SUSPENDED');

    const suspended = await myProgram(j.accessToken);
    expect(suspended.campaign.status).toBe('SUSPENDED');
    expect(suspended.rewards).toHaveLength(1);
    expect(await balance(j.userId)).toBe(5000);

    await admin
      .post('/api/admin/referrals/campaign/status', { status: 'ACTIVE', reason: 'Reprise' })
      .expect(200);
    await qualifiedReferees(j.code, 10);
    await admin
      .post('/api/admin/referrals/campaign/status', { status: 'SUSPENDED', reason: 'Contrôle 2' })
      .expect(200);
    await referrals.processQueue();
    const withheld = await myProgram(j.accessToken);
    expect(withheld.withheldTiers).toBe(1);
    expect(await referralCredits(j.userId)).toEqual({ total: 5000, count: 1 });

    await admin
      .post('/api/admin/referrals/campaign/status', { status: 'ACTIVE', reason: 'Fin du contrôle' })
      .expect(200);
    await referrals.processQueue();
    expect(await referralCredits(j.userId)).toEqual({ total: 10000, count: 2 });
  });

  it('un compte non administrateur ne pilote pas la campagne (30)', async () => {
    const player = await registerAndLogin(ctx.app);
    const as = (method: 'get' | 'post' | 'patch', path: string) =>
      request(ctx.app)[method](path).set('Authorization', `Bearer ${player.accessToken}`);
    expect((await as('get', '/api/admin/referrals/overview')).status).toBe(403);
    expect(
      (await as('post', '/api/admin/referrals/campaign/status').send({ status: 'SUSPENDED', reason: 'abc' }))
        .status,
    ).toBe(403);
    expect(
      (
        await as('patch', '/api/admin/referrals/campaign/rules').send({
          referralsPerTier: 1,
          qualificationThreshold: 1,
          rewardPerTier: 1_000_000,
          reason: 'abc',
        })
      ).status,
    ).toBe(403);
    expect((await request(ctx.app).get('/api/admin/referrals/overview')).status).toBe(401);
  });

  it('vue d’ensemble, détail du parrain, contrôle d’une attribution et historique (29)', async () => {
    const j = await newReferrer();
    const admin = asAdmin(ctx.app, (await createAdmin(ctx.app, database.sql)).accessToken);
    const ids = await qualifiedReferees(j.code, 10);
    await referrals.processQueue();

    const overview = await admin.get('/api/admin/referrals/overview').expect(200);
    expect(overview.body).toMatchObject({
      attributed: 10,
      qualified: 10,
      rewardsCredited: 1,
      tokensDistributed: 5000,
      campaign: { status: 'ACTIVE' },
    });

    const list = await admin.get(`/api/admin/referrals/referrers?q=${j.code}`).expect(200);
    expect(list.body.items).toEqual([
      expect.objectContaining({ userId: j.userId, code: j.code, attributed: 10, tiers: 1, tokensCredited: 5000 }),
    ]);

    const detail = await admin.get(`/api/admin/referrals/referrers/${j.userId}`).expect(200);
    expect(detail.body.referees).toHaveLength(10);
    expect(detail.body.referees[0].deposits).toHaveLength(1);
    expect(detail.body.rewards[0]).toMatchObject({
      tier: 1,
      amount: 5000,
      rulesVersion: 1,
      idempotencyKey: expect.stringContaining('referral-reward:'),
    });

    // Attribution mise en vérification : ne compte plus ; les crédits acquis restent.
    const attribution = detail.body.referees.find(
      (r: { refereeId: string }) => r.refereeId === ids[0],
    ).attributionId;
    await admin
      .post(`/api/admin/referrals/attributions/${attribution}/review`, {
        decision: 'FLAG',
        reason: 'Même appareil que le parrain',
      })
      .expect(200);
    const flagged = await myProgram(j.accessToken);
    expect(flagged.summary.counted).toBe(9);
    expect(flagged.referees.find((r: { id: string }) => r.id === attribution).status).toBe(
      'UNDER_REVIEW',
    );
    expect(await referralCredits(j.userId)).toEqual({ total: 5000, count: 1 });
    const cases = await admin.get('/api/admin/referrals/overview').expect(200);
    expect(cases.body.attention).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'FLAGGED_ATTRIBUTION' })]),
    );

    // Historique complet de l'audit.
    const settings = await admin.get('/api/admin/referrals/campaign').expect(200);
    expect(settings.body.versions.map((v: { version: number }) => v.version)).toContain(1);
    const after = await admin.get(`/api/admin/referrals/referrers/${j.userId}`).expect(200);
    expect(after.body.history.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining(['REFERRAL_ATTRIBUTION_REVIEWED', 'REFERRAL_REFERRER_VIEWED']),
    );
  });

  it('valide les réglages côté serveur et refuse tout champ inconnu', async () => {
    const admin = asAdmin(ctx.app, (await createAdmin(ctx.app, database.sql)).accessToken);
    const bad = await admin
      .patch('/api/admin/referrals/campaign/rules')
      .send({ referralsPerTier: 0, qualificationThreshold: 1000, rewardPerTier: 5000, reason: 'x' })
      .expect(400);
    expect(Object.keys(bad.body.fields)).toEqual(
      expect.arrayContaining(['referralsPerTier', 'reason']),
    );
    const extra = await admin
      .post('/api/admin/referrals/campaign/status', {
        status: 'ACTIVE',
        reason: 'Motif valable',
        credit: 5000,
      })
      .expect(400);
    expect(extra.body.fields.credit).toBeDefined();
  });
});
