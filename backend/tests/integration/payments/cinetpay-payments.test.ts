import { createHash, randomUUID } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';

import { createApp } from '../../../src/app';
import type { SqlClient, SqlExecutor } from '../../../src/database/sql-client';
import { PostgresPaymentRepository } from '../../../src/repositories/postgres-payment.repository';
import { createAuthService } from '../../../src/services/auth/create-auth-service';
import {
  CinetPayError,
  type CinetPayPaymentCreated,
  type CinetPayPaymentRequest,
  type CinetPayPaymentStatus,
} from '../../../src/services/payments/cinetpay/cinetpay-client';
import { CinetPayGateway } from '../../../src/services/payments/cinetpay/cinetpay.gateway';
import { PaymentService } from '../../../src/services/payments/payment.service';
import { createWalletService } from '../../../src/services/wallet/create-wallet-service';
import { createLogger } from '../../../src/utils/logger';
import { NO_RATE_LIMITS, registerAndLogin, TEST_JWT_SECRET } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Achats CinetPay v1 de bout en bout (D-050), sur PostgreSQL (PGlite) : POST
 * /api/wallet/deposits → CinetPay (simulé) → paiement PENDING → notification → statut RELU
 * chez CinetPay → contrôles → règlement atomique et idempotent du compte de jeu (`settle`).
 */
jest.setTimeout(60_000);

let database: TestDatabase;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
afterEach(() => database.reset());

/** CinetPay simulé : pages de paiement et statuts contrôlés par le test. */
class FakeCinetPay {
  readonly created: (CinetPayPaymentRequest & { transactionId: string; notifyToken: string })[] =
    [];
  readonly remote = new Map<string, Omit<CinetPayPaymentStatus, 'code'>>();
  statusCalls = 0;
  failCreate = false;
  failStatus = false;

  createPayment(req: CinetPayPaymentRequest): Promise<CinetPayPaymentCreated> {
    if (this.failCreate) {
      return Promise.reject(new CinetPayError('http', 'CinetPay a répondu 500'));
    }
    const transactionId = `cp-${randomUUID()}`;
    const notifyToken = `notify-${randomUUID()}`;
    this.created.push({ ...req, transactionId, notifyToken });
    this.remote.set(transactionId, {
      status: 'INITIATED',
      transactionId,
      merchantTransactionId: req.merchantTransactionId,
    });
    return Promise.resolve({
      transactionId,
      merchantTransactionId: req.merchantTransactionId,
      paymentUrl: `https://secure.sandbox.cinetpay.net/payment/${transactionId}`,
      notifyToken,
      initialStatus: 'INITIATED',
    });
  }

  getPaymentStatus(identifier: string): Promise<CinetPayPaymentStatus> {
    this.statusCalls += 1;
    if (this.failStatus) return Promise.reject(new CinetPayError('timeout', 'timeout'));
    const remote = this.remote.get(identifier);
    if (!remote) return Promise.reject(new CinetPayError('http', 'not found'));
    return Promise.resolve({ code: remote.status === 'SUCCESS' ? 100 : 2002, ...remote });
  }

  /** Ce que CinetPay sait du paiement (le joueur a payé, échoué…). */
  set(index: number, patch: Partial<Omit<CinetPayPaymentStatus, 'code'>>) {
    const { transactionId } = this.created[index]!;
    this.remote.set(transactionId, { ...this.remote.get(transactionId)!, ...patch });
  }

  /** Notification telle que CinetPay l'envoie (JSON v1). */
  notification(index = 0, override: Record<string, unknown> = {}) {
    const c = this.created[index]!;
    return {
      notify_token: c.notifyToken,
      merchant_transaction_id: c.merchantTransactionId,
      transaction_id: c.transactionId,
      user: { name: 'Payeur', email: 'payeur@test.local', phone_number: '+237600000000' },
      ...override,
    };
  }
}

/** Client SQL dont la prochaine écriture du statut d'un paiement échoue (test du ROLLBACK). */
function failingSql(sql: SqlClient, state: { fail: boolean }): SqlClient {
  const wrap = (tx: SqlExecutor): SqlExecutor => ({
    query: (text, params) => {
      if (state.fail && /UPDATE payments\s+SET status/.test(text)) {
        state.fail = false;
        return Promise.reject(new Error('panne simulée pendant le règlement'));
      }
      return tx.query(text, params);
    },
  });
  return { ...wrap(sql), transaction: (work) => sql.transaction((tx) => work(wrap(tx))) };
}

function setup(options: { reconcileIntervalMs?: number; paymentsSql?: SqlClient } = {}) {
  const logLines: string[] = [];
  const logger = createLogger({}, (line) => logLines.push(line));
  const auth = createAuthService(
    database.sql,
    {
      jwtSecret: TEST_JWT_SECRET,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 3600,
      bcryptCost: 4,
    },
    logger,
  );
  const cinetpay = new FakeCinetPay();
  const repository = new PostgresPaymentRepository(database.sql);
  const gateway = new CinetPayGateway({
    client: cinetpay,
    payments: repository,
    logger,
    notifyUrl: 'https://api.test.local/api/payments/cinetpay/notify',
    returnUrl: 'https://api.test.local/api/payments/cinetpay/return',
  });
  const wallet = createWalletService({ sql: database.sql, logger, gateway });
  const payments = new PaymentService({
    payments: new PostgresPaymentRepository(options.paymentsSql ?? database.sql),
    cinetpay,
    logger,
    reconcileIntervalMs: options.reconcileIntervalMs ?? 60 * 60_000,
  });
  const app = createApp({
    logger,
    auth,
    wallet,
    payments,
    authRateLimits: NO_RATE_LIMITS,
    walletWriteLimit: { windowMs: 60_000, max: 100_000 },
    paymentOptions: { notifyLimit: { windowMs: 60_000, max: 100_000 } },
  });
  return { app, cinetpay, logLines };
}

async function player(app: Express) {
  const session = await registerAndLogin(app);
  const auth = `Bearer ${session.accessToken}`;
  return {
    id: session.userId,
    deposit: (body: object, key: string = randomUUID()) =>
      request(app)
        .post('/api/wallet/deposits')
        .set('Authorization', auth)
        .set('Idempotency-Key', key)
        .send(body),
    withdraw: (body: object) =>
      request(app)
        .post('/api/wallet/withdrawals')
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send(body),
    wallet: async () =>
      (await request(app).get('/api/wallet').set('Authorization', auth).expect(200)).body.wallet,
    payment: (id: string) => request(app).get(`/api/payments/${id}`).set('Authorization', auth),
    balance: async () =>
      (await request(app).get('/api/wallet').set('Authorization', auth).expect(200)).body.wallet
        .balance as number,
  };
}

const notify = (app: Express, body: object) =>
  request(app).post('/api/payments/cinetpay/notify').send(body);

async function row(paymentId: string) {
  const { rows } = await database.sql.query<Record<string, unknown>>(
    `SELECT p.*, t.status AS wallet_status, t.failure_code AS wallet_failure
     FROM payments p JOIN wallet_transactions t ON t.id = p.wallet_transaction_id
     WHERE p.id = $1`,
    [paymentId],
  );
  return rows[0]!;
}

const count = async (table: 'payments' | 'wallet_transactions') =>
  Number(
    (await database.sql.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n,
  );

describe('Scénario complet', () => {
  it('POST /deposits → CinetPay → PENDING → notification SUCCESS → vérification → settle → +1000', async () => {
    const { app, cinetpay } = setup();
    const A = await player(app);

    const res = await A.deposit({ tokens: 1000 });
    expect(res.status).toBe(202);
    expect(res.body.transaction).toEqual(
      expect.objectContaining({ kind: 'deposit', status: 'pending', tokens: 1000 }),
    );
    const payment = res.body.payment;
    expect(payment).toEqual({
      id: expect.any(String),
      status: 'PENDING',
      amount: 1000,
      currency: 'XAF',
      paymentUrl: expect.stringMatching(/^https:\/\/secure\.sandbox\.cinetpay\.net\//),
    });
    expect(await A.balance()).toBe(0);
    expect((await A.payment(payment.id).expect(200)).body.payment.status).toBe('PENDING');

    // Le joueur paie sur la page CinetPay ; CinetPay notifie.
    cinetpay.set(0, { status: 'SUCCESS' });
    const notified = await notify(app, cinetpay.notification());
    expect(notified.status).toBe(200);
    expect(notified.body).toEqual({ received: true, status: 'SUCCESS' });
    // Deux lectures serveur à serveur : la lecture du paiement en attente (encore INITIATED),
    // puis la vérification de la notification.
    expect(cinetpay.statusCalls).toBe(2);

    expect(await A.balance()).toBe(1000);
    expect((await A.payment(payment.id).expect(200)).body.payment).toEqual({
      id: payment.id,
      status: 'SUCCESS',
      amount: 1000,
      currency: 'XAF',
      tokens: 1000,
      createdAt: expect.any(String),
      completedAt: expect.any(String),
    });
    expect(await row(payment.id)).toEqual(
      expect.objectContaining({ status: 'SUCCESS', wallet_status: 'succeeded' }),
    );
  });
});

describe('Wallet : conversion 1 FCFA = 1 jeton, montants autorisés', () => {
  it.each([500, 1000, 2000, 5000])('%i XAF → %i jetons', async (amount) => {
    const { app, cinetpay } = setup();
    const A = await player(app);

    const res = await A.deposit({ tokens: amount, currency: 'XAF' });
    expect(res.status).toBe(202);
    expect(res.body.payment).toMatchObject({ amount, currency: 'XAF', status: 'PENDING' });
    expect(cinetpay.created[0]).toMatchObject({ amount, currency: 'XAF', channel: 'PUSH' });
    expect(cinetpay.created[0]!.merchantTransactionId.length).toBeLessThanOrEqual(30);

    cinetpay.set(0, { status: 'SUCCESS' });
    await notify(app, cinetpay.notification()).expect(200);
    expect(await A.balance()).toBe(amount);
  });

  it.each([100, 750, 1500, 10_000, 0, -500, 1000.5, '1000'])(
    'montant non autorisé (%p) → 400, ni transaction ni appel CinetPay',
    async (tokens) => {
      const { app, cinetpay } = setup();
      const A = await player(app);
      const res = await A.deposit({ tokens });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(cinetpay.created).toHaveLength(0);
      expect(await count('wallet_transactions')).toBe(0);
    },
  );

  it.each(['XOF', 'EUR', 'xaf', 1])('devise incorrecte (%p) → 400', async (currency) => {
    const { app, cinetpay } = setup();
    const A = await player(app);
    const res = await A.deposit({ tokens: 1000, currency });
    expect(res.status).toBe(400);
    expect(res.body.fields).toHaveProperty('currency');
    expect(cinetpay.created).toHaveLength(0);
  });

  it('même Idempotency-Key : même paiement, une seule initialisation CinetPay', async () => {
    const { app, cinetpay } = setup();
    const A = await player(app);
    const key = randomUUID();
    const first = await A.deposit({ tokens: 2000 }, key);
    const again = await A.deposit({ tokens: 2000 }, key);
    expect(again.status).toBe(202);
    expect(again.body.payment).toEqual(first.body.payment);
    expect(cinetpay.created).toHaveLength(1);
    expect(await count('payments')).toBe(1);
  });

  it('initialisation refusée par CinetPay : 503, paiement FAILED, aucun crédit', async () => {
    const { app, cinetpay } = setup();
    const A = await player(app);
    cinetpay.failCreate = true;
    const res = await A.deposit({ tokens: 1000 });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MOBILE_MONEY_UNAVAILABLE');
    const { rows } = await database.sql.query<Record<string, unknown>>(
      `SELECT p.status, p.provider_reference, t.status AS wallet_status
       FROM payments p JOIN wallet_transactions t ON t.id = p.wallet_transaction_id`,
    );
    expect(rows).toEqual([{ status: 'FAILED', provider_reference: null, wallet_status: 'failed' }]);
    expect(await A.balance()).toBe(0);
  });

  it('retrait : hors périmètre CinetPay, refusé proprement (rien n’est débité)', async () => {
    const { app } = setup();
    const A = await player(app);
    await database.sql.query(
      `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, 100, now(), now())`,
      [A.id],
    );
    const res = await A.withdraw({ tokens: 50 });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MOBILE_MONEY_UNAVAILABLE');
    expect(await A.balance()).toBe(100);
    // Aucune transaction fictive : rien n'est écrit pour un retrait que CinetPay ne gère pas.
    expect(await count('wallet_transactions')).toBe(0);
    expect(await A.wallet()).toMatchObject({
      mobileMoneyAvailable: true,
      withdrawalAvailable: false,
    });
  });
});

describe('Webhook POST /api/payments/cinetpay/notify', () => {
  async function pending() {
    const ctx = setup();
    const A = await player(ctx.app);
    const res = await A.deposit({ tokens: 1000 });
    return { ...ctx, A, paymentId: res.body.payment.id as string };
  }

  it('SUCCESS : payé, crédité', async () => {
    const { app, cinetpay, A, paymentId } = await pending();
    cinetpay.set(0, { status: 'SUCCESS' });
    expect((await notify(app, cinetpay.notification())).body.status).toBe('SUCCESS');
    expect(await A.balance()).toBe(1000);
    expect(await row(paymentId)).toMatchObject({ provider_status: 'SUCCESS' });
  });

  it('FAILED : paiement et achat échoués, aucun crédit', async () => {
    const { app, cinetpay, A, paymentId } = await pending();
    cinetpay.set(0, { status: 'FAILED' });
    expect((await notify(app, cinetpay.notification()).expect(200)).body.status).toBe('FAILED');
    expect(await A.balance()).toBe(0);
    expect(await row(paymentId)).toMatchObject({
      status: 'FAILED',
      wallet_status: 'failed',
      wallet_failure: 'PAYMENT_FAILED',
    });
  });

  it('PENDING : rien ne change (statut fournisseur seulement noté)', async () => {
    const { app, cinetpay, A, paymentId } = await pending();
    cinetpay.set(0, { status: 'PENDING' });
    expect((await notify(app, cinetpay.notification()).expect(200)).body.status).toBe('PENDING');
    expect(await A.balance()).toBe(0);
    expect(await row(paymentId)).toMatchObject({
      status: 'PENDING',
      provider_status: 'PENDING',
      wallet_status: 'pending',
    });
  });

  it('EXPIRED : paiement expiré, aucun crédit', async () => {
    const { app, cinetpay, A, paymentId } = await pending();
    cinetpay.set(0, { status: 'EXPIRED' });
    expect((await notify(app, cinetpay.notification()).expect(200)).body.status).toBe('EXPIRED');
    expect(await A.balance()).toBe(0);
    expect(await row(paymentId)).toMatchObject({
      status: 'EXPIRED',
      wallet_failure: 'PAYMENT_EXPIRED',
    });
  });

  it('mauvais notify_token : 401, CinetPay non interrogé, aucun crédit', async () => {
    const { app, cinetpay, A } = await pending();
    cinetpay.set(0, { status: 'SUCCESS' });
    const res = await notify(app, cinetpay.notification(0, { notify_token: 'forged-token' }));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NOTIFICATION_REJECTED');
    expect(cinetpay.statusCalls).toBe(0);
    expect(await A.balance()).toBe(0);
  });

  it('mauvais provider_reference (transaction_id) : 401, aucun crédit', async () => {
    const { app, cinetpay, A } = await pending();
    cinetpay.set(0, { status: 'SUCCESS' });
    const res = await notify(app, cinetpay.notification(0, { transaction_id: 'cp-other' }));
    expect(res.status).toBe(401);
    expect(cinetpay.statusCalls).toBe(0);
    expect(await A.balance()).toBe(0);
  });

  it('références différentes dans le statut relu : 409, aucun crédit', async () => {
    const { app, cinetpay, A, paymentId } = await pending();
    cinetpay.set(0, { status: 'SUCCESS', merchantTransactionId: 'LTother' });
    const res = await notify(app, cinetpay.notification());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYMENT_VERIFICATION_FAILED');
    expect(await A.balance()).toBe(0);
    expect(await row(paymentId)).toMatchObject({ status: 'PENDING' });
  });

  it('mauvais montant (renvoyé par CinetPay) : 409, aucun crédit', async () => {
    const { app, cinetpay, A, paymentId } = await pending();
    cinetpay.set(0, { status: 'SUCCESS', amount: 100 });
    expect((await notify(app, cinetpay.notification())).status).toBe(409);
    expect(await A.balance()).toBe(0);
    expect(await row(paymentId)).toMatchObject({ status: 'PENDING', wallet_status: 'pending' });
  });

  it('mauvaise devise (renvoyée par CinetPay) : 409, aucun crédit', async () => {
    const { app, cinetpay, A } = await pending();
    cinetpay.set(0, { status: 'SUCCESS', currency: 'XOF' });
    expect((await notify(app, cinetpay.notification())).status).toBe(409);
    expect(await A.balance()).toBe(0);
  });

  it('montant et devise identiques renvoyés par CinetPay : accepté', async () => {
    const { app, cinetpay, A } = await pending();
    cinetpay.set(0, { status: 'SUCCESS', amount: 1000, currency: 'XAF' });
    await notify(app, cinetpay.notification()).expect(200);
    expect(await A.balance()).toBe(1000);
  });

  it('paiement inconnu : 404', async () => {
    const { app, cinetpay } = await pending();
    const res = await notify(
      app,
      cinetpay.notification(0, { merchant_transaction_id: 'LT-unknown' }),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PAYMENT_NOT_FOUND');
  });

  it.each([{}, { notify_token: 'x' }, { notify_token: 1, transaction_id: 2 }, 'text'])(
    'notification incomplète (%p) : 400',
    async (body) => {
      const { app } = setup();
      expect((await notify(app, body as object)).status).toBe(400);
    },
  );

  it('fournisseur injoignable pendant la vérification : 502 (CinetPay renverra), rien ne change', async () => {
    const { app, cinetpay, A, paymentId } = await pending();
    cinetpay.set(0, { status: 'SUCCESS' });
    cinetpay.failStatus = true;
    expect((await notify(app, cinetpay.notification())).status).toBe(502);
    expect(await row(paymentId)).toMatchObject({ status: 'PENDING' });
    cinetpay.failStatus = false;
    await notify(app, cinetpay.notification()).expect(200);
    expect(await A.balance()).toBe(1000);
  });

  it('paiement déjà traité : 200, ni nouvelle vérification ni nouveau crédit', async () => {
    const { app, cinetpay, A } = await pending();
    cinetpay.set(0, { status: 'FAILED' });
    await notify(app, cinetpay.notification()).expect(200);
    // CinetPay change d'avis : un paiement réglé n'est jamais modifié.
    cinetpay.set(0, { status: 'SUCCESS' });
    const res = await notify(app, cinetpay.notification()).expect(200);
    expect(res.body.status).toBe('FAILED');
    expect(cinetpay.statusCalls).toBe(1);
    expect(await A.balance()).toBe(0);
  });

  it('webhook dupliqué ×3 : un seul crédit', async () => {
    const { app, cinetpay, A } = await pending();
    cinetpay.set(0, { status: 'SUCCESS' });
    for (let i = 0; i < 3; i += 1) {
      expect((await notify(app, cinetpay.notification()).expect(200)).body.status).toBe('SUCCESS');
    }
    expect(await A.balance()).toBe(1000);
  });

  it('webhooks simultanés : un seul crédit', async () => {
    const { app, cinetpay, A, paymentId } = await pending();
    cinetpay.set(0, { status: 'SUCCESS' });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => notify(app, cinetpay.notification())),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(await A.balance()).toBe(1000);
    expect(await row(paymentId)).toMatchObject({ status: 'SUCCESS', wallet_status: 'succeeded' });
  });
});

describe('Transaction PostgreSQL', () => {
  it('erreur pendant le règlement : ROLLBACK complet (ni crédit ni statut), puis reprise unique', async () => {
    const state = { fail: false };
    const { app, cinetpay } = setup({ paymentsSql: failingSql(database.sql, state) });
    const A = await player(app);
    const { body } = await A.deposit({ tokens: 5000 });
    cinetpay.set(0, { status: 'SUCCESS' });

    state.fail = true;
    expect((await notify(app, cinetpay.notification())).status).toBe(500);
    // Le crédit, écrit AVANT la panne dans la même transaction, a été annulé.
    expect(await A.balance()).toBe(0);
    expect(await row(body.payment.id)).toMatchObject({
      status: 'PENDING',
      wallet_status: 'pending',
    });

    await notify(app, cinetpay.notification()).expect(200);
    await notify(app, cinetpay.notification()).expect(200);
    expect(await A.balance()).toBe(5000);
  });
});

describe('GET /api/payments/:id', () => {
  it('le joueur ne lit que SES paiements ; autre joueur ou inconnu : même 404', async () => {
    const { app } = setup();
    const A = await player(app);
    const B = await player(app);
    const { body } = await A.deposit({ tokens: 500 });

    const own = await A.payment(body.payment.id).expect(200);
    expect(Object.keys(own.body.payment).sort()).toEqual(
      ['amount', 'createdAt', 'currency', 'id', 'paymentUrl', 'status', 'tokens'].sort(),
    );
    const foreign = await B.payment(body.payment.id);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('PAYMENT_NOT_FOUND');
    expect((await B.payment(randomUUID())).body.code).toBe('PAYMENT_NOT_FOUND');
    expect((await B.payment('not-a-uuid')).status).toBe(404);
  });

  it('401 sans authentification', async () => {
    const { app } = setup();
    await request(app).get(`/api/payments/${randomUUID()}`).expect(401);
  });

  it('paiement en attente : revérifié auprès de CinetPay si la notification manque', async () => {
    const { app, cinetpay } = setup({ reconcileIntervalMs: 0 });
    const A = await player(app);
    const { body } = await A.deposit({ tokens: 2000 });
    cinetpay.set(0, { status: 'SUCCESS' });

    expect((await A.payment(body.payment.id).expect(200)).body.payment.status).toBe('SUCCESS');
    expect(await A.balance()).toBe(2000);
    // La notification arrivée ensuite ne crédite pas une seconde fois.
    await notify(app, cinetpay.notification()).expect(200);
    expect(await A.balance()).toBe(2000);
  });

  it('fournisseur injoignable : la lecture renvoie l’état enregistré', async () => {
    const { app, cinetpay } = setup({ reconcileIntervalMs: 0 });
    const A = await player(app);
    const { body } = await A.deposit({ tokens: 500 });
    cinetpay.failStatus = true;
    expect((await A.payment(body.payment.id).expect(200)).body.payment.status).toBe('PENDING');
  });
});

describe('Retour navigateur GET /api/payments/cinetpay/return/:paymentId', () => {
  it('redirige vers leter://payment/return sans rien décider ni afficher l’issue', async () => {
    const { app } = setup();
    const id = randomUUID();
    const res = await request(app).get(`/api/payments/cinetpay/return/${id}`).expect(200);
    expect(res.text).toContain(`leter://payment/return?paymentId=${id}`);
    expect(res.text).not.toMatch(/réussi|confirmé|échoué/i);
    expect(res.headers['content-security-policy']).not.toContain('script-src');
    await request(app).get('/api/payments/cinetpay/return/%3Cscript%3E').expect(400);
  });
});

describe('Profil incompatible avec CinetPay (prénom ou nom d’une lettre)', () => {
  it('422 PAYMENT_PROFILE_INCOMPLETE avant toute écriture : ni transaction, ni paiement, ni appel', async () => {
    const { app, cinetpay } = setup();
    const session = await registerAndLogin(app, { firstName: 'A' });
    const res = await request(app)
      .post('/api/wallet/deposits')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ tokens: 500 });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PAYMENT_PROFILE_INCOMPLETE');
    expect(res.body.message).toMatch(/au moins 2 caractères/);
    expect(Object.keys(res.body.fields)).toEqual(['firstName']);
    expect(cinetpay.created).toHaveLength(0);
    expect(await count('wallet_transactions')).toBe(0);
    expect(await count('payments')).toBe(0);
    // Le compte n'est ni bloqué ni modifié.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect(me.body.user.firstName).toBe('A');
  });

  it('prénom et nom de 2 caractères : accepté', async () => {
    const { app, cinetpay } = setup();
    const session = await registerAndLogin(app, { firstName: 'Al', lastName: 'Bo' });
    await request(app)
      .post('/api/wallet/deposits')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ tokens: 500 })
      .expect(202);
    expect(cinetpay.created[0]).toMatchObject({ clientFirstName: 'Al', clientLastName: 'Bo' });
  });
});

describe('Sécurité', () => {
  it('playerId falsifié dans le corps : ignoré, le paiement appartient au joueur authentifié', async () => {
    const { app, cinetpay } = setup();
    const A = await player(app);
    const B = await player(app);
    const { body } = await A.deposit({ tokens: 1000, playerId: B.id, userId: B.id });
    cinetpay.set(0, { status: 'SUCCESS' });
    await notify(app, cinetpay.notification()).expect(200);

    expect(await A.balance()).toBe(1000);
    expect(await B.balance()).toBe(0);
    expect((await B.payment(body.payment.id)).status).toBe(404);
    expect(cinetpay.created[0]!.clientEmail).not.toBe('');
  });

  it('montant falsifié (`amount`) : ignoré, le montant payé est calculé par le serveur', async () => {
    const { app, cinetpay } = setup();
    const A = await player(app);
    const { body } = await A.deposit({ tokens: 5000, amount: 1 });
    expect(body.payment.amount).toBe(5000);
    expect(cinetpay.created[0]!.amount).toBe(5000);
  });

  it('notify_token jamais stocké ni journalisé en clair (seulement son SHA-256)', async () => {
    const { app, cinetpay, logLines } = setup();
    const A = await player(app);
    const { body } = await A.deposit({ tokens: 1000 });
    cinetpay.set(0, { status: 'SUCCESS' });
    await notify(app, cinetpay.notification()).expect(200);
    // Jeton vérifié AVANT « déjà traité » : un faux jeton est refusé même après règlement.
    await notify(app, cinetpay.notification(0, { notify_token: 'forged' })).expect(401);

    const token = cinetpay.created[0]!.notifyToken;
    const stored = await row(body.payment.id);
    expect(stored.notify_token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(logLines.join('\n')).not.toContain(token);
    expect(logLines.join('\n')).not.toContain('forged');
    // Diagnostic du webhook : reçu → vérifié → réglé, sans secret.
    const messages = logLines.map((line) => JSON.parse(line).message as string);
    expect(messages).toEqual(
      expect.arrayContaining([
        'cinetpay notification received',
        'cinetpay payment verified',
        'cinetpay payment settled',
      ]),
    );
    expect(logLines.join('\n')).not.toMatch(/Bearer|api_password|api_key|access_token/i);
  });
});
