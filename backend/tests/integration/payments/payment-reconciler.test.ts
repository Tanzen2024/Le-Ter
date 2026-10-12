import { randomUUID } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';

import { createApp } from '../../../src/app';
import { PostgresPaymentRepository } from '../../../src/repositories/postgres-payment.repository';
import { createAuthService } from '../../../src/services/auth/create-auth-service';
import {
  CinetPayError,
  type CinetPayPaymentCreated,
  type CinetPayPaymentRequest,
  type CinetPayPaymentStatus,
} from '../../../src/services/payments/cinetpay/cinetpay-client';
import { CinetPayGateway } from '../../../src/services/payments/cinetpay/cinetpay.gateway';
import {
  PaymentReconciler,
  type PaymentReconcilerOptions,
} from '../../../src/services/payments/payment-reconciler';
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
 * Réconciliation automatique des paiements CinetPay (D-050), sur PostgreSQL (PGlite) : un
 * paiement PENDING est revérifié sans notification ni application ouverte, par le même
 * contrôle serveur à serveur et le même règlement idempotent que la notification.
 */
jest.setTimeout(60_000);

let database: TestDatabase;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
afterEach(() => database.reset());

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** CinetPay simulé : statuts et pannes contrôlés par le test. */
class FakeCinetPay {
  readonly created: (CinetPayPaymentRequest & { transactionId: string; notifyToken: string })[] =
    [];
  readonly remote = new Map<string, Omit<CinetPayPaymentStatus, 'code'>>();
  statusCalls = 0;
  failure: CinetPayError | undefined;
  /** Appelé à chaque lecture de statut (synchronisation des tests de concurrence). */
  onStatus: (() => void) | undefined;

  createPayment(req: CinetPayPaymentRequest): Promise<CinetPayPaymentCreated> {
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
      mustBeRedirected: true,
    });
  }

  async getPaymentStatus(identifier: string): Promise<CinetPayPaymentStatus> {
    this.statusCalls += 1;
    this.onStatus?.();
    // Laisse les autres vérifications simultanées démarrer avant de répondre.
    await new Promise((resolve) => setImmediate(resolve));
    if (this.failure) throw this.failure;
    const remote = this.remote.get(identifier);
    if (!remote) throw new CinetPayError('http', 'not found');
    return { code: remote.status === 'SUCCESS' ? 100 : 2002, ...remote };
  }

  set(index: number, status: string) {
    const { transactionId } = this.created[index]!;
    this.remote.set(transactionId, { ...this.remote.get(transactionId)!, status });
  }

  notification(index = 0) {
    const c = this.created[index]!;
    return {
      notify_token: c.notifyToken,
      merchant_transaction_id: c.merchantTransactionId,
      transaction_id: c.transactionId,
    };
  }
}

/** Horloge commune (création, statut noté, réconciliation), avancée par le test. */
function testClock() {
  let now = Date.now();
  return {
    now: () => new Date(now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function setup(reconcilerOptions: PaymentReconcilerOptions = {}) {
  const logLines: string[] = [];
  const logger = createLogger({}, (line) => logLines.push(line));
  const clock = testClock();
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
    clock: clock.now,
    notifyUrl: 'https://api.test.local/api/payments/cinetpay/notify',
    returnUrl: 'https://api.test.local/api/payments/cinetpay/return',
  });
  const wallet = createWalletService({ sql: database.sql, logger, gateway });
  const payments = new PaymentService({
    payments: repository,
    cinetpay,
    logger,
    clock: clock.now,
    // La lecture joueur ne revérifie pas : seul le réconciliateur est testé.
    reconcileIntervalMs: 24 * 60 * MINUTE,
  });
  const reconcilerOf = (options: PaymentReconcilerOptions = reconcilerOptions) =>
    new PaymentReconciler({ payments, repository, logger, clock: clock.now, options });
  const app = createApp({
    logger,
    auth,
    wallet,
    payments,
    authRateLimits: NO_RATE_LIMITS,
    walletWriteLimit: { windowMs: 60_000, max: 100_000 },
    paymentOptions: { notifyLimit: { windowMs: 60_000, max: 100_000 } },
  });
  return {
    app,
    cinetpay,
    clock,
    payments,
    logLines,
    reconciler: reconcilerOf(),
    reconcilerOf,
  };
}

async function player(app: Express) {
  const session = await registerAndLogin(app);
  const auth = `Bearer ${session.accessToken}`;
  return {
    /** Achat initialisé chez CinetPay ; renvoie l'identifiant du paiement PENDING. */
    buy: async (tokens = 500): Promise<string> => {
      const res = await request(app)
        .post('/api/wallet/deposits')
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({ tokens })
        .expect(202);
      return res.body.payment.id as string;
    },
    balance: async () =>
      (await request(app).get('/api/wallet').set('Authorization', auth).expect(200)).body.wallet
        .balance as number,
  };
}

async function row(paymentId: string) {
  const { rows } = await database.sql.query<Record<string, unknown>>(
    `SELECT p.status, p.provider_status, t.status AS wallet_status
     FROM payments p JOIN wallet_transactions t ON t.id = p.wallet_transaction_id
     WHERE p.id = $1`,
    [paymentId],
  );
  return rows[0]!;
}

describe('PaymentReconciler — règlement', () => {
  it('SUCCESS sans notification ni application : crédité une seule fois', async () => {
    const { app, cinetpay, clock, reconciler } = setup();
    const p = await player(app);
    const paymentId = await p.buy(500);
    cinetpay.set(0, 'SUCCESS');
    clock.advance(2 * MINUTE);

    const first = await reconciler.tick();
    expect(first).toMatchObject({ checked: 1, settled: 1, failed: 0 });
    expect(await row(paymentId)).toMatchObject({
      status: 'SUCCESS',
      provider_status: 'SUCCESS',
      wallet_status: 'succeeded',
    });
    expect(await p.balance()).toBe(500);

    // Déjà final : plus jamais sélectionné, CinetPay n'est plus interrogé.
    const calls = cinetpay.statusCalls;
    clock.advance(10 * MINUTE);
    expect(await reconciler.tick()).toMatchObject({ checked: 0 });
    expect(cinetpay.statusCalls).toBe(calls);
    expect(await p.balance()).toBe(500);
  });

  it('INITIATED puis PENDING : reste en attente, statut fournisseur noté, aucun crédit', async () => {
    const { app, cinetpay, clock, reconciler } = setup();
    const p = await player(app);
    const paymentId = await p.buy(500);
    clock.advance(2 * MINUTE);

    expect(await reconciler.tick()).toMatchObject({ checked: 1, pending: 1, settled: 0 });
    expect(await row(paymentId)).toMatchObject({
      status: 'PENDING',
      provider_status: 'INITIATED',
      wallet_status: 'pending',
    });

    cinetpay.set(0, 'PENDING');
    clock.advance(2 * MINUTE);
    expect(await reconciler.tick()).toMatchObject({ checked: 1, pending: 1 });
    expect(await row(paymentId)).toMatchObject({ status: 'PENDING', provider_status: 'PENDING' });
    expect(await p.balance()).toBe(0);
  });

  it('FAILED : règles de finalisation existantes, aucun crédit', async () => {
    const { app, cinetpay, clock, reconciler } = setup();
    const p = await player(app);
    const paymentId = await p.buy(500);
    cinetpay.set(0, 'FAILED');
    clock.advance(2 * MINUTE);

    expect(await reconciler.tick()).toMatchObject({ checked: 1, settled: 1 });
    expect(await row(paymentId)).toMatchObject({ status: 'FAILED', wallet_status: 'failed' });
    expect(await p.balance()).toBe(0);
  });
});

describe('PaymentReconciler — erreurs et nouvelles tentatives', () => {
  it.each([
    ['réseau', new CinetPayError('network', 'CinetPay injoignable')],
    ['délai dépassé', new CinetPayError('timeout', 'CinetPay n’a pas répondu à temps')],
    ['réponse malformée', new CinetPayError('malformed_response', 'Réponse invalide')],
  ])(
    'erreur %s : aucun crédit, rien écrit, nouvelle tentative différée puis réussie',
    async (_, error) => {
      const { app, cinetpay, clock, reconciler, logLines } = setup({
        retryBaseMs: MINUTE,
        retryMaxMs: 10 * MINUTE,
      });
      const p = await player(app);
      const paymentId = await p.buy(500);
      cinetpay.set(0, 'SUCCESS');
      cinetpay.failure = error;
      clock.advance(2 * MINUTE);

      expect(await reconciler.tick()).toMatchObject({ checked: 1, failed: 1, settled: 0 });
      expect(await row(paymentId)).toMatchObject({
        status: 'PENDING',
        provider_status: 'INITIATED',
        wallet_status: 'pending',
      });
      expect(await p.balance()).toBe(0);
      expect(logLines.some((l) => l.includes('payment reconciliation failed'))).toBe(true);

      // Backoff : pas de nouvel appel avant l'échéance (1 min), même si le passage repasse.
      const calls = cinetpay.statusCalls;
      clock.advance(30 * SECOND);
      expect(await reconciler.tick()).toMatchObject({ checked: 0 });
      expect(cinetpay.statusCalls).toBe(calls);

      // Deuxième échec : délai doublé (2 min).
      clock.advance(31 * SECOND);
      expect(await reconciler.tick()).toMatchObject({ checked: 1, failed: 1 });
      clock.advance(MINUTE + 30 * SECOND);
      expect(await reconciler.tick()).toMatchObject({ checked: 0 });

      // Fournisseur rétabli : réglé et crédité une seule fois.
      cinetpay.failure = undefined;
      clock.advance(MINUTE);
      expect(await reconciler.tick()).toMatchObject({ checked: 1, settled: 1 });
      expect(await p.balance()).toBe(500);
    },
  );

  it('références différentes dans le statut relu : aucun crédit, reste PENDING', async () => {
    const { app, cinetpay, clock, reconciler } = setup();
    const p = await player(app);
    const paymentId = await p.buy(500);
    const { transactionId } = cinetpay.created[0]!;
    cinetpay.remote.set(transactionId, {
      status: 'SUCCESS',
      transactionId,
      merchantTransactionId: 'LTautre',
    });
    clock.advance(2 * MINUTE);

    expect(await reconciler.tick()).toMatchObject({ checked: 1, failed: 1, settled: 0 });
    expect(await row(paymentId)).toMatchObject({ status: 'PENDING', wallet_status: 'pending' });
    expect(await p.balance()).toBe(0);
  });

  it('base indisponible pendant la sélection : le passage ne rejette jamais', async () => {
    const { logLines } = setup();
    const reconciler = new PaymentReconciler({
      payments: { reconcile: () => Promise.reject(new Error('jamais appelé')) },
      repository: {
        findPendingForReconciliation: () => Promise.reject(new Error('connexion perdue')),
      },
      logger: createLogger({}, (line) => logLines.push(line)),
    });
    await expect(reconciler.tick()).resolves.toMatchObject({ checked: 0 });
    expect(logLines.some((l) => l.includes('payment reconciliation lookup failed'))).toBe(true);
  });
});

describe('PaymentReconciler — éligibilité, lots et délais', () => {
  it('paiements finaux ou sans référence : jamais sélectionnés, CinetPay non interrogé', async () => {
    const { app, cinetpay, clock, reconciler } = setup();
    const p = await player(app);
    const paid = await p.buy(500);
    const unreferenced = await p.buy(1000);
    cinetpay.set(0, 'SUCCESS');
    await request(app)
      .post('/api/payments/cinetpay/notify')
      .send(cinetpay.notification(0))
      .expect(200);
    expect(await row(paid)).toMatchObject({ status: 'SUCCESS' });

    // Paiement PENDING sans référence (arrêt entre l'enregistrement et l'initialisation).
    await database.sql.query(
      `UPDATE payments SET provider_reference = NULL, notify_token_hash = NULL WHERE id = $1`,
      [unreferenced],
    );
    expect(await row(unreferenced)).toMatchObject({ status: 'PENDING' });
    const calls = cinetpay.statusCalls;
    clock.advance(2 * MINUTE);
    expect(await reconciler.tick()).toMatchObject({ checked: 0 });
    expect(cinetpay.statusCalls).toBe(calls);
  });

  it('âge minimal et âge maximal respectés', async () => {
    const { app, clock, reconciler } = setup({ minAgeMs: MINUTE, maxAgeMs: 60 * MINUTE });
    const p = await player(app);
    await p.buy(500);

    clock.advance(30 * SECOND);
    expect(await reconciler.tick()).toMatchObject({ checked: 0 });
    clock.advance(31 * SECOND);
    expect(await reconciler.tick()).toMatchObject({ checked: 1, pending: 1 });
    clock.advance(61 * MINUTE);
    expect(await reconciler.tick()).toMatchObject({ checked: 0 });
  });

  it('limite de lot et délai minimal entre deux vérifications d’un même paiement', async () => {
    const { app, clock, reconciler } = setup({ batchSize: 2, recheckMs: 5 * MINUTE });
    const p = await player(app);
    await p.buy(500);
    await p.buy(1000);
    await p.buy(2000);
    clock.advance(6 * MINUTE);

    // Lot de 2, puis le 3e (les deux premiers viennent d'être vérifiés).
    expect(await reconciler.tick()).toMatchObject({ checked: 2, pending: 2 });
    expect(await reconciler.tick()).toMatchObject({ checked: 1, pending: 1 });
    // Tous vérifiés il y a moins de 5 min : rien.
    clock.advance(4 * MINUTE);
    expect(await reconciler.tick()).toMatchObject({ checked: 0 });
    // Délai écoulé : de nouveau éligibles, toujours par lots de 2.
    clock.advance(2 * MINUTE);
    expect(await reconciler.tick()).toMatchObject({ checked: 2 });
  });
});

describe('PaymentReconciler — concurrence', () => {
  it('deux réconciliateurs simultanés (deux instances) : un seul crédit', async () => {
    const { app, cinetpay, clock, reconcilerOf } = setup();
    const p = await player(app);
    const paymentId = await p.buy(1000);
    cinetpay.set(0, 'SUCCESS');
    clock.advance(2 * MINUTE);

    const [a, b] = await Promise.all([reconcilerOf().tick(), reconcilerOf().tick()]);
    expect(a.settled + b.settled).toBe(1);
    expect(await row(paymentId)).toMatchObject({ status: 'SUCCESS', wallet_status: 'succeeded' });
    expect(await p.balance()).toBe(1000);
  });

  it('même réconciliateur : un passage déjà en cours n’en lance pas un second', async () => {
    const { app, cinetpay, clock, reconciler } = setup();
    const p = await player(app);
    await p.buy(500);
    cinetpay.set(0, 'SUCCESS');
    clock.advance(2 * MINUTE);

    const [a, b] = await Promise.all([reconciler.tick(), reconciler.tick()]);
    expect([a.checked, b.checked].sort()).toEqual([0, 1]);
    expect(await p.balance()).toBe(500);
  });

  it('notification, vérification administrative et réconciliateur simultanés : un seul crédit', async () => {
    const { app, cinetpay, clock, payments, reconciler } = setup();
    const p = await player(app);
    const paymentId = await p.buy(2000);
    cinetpay.set(0, 'SUCCESS');
    clock.advance(2 * MINUTE);

    const results = await Promise.allSettled([
      request(app).post('/api/payments/cinetpay/notify').send(cinetpay.notification(0)),
      payments.verifyForAdmin(paymentId),
      reconciler.tick(),
      request(app).post('/api/payments/cinetpay/notify').send(cinetpay.notification(0)),
      payments.verifyForAdmin(paymentId),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await row(paymentId)).toMatchObject({ status: 'SUCCESS', wallet_status: 'succeeded' });
    expect(await p.balance()).toBe(2000);
    const { rows } = await database.sql.query<{ n: string }>(
      `SELECT count(*) AS n FROM wallet_transactions WHERE status = 'succeeded'`,
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});

describe('PaymentReconciler — cycle de vie et journaux', () => {
  it('stop() pendant un passage : le paiement en cours se termine, les suivants attendent', async () => {
    const { app, cinetpay, clock, reconciler } = setup({ batchSize: 10 });
    const p = await player(app);
    const first = await p.buy(500);
    // Horodatages distincts : le lot est trié par `updated_at` (le moins récemment vérifié
    // d'abord). À dates égales, l'ordre dépendrait d'UUID aléatoires (test intermittent).
    clock.advance(SECOND);
    const second = await p.buy(1000);
    cinetpay.set(0, 'SUCCESS');
    cinetpay.set(1, 'SUCCESS');
    clock.advance(2 * MINUTE);
    cinetpay.onStatus = () => reconciler.stop();

    expect(await reconciler.tick()).toMatchObject({ checked: 1, settled: 1 });
    await reconciler.idle();
    expect(await p.balance()).toBe(500);
    expect(await row(first)).toMatchObject({ status: 'SUCCESS', wallet_status: 'succeeded' });
    // Le paiement suivant n'a pas été traité après stop() : il attend le prochain démarrage.
    expect(await row(second)).toMatchObject({ status: 'PENDING', wallet_status: 'pending' });
  });

  it('start() reprend aussitôt les paiements en attente ; idle() attend la fin', async () => {
    const { app, cinetpay, clock, reconciler } = setup({ tickMs: 60 * MINUTE });
    const p = await player(app);
    await p.buy(500);
    cinetpay.set(0, 'SUCCESS');
    clock.advance(2 * MINUTE);

    reconciler.start();
    await reconciler.idle();
    reconciler.stop();
    expect(await p.balance()).toBe(500);
    expect(cinetpay.statusCalls).toBe(1);
  });

  it('journaux : identifiants et statuts seulement, jamais de notify_token', async () => {
    const { app, cinetpay, clock, reconciler, logLines } = setup();
    const p = await player(app);
    await p.buy(500);
    cinetpay.set(0, 'SUCCESS');
    clock.advance(2 * MINUTE);
    await reconciler.tick();

    const output = logLines.join('\n');
    expect(output).toContain('payment reconciliation tick');
    expect(output).not.toContain(cinetpay.created[0]!.notifyToken);
  });
});
