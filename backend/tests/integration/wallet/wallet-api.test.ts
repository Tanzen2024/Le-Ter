import { randomUUID } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';

import { createApp } from '../../../src/app';
import { createAuthService } from '../../../src/services/auth/create-auth-service';
import { createWalletService } from '../../../src/services/wallet/create-wallet-service';
import type {
  MobileMoneyGateway,
  MobileMoneyRequest,
} from '../../../src/services/wallet/mobile-money.gateway';
import type { WalletService } from '../../../src/services/wallet/wallet.service';
import { createLogger } from '../../../src/utils/logger';
import { NO_RATE_LIMITS, registerAndLogin, TEST_JWT_SECRET } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Compte de jeu (D-040) par l'API : solde réel (serveur), achat crédité seulement après
 * confirmation du fournisseur, retrait débité sous verrou (jamais de solde négatif) et
 * remboursé s'il échoue, idempotence, numéro Mobile Money = numéro d'inscription (masqué).
 * Sans fournisseur configuré : refus propre, jamais de fausse réussite.
 */
jest.setTimeout(30_000);

let database: TestDatabase;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
afterEach(() => database.reset());

/** Fournisseur simulé : enregistre les demandes, l'issue est réglée par le test. */
class FakeGateway implements MobileMoneyGateway {
  readonly available = true;
  readonly calls: (MobileMoneyRequest & { op: string })[] = [];
  requestCollection(r: MobileMoneyRequest) {
    this.calls.push({ ...r, op: 'collection' });
    return Promise.resolve({ providerReference: `col-${r.transactionId}` });
  }
  requestDisbursement(r: MobileMoneyRequest) {
    this.calls.push({ ...r, op: 'disbursement' });
    return Promise.resolve({ providerReference: `dis-${r.transactionId}` });
  }
}

function setup(gateway?: MobileMoneyGateway): { app: Express; wallet: WalletService } {
  const logger = createLogger({}, () => undefined);
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
  const wallet = createWalletService({ sql: database.sql, logger, gateway });
  const app = createApp({
    logger,
    auth,
    wallet,
    authRateLimits: NO_RATE_LIMITS,
    walletWriteLimit: { windowMs: 60_000, max: 100_000 },
  });
  return { app, wallet };
}

async function player(app: Express) {
  const session = await registerAndLogin(app);
  const auth = `Bearer ${session.accessToken}`;
  const phone = (await request(app).get('/api/auth/me').set('Authorization', auth).expect(200)).body
    .user.phone as string;
  return {
    id: session.userId,
    phone,
    wallet: () => request(app).get('/api/wallet').set('Authorization', auth),
    send: (op: 'deposits' | 'withdrawals', body: object, key: string | null = randomUUID()) => {
      const req = request(app).post(`/api/wallet/${op}`).set('Authorization', auth);
      return (key ? req.set('Idempotency-Key', key) : req).send(body);
    },
  };
}

const balanceOf = async (p: Awaited<ReturnType<typeof player>>) =>
  (await p.wallet().expect(200)).body.wallet.balance as number;

const seed = (userId: string, balance: number) =>
  database.sql.query(
    `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, $2, now(), now())
     ON CONFLICT (user_id) DO UPDATE SET balance = $2`,
    [userId, balance],
  );

const countTransactions = async (userId: string) =>
  Number(
    (
      await database.sql.query<{ n: string }>(
        'SELECT count(*) AS n FROM wallet_transactions WHERE user_id = $1',
        [userId],
      )
    ).rows[0]?.n,
  );

describe('GET /api/wallet', () => {
  it('solde réel (0 au départ), numéro d’inscription masqué, Mobile Money indisponible', async () => {
    const { app } = setup();
    const A = await player(app);
    const { wallet } = (await A.wallet().expect(200)).body;

    expect(wallet).toEqual({
      balance: 0,
      reserved: 0,
      available: 0,
      mobileMoneyNumber: expect.any(String),
      phoneVerified: false,
      mobileMoneyAvailable: false,
      // Paiement direct (D-083) : aucun opérateur sans CinetPay configuré.
      directPayOperators: [],
      // Page CinetPay (D-087) : aucun opérateur présélectionné par défaut.
      pageOperators: [],
      // Opérateur déduit du numéro d'inscription (D-090) : fixture 67x → MTN.
      paymentOperator: 'MTN_CM',
      // Montant saisi (D-085) : limites du contrat CinetPay v1, annoncées à l'application.
      depositLimits: { min: 100, max: 2_500_000, currency: 'XAF' },
      withdrawalAvailable: false,
    });
    expect(wallet.mobileMoneyNumber).not.toBe(A.phone);
    expect(wallet.mobileMoneyNumber.slice(-3)).toBe(A.phone.slice(-3));
    expect(wallet.mobileMoneyNumber).toContain('*');
  });

  it('401 sans jeton', async () => {
    const { app } = setup();
    await request(app).get('/api/wallet').expect(401);
  });
});

describe('Validation des montants', () => {
  it.each([0, -5, 1.5, '20', null])('tokens = %p → 400', async (tokens) => {
    const { app } = setup();
    const A = await player(app);
    for (const op of ['deposits', 'withdrawals'] as const) {
      const res = await A.send(op, { tokens });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect(await countTransactions(A.id)).toBe(0);
  });

  it('Idempotency-Key obligatoire', async () => {
    const { app } = setup();
    const A = await player(app);
    expect((await A.send('deposits', { tokens: 500 }, null)).status).toBe(400);
  });
});

describe('Sans fournisseur Mobile Money (configuration actuelle)', () => {
  it('achat : 503 MOBILE_MONEY_UNAVAILABLE, aucun crédit, opération échouée enregistrée une fois', async () => {
    const { app } = setup();
    const A = await player(app);
    const key = randomUUID();

    const first = await A.send('deposits', { tokens: 500 }, key);
    expect(first.status).toBe(503);
    expect(first.body.code).toBe('MOBILE_MONEY_UNAVAILABLE');
    expect((await A.send('deposits', { tokens: 500 }, key)).status).toBe(503);
    expect(await balanceOf(A)).toBe(0);
    expect(await countTransactions(A.id)).toBe(1);
  });

  it('retrait : refus propre AVANT toute écriture (ni débit, ni transaction enregistrée)', async () => {
    const { app } = setup();
    const A = await player(app);
    await seed(A.id, 5000);

    for (const tokens of [1000, 5000]) {
      const res = await A.send('withdrawals', { tokens, operator: 'MTN_CM' });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('MOBILE_MONEY_UNAVAILABLE');
    }
    expect(await balanceOf(A)).toBe(5000);
    expect(await countTransactions(A.id)).toBe(0);
  });
});

describe('Avec un fournisseur (simulé)', () => {
  it('achat : en attente, crédité seulement à la confirmation, une seule fois', async () => {
    const gateway = new FakeGateway();
    const { app, wallet } = setup(gateway);
    const A = await player(app);

    const res = await A.send('deposits', { tokens: 500 });
    expect(res.status).toBe(202);
    expect(res.body.transaction).toEqual(
      expect.objectContaining({ kind: 'deposit', status: 'pending', tokens: 500 }),
    );
    expect(res.body.balance).toBe(0);
    // Le compte Mobile Money utilisé est celui du numéro d'inscription.
    expect(gateway.calls).toEqual([expect.objectContaining({ op: 'collection', msisdn: A.phone })]);

    const id = res.body.transaction.id as string;
    await wallet.settle(id, { status: 'succeeded' });
    await wallet.settle(id, { status: 'succeeded' });
    expect(await balanceOf(A)).toBe(500);
  });

  it('la base refuse un solde négatif même si l’application est contournée', async () => {
    const { app } = setup();
    const A = await player(app);
    await seed(A.id, 5);
    await expect(
      database.sql.query('UPDATE wallets SET balance = balance - 10 WHERE user_id = $1', [A.id]),
    ).rejects.toThrow();
  });
});
