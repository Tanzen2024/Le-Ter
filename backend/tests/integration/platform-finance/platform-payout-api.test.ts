import { randomUUID } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';

import { createApp } from '../../../src/app';
import type { PayoutFeeSchedule } from '../../../src/domain/platform-finance/platform-finance';
import { createAdminServices } from '../../../src/services/admin/create-admin-services';
import { createAuthService } from '../../../src/services/auth/create-auth-service';
import { createPlatformFinanceServices } from '../../../src/services/platform-finance/create-platform-finance-services';
import type { PayoutExecutionState } from '../../../src/services/platform-finance/platform-payout.service';
import type { TreasuryGateway } from '../../../src/services/platform-finance/treasury.gateway';
import type {
  TransferGateway,
  TransferLookup,
  TransferRequest,
  TransferSubmission,
} from '../../../src/services/withdrawals/transfer.gateway';
import { createLogger } from '../../../src/utils/logger';
import { createAdmin, NO_ADMIN_LOGIN_LIMITS } from '../../fixtures/admin';
import { NO_RATE_LIMITS, registerAndLogin, TEST_JWT_SECRET } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Retraits des revenus de la plateforme (D-078) par l'API, sur une base PGlite migrée, avec
 * une trésorerie et un fournisseur de transfert SIMULÉS : aucun appel réseau, aucun transfert
 * réel. Horloge des finances contrôlée par le test.
 */
jest.setTimeout(120_000);

let database: TestDatabase;
beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
afterEach(() => database.reset());

const MSISDN = '+237677123456';
const FEES: PayoutFeeSchedule = { bps: 100, fixed: 0 };
const DISABLED: PayoutExecutionState = {
  enabled: false,
  reason: 'PLATFORM_PAYOUTS_DISABLED',
  mode: 'disabled',
};
const ENABLED: PayoutExecutionState = { enabled: true, mode: 'sandbox' };

class FakeTreasury implements TreasuryGateway {
  configured = true;
  readonly environment = 'test' as const;
  balance = '500000';
  currency: string | undefined = 'XAF';
  fail = false;
  reads = 0;
  readBalance() {
    this.reads += 1;
    if (this.fail) return Promise.reject(new Error('CinetPay injoignable (simulé)'));
    return Promise.resolve({
      availableBalance: this.balance,
      ...(this.currency && { currency: this.currency }),
    });
  }
}

/** Transfert simulé : l'état « chez CinetPay » est tenu par le test. */
class FakeTransfers implements TransferGateway {
  canSubmit = true;
  canLookup = true;
  readonly submissions: TransferRequest[] = [];
  readonly remote = new Map<
    string,
    {
      providerReference: string;
      providerStatus: string;
      amount?: number;
      currency?: string;
      feeAmount?: number;
    }
  >();
  onSubmit: (r: TransferRequest) => TransferSubmission = (r) => {
    this.create(r.merchantTransactionId, r.amount);
    return {
      kind: 'accepted',
      providerReference: `cp-${r.merchantTransactionId}`,
      providerStatus: 'PENDING',
      notifyToken: `nt-${r.merchantTransactionId}`,
    };
  };
  submit(r: TransferRequest) {
    this.submissions.push(r);
    return Promise.resolve(this.onSubmit(r));
  }
  lookup(id: string): Promise<TransferLookup> {
    const remote = this.remote.get(id);
    return Promise.resolve(
      remote ? { found: true, merchantTransactionId: id, ...remote } : { found: false },
    );
  }
  create(id: string, amount: number) {
    this.remote.set(id, {
      providerReference: `cp-${id}`,
      providerStatus: 'PENDING',
      amount,
      currency: 'XAF',
    });
  }
  setStatus(id: string, providerStatus: string, feeAmount?: number) {
    const remote = this.remote.get(id)!;
    remote.providerStatus = providerStatus;
    if (feeAmount !== undefined) remote.feeAmount = feeAmount;
  }
}

function setup(
  options: { execution?: PayoutExecutionState; fees?: PayoutFeeSchedule | null } = {},
) {
  let current = new Date('2026-10-11T08:00:00Z');
  const clock = () => current;
  const logLines: string[] = [];
  const logger = createLogger({}, (line) => logLines.push(line));
  const auth = createAuthService(
    database.sql,
    {
      jwtSecret: TEST_JWT_SECRET,
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 86_400,
      bcryptCost: 4,
    },
    logger,
  );
  const transfers = new FakeTransfers();
  const treasuryGateway = new FakeTreasury();
  const make = () =>
    createPlatformFinanceServices({
      sql: database.sql,
      logger,
      env: { enabled: false, fees: options.fees === undefined ? FEES : options.fees },
      transferAvailability: { mode: 'sandbox', warnings: [] },
      transfers,
      treasuryGateway,
      execution: options.execution ?? DISABLED,
      clock,
    });
  const pf = make();
  const admin = createAdminServices({ sql: database.sql, auth, logger });
  const app = createApp({
    logger,
    auth,
    authRateLimits: NO_RATE_LIMITS,
    admin: {
      ...admin,
      loginLimits: NO_ADMIN_LOGIN_LIMITS,
      system: { nodeEnv: 'test', cinetpay: 'sandbox' },
    },
    platformFinance: {
      payouts: pf.payouts,
      treasury: pf.treasury,
      providerLimit: { windowMs: 60_000, max: 100_000 },
    },
  });
  return {
    app,
    pf,
    make,
    transfers,
    treasuryGateway,
    logLines,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
    now: clock,
  };
}

type Ctx = ReturnType<typeof setup>;

function client(app: Express, token: string) {
  const auth = `Bearer ${token}`;
  const base = '/api/admin/platform-finance';
  return {
    get: (path = '') => request(app).get(`${base}${path}`).set('Authorization', auth),
    post: (path: string, body: object = {}, key?: string) => {
      const req = request(app).post(`${base}${path}`).set('Authorization', auth);
      return (key ? req.set('Idempotency-Key', key) : req).send(body);
    },
  };
}

/** Recettes : une commission de partie (mêmes contraintes que le règlement réel, D-074). */
async function seedRevenue(creatorId: string, amount: number) {
  const sessionId = randomUUID();
  const gameId = randomUUID();
  const at = '2026-10-10T07:00:00Z';
  await database.sql.query(
    `INSERT INTO sessions (id, version, status, creator_id, created_at, updated_at, max_players)
     VALUES ($1, 1, 'open', $2, $3, $3, 2)`,
    [sessionId, creatorId, at],
  );
  await database.sql.query(
    `INSERT INTO games (id, version, status, creator_id, max_players, state, created_at, updated_at,
       session_id, first_player_id)
     VALUES ($1, 1, 'waiting', $2, 2, '{}', $3, $3, $4, $2)`,
    [gameId, creatorId, at, sessionId],
  );
  await database.sql.query(
    `INSERT INTO platform_ledger (id, game_id, kind, amount, fee_bps, currency, created_at)
     VALUES ($1, $2, 'GAME_COMMISSION', $3, 500, 'XAF', $4)`,
    [randomUUID(), gameId, amount, at],
  );
}

async function setWallet(userId: string, balance: number) {
  await database.sql.query(
    `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, $2, now(), now())
     ON CONFLICT (user_id) DO UPDATE SET balance = $2`,
    [userId, balance],
  );
}

/**
 * Deux administrateurs, un joueur (300 000 jetons), 100 000 FCFA de recettes, solde CinetPay
 * simulé de 500 000 : trésorerie libre 200 000, distribuable 100 000.
 */
async function scenario(ctx: Ctx) {
  const adminA = await createAdmin(ctx.app, database.sql);
  const adminB = await createAdmin(ctx.app, database.sql);
  const player = await registerAndLogin(ctx.app);
  await seedRevenue(adminA.userId, 100_000);
  await setWallet(player.userId, 300_000);
  return {
    a: client(ctx.app, adminA.accessToken),
    b: client(ctx.app, adminB.accessToken),
    adminA,
    adminB,
    player,
  };
}

async function activeBeneficiary(s: Awaited<ReturnType<typeof scenario>>) {
  const created = await s.a
    .post('/beneficiaries', { label: 'Compte MTN de Le Ter', msisdn: MSISDN })
    .expect(201);
  await s.b
    .post(`/beneficiaries/${created.body.id}/verify`, { note: 'Titulaire vérifié par appel MTN' })
    .expect(200);
  return created.body.id as string;
}

async function createPayout(
  s: Awaited<ReturnType<typeof scenario>>,
  beneficiaryId: string,
  amount: number,
  by: 'a' | 'b' = 'a',
) {
  const res = await s[by]
    .post('/payouts', { beneficiaryId, amount, purpose: 'Versement des revenus' }, randomUUID())
    .expect(201);
  return res.body.payout.id as string;
}

/** Retrait approuvé, réservé et mis en exécution (exécution activée). */
async function readyPayout(ctx: Ctx, amount = 10_000) {
  const s = await scenario(ctx);
  const beneficiaryId = await activeBeneficiary(s);
  await s.a.post('/treasury/observe').expect(201);
  const id = await createPayout(s, beneficiaryId, amount);
  await s.b.post(`/payouts/${id}/approve`).expect(200);
  await s.b.post(`/payouts/${id}/release`).expect(200);
  const reference = (await s.a.get(`/payouts/${id}`).expect(200)).body.payout.reference as string;
  return { s, id, reference };
}

const status = async (s: { a: ReturnType<typeof client> }, id: string) =>
  (await s.a.get(`/payouts/${id}`).expect(200)).body.payout;

describe('accès', () => {
  it('sans authentification : 401 ; joueur : 403 ; aucune donnée financière', async () => {
    const ctx = setup();
    const player = await registerAndLogin(ctx.app);
    const anonymous = await request(ctx.app).get('/api/admin/platform-finance');
    expect(anonymous.status).toBe(401);
    const asPlayer = await request(ctx.app)
      .get('/api/admin/platform-finance')
      .set('Authorization', `Bearer ${player.accessToken}`);
    expect(asPlayer.status).toBe(403);
    expect(JSON.stringify(asPlayer.body)).not.toMatch(/withdrawable|treasury/);
  });
});

describe('indicateurs : revenus, trésorerie, retirable', () => {
  it('sans relecture de trésorerie : inconnue (null), retrait bloqué', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    const res = await s.a.get().expect(200);
    expect(res.body.revenue).toMatchObject({ validatedRevenue: 100_000, distributable: 100_000 });
    expect(res.body.treasury).toMatchObject({
      state: 'UNKNOWN',
      confirmedAvailable: null,
      free: null,
    });
    expect(res.body.treasury.obligations).toMatchObject({
      walletBalances: 300_000,
      total: 300_000,
    });
    expect(res.body.withdrawable).toEqual({
      amount: null,
      ceiling: null,
      blockers: ['TREASURY_NOT_CONFIRMED'],
    });
    expect(res.body.execution).toEqual(DISABLED);
  });

  it('trésorerie confirmée : min(distribuable, trésorerie libre), frais compris', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    const observed = await s.a.post('/treasury/observe').expect(201);
    expect(observed.body.observation).toMatchObject({
      status: 'VALID',
      availableAmount: 500_000,
      currency: 'XAF',
    });
    let res = await s.a.get().expect(200);
    expect(res.body.treasury).toMatchObject({
      state: 'CONFIRMED',
      confirmedAvailable: 500_000,
      free: 200_000,
    });
    expect(res.body.withdrawable.ceiling).toBe(100_000); // revenus < trésorerie libre
    const { amount } = res.body.withdrawable;
    expect(amount + Math.ceil(amount / 100)).toBeLessThanOrEqual(100_000);
    expect(res.body.fees).toMatchObject({ configured: true, bps: 100 });

    // Trésorerie < revenus : la trésorerie libre borne.
    ctx.treasuryGateway.balance = '350000';
    await s.a.post('/treasury/observe').expect(201);
    res = await s.a.get().expect(200);
    expect(res.body.withdrawable.ceiling).toBe(50_000);
  });

  it('relecture périmée, devise inattendue ou CinetPay injoignable : bloqué, constatation conservée', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    await s.a.post('/treasury/observe').expect(201);
    ctx.advance(16 * 60_000);
    expect((await s.a.get().expect(200)).body.treasury.state).toBe('STALE');

    ctx.treasuryGateway.currency = 'XOF';
    expect((await s.a.post('/treasury/observe').expect(201)).body.observation).toMatchObject({
      status: 'INVALID',
      errorCode: 'CURRENCY_MISMATCH',
    });
    ctx.treasuryGateway.currency = 'XAF';
    ctx.treasuryGateway.balance = '12.5';
    expect((await s.a.post('/treasury/observe').expect(201)).body.observation.errorCode).toBe(
      'AMOUNT_NOT_INTEGER',
    );
    ctx.treasuryGateway.fail = true;
    expect((await s.a.post('/treasury/observe').expect(201)).body.observation.status).toBe('ERROR');

    const res = await s.a.get().expect(200);
    expect(res.body.treasury.state).toBe('UNAVAILABLE');
    expect(res.body.withdrawable.amount).toBeNull();
    expect((await s.a.get('/treasury').expect(200)).body.observations).toHaveLength(4);
  });

  it('barème des frais non configuré : aucun retrait possible', async () => {
    const ctx = setup({ fees: null });
    const s = await scenario(ctx);
    await s.a.post('/treasury/observe').expect(201);
    const res = await s.a.get().expect(200);
    expect(res.body.withdrawable.blockers).toEqual(['FEE_SCHEDULE_UNKNOWN']);
    expect(res.body.fees.configured).toBe(false);
  });
});

describe('bénéficiaire MTN Mobile Money', () => {
  it('numéro masqué partout, vérifié par un AUTRE administrateur', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    const created = await s.a
      .post('/beneficiaries', { label: 'Compte MTN', msisdn: '677 12 34 56' })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'PENDING_VERIFICATION',
      msisdn: '+2376** *** *56',
    });

    const same = await s.a
      .post(`/beneficiaries/${created.body.id}/verify`, { note: 'Vérifié par moi-même' })
      .expect(403);
    expect(same.body.details.reason).toBe('SAME_ADMIN');
    await s.b
      .post(`/beneficiaries/${created.body.id}/verify`, { note: 'Titulaire confirmé par MTN' })
      .expect(200);
    await s.b
      .post(`/beneficiaries/${created.body.id}/verify`, { note: 'Titulaire confirmé par MTN' })
      .expect(409);

    await s.b.post('/beneficiaries', { label: 'Doublon', msisdn: MSISDN }).expect(409);
    await s.b.post('/beneficiaries', { label: 'Fixe', msisdn: '+237233123456' }).expect(400);

    const list = await s.a.get('/beneficiaries').expect(200);
    expect(list.body.beneficiaries[0]).toMatchObject({
      status: 'ACTIVE',
      msisdn: '+2376** *** *56',
    });
    expect(JSON.stringify(list.body)).not.toContain('677123456');
  });
});

describe('demandes, approbation, réservation', () => {
  it('création : bénéficiaire actif, montant ≤ retirable, champs imposés ignorés, idempotente', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    const pending = await s.a
      .post('/beneficiaries', { label: 'Compte MTN', msisdn: MSISDN })
      .expect(201);
    await s.a.post('/treasury/observe').expect(201);
    const body = { beneficiaryId: pending.body.id, amount: 10_000, purpose: 'Versement mensuel' };
    expect((await s.a.post('/payouts', body, randomUUID()).expect(409)).body.details.reason).toBe(
      'BENEFICIARY_NOT_ACTIVE',
    );
    await s.b
      .post(`/beneficiaries/${pending.body.id}/verify`, { note: 'Titulaire confirmé par MTN' })
      .expect(200);

    await s.a.post('/payouts', body).expect(400); // Idempotency-Key exigée
    await s.a.post('/payouts', { ...body, amount: '10000' }, randomUUID()).expect(400);
    await s.a.post('/payouts', { ...body, amount: 10_000.5 }, randomUUID()).expect(400);
    await s.a.post('/payouts', { ...body, amount: -10_000 }, randomUUID()).expect(400);
    const over = await s.a.post('/payouts', { ...body, amount: 100_000 }, randomUUID()).expect(409);
    expect(over.body.details.reason).toBe('AMOUNT_EXCEEDS_WITHDRAWABLE');

    const key = randomUUID();
    const created = await s.a
      .post(
        '/payouts',
        { ...body, status: 'SUCCEEDED', approvedBy: s.adminA.userId, estimatedFee: 0 },
        key,
      )
      .expect(201);
    expect(created.body.payout).toMatchObject({
      status: 'PENDING_APPROVAL',
      amount: 10_000,
      estimatedFee: 100,
      approvedBy: null,
      currency: 'XAF',
      beneficiary: { msisdn: '+2376** *** *56' },
    });
    expect(created.body.payout.reference).toMatch(/^LP[0-9a-f]{26}$/);
    const replay = await s.a.post('/payouts', body, key).expect(200);
    expect(replay.body).toMatchObject({ replayed: true, payout: { id: created.body.payout.id } });
    const reused = await s.a.post('/payouts', { ...body, amount: 9_000 }, key).expect(409);
    expect(reused.body.details.reason).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('approbation : jamais par l’initiateur, une seule fois, réserve les fonds', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    const beneficiaryId = await activeBeneficiary(s);
    await s.a.post('/treasury/observe').expect(201);
    const id = await createPayout(s, beneficiaryId, 40_000);
    const before = (await s.a.get().expect(200)).body.withdrawable.ceiling;

    expect((await s.a.post(`/payouts/${id}/approve`).expect(403)).body.details.reason).toBe(
      'SAME_ADMIN',
    );
    await s.b.post(`/payouts/${id}/approve`, { note: 'Conforme au budget' }).expect(200);
    const again = await s.b.post(`/payouts/${id}/approve`).expect(409);
    expect(again.body.details.reason).toBe('INVALID_TRANSITION');

    const payout = await status(s, id);
    expect(payout).toMatchObject({ status: 'RESERVED', approvedBy: { id: s.adminB.userId } });
    const after = (await s.a.get().expect(200)).body;
    expect(after.revenue.reserved).toBe(40_400);
    expect(after.withdrawable.ceiling).toBe(before - 40_400);

    // Annulation avant exécution : la réservation est libérée.
    await s.a.post(`/payouts/${id}/cancel`).expect(400); // motif requis
    await s.a.post(`/payouts/${id}/cancel`, { note: 'Budget reporté' }).expect(200);
    expect((await s.a.get().expect(200)).body.withdrawable.ceiling).toBe(before);
    await s.a.post(`/payouts/${id}/cancel`, { note: 'Encore' }).expect(409);
  });

  it('rejet : motif requis, par un autre administrateur, statut final', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    const beneficiaryId = await activeBeneficiary(s);
    await s.a.post('/treasury/observe').expect(201);
    const id = await createPayout(s, beneficiaryId, 5_000);
    await s.b.post(`/payouts/${id}/reject`).expect(400);
    await s.a.post(`/payouts/${id}/reject`, { note: 'Non justifié' }).expect(403);
    await s.b.post(`/payouts/${id}/reject`, { note: 'Non justifié' }).expect(200);
    expect(await status(s, id)).toMatchObject({ status: 'REJECTED', decisionNote: 'Non justifié' });
    await s.b.post(`/payouts/${id}/approve`).expect(409);
  });

  it('base de données : montant figé, aucun second envoi, aucune suppression', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    const beneficiaryId = await activeBeneficiary(s);
    await s.a.post('/treasury/observe').expect(201);
    const id = await createPayout(s, beneficiaryId, 5_000);
    await s.b.post(`/payouts/${id}/approve`).expect(200);
    await expect(
      database.sql.query('UPDATE platform_payouts SET amount = 90000 WHERE id = $1', [id]),
    ).rejects.toThrow(/figées/);
    await expect(
      database.sql.query('UPDATE platform_payouts SET submission_attempts = 2 WHERE id = $1', [id]),
    ).rejects.toThrow();
    await expect(
      database.sql.query('DELETE FROM platform_payouts WHERE id = $1', [id]),
    ).rejects.toThrow();
    await expect(
      database.sql.query(`UPDATE platform_payouts SET approved_by = initiated_by WHERE id = $1`, [
        id,
      ]),
    ).rejects.toThrow();
  });

  it('demandes concurrentes : jamais plus que le disponible réservé', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    const beneficiaryId = await activeBeneficiary(s);
    await s.a.post('/treasury/observe').expect(201);
    const first = await createPayout(s, beneficiaryId, 60_000);
    const second = await createPayout(s, beneficiaryId, 60_000);
    const results = await Promise.all([
      s.b.post(`/payouts/${first}/approve`),
      s.b.post(`/payouts/${second}/approve`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.details.reason).toBe(
      'AMOUNT_EXCEEDS_WITHDRAWABLE',
    );
    const overview = (await s.a.get().expect(200)).body;
    expect(overview.revenue.reserved).toBe(60_600);
  });

  it('fonds des joueurs protégés : un solde joueur en hausse bloque l’approbation', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    const beneficiaryId = await activeBeneficiary(s);
    await s.a.post('/treasury/observe').expect(201);
    const id = await createPayout(s, beneficiaryId, 50_000);
    // Le solde CinetPay relu couvre désormais tout juste les comptes de jeu.
    await setWallet(s.player.userId, 480_000);
    const refused = await s.b.post(`/payouts/${id}/approve`).expect(409);
    expect(refused.body.details.reason).toBe('AMOUNT_EXCEEDS_WITHDRAWABLE');
    expect((await status(s, id)).status).toBe('PENDING_APPROVAL');
  });

  it('exécution désactivée : mise en exécution refusée (503), aucun envoi, même par l’exécuteur', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    const beneficiaryId = await activeBeneficiary(s);
    await s.a.post('/treasury/observe').expect(201);
    const id = await createPayout(s, beneficiaryId, 5_000);
    await s.b.post(`/payouts/${id}/approve`).expect(200);
    const res = await s.b.post(`/payouts/${id}/release`).expect(503);
    expect(res.body).toMatchObject({ code: 'PLATFORM_PAYOUTS_DISABLED' });
    // Même un retrait forcé à READY en base n'est jamais envoyé.
    await database.sql.query(
      `UPDATE platform_payouts SET status = 'READY', released_by = approved_by, released_at = now() WHERE id = $1`,
      [id],
    );
    expect(await ctx.pf.executor.tick()).toMatchObject({ submitted: 0 });
    expect(ctx.transfers.submissions).toHaveLength(0);
    const detail = (await s.a.get(`/payouts/${id}`).expect(200)).body.payout;
    expect(detail.actions.release).toEqual({ allowed: false, reason: 'PLATFORM_PAYOUTS_DISABLED' });
  });
});

describe('transferts simulés', () => {
  it('acceptation puis confirmation relue : réussi, frais définitifs, revenus diminués', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s, id, reference } = await readyPayout(ctx);
    const before = (await s.a.get().expect(200)).body.revenue;
    await ctx.pf.executor.tick();
    expect(ctx.transfers.submissions).toHaveLength(1);
    expect(ctx.transfers.submissions[0]).toMatchObject({
      phoneNumber: MSISDN,
      amount: 10_000,
      operator: 'MTN_CM',
    });
    // Acceptée : jamais un succès.
    expect((await status(s, id)).status).toBe('PROCESSING');

    ctx.transfers.setStatus(reference, 'SUCCESS', 95.5);
    expect((await s.a.post(`/payouts/${id}/check`).expect(200)).body).toEqual({
      outcome: 'settled',
      status: 'SUCCEEDED',
    });
    const done = await status(s, id);
    expect(done).toMatchObject({
      status: 'SUCCEEDED',
      finalAmount: 10_000,
      finalFee: 96,
      providerReference: `cp-${reference}`,
    });
    const after = (await s.a.get().expect(200)).body.revenue;
    expect(after.reserved).toBe(0);
    expect(after.charges.executedPayouts).toBe(10_000);
    expect(after.distributable).toBe(before.distributable + before.reserved - 10_000 - 96);
    expect(ctx.transfers.submissions).toHaveLength(1);
  });

  it('échec définitif relu : FAILED, réservation libérée', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s, id, reference } = await readyPayout(ctx);
    await ctx.pf.executor.tick();
    ctx.transfers.setStatus(reference, 'FAILED');
    await s.a.post(`/payouts/${id}/check`).expect(200);
    expect((await status(s, id)).status).toBe('FAILED');
    expect((await s.a.get().expect(200)).body.revenue.reserved).toBe(0);
  });

  it('erreur réseau AVANT l’envoi : retour à READY (certain), envoyé au passage suivant', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s, id } = await readyPayout(ctx);
    const normal = ctx.transfers.onSubmit;
    ctx.transfers.onSubmit = () => ({ kind: 'not_sent', errorCode: 'CINETPAY_NETWORK' });
    await ctx.pf.executor.tick();
    expect(await status(s, id)).toMatchObject({
      status: 'READY',
      submissionAttempts: 0,
      lastErrorCode: 'CINETPAY_NETWORK',
    });
    ctx.transfers.onSubmit = normal;
    await ctx.pf.executor.tick();
    expect((await status(s, id)).status).toBe('PROCESSING');
  });

  it('issue incertaine APRÈS l’envoi : jamais renvoyé ; NOT_FOUND ne prouve rien ; rapprochement après 24 h', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s, id, reference } = await readyPayout(ctx);
    ctx.transfers.onSubmit = () => ({ kind: 'uncertain', errorCode: 'CINETPAY_TIMEOUT' });
    await ctx.pf.executor.tick();
    expect((await status(s, id)).status).toBe('UNCERTAIN');
    for (let i = 0; i < 3; i += 1) {
      ctx.advance(2 * 60_000);
      await ctx.pf.executor.tick();
    }
    const still = await status(s, id);
    expect(still).toMatchObject({ status: 'UNCERTAIN' });
    expect(still.notFoundChecks).toBeGreaterThan(0);
    expect(ctx.transfers.submissions).toHaveLength(1);

    ctx.advance(25 * 60 * 60_000);
    await ctx.pf.executor.tick();
    expect(await status(s, id)).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      reconciliationResult: 'NOT_FOUND_UNPROVEN',
    });
    expect((await s.a.get().expect(200)).body.revenue.reserved).toBe(10_100); // toujours réservé
    expect(ctx.transfers.submissions).toHaveLength(1);

    // Réponse tardive : CinetPay connaît finalement le transfert, réussi.
    ctx.transfers.create(reference, 10_000);
    ctx.transfers.setStatus(reference, 'SUCCESS');
    await s.a.post(`/payouts/${id}/check`).expect(200);
    expect((await status(s, id)).status).toBe('SUCCEEDED');
  });

  it('refus annoncé à l’envoi (ex. solde insuffisant) : incertain, jamais un échec présumé', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s, id } = await readyPayout(ctx);
    ctx.transfers.onSubmit = () => ({ kind: 'rejected', providerStatus: 'INSUFFICIENT_BALANCE' });
    await ctx.pf.executor.tick();
    expect(await status(s, id)).toMatchObject({
      status: 'UNCERTAIN',
      lastErrorCode: 'PROVIDER_REJECTED_INSUFFICIENT_BALANCE',
    });
  });

  it('contrôle préalable : trésorerie relue insuffisante → aucun envoi, retour à READY', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s, id } = await readyPayout(ctx);
    ctx.treasuryGateway.balance = '305000'; // couvre les joueurs, pas le retrait réservé
    await ctx.pf.executor.tick();
    expect(await status(s, id)).toMatchObject({
      status: 'READY',
      lastErrorCode: 'INCONSISTENT_DATA',
    });
    expect(ctx.transfers.submissions).toHaveLength(0);
  });

  it('reprise après redémarrage : envoi interrompu → incertain, jamais renvoyé', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s, id } = await readyPayout(ctx);
    await database.sql.query(
      `UPDATE platform_payouts SET status = 'SUBMITTING', submission_attempts = 1,
         submission_claimed_at = $2 WHERE id = $1`,
      [id, new Date(ctx.now().getTime() - 10 * 60_000).toISOString()],
    );
    const restarted = ctx.make();
    await restarted.executor.tick();
    expect(await status(s, id)).toMatchObject({
      status: 'UNCERTAIN',
      lastErrorCode: 'SUBMISSION_INTERRUPTED',
    });
    expect(ctx.transfers.submissions).toHaveLength(0);
  });

  it('deux exécuteurs sur le même retrait : un seul envoi', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s, id } = await readyPayout(ctx);
    const other = ctx.make();
    await Promise.all([ctx.pf.payouts.executeReady(), other.payouts.executeReady()]);
    expect(ctx.transfers.submissions).toHaveLength(1);
    expect((await status(s, id)).submissionAttempts).toBe(1);
  });

  it('statut relu incohérent (montant) : rapprochement requis, jamais réussi', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s, id, reference } = await readyPayout(ctx);
    await ctx.pf.executor.tick();
    ctx.transfers.remote.get(reference)!.amount = 99_999;
    ctx.transfers.setStatus(reference, 'SUCCESS');
    await s.a.post(`/payouts/${id}/check`).expect(200);
    expect(await status(s, id)).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      reconciliationResult: 'PROVIDER_MISMATCH',
    });
  });

  it('notifications : jeton vérifié, statut toujours relu, doublons sans effet', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s, id, reference } = await readyPayout(ctx);
    await ctx.pf.executor.tick();
    const notify = (body: object) =>
      request(ctx.app).post('/api/platform-payouts/cinetpay/notify').send(body);

    await notify({ notify_token: 'faux', merchant_transaction_id: reference }).expect(401);
    await notify({
      notify_token: `nt-${reference}`,
      merchant_transaction_id: 'LP' + '0'.repeat(26),
    }).expect(401);
    await notify({ foo: 'bar' }).expect(401);
    // Le corps n'est jamais cru : un « SUCCESS » annoncé ne change rien tant que CinetPay dit PENDING.
    const pending = await notify({
      notify_token: `nt-${reference}`,
      merchant_transaction_id: reference,
      status: 'SUCCESS',
    }).expect(200);
    expect(pending.body.status).toBe('PROCESSING');

    ctx.transfers.setStatus(reference, 'SUCCESS');
    const ok = { notify_token: `nt-${reference}`, merchant_transaction_id: reference };
    expect((await notify(ok).expect(200)).body.status).toBe('SUCCEEDED');
    expect((await notify(ok).expect(200)).body.status).toBe('SUCCEEDED');
    const events = (await s.a.get(`/payouts/${id}`).expect(200)).body.payout.events;
    expect(events.filter((e: { toStatus: string }) => e.toStatus === 'SUCCEEDED')).toHaveLength(1);
  });

  it('rapprochement demandé : relectures seulement, AUCUN envoi, audité', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s } = await readyPayout(ctx);
    const res = await s.a.post('/reconcile').expect(200);
    expect(res.body).toMatchObject({ treasury: { status: 'VALID' }, recoveredSubmissions: 0 });
    expect(ctx.transfers.submissions).toHaveLength(0);
    const { rows } = await database.sql.query(
      `SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'PLATFORM_PAYOUT_RECONCILED'`,
    );
    expect(rows[0]).toEqual({ n: 1 });
  });
});

describe('audit et confidentialité', () => {
  it('historique et journal d’audit complets ; numéro complet jamais exposé ni journalisé', async () => {
    const ctx = setup({ execution: ENABLED });
    const { s, id, reference } = await readyPayout(ctx);
    await ctx.pf.executor.tick();
    ctx.transfers.setStatus(reference, 'SUCCESS');
    await s.a.post(`/payouts/${id}/check`).expect(200);

    const detail = await s.a.get(`/payouts/${id}`).expect(200);
    expect(detail.body.payout.events.map((e: { event: string }) => e.event)).toEqual([
      'CREATED',
      'APPROVED_AND_RESERVED',
      'RELEASED_FOR_EXECUTION',
      'SUBMISSION_CLAIMED',
      'PROVIDER_ACCEPTED',
      'PROVIDER_CONFIRMED_SUCCESS',
    ]);
    const { rows } = await database.sql.query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM admin_audit_log WHERE action LIKE 'PLATFORM_PAYOUT_%' OR action LIKE 'PAYOUT_BENEFICIARY_%' OR action = 'TREASURY_OBSERVED' ORDER BY created_at`,
    );
    const actions = rows.map((r) => r.action);
    for (const action of [
      'PAYOUT_BENEFICIARY_CREATED',
      'PAYOUT_BENEFICIARY_VERIFIED',
      'TREASURY_OBSERVED',
      'PLATFORM_PAYOUT_CREATED',
      'PLATFORM_PAYOUT_APPROVED',
      'PLATFORM_PAYOUT_RELEASED',
      'PLATFORM_PAYOUT_VIEWED',
    ]) {
      expect(actions).toContain(action);
    }
    const approval = rows.find((r) => r.action === 'PLATFORM_PAYOUT_APPROVED')!;
    expect(approval.actor_id).toBe(s.adminB.userId);

    const everything = JSON.stringify([
      detail.body,
      (await s.a.get('/payouts').expect(200)).body,
      (await s.a.get('/beneficiaries').expect(200)).body,
      (await database.sql.query('SELECT details FROM admin_audit_log')).rows,
      (await database.sql.query('SELECT details FROM platform_payout_events')).rows,
      ctx.logLines,
    ]);
    expect(everything).not.toContain('677123456');
    expect(everything).not.toContain(`nt-${reference}`);
    expect(detail.body.payout).not.toHaveProperty('notifyTokenHash');
    expect(detail.body.payout).not.toHaveProperty('creationKey');
  });

  it('liste paginée et filtrée par statut', async () => {
    const ctx = setup();
    const s = await scenario(ctx);
    const beneficiaryId = await activeBeneficiary(s);
    await s.a.post('/treasury/observe').expect(201);
    for (let i = 0; i < 3; i += 1) await createPayout(s, beneficiaryId, 1_000);
    const page = await s.a.get('/payouts?limit=2&page=1').expect(200);
    expect(page.body).toMatchObject({ total: 3, limit: 2 });
    expect(page.body.items).toHaveLength(2);
    expect((await s.a.get('/payouts?status=SUCCEEDED').expect(200)).body.total).toBe(0);
    await s.a.get('/payouts?status=HACKED').expect(400);
    await s.a.get('/payouts?foo=1').expect(400);
  });
});
