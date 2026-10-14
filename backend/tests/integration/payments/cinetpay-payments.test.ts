import { createHash, randomUUID } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';

import { createApp } from '../../../src/app';
import type { SqlClient, SqlExecutor } from '../../../src/database/sql-client';
import { PostgresPaymentRepository } from '../../../src/repositories/postgres-payment.repository';
import { createAuthService } from '../../../src/services/auth/create-auth-service';
import {
  CinetPayError,
  CinetPayPaymentNotSentError,
  type CinetPayPaymentCreated,
  type CinetPayPaymentRequest,
  type CinetPayPaymentStatus,
} from '../../../src/services/payments/cinetpay/cinetpay-client';
import { CinetPayGateway } from '../../../src/services/payments/cinetpay/cinetpay.gateway';
import type { DirectPayOperator } from '../../../src/domain/payments/payment';
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
  /** Refus explicite de la création (ex. 422 { code: 2011, NOT_ALLOWED }). */
  refuseCreate?: CinetPayError;
  /** Paiement créé chez CinetPay, mais la réponse n'arrive jamais (délai dépassé). */
  timeoutAfterCreate = false;
  /** Paiement direct : CinetPay exige malgré tout une redirection. */
  directRedirect = false;
  /** Statut annoncé à la création (jamais une preuve). */
  initialStatus = 'INITIATED';

  createPayment(req: CinetPayPaymentRequest): Promise<CinetPayPaymentCreated> {
    if (this.failCreate) {
      return Promise.reject(new CinetPayError('http', 'CinetPay a répondu 500'));
    }
    if (this.refuseCreate) return Promise.reject(this.refuseCreate);
    const transactionId = `cp-${randomUUID()}`;
    const notifyToken = `notify-${randomUUID()}`;
    this.created.push({ ...req, transactionId, notifyToken });
    this.remote.set(transactionId, {
      status: 'INITIATED',
      transactionId,
      merchantTransactionId: req.merchantTransactionId,
    });
    if (this.timeoutAfterCreate) {
      return Promise.reject(new CinetPayError('timeout', 'CinetPay ne répond pas'));
    }
    const mustBeRedirected = !req.direct || this.directRedirect;
    return Promise.resolve({
      transactionId,
      merchantTransactionId: req.merchantTransactionId,
      ...(mustBeRedirected && {
        paymentUrl: `https://secure.sandbox.cinetpay.net/payment/${transactionId}`,
      }),
      notifyToken,
      initialStatus: this.initialStatus,
      mustBeRedirected,
    });
  }

  /** Comme l'API : `transaction_id` OU `merchant_transaction_id`. */
  getPaymentStatus(identifier: string): Promise<CinetPayPaymentStatus> {
    this.statusCalls += 1;
    if (this.failStatus) return Promise.reject(new CinetPayError('timeout', 'timeout'));
    const remote =
      this.remote.get(identifier) ??
      [...this.remote.values()].find((r) => r.merchantTransactionId === identifier);
    if (!remote) {
      return Promise.reject(
        new CinetPayError('http', 'not found', { httpStatus: 404, apiCode: 404, apiStatus: 'NOT_FOUND' }),
      );
    }
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

function setup(
  options: {
    reconcileIntervalMs?: number;
    paymentsSql?: SqlClient;
    directPayOperators?: DirectPayOperator[];
    pagePreselectOperators?: DirectPayOperator[];
    clock?: () => Date;
    /** Client SQL de la passerelle (simulation d'une base qui tombe pendant la création). */
    gatewaySql?: SqlClient;
  } = {},
) {
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
  const repository = new PostgresPaymentRepository(options.gatewaySql ?? database.sql);
  const gateway = new CinetPayGateway({
    client: cinetpay,
    payments: repository,
    logger,
    notifyUrl: 'https://api.test.local/api/payments/cinetpay/notify',
    returnUrl: 'https://api.test.local/api/payments/cinetpay/return',
    directPayOperators: options.directPayOperators ?? [],
    pagePreselectOperators: options.pagePreselectOperators ?? [],
  });
  const wallet = createWalletService({ sql: database.sql, logger, gateway });
  const payments = new PaymentService({
    payments: new PostgresPaymentRepository(options.paymentsSql ?? database.sql),
    cinetpay,
    logger,
    reconcileIntervalMs: options.reconcileIntervalMs ?? 60 * 60_000,
    ...(options.clock && { clock: options.clock }),
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
  return { app, cinetpay, logLines, payments };
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
      mode: 'REDIRECT',
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
      mode: 'REDIRECT',
      tokens: 1000,
      createdAt: expect.any(String),
      completedAt: expect.any(String),
    });
    expect(await row(payment.id)).toEqual(
      expect.objectContaining({ status: 'SUCCESS', wallet_status: 'succeeded' }),
    );
  });
});

describe('Wallet : montant SAISI, 1 FCFA = 1 jeton, limites 100 à 2 500 000 FCFA (D-085)', () => {
  it.each([100, 500, 750, 1000, 1234, 5000, 10_000, 2_500_000])('%i XAF → %i jetons', async (amount) => {
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

  it.each([
    ['nul', 0],
    ['négatif', -500],
    ['décimal', 1000.5],
    ['chaîne numérique', '1000'],
    ['texte', 'mille'],
    ['vide', ''],
    ['null', null],
    ['absent', undefined],
    ['sous le minimum', 99],
    ['au-dessus du maximum', 2_500_001],
    ['énorme', 1e12],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('montant %s (%p) → 400 explicite, ni transaction ni appel CinetPay', async (_label, tokens) => {
    const { app, cinetpay } = setup();
    const A = await player(app);
    const res = await A.deposit(tokens === undefined ? {} : { tokens });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(typeof res.body.fields.tokens).toBe('string');
    expect(cinetpay.created).toHaveLength(0);
    expect(await count('wallet_transactions')).toBe(0);
    expect(await count('payments')).toBe(0);
  });

  it('hors limites : message explicite avec les bornes', async () => {
    const { app } = setup();
    const A = await player(app);
    for (const tokens of [99, 2_500_001]) {
      const res = await A.deposit({ tokens });
      expect(res.body.fields.tokens).toBe(
        'Montant de recharge invalide : nombre entier de FCFA entre 100 et 2 500 000.',
      );
    }
  });

  it('requête envoyée à la main : montant, jetons ou prix fournis par le client ignorés', async () => {
    const { app, cinetpay } = setup();
    const A = await player(app);
    const res = await A.deposit({ tokens: 1500, amount: 1, price: 1, currency: 'XAF', userId: 'x' });
    expect(res.status).toBe(202);
    expect(res.body.payment).toMatchObject({ amount: 1500, currency: 'XAF' });
    expect(cinetpay.created[0]).toMatchObject({ amount: 1500, currency: 'XAF' });
  });

  it('GET /api/wallet annonce les limites appliquées par le serveur', async () => {
    const { app } = setup();
    const A = await player(app);
    expect((await A.wallet()).depositLimits).toEqual({ min: 100, max: 2_500_000, currency: 'XAF' });
  });

  it('montant libre : idempotence et aucun double crédit (notifications multiples, réconciliation)', async () => {
    const { app, cinetpay, payments } = setup();
    const A = await player(app);
    const key = randomUUID();
    const [first, again] = await Promise.all([
      A.deposit({ tokens: 3750 }, key),
      A.deposit({ tokens: 3750 }, key),
    ]);
    expect(first.body.payment.id).toBe(again.body.payment.id);
    expect(cinetpay.created).toHaveLength(1);
    // Même clé, autre montant : autre opération, refusée.
    expect((await A.deposit({ tokens: 3751 }, key)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    cinetpay.set(0, { status: 'SUCCESS' });
    await Promise.all([notify(app, cinetpay.notification()), notify(app, cinetpay.notification())]);
    await payments.reconcile(first.body.payment.id);
    expect(await A.balance()).toBe(3750);
  });


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

  it('retrait : transferts non activés (D-075), refusé proprement (rien n’est débité)', async () => {
    const { app } = setup();
    const A = await player(app);
    await database.sql.query(
      `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, 5000, now(), now())`,
      [A.id],
    );
    const res = await A.withdraw({ tokens: 1000, operator: 'MTN_CM' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MOBILE_MONEY_UNAVAILABLE');
    expect(await A.balance()).toBe(5000);
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
      ['amount', 'createdAt', 'currency', 'id', 'mode', 'paymentUrl', 'status', 'tokens'].sort(),
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

/**
 * Paiement DIRECT, sans redirection (D-083) : même API v1 (`direct_pay`, opérateur, numéro
 * d'inscription), validation sur le téléphone. Jamais de crédit avant le statut RELU par le
 * serveur ; opérateur non activé, numéro hors Cameroun ou refus explicite : rien n'est
 * crédité et la page CinetPay reste possible ; issue inconnue : jamais close à l'aveugle.
 */
describe('Paiement direct MTN Mobile Money (sans redirection)', () => {
  const MTN = ['MTN_CM'] as DirectPayOperator[];

  it('GET /api/wallet annonce les opérateurs directs ; aucun sans activation ni numéro +237', async () => {
    const off = setup();
    expect((await (await player(off.app)).wallet()).directPayOperators).toEqual([]);
    await database.reset();
    const on = setup({ directPayOperators: MTN });
    const A = await player(on.app);
    expect((await A.wallet()).directPayOperators).toEqual(['MTN_CM']);
    await database.sql.query("UPDATE users SET phone = '+33612345678' WHERE id = $1", [A.id]);
    expect((await A.wallet()).directPayOperators).toEqual([]);
  });

  it('succès : validation sur le téléphone, crédit seulement après le statut relu, une fois', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN });
    // Même un « SUCCESS » annoncé à la création n'est pas une preuve.
    cinetpay.initialStatus = 'SUCCESS';
    const A = await player(app);
    const res = await A.deposit({ tokens: 1000, method: 'MTN_CM', playerId: 'autre', amount: 1 });
    expect(res.status).toBe(202);
    expect(res.body.payment).toEqual({
      id: expect.any(String),
      status: 'PENDING',
      amount: 1000,
      currency: 'XAF',
      mode: 'DIRECT',
      operator: 'MTN_CM',
    });
    // Le serveur calcule le montant ; le numéro est celui du compte (+237), jamais du client.
    const sent = cinetpay.created[0]!;
    expect(sent).toMatchObject({ amount: 1000, currency: 'XAF', channel: 'PUSH' });
    expect(sent.direct).toEqual({ paymentMethod: 'MTN_CM', phoneNumber: expect.stringMatching(/^\+2376\d{8}$/) });
    expect(sent).not.toHaveProperty('otpCode');
    const id = res.body.payment.id as string;
    expect(await row(id)).toMatchObject({ payment_method: 'MTN_CM', payment_url: null, status: 'PENDING' });

    // Toujours INITIATED chez CinetPay : rien n'est crédité malgré le « SUCCESS » initial.
    expect((await A.payment(id).expect(200)).body.payment.status).toBe('PENDING');
    expect(await A.balance()).toBe(0);

    cinetpay.set(0, { status: 'SUCCESS' });
    const notifications = await Promise.all([1, 2, 3].map(() => notify(app, cinetpay.notification())));
    expect(notifications.every((n) => n.status === 200)).toBe(true);
    expect(await A.balance()).toBe(1000);
    expect((await A.payment(id).expect(200)).body.payment).toMatchObject({
      status: 'SUCCESS',
      mode: 'DIRECT',
      tokens: 1000,
    });
    await notify(app, cinetpay.notification()).expect(200);
    expect(await A.balance()).toBe(1000);
  });

  it.each([
    ['PENDING', 'PENDING', 'pending'],
    ['FAILED', 'FAILED', 'failed'],
    ['INSUFFICIENT_BALANCE', 'FAILED', 'failed'],
    ['EXPIRED', 'EXPIRED', 'failed'],
    ['OTP_ERROR', 'PENDING', 'pending'],
    ['NOT_ALLOWED', 'PENDING', 'pending'],
  ])('statut CinetPay %s → paiement %s, aucun crédit', async (remote, status, walletStatus) => {
    const { app, cinetpay } = setup({ directPayOperators: MTN });
    const A = await player(app);
    const id = (await A.deposit({ tokens: 500, method: 'MTN_CM' }).expect(202)).body.payment.id;
    cinetpay.set(0, { status: remote });
    await notify(app, cinetpay.notification()).expect(200);
    expect(await row(id)).toMatchObject({ status, wallet_status: walletStatus });
    expect(await A.balance()).toBe(0);
  });

  it('erreur réseau à la vérification : jamais un succès, paiement toujours en attente', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN });
    const A = await player(app);
    const id = (await A.deposit({ tokens: 500, method: 'MTN_CM' }).expect(202)).body.payment.id;
    cinetpay.set(0, { status: 'SUCCESS' });
    cinetpay.failStatus = true;
    expect((await notify(app, cinetpay.notification())).status).toBeGreaterThanOrEqual(500);
    expect(await row(id)).toMatchObject({ status: 'PENDING', wallet_status: 'pending' });
    expect(await A.balance()).toBe(0);
  });




  it('5xx sans code après envoi : issue inconnue, jamais déclarée échouée ni réussie', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN });
    cinetpay.refuseCreate = new CinetPayError('http', 'CinetPay a répondu 502', { httpStatus: 502 });
    const A = await player(app);
    const res = await A.deposit({ tokens: 500, method: 'MTN_CM' });
    expect(res.status).toBe(202);
    expect(res.body.payment).toMatchObject({ status: 'PENDING', mode: 'DIRECT' });
    expect(await row(res.body.payment.id)).toMatchObject({ status: 'PENDING', wallet_status: 'pending' });
  });

  it('CinetPay exige une redirection : page proposée comme telle (mode REDIRECT)', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN });
    cinetpay.directRedirect = true;
    const A = await player(app);
    const res = await A.deposit({ tokens: 500, method: 'MTN_CM' });
    expect(res.status).toBe(202);
    expect(res.body.payment).toMatchObject({
      mode: 'REDIRECT',
      operator: 'MTN_CM',
      paymentUrl: expect.stringMatching(/^https:\/\//),
    });
  });


  describe('création partie sans réponse (délai dépassé après l’envoi)', () => {
    it('paiement retrouvé chez CinetPay par merchant_transaction_id, crédité une fois après SUCCESS', async () => {
      const { app, cinetpay, payments } = setup({ directPayOperators: MTN, reconcileIntervalMs: 0 });
      cinetpay.timeoutAfterCreate = true;
      const A = await player(app);
      const res = await A.deposit({ tokens: 2000, method: 'MTN_CM' });
      // Ni échec ni crédit : la demande a peut-être atteint le téléphone.
      expect(res.status).toBe(202);
      expect(res.body.payment).toEqual({
        id: expect.any(String),
        status: 'PENDING',
        amount: 2000,
        currency: 'XAF',
        mode: 'DIRECT',
        operator: 'MTN_CM',
      });
      const id = res.body.payment.id as string;
      expect(await row(id)).toMatchObject({
        status: 'PENDING',
        provider_reference: null,
        notify_token_hash: null,
        wallet_status: 'pending',
      });

      // Toujours INITIATED : référence retrouvée, rien crédité.
      expect((await payments.reconcile(id)).status).toBe('PENDING');
      expect(await row(id)).toMatchObject({
        provider_reference: cinetpay.created[0]!.transactionId,
        notify_token_hash: null,
      });
      expect(await A.balance()).toBe(0);
      // Notification de ce paiement : refusée (jeton inconnu), jamais un crédit.
      expect((await notify(app, cinetpay.notification())).status).toBe(401);

      cinetpay.set(0, { status: 'SUCCESS' });
      const results = await Promise.all([payments.reconcile(id), payments.reconcile(id), A.payment(id)]);
      expect(results[0].status === 'SUCCESS' || results[1].status === 'SUCCESS').toBe(true);
      expect(await A.balance()).toBe(2000);
      expect(await payments.reconcile(id)).toMatchObject({ outcome: 'already_final', status: 'SUCCESS' });
      expect(await A.balance()).toBe(2000);
    });

    it('jamais créé chez CinetPay : en attente, puis clos sans crédit après 30 min', async () => {
      let now = new Date('2026-10-12T10:00:00Z');
      const { app, cinetpay, payments } = setup({
        directPayOperators: MTN,
        reconcileIntervalMs: 0,
        clock: () => now,
      });
      cinetpay.refuseCreate = new CinetPayError('timeout', 'CinetPay ne répond pas');
      const A = await player(app);
      const id = (await A.deposit({ tokens: 500, method: 'MTN_CM' }).expect(202)).body.payment.id;
      await database.sql.query('UPDATE payments SET created_at = $2 WHERE id = $1', [id, now.toISOString()]);

      now = new Date(now.getTime() + 5 * 60_000);
      expect(await payments.reconcile(id)).toMatchObject({ outcome: 'pending', status: 'PENDING' });
      expect(await row(id)).toMatchObject({ status: 'PENDING', provider_status: 'NOT_FOUND' });

      now = new Date(now.getTime() + 30 * 60_000);
      expect(await payments.reconcile(id)).toMatchObject({ status: 'FAILED' });
      expect(await row(id)).toMatchObject({ status: 'FAILED', wallet_status: 'failed' });
      expect(await A.balance()).toBe(0);
    });

    it('fournisseur injoignable pendant la recherche : rien n’est écrit', async () => {
      const { app, cinetpay, payments } = setup({ directPayOperators: MTN, reconcileIntervalMs: 0 });
      cinetpay.timeoutAfterCreate = true;
      const A = await player(app);
      const id = (await A.deposit({ tokens: 500, method: 'MTN_CM' }).expect(202)).body.payment.id;
      cinetpay.failStatus = true;
      await expect(payments.reconcile(id)).rejects.toThrow();
      expect(await row(id)).toMatchObject({ status: 'PENDING', provider_reference: null });
    });
  });
});

/**
 * Cas observé le 2026-10-12 sur téléphone : CinetPay refuse l'AUTHENTIFICATION du serveur
 * (`422 { code: 2011, NOT_ALLOWED }` : adresse IP non autorisée par le compte marchand). La
 * demande de paiement n'est jamais envoyée : 503 MOBILE_MONEY_UNAVAILABLE, rien de crédité ni
 * de débité, et le motif exact est conservé pour le diagnostic.
 */
describe('Authentification CinetPay refusée (IP non autorisée)', () => {
  const notAllowed = () =>
    new CinetPayPaymentNotSentError(
      new CinetPayError('authentication', 'Authentification CinetPay refusée', {
        httpStatus: 422,
        apiCode: 2011,
        apiStatus: 'NOT_ALLOWED',
      }),
    );

  it('503 MOBILE_MONEY_UNAVAILABLE, motif 2011 NOT_ALLOWED enregistré, aucun crédit, rejeu identique', async () => {
    const { app, cinetpay, logLines } = setup();
    cinetpay.refuseCreate = notAllowed() as unknown as CinetPayError;
    const A = await player(app);
    const key = randomUUID();

    const res = await A.deposit({ tokens: 2000 }, key);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MOBILE_MONEY_UNAVAILABLE');
    // Cause classée (D-100) : accès refusé au fournisseur, non réessayable par le joueur ;
    // jamais l'IP, la clé ni le code brut dans le message.
    expect(res.body.details).toEqual({
      cause: 'PROVIDER_IP_NOT_ALLOWED',
      retryable: false,
      charged: false,
    });
    expect(res.body.message).toContain('suspendues');
    expect(res.body.message).toContain('Aucun montant n’a été débité');
    expect(res.body.message).not.toMatch(/IP|2011|NOT_ALLOWED|clé/);
    expect(cinetpay.created).toHaveLength(0);

    const { rows } = await database.sql.query<Record<string, unknown>>(
      `SELECT p.status, p.provider_reference, p.metadata, t.status AS wallet_status, t.failure_code
       FROM payments p JOIN wallet_transactions t ON t.id = p.wallet_transaction_id`,
    );
    expect(rows).toEqual([
      {
        status: 'FAILED',
        provider_reference: null,
        metadata: { failure: 'CinetPayPaymentNotSentError:authentication:2011:NOT_ALLOWED' },
        wallet_status: 'failed',
        failure_code: 'PROVIDER_UNAVAILABLE',
      },
    ]);
    expect(await A.balance()).toBe(0);
    // Journal exploitable, sans secret : le motif et le code.
    expect(logLines.join('\n')).toContain(
      'CinetPayPaymentNotSentError:authentication:2011:NOT_ALLOWED',
    );

    // Même Idempotency-Key : même refus, aucune nouvelle opération ni nouvel appel.
    cinetpay.refuseCreate = undefined;
    expect((await A.deposit({ tokens: 2000 }, key)).status).toBe(503);
    expect(await count('wallet_transactions')).toBe(1);
    expect(cinetpay.created).toHaveLength(0);

    // Accès rétabli (IP autorisée) : une NOUVELLE demande aboutit normalement.
    const retry = await A.deposit({ tokens: 2000 });
    expect(retry.status).toBe(202);
    expect(retry.body.payment).toMatchObject({ status: 'PENDING', mode: 'REDIRECT' });
    expect(await A.balance()).toBe(0);
  });

  it.each([
    ['délai dépassé', new CinetPayError('timeout', 'CinetPay ne répond pas'), 'CinetPayError:timeout', 'PROVIDER_TIMEOUT_AFTER_SEND'],
    ['erreur HTTP 500', new CinetPayError('http', 'CinetPay a répondu 500', { httpStatus: 500 }), 'CinetPayError:http:500', 'PROVIDER_HTTP_ERROR'],
  ])('%s à la création (page CinetPay) : 503, motif enregistré, aucun crédit', async (_label, error, reason, cause) => {
    const { app, cinetpay } = setup();
    cinetpay.refuseCreate = error;
    const A = await player(app);
    const res = await A.deposit({ tokens: 500 });
    expect(res.status).toBe(503);
    // Page jamais remise au joueur : rien n'a pu être payé ; un nouvel essai est sûr.
    expect(res.body.details).toEqual({ cause, retryable: true, charged: false });
    expect(res.body.message).toContain('incident');
    const { rows } = await database.sql.query<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM payments',
    );
    expect(rows[0]!.metadata).toEqual({ failure: reason });
    expect(await A.balance()).toBe(0);
  });

  it('sans jeton : 401, rien n’est créé', async () => {
    const { app, cinetpay } = setup();
    await request(app)
      .post('/api/wallet/deposits')
      .set('Idempotency-Key', randomUUID())
      .send({ tokens: 500 })
      .expect(401);
    expect(cinetpay.created).toHaveLength(0);
    expect(await count('wallet_transactions')).toBe(0);
  });
});

/**
 * Traçabilité (2026-10-12) : la réponse de création et le chemin qui a relu puis réglé le
 * paiement sont conservés (`metadata`), sans secret ni numéro. Cas observé en sandbox : un
 * paiement direct MTN « SUCCESS » relu ~2 s après sa création, sans aucune validation sur le
 * téléphone (issue simulée par CinetPay) ; d'autres restent PENDING. Simulation : ce test ne
 * prouve PAS un fonctionnement réel auprès de MTN.
 */
describe('Traçabilité des paiements directs (création → crédit)', () => {
  const MTN = ['MTN_CM'] as DirectPayOperator[];
  const metadataOf = async (id: string) =>
    (await database.sql.query<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM payments WHERE id = $1',
      [id],
    )).rows[0]!.metadata;

  it('SUCCESS relu par la lecture du joueur, sans validation sur le téléphone : crédité une fois, tracé', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN, reconcileIntervalMs: 0 });
    const A = await player(app);
    const id = (await A.deposit({ tokens: 1000, method: 'MTN_CM' }).expect(202)).body.payment.id;
    expect(await metadataOf(id)).toEqual({ initialStatus: 'INITIATED', mustBeRedirected: false });

    // L'issue est décidée par CinetPay (sandbox) : aucune action sur le téléphone.
    cinetpay.set(0, { status: 'SUCCESS' });
    const reads = await Promise.all([A.payment(id), A.payment(id), A.payment(id)]);
    expect(reads.every((r) => r.status === 200)).toBe(true);
    expect(await A.balance()).toBe(1000);
    expect(await metadataOf(id)).toEqual({
      initialStatus: 'INITIATED',
      mustBeRedirected: false,
      settledBy: 'player_read',
    });
    // Relectures et notification ultérieures : aucun nouveau crédit, trace inchangée.
    await A.payment(id).expect(200);
    await notify(app, cinetpay.notification()).expect(200);
    expect(await A.balance()).toBe(1000);
    expect((await metadataOf(id)).settledBy).toBe('player_read');
  });

  it('INITIATED puis PENDING : jamais crédité, statut fournisseur noté, aucune trace de règlement', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN, reconcileIntervalMs: 0 });
    const A = await player(app);
    const id = (await A.deposit({ tokens: 500, method: 'MTN_CM' }).expect(202)).body.payment.id;
    await A.payment(id).expect(200);
    expect(await row(id)).toMatchObject({ status: 'PENDING', provider_status: 'INITIATED' });
    cinetpay.set(0, { status: 'PENDING' });
    await A.payment(id).expect(200);
    expect(await row(id)).toMatchObject({ status: 'PENDING', provider_status: 'PENDING' });
    expect(await metadataOf(id)).not.toHaveProperty('settledBy');
    expect(await A.balance()).toBe(0);
  });

  it.each([
    ['notification', 'notification'],
    ['réconciliation', 'reconciliation'],
  ] as const)('règlement par %s : settledBy = %s', async (_label, expected) => {
    const { app, cinetpay, payments } = setup({ directPayOperators: MTN });
    const A = await player(app);
    const id = (await A.deposit({ tokens: 2000, method: 'MTN_CM' }).expect(202)).body.payment.id;
    cinetpay.set(0, { status: 'FAILED' });
    if (expected === 'notification') await notify(app, cinetpay.notification()).expect(200);
    else await payments.reconcile(id);
    expect(await row(id)).toMatchObject({ status: 'FAILED', wallet_status: 'failed' });
    expect((await metadataOf(id)).settledBy).toBe(expected);
    expect(await A.balance()).toBe(0);
  });

  it('réconciliation répétée et simultanée après SUCCESS : un seul crédit', async () => {
    const { app, cinetpay, payments } = setup({ directPayOperators: MTN });
    const A = await player(app);
    const id = (await A.deposit({ tokens: 5000, method: 'MTN_CM' }).expect(202)).body.payment.id;
    cinetpay.set(0, { status: 'SUCCESS' });
    await Promise.all([1, 2, 3, 4].map(() => payments.reconcile(id)));
    await payments.reconcile(id);
    expect(await A.balance()).toBe(5000);
    const { rows } = await database.sql.query<{ n: string }>(
      "SELECT count(*) AS n FROM wallet_transactions WHERE kind = 'deposit' AND status = 'succeeded'",
    );
    expect(Number(rows[0]!.n)).toBe(1);
    expect((await metadataOf(id)).settledBy).toBe('reconciliation');
  });

  it('page CinetPay (non directe) : mustBeRedirected = true conservé', async () => {
    const { app } = setup();
    const A = await player(app);
    const id = (await A.deposit({ tokens: 500 }).expect(202)).body.payment.id;
    expect(await metadataOf(id)).toEqual({ initialStatus: 'INITIATED', mustBeRedirected: true });
  });
});



/**
 * Numéro du payeur (D-088) : TOUJOURS le numéro d'inscription du compte, au format
 * international (`+237…`), transmis à CinetPay par le serveur pour toute recharge (page
 * hébergée comme paiement direct). Un numéro envoyé par l'application est ignoré.
 */
describe('Numéro du payeur transmis à CinetPay', () => {
  const registeredPhone = async (userId: string) =>
    (await database.sql.query<{ phone: string }>('SELECT phone FROM users WHERE id = $1', [userId]))
      .rows[0]!.phone;

  it('page CinetPay : numéro d’inscription +237 transmis, numéro du client ignoré', async () => {
    const { app, cinetpay } = setup();
    const A = await player(app);
    const res = await A.deposit({
      tokens: 1500,
      phone: '+237600000000',
      clientPhoneNumber: '+237600000000',
      msisdn: '+237600000000',
    });
    expect(res.status).toBe(202);
    const phone = await registeredPhone(A.id);
    expect(phone).toMatch(/^\+2376\d{8}$/);
    expect(cinetpay.created[0]!.clientPhoneNumber).toBe(phone);
    expect(cinetpay.created[0]!.clientPhoneNumber).not.toBe('+237600000000');
  });

  it('paiement direct MTN : même numéro d’inscription', async () => {
    const { app, cinetpay } = setup({ directPayOperators: ['MTN_CM'] as DirectPayOperator[] });
    const A = await player(app);
    await A.deposit({ tokens: 500, method: 'MTN_CM' }).expect(202);
    const phone = await registeredPhone(A.id);
    expect(cinetpay.created[0]!.direct?.phoneNumber).toBe(phone);
    expect(cinetpay.created[0]!.clientPhoneNumber).toBe(phone);
  });


  it('numéro d’inscription : format international garanti par la base (indicatif obligatoire)', async () => {
    const { app } = setup();
    const A = await player(app);
    // users.phone : CHECK (phone ~ '^\+[1-9][0-9]{7,14}$') depuis la migration 0002.
    await expect(
      database.sql.query("UPDATE users SET phone = '692130271' WHERE id = $1", [A.id]),
    ).rejects.toThrow(/users_phone_check/);
    expect(await registeredPhone(A.id)).toMatch(/^\+237/);
  });
});

/**
 * Recharge AUTOMATIQUE (D-090) : l'application n'envoie que le montant ; le serveur déduit
 * l'opérateur du numéro d'inscription (préfixe camerounais), tente le paiement DIRECT s'il est
 * ouvert pour cet opérateur, et ne bascule sur la page CinetPay (même opérateur) que sur un refus
 * CERTAIN. Jamais d'opérateur imposé par l'application, jamais de second paiement vivant.
 */
describe('Recharge automatique (opérateur déduit du numéro du compte)', () => {
  const MTN = ['MTN_CM'] as DirectPayOperator[];
  const BOTH = ['MTN_CM', 'OM_CM'] as DirectPayOperator[];
  let orangeSeq = 0;
  /** Joueur Orange Money : numéro d'inscription 69x (le fixture crée des 67x, MTN). */
  async function orangePlayer(app: Express) {
    const p = await player(app);
    orangeSeq += 1;
    await database.sql.query('UPDATE users SET phone = $2 WHERE id = $1', [
      p.id,
      `+23769${String(orangeSeq).padStart(7, '0')}`,
    ]);
    return p;
  }

  it('GET /api/wallet : opérateur déduit du numéro (MTN 67x, Orange 69x, non pris en charge null)', async () => {
    const { app } = setup();
    const mtn = await player(app);
    const orange = await orangePlayer(app);
    const nexttel = await player(app);
    await database.sql.query("UPDATE users SET phone = '+237661234567' WHERE id = $1", [nexttel.id]);
    expect((await mtn.wallet()).paymentOperator).toBe('MTN_CM');
    expect((await orange.wallet()).paymentOperator).toBe('OM_CM');
    expect((await nexttel.wallet()).paymentOperator).toBeNull();
  });

  it('MTN, direct ouvert : le montant seul suffit → paiement direct sur le numéro du compte', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN });
    const A = await player(app);
    const res = await A.deposit({ tokens: 1500 });
    expect(res.status).toBe(202);
    expect(res.body.payment).toMatchObject({ amount: 1500, mode: 'DIRECT', operator: 'MTN_CM' });
    expect(cinetpay.created[0]!.direct?.paymentMethod).toBe('MTN_CM');
  });

  it('Orange, direct non ouvert (OTP) : page CinetPay directement, jamais direct ni OTP', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN });
    const B = await orangePlayer(app);
    const res = await B.deposit({ tokens: 800, otpCode: '1234' });
    expect(res.status).toBe(202);
    expect(res.body.payment).toMatchObject({ amount: 800, mode: 'REDIRECT', paymentUrl: expect.any(String) });
    expect(cinetpay.created[0]).not.toHaveProperty('direct');
    expect(cinetpay.created[0]).not.toHaveProperty('otpCode');
    expect(cinetpay.created[0]!.clientPhoneNumber).toMatch(/^\+23769/);
  });

  it('Orange présélectionné si le compte l’accepte (CINETPAY_PAGE_PRESELECT_METHODS)', async () => {
    const { app, cinetpay } = setup({ pagePreselectOperators: ['OM_CM'] as DirectPayOperator[] });
    const B = await orangePlayer(app);
    const res = await B.deposit({ tokens: 800 });
    expect(res.body.payment).toMatchObject({ mode: 'REDIRECT', operator: 'OM_CM' });
    expect(cinetpay.created[0]!.pagePaymentMethod).toBe('OM_CM');
  });

  it('opérateur ou mode imposé par l’application et différent du compte : 400, rien créé', async () => {
    const { app, cinetpay } = setup({ directPayOperators: BOTH });
    const A = await player(app); // MTN
    for (const body of [
      { tokens: 500, method: 'OM_CM' },
      { tokens: 500, operator: 'OM_CM' },
      { tokens: 500, method: 'WAVE_SN' },
    ]) {
      expect((await A.deposit(body)).status).toBe(400);
    }
    expect(cinetpay.created).toHaveLength(0);
    expect(await count('wallet_transactions')).toBe(0);
    // Le même opérateur que le compte est simplement redondant (accepté).
    expect((await A.deposit({ tokens: 500, method: 'MTN_CM' })).status).toBe(202);
  });

  it('numéro hors MTN / Orange (Nexttel, autre pays) : 409 PAYMENT_OPERATOR_UNSUPPORTED, rien créé', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN });
    const A = await player(app);
    for (const phone of ['+237661234567', '+2250707070700']) {
      await database.sql.query('UPDATE users SET phone = $2 WHERE id = $1', [A.id, phone]);
      const res = await A.deposit({ tokens: 500 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PAYMENT_OPERATOR_UNSUPPORTED');
    }
    expect(cinetpay.created).toHaveLength(0);
    expect(await count('wallet_transactions')).toBe(0);
  });

  it('direct refusé de façon CERTAINE : repli serveur vers la page (même requête), un seul paiement vivant, crédit unique, rejeu identique', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN, pagePreselectOperators: MTN });
    const A = await player(app);
    let refused = false;
    const original = cinetpay.createPayment.bind(cinetpay);
    cinetpay.createPayment = (req) => {
      if (req.direct && !refused) {
        refused = true;
        return Promise.reject(
          new CinetPayError('http', 'CinetPay a répondu 422', {
            httpStatus: 422,
            apiCode: 2011,
            apiStatus: 'NOT_ALLOWED',
          }),
        );
      }
      return original(req);
    };
    const key = randomUUID();
    const res = await A.deposit({ tokens: 2000 }, key);
    expect(res.status).toBe(202);
    expect(res.body.payment).toMatchObject({ amount: 2000, mode: 'REDIRECT', operator: 'MTN_CM' });
    expect(cinetpay.created).toHaveLength(1);
    expect(cinetpay.created[0]!.pagePaymentMethod).toBe('MTN_CM');

    // Rejeu de la même intention : la même page, aucune nouvelle demande.
    const again = await A.deposit({ tokens: 2000 }, key);
    expect(again.body.payment.id).toBe(res.body.payment.id);
    expect(cinetpay.created).toHaveLength(1);

    cinetpay.set(0, { status: 'SUCCESS' });
    await Promise.all([notify(app, cinetpay.notification()), notify(app, cinetpay.notification())]);
    expect(await A.balance()).toBe(2000);
    const { rows } = await database.sql.query<{ status: string }>(
      'SELECT status FROM payments ORDER BY created_at',
    );
    expect(rows.map((r) => r.status)).toEqual(['FAILED', 'SUCCESS']);
  });

  it('direct à l’issue INCERTAINE : paiement en attente renvoyé, AUCUN repli ni second paiement', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN });
    cinetpay.timeoutAfterCreate = true;
    const A = await player(app);
    const key = randomUUID();
    const res = await A.deposit({ tokens: 1000 }, key);
    expect(res.status).toBe(202);
    expect(res.body.payment).toMatchObject({ status: 'PENDING', mode: 'DIRECT' });
    cinetpay.timeoutAfterCreate = false;
    const again = await A.deposit({ tokens: 1000 }, key);
    expect(again.body.payment.id).toBe(res.body.payment.id);
    expect(cinetpay.created).toHaveLength(1);
    expect(await A.balance()).toBe(0);
  });

  it('service indisponible (demande jamais partie) : 503 explicite, aucun repli, rien crédité', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN });
    cinetpay.refuseCreate = new CinetPayPaymentNotSentError(
      new CinetPayError('authentication', 'refus', { httpStatus: 422, apiCode: 2011 }),
    ) as unknown as CinetPayError;
    const A = await player(app);
    const res = await A.deposit({ tokens: 500 });
    expect(res.status).toBe(503);
    expect(cinetpay.created).toHaveLength(0);
    expect(await count('payments')).toBe(1);
    expect(await A.balance()).toBe(0);
  });

  /**
   * Cas réels du 2026-10-14 (transactions de Hugo, MTN 682, et de LAMAT, Orange 690) : l'IP
   * publique du serveur n'est plus autorisée (2011). MTN (direct) et Orange (page) échouent pour
   * la MÊME raison ; aucun repli, puisque la page exige la même authentification.
   */
  it.each([
    ['MTN (paiement direct)', false, 'MTN_CM'],
    ['Orange (page CinetPay)', true, null],
  ])('%s, IP non autorisée (2011) : 503 explicite, aucun repli, achat clos, rien crédité', async (_label, orange, method) => {
    const { app, cinetpay, logLines } = setup({ directPayOperators: MTN });
    cinetpay.refuseCreate = new CinetPayPaymentNotSentError(
      new CinetPayError('authentication', 'Authentification CinetPay refusée', {
        httpStatus: 422,
        apiCode: 2011,
        apiStatus: 'NOT_ALLOWED',
      }),
    ) as unknown as CinetPayError;
    const A = orange ? await orangePlayer(app) : await player(app);

    const res = await A.deposit({ tokens: 1200 });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MOBILE_MONEY_UNAVAILABLE');
    expect(res.body.details).toEqual({
      cause: 'PROVIDER_IP_NOT_ALLOWED',
      retryable: false,
      charged: false,
    });
    expect(res.body.message).toContain('suspendues');
    // Rien n'a quitté le serveur, aucun second paiement (page) n'a été tenté.
    expect(cinetpay.created).toHaveLength(0);
    const { rows } = await database.sql.query<Record<string, unknown>>(
      `SELECT p.status, p.payment_method, p.provider_reference, t.status AS wallet_status,
              t.failure_code
       FROM payments p JOIN wallet_transactions t ON t.id = p.wallet_transaction_id`,
    );
    expect(rows).toEqual([
      {
        status: 'FAILED',
        payment_method: method,
        provider_reference: null,
        wallet_status: 'failed',
        failure_code: 'PROVIDER_UNAVAILABLE',
      },
    ]);
    expect(await A.balance()).toBe(0);
    const failed = logLines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.message === 'cinetpay payment initialization failed');
    expect(failed).toMatchObject({
      category: 'PROVIDER_IP_NOT_ALLOWED',
      retryable: false,
      sent: false,
      pageFallback: false,
    });
  });

  it('confirmation seulement par le serveur : aucun crédit avant SUCCESS relu, puis exactement le montant', async () => {
    const { app, cinetpay } = setup({ directPayOperators: MTN });
    const A = await player(app);
    const id = (await A.deposit({ tokens: 1234 }).expect(202)).body.payment.id;
    expect(await A.balance()).toBe(0);
    cinetpay.set(0, { status: 'PENDING' });
    await A.payment(id).expect(200);
    expect(await A.balance()).toBe(0);
    cinetpay.set(0, { status: 'SUCCESS' });
    await notify(app, cinetpay.notification()).expect(200);
    expect(await A.balance()).toBe(1234);
  });
});

/** Client SQL dont l'enregistrement de la référence CinetPay échoue (base perdue après l'appel). */
function sqlLostAfterProviderCall(sql: SqlClient, state: { fail: boolean }): SqlClient {
  const wrap = (tx: SqlExecutor): SqlExecutor => ({
    query: (text, params) => {
      if (state.fail && /SET provider_reference = \$2, payment_url/.test(text)) {
        return Promise.reject(new Error('Connection terminated due to connection timeout'));
      }
      if (state.fail && /SET status = 'FAILED'|initialization', 'UNCERTAIN',\s*'initializationError'/.test(text)) {
        return Promise.reject(new Error('Connection terminated unexpectedly'));
      }
      return tx.query(text, params);
    },
  });
  return { ...wrap(sql), transaction: (work) => sql.transaction((tx) => work(wrap(tx))) };
}

/**
 * Base indisponible pendant une recharge (D-091) : une erreur INTERNE n'est jamais présentée
 * comme une indisponibilité du fournisseur ni comme « rien n'a été débité ». Rien n'est déclaré
 * échoué ni crédité ; un paiement direct, marqué incertain dès sa création, est retrouvé chez
 * CinetPay par la réconciliation et crédité une seule fois.
 */
describe('Base indisponible pendant la création d’une recharge', () => {
  it('paiement direct : 503 PAYMENT_VERIFICATION_PENDING, achat en attente, puis retrouvé et crédité une fois', async () => {
    const state = { fail: true };
    const { app, cinetpay, payments } = setup({
      directPayOperators: ['MTN_CM'] as DirectPayOperator[],
      reconcileIntervalMs: 0,
      gatewaySql: sqlLostAfterProviderCall(database.sql, state),
    });
    const A = await player(app);
    const key = randomUUID();
    const res = await A.deposit({ tokens: 1500 }, key);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PAYMENT_VERIFICATION_PENDING');
    expect(res.body.message).not.toMatch(/aucun montant/i);
    expect(cinetpay.created).toHaveLength(1); // la demande est partie vers le téléphone

    const { rows } = await database.sql.query<Record<string, unknown>>(
      `SELECT p.id, p.status, p.provider_reference, p.metadata, t.status AS wallet
       FROM payments p JOIN wallet_transactions t ON t.id = p.wallet_transaction_id`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'PENDING',
      provider_reference: null,
      wallet: 'pending',
      metadata: { initialization: 'UNCERTAIN' },
    });

    // Base revenue : rejeu de la même intention → même opération, aucun second paiement.
    state.fail = false;
    const again = await A.deposit({ tokens: 1500 }, key);
    expect(again.status).toBe(202);
    expect(cinetpay.created).toHaveLength(1);

    // Le joueur a validé sur son téléphone : la réconciliation retrouve et crédite une fois.
    cinetpay.set(0, { status: 'SUCCESS' });
    const id = rows[0]!.id as string;
    await payments.reconcile(id);
    await payments.reconcile(id);
    expect(await A.balance()).toBe(1500);
  });

  it('page CinetPay : 503 PAYMENT_VERIFICATION_PENDING, rien déclaré échoué ni crédité', async () => {
    const state = { fail: true };
    const { app, cinetpay } = setup({ gatewaySql: sqlLostAfterProviderCall(database.sql, state) });
    const A = await player(app);
    const res = await A.deposit({ tokens: 500 });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PAYMENT_VERIFICATION_PENDING');
    expect(cinetpay.created).toHaveLength(1);
    const { rows } = await database.sql.query<{ wallet: string }>(
      'SELECT status AS wallet FROM wallet_transactions',
    );
    expect(rows).toEqual([{ wallet: 'pending' }]);
    expect(await A.balance()).toBe(0);
  });

  it('fournisseur injoignable (et base saine) : toujours 503 MOBILE_MONEY_UNAVAILABLE, achat clos', async () => {
    const { app, cinetpay } = setup();
    cinetpay.failCreate = true;
    const A = await player(app);
    const res = await A.deposit({ tokens: 500 });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MOBILE_MONEY_UNAVAILABLE');
    const { rows } = await database.sql.query<{ status: string }>('SELECT status FROM wallet_transactions');
    expect(rows).toEqual([{ status: 'failed' }]);
  });
});
