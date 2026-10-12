import { createHash, randomUUID } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';

import { createApp } from '../../../src/app';
import { maskPhone } from '../../../src/domain/wallet/wallet';
import { PostgresAdminAuditRepository } from '../../../src/repositories/postgres-admin-audit.repository';
import { PostgresUserRepository } from '../../../src/repositories/postgres-user.repository';
import { PostgresWalletRepository } from '../../../src/repositories/postgres-wallet.repository';
import { PostgresWithdrawalRepository } from '../../../src/repositories/postgres-withdrawal.repository';
import { createAdminServices } from '../../../src/services/admin/create-admin-services';
import { createAuthService } from '../../../src/services/auth/create-auth-service';
import { createWalletService } from '../../../src/services/wallet/create-wallet-service';
import type {
  TransferGateway,
  TransferLookup,
  TransferRequest,
  TransferSubmission,
} from '../../../src/services/withdrawals/transfer.gateway';
import type { WithdrawalAvailability } from '../../../src/services/withdrawals/withdrawal-availability';
import { WithdrawalAdminService } from '../../../src/services/withdrawals/withdrawal-admin.service';
import { WithdrawalReconciler } from '../../../src/services/withdrawals/withdrawal-reconciler';
import { WithdrawalService } from '../../../src/services/withdrawals/withdrawal.service';
import { createLogger } from '../../../src/utils/logger';
import { NO_ADMIN_LOGIN_LIMITS, adminLogin, asAdmin } from '../../fixtures/admin';
import { NO_RATE_LIMITS, registerAndLogin, TEST_JWT_SECRET } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Retraits Mobile Money (D-075) par l'API, sur une base PGlite migrée, avec un fournisseur de
 * transfert SIMULÉ (aucun appel réseau, aucun mouvement de fonds réel) et une horloge
 * contrôlée : minimum de 1 000 jetons, quota configurable et concurrent, débit atomique,
 * idempotence, issue incertaine jamais tranchée à l'aveugle, remboursement et finalisation
 * uniques, notifications vérifiées, reprise après redémarrage, administration auditée.
 */
jest.setTimeout(60_000);

let database: TestDatabase;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
afterEach(() => database.reset());

/** Transfert simulé : l'état « chez CinetPay » est tenu par le test. */
class FakeTransfers implements TransferGateway {
  canSubmit = true;
  canLookup = true;
  readonly submissions: TransferRequest[] = [];
  readonly remote = new Map<
    string,
    { providerReference: string; providerStatus: string; amount?: number; currency?: string }
  >();
  lookups = 0;
  lookupFails = false;
  /** Réponse de l'envoi ; par défaut : transfert créé chez le fournisseur, PENDING. */
  onSubmit: (r: TransferRequest) => TransferSubmission = (r) => {
    this.remote.set(r.merchantTransactionId, {
      providerReference: `cp-${r.merchantTransactionId}`,
      providerStatus: 'PENDING',
    });
    return {
      kind: 'accepted',
      providerReference: `cp-${r.merchantTransactionId}`,
      providerStatus: 'PENDING',
      notifyToken: `nt-${r.merchantTransactionId}`,
    };
  };

  submit(r: TransferRequest): Promise<TransferSubmission> {
    this.submissions.push(r);
    return Promise.resolve(this.onSubmit(r));
  }

  lookup(merchantTransactionId: string): Promise<TransferLookup> {
    this.lookups += 1;
    if (this.lookupFails) return Promise.reject(new Error('CinetPay injoignable (simulé)'));
    const remote = this.remote.get(merchantTransactionId);
    return Promise.resolve(remote ? { found: true, merchantTransactionId, ...remote } : { found: false });
  }

  /** Statut final (ou non) fixé « chez CinetPay ». */
  setStatus(merchantTransactionId: string, providerStatus: string) {
    const remote = this.remote.get(merchantTransactionId);
    if (!remote) throw new Error('transfert inconnu');
    remote.providerStatus = providerStatus;
  }
}

function setup(
  options: {
    transfers?: FakeTransfers;
    maxSubmissionAttempts?: number;
    availability?: WithdrawalAvailability;
  } = {},
) {
  let current = new Date('2026-10-10T08:00:00Z');
  const clock = () => current;
  const logLines: string[] = [];
  const logger = createLogger({}, (line) => logLines.push(line));
  const auth = createAuthService(
    database.sql,
    {
      jwtSecret: TEST_JWT_SECRET,
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 30 * 24 * 3600,
      bcryptCost: 4,
    },
    logger,
  );
  const transfers = options.transfers ?? new FakeTransfers();
  const repository = new PostgresWithdrawalRepository(database.sql);
  const makeService = () =>
    new WithdrawalService({
      withdrawals: repository,
      wallets: new PostgresWalletRepository(database.sql),
      users: new PostgresUserRepository(database.sql),
      gateway: transfers,
      logger,
      clock,
      ...(options.availability && { availability: options.availability }),
      options: {
        readRecheckMs: 0,
        ...(options.maxSubmissionAttempts && {
          maxSubmissionAttempts: options.maxSubmissionAttempts,
        }),
      },
    });
  const withdrawals = makeService();
  const wallet = createWalletService({
    sql: database.sql,
    logger,
    withdrawalAvailability: () => withdrawals.availability,
  });
  // Authentification et sessions d'administration à l'heure réelle : seule l'horloge des
  // retraits (quota, délais) est avancée par les tests.
  const admin = createAdminServices({ sql: database.sql, auth, logger });
  const app = createApp({
    logger,
    auth,
    authRateLimits: NO_RATE_LIMITS,
    wallet,
    walletWriteLimit: { windowMs: 60_000, max: 100_000 },
    withdrawals,
    withdrawalAdmin: new WithdrawalAdminService({
      withdrawals,
      audit: new PostgresAdminAuditRepository(database.sql),
      logger,
      clock,
    }),
    admin: {
      ...admin,
      loginLimits: NO_ADMIN_LOGIN_LIMITS,
      system: { nodeEnv: 'test', cinetpay: 'sandbox' },
    },
  });
  return {
    app,
    transfers,
    withdrawals,
    repository,
    makeService,
    clock,
    logLines,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

async function player(app: Express) {
  const session = await registerAndLogin(app);
  const auth = `Bearer ${session.accessToken}`;
  const phone = (await request(app).get('/api/auth/me').set('Authorization', auth).expect(200))
    .body.user.phone as string;
  return {
    id: session.userId,
    auth,
    phone,
    withdraw: (body: unknown, key: string | null = randomUUID()) => {
      const req = request(app).post('/api/wallet/withdrawals').set('Authorization', auth);
      return (key ? req.set('Idempotency-Key', key) : req).send(body as object);
    },
    history: () => request(app).get('/api/wallet/withdrawals').set('Authorization', auth),
    get: (id: string) => request(app).get(`/api/wallet/withdrawals/${id}`).set('Authorization', auth),
    wallet: async () =>
      (await request(app).get('/api/wallet').set('Authorization', auth).expect(200)).body.wallet,
  };
}

const seed = (userId: string, balance: number) =>
  database.sql.query(
    `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, $2, now(), now())
     ON CONFLICT (user_id) DO UPDATE SET balance = $2`,
    [userId, balance],
  );

const balanceOf = async (userId: string) =>
  Number(
    (await database.sql.query<{ balance: string }>('SELECT balance FROM wallets WHERE user_id = $1', [
      userId,
    ])).rows[0]?.balance ?? 0,
  );

const count = async (table: 'withdrawals' | 'wallet_transactions', userId: string) =>
  Number(
    (
      await database.sql.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE user_id = $1`, [
        userId,
      ])
    ).rows[0]?.n,
  );

const ok = { tokens: 1000, operator: 'MTN_CM' };

async function makeAdmin(app: Express) {
  const account = await registerAndLogin(app);
  await database.sql.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [account.userId]);
  const session = await adminLogin(app, account.email, account.password, account.userId);
  return { ...asAdmin(app, session.accessToken), token: session.accessToken };
}

async function setLimit(app: Express, count: number | null, periodMinutes: number | null) {
  const admin = await makeAdmin(app);
  const res = await admin.patch('/api/admin/settings/withdrawal-limit', { count, periodMinutes });
  expect(res.status).toBe(200);
  return admin;
}

// --- Montant ----------------------------------------------------------------------------------

describe('Montant minimum (1 000 jetons)', () => {
  it('999 → 400, rien n’est écrit ; 1 000 → 202, débité, transfert de 1 000 XAF demandé', async () => {
    const { app, transfers } = setup();
    const A = await player(app);
    await seed(A.id, 5000);

    const refused = await A.withdraw({ tokens: 999, operator: 'MTN_CM' });
    expect(refused.status).toBe(400);
    expect(refused.body.fields.tokens).toMatch(/minimum.*1000/);
    expect(await count('withdrawals', A.id)).toBe(0);
    expect(await balanceOf(A.id)).toBe(5000);

    const accepted = await A.withdraw(ok);
    expect(accepted.status).toBe(202);
    expect(accepted.body.withdrawal).toEqual(
      expect.objectContaining({ status: 'PROCESSING', tokens: 1000, amount: 1000, currency: 'XAF' }),
    );
    expect(accepted.body.withdrawal.reference).toMatch(/^LW[0-9a-f]{26}$/);
    expect(accepted.body.balance.available).toBe(4000);
    expect(await balanceOf(A.id)).toBe(4000);
    expect(transfers.submissions).toEqual([
      expect.objectContaining({ amount: 1000, currency: 'XAF', operator: 'MTN_CM', phoneNumber: A.phone }),
    ]);
  });

  it.each([
    ['0', 0],
    ['négatif', -1000],
    ['absent', undefined],
    ['null', null],
    ['chaîne vide', ''],
    ['chaîne numérique', '1000'],
    ['décimal', 1000.5],
    ['non fini (1e400)', 'INFINITY'],
    ['hors limites', 10_000_000_000],
    ['objet', { value: 1000 }],
  ])('%s → 400 VALIDATION_ERROR, aucune écriture', async (_label, tokens) => {
    const { app, transfers } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    const body =
      tokens === 'INFINITY'
        ? '{"tokens": 1e400, "operator": "MTN_CM"}'
        : { ...(tokens !== undefined && { tokens }), operator: 'MTN_CM' };
    const res = await (typeof body === 'string'
      ? request(app)
          .post('/api/wallet/withdrawals')
          .set('Authorization', A.auth)
          .set('Idempotency-Key', randomUUID())
          .set('Content-Type', 'application/json')
          .send(body)
      : A.withdraw(body));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await count('wallet_transactions', A.id)).toBe(0);
    expect(transfers.submissions).toHaveLength(0);
  });

  it('opérateur inconnu → 400 ; Idempotency-Key absente → 400', async () => {
    const { app } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    expect((await A.withdraw({ tokens: 1000, operator: 'OM_CI' })).status).toBe(400);
    expect((await A.withdraw(ok, null)).status).toBe(400);
    expect(await count('withdrawals', A.id)).toBe(0);
  });

  it('solde insuffisant (disponible) → 409, aucun débit, aucun retrait', async () => {
    const { app, transfers } = setup();
    const A = await player(app);
    await seed(A.id, 999);
    const res = await A.withdraw(ok);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balanceOf(A.id)).toBe(999);
    expect(await count('wallet_transactions', A.id)).toBe(0);
    expect(transfers.submissions).toHaveLength(0);
  });

  it('le destinataire est TOUJOURS le numéro d’inscription : un numéro du corps est ignoré', async () => {
    const { app, transfers } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    await A.withdraw({ ...ok, phone: '+237699999999', phoneNumber: '+237699999999', userId: randomUUID() });
    expect(transfers.submissions[0]?.phoneNumber).toBe(A.phone);
  });
});

// --- Conditions du compte et du fournisseur ---------------------------------------------------

describe('Conditions préalables (avant toute écriture)', () => {
  it('fournisseur de transfert non configuré → 503, rien n’est débité', async () => {
    const transfers = new FakeTransfers();
    transfers.canSubmit = false;
    transfers.canLookup = false;
    const { app } = setup({ transfers });
    const A = await player(app);
    await seed(A.id, 5000);
    const res = await A.withdraw(ok);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MOBILE_MONEY_UNAVAILABLE');
    expect(await balanceOf(A.id)).toBe(5000);
    expect(await count('wallet_transactions', A.id)).toBe(0);
    expect((await A.wallet()).withdrawalAvailable).toBe(false);
  });

  it('numéro d’inscription hors Cameroun → 422, compte désactivé → 403', async () => {
    const { app } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    await database.sql.query(`UPDATE users SET phone = '+2250701234567' WHERE id = $1`, [A.id]);
    expect((await A.withdraw(ok)).body.code).toBe('WITHDRAWAL_PHONE_UNSUPPORTED');

    const B = await player(app);
    await seed(B.id, 5000);
    await database.sql.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [B.id]);
    const res = await B.withdraw(ok);
    // Selon le contrôle d'authentification, un compte désactivé est refusé en 401 ou 403 :
    // dans tous les cas, rien n'est écrit.
    expect([401, 403]).toContain(res.status);
    expect(await count('withdrawals', A.id)).toBe(0);
    expect(await count('withdrawals', B.id)).toBe(0);
  });

  it('GET /api/wallet annonce les retraits ; 401 sans jeton', async () => {
    const { app } = setup();
    const A = await player(app);
    expect((await A.wallet()).withdrawalAvailable).toBe(true);
    await request(app).post('/api/wallet/withdrawals').send(ok).expect(401);
  });
});

// --- Disponibilité (D-077) ---------------------------------------------------------------------

describe('Disponibilité : indisponible, sandbox, production', () => {
  it('fournisseur non configuré : mode et motif annoncés, aucune écriture', async () => {
    const transfers = new FakeTransfers();
    transfers.canSubmit = false;
    transfers.canLookup = false;
    const { app } = setup({ transfers });
    const A = await player(app);
    const wallet = await A.wallet();
    expect(wallet).toMatchObject({
      withdrawalAvailable: false,
      withdrawalMode: 'unavailable',
      withdrawalUnavailableReason: 'PROVIDER_NOT_CONFIGURED',
    });
    const policy = (await A.history().expect(200)).body.policy;
    expect(policy).toMatchObject({
      available: false,
      mode: 'unavailable',
      unavailableReason: 'PROVIDER_NOT_CONFIGURED',
    });
  });

  it('production désactivée : le serveur refuse même si un client affiche le bouton', async () => {
    // La passerelle POURRAIT envoyer : seul l'état décidé au démarrage s'y oppose.
    const { app, transfers } = setup({
      availability: { mode: 'unavailable', reason: 'LIVE_NOT_CONFIRMED', warnings: [] },
    });
    const A = await player(app);
    await seed(A.id, 5000);
    expect(await A.wallet()).toMatchObject({
      withdrawalAvailable: false,
      withdrawalMode: 'unavailable',
      withdrawalUnavailableReason: 'LIVE_NOT_CONFIRMED',
    });
    const res = await A.withdraw(ok);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MOBILE_MONEY_UNAVAILABLE');
    expect(transfers.submissions).toHaveLength(0);
    expect(await balanceOf(A.id)).toBe(5000);
    expect(await count('withdrawals', A.id)).toBe(0);
    expect(await count('wallet_transactions', A.id)).toBe(0);
  });

  it('sandbox : mode test annoncé ; le parcours fonctionne contre le transfert simulé', async () => {
    const { app, transfers } = setup({ availability: { mode: 'sandbox', warnings: [] } });
    const A = await player(app);
    await seed(A.id, 5000);
    expect(await A.wallet()).toMatchObject({ withdrawalAvailable: true, withdrawalMode: 'sandbox' });
    expect((await A.wallet()).withdrawalUnavailableReason).toBeUndefined();
    expect((await A.history().expect(200)).body.policy.mode).toBe('sandbox');
    const res = await A.withdraw(ok);
    expect(res.status).toBe(202);
    // Jamais « réussi » sans statut final relu : en cours, jetons réservés.
    expect(res.body.withdrawal.status).toBe('PROCESSING');
    expect(transfers.submissions).toHaveLength(1);
    expect(await balanceOf(A.id)).toBe(4000);
  });

  it('production activée (prérequis validés) : retraits acceptés, mode production', async () => {
    const { app, transfers } = setup({ availability: { mode: 'live', warnings: [] } });
    const A = await player(app);
    await seed(A.id, 5000);
    expect(await A.wallet()).toMatchObject({ withdrawalAvailable: true, withdrawalMode: 'live' });
    expect((await A.withdraw(ok)).status).toBe(202);
    expect(transfers.submissions).toHaveLength(1);
  });

  it('les avertissements d’exploitation ne sont jamais montrés au joueur', async () => {
    const { app } = setup({
      availability: { mode: 'sandbox', warnings: ['TRANSFER_NOTIFY_URL_NOT_PUBLIC'] },
    });
    const A = await player(app);
    expect(JSON.stringify(await A.wallet())).not.toMatch(/NOTIFY|warnings/);
    expect(JSON.stringify((await A.history().expect(200)).body)).not.toMatch(/NOTIFY|warnings/);
  });
});

// --- Quota ------------------------------------------------------------------------------------

describe('Quota de retraits', () => {
  it('par défaut illimité (n = ∞, t = ∞) : plusieurs retraits acceptés', async () => {
    const { app } = setup();
    const A = await player(app);
    await seed(A.id, 10_000);
    for (let i = 0; i < 4; i += 1) expect((await A.withdraw(ok)).status).toBe(202);
    const { policy } = (await A.history().expect(200)).body;
    expect(policy.limit).toEqual(
      expect.objectContaining({ count: null, periodMinutes: null, remaining: null }),
    );
  });

  it('n = 1, t = 24 h : un retrait, puis 429 ; à l’expiration de la fenêtre, de nouveau autorisé', async () => {
    const { app, advance } = setup();
    await setLimit(app, 1, 24 * 60);
    const A = await player(app);
    await seed(A.id, 10_000);

    expect((await A.withdraw(ok)).status).toBe(202);
    const refused = await A.withdraw(ok);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('WITHDRAWAL_LIMIT_REACHED');
    expect(refused.body.details).toEqual({ maxWithdrawals: 1, periodMinutes: 1440, used: 1 });
    expect(await count('withdrawals', A.id)).toBe(1);
    expect(await balanceOf(A.id)).toBe(9000);
    expect((await A.history()).body.policy.limit).toEqual(
      expect.objectContaining({ remaining: 0, nextAvailableAt: expect.any(String) }),
    );

    advance(24 * 60 * 60_000 - 60_000);
    expect((await A.withdraw(ok)).status).toBe(429);
    advance(2 * 60_000);
    expect((await A.withdraw(ok)).status).toBe(202);
  });

  it('n = 2, t = ∞ : au plus deux retraits au total', async () => {
    const { app, advance } = setup();
    await setLimit(app, 2, null);
    const A = await player(app);
    await seed(A.id, 10_000);
    expect((await A.withdraw(ok)).status).toBe(202);
    advance(400 * 24 * 60 * 60_000);
    expect((await A.withdraw(ok)).status).toBe(202);
    expect((await A.withdraw(ok)).status).toBe(429);
  });

  it('demandes CONCURRENTES avec une seule place restante : une seule acceptée', async () => {
    const { app, transfers } = setup();
    await setLimit(app, 1, 60);
    const A = await player(app);
    await seed(A.id, 10_000);
    const results = await Promise.all(Array.from({ length: 5 }, () => A.withdraw(ok)));
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(results.filter((r) => r.status === 429)).toHaveLength(4);
    expect(await count('withdrawals', A.id)).toBe(1);
    expect(await balanceOf(A.id)).toBe(9000);
    expect(transfers.submissions).toHaveLength(1);
  });

  it('un retrait FAILED (échec confirmé, remboursé) ne consomme pas le quota', async () => {
    const { app, transfers, withdrawals } = setup();
    await setLimit(app, 1, 24 * 60);
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    expect((await A.withdraw(ok)).status).toBe(429);
    // Échec final CONFIRMÉ par la relecture : remboursé, la place se libère.
    transfers.setStatus(withdrawal.reference, 'FAILED');
    expect((await withdrawals.check(withdrawal.id)).status).toBe('FAILED');
    expect(await balanceOf(A.id)).toBe(5000);
    expect((await A.withdraw(ok)).status).toBe(202);
  });

  it('administration : paramètres invalides refusés, retour à l’illimité, réglage audité', async () => {
    const { app } = setup();
    const admin = await makeAdmin(app);
    const initial = await admin.get('/api/admin/settings/withdrawal-limit').expect(200);
    expect(initial.body).toEqual(
      expect.objectContaining({ count: null, periodMinutes: null, updatedAt: null }),
    );
    for (const body of [
      { count: 0, periodMinutes: 60 },
      { count: -1, periodMinutes: 60 },
      { count: 1.5, periodMinutes: 60 },
      { count: '3', periodMinutes: 60 },
      { count: 'Infinity', periodMinutes: null },
      { count: 3, periodMinutes: 0 },
      { count: 3, periodMinutes: 600_000 },
      { count: 3 },
      {},
    ]) {
      const res = await admin.patch('/api/admin/settings/withdrawal-limit', body);
      expect(res.status).toBe(400);
    }
    expect((await admin.get('/api/admin/settings/withdrawal-limit')).body.count).toBeNull();

    const set = await admin.patch('/api/admin/settings/withdrawal-limit', { count: 3, periodMinutes: 1440 });
    expect(set.body).toEqual(expect.objectContaining({ count: 3, periodMinutes: 1440, changed: true }));
    const same = await admin.patch('/api/admin/settings/withdrawal-limit', { count: 3, periodMinutes: 1440 });
    expect(same.body.changed).toBe(false);
    const reset = await admin.patch('/api/admin/settings/withdrawal-limit', {
      count: null,
      periodMinutes: null,
    });
    expect(reset.body).toEqual(expect.objectContaining({ count: null, periodMinutes: null }));

    const audit = await database.sql.query<{ details: { to: unknown } }>(
      `SELECT details FROM admin_audit_log WHERE action = 'WITHDRAWAL_LIMIT_UPDATED' ORDER BY created_at`,
    );
    expect(audit.rows.map((r) => r.details.to)).toEqual([
      { count: 3, periodMinutes: 1440 },
      { count: null, periodMinutes: null },
    ]);
  });

  it('un joueur ne peut ni lire ni régler le quota (403)', async () => {
    const { app } = setup();
    const A = await registerAndLogin(app);
    await request(app)
      .patch('/api/admin/settings/withdrawal-limit')
      .set('Authorization', `Bearer ${A.accessToken}`)
      .send({ count: 1, periodMinutes: 60 })
      .expect(403);
  });
});

// --- Fiabilité financière ---------------------------------------------------------------------

describe('Fiabilité financière', () => {
  it('double clic (même Idempotency-Key, simultané) : un seul retrait, un seul débit, un seul envoi', async () => {
    const { app, transfers } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    const key = randomUUID();
    const [one, two] = await Promise.all([A.withdraw(ok, key), A.withdraw(ok, key)]);
    expect([one.status, two.status]).toEqual([202, 202]);
    expect(one.body.withdrawal.id).toBe(two.body.withdrawal.id);
    expect(await balanceOf(A.id)).toBe(4000);
    expect(await count('withdrawals', A.id)).toBe(1);
    expect(transfers.submissions).toHaveLength(1);

    const reused = await A.withdraw({ tokens: 2000, operator: 'MTN_CM' }, key);
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('réponse AMBIGUË : débité, ouvert, aucun renvoi tant que le résultat est incertain', async () => {
    const transfers = new FakeTransfers();
    // Délai dépassé… mais le transfert a bien été créé chez le fournisseur.
    transfers.onSubmit = (r) => {
      transfers.remote.set(r.merchantTransactionId, {
        providerReference: `cp-${r.merchantTransactionId}`,
        providerStatus: 'PENDING',
      });
      return { kind: 'uncertain', errorCode: 'CINETPAY_TIMEOUT' };
    };
    const { app, withdrawals, advance } = setup({ transfers });
    const A = await player(app);
    await seed(A.id, 5000);

    const res = await A.withdraw(ok);
    expect(res.status).toBe(202);
    expect(res.body.withdrawal.status).toBe('CREATED');
    expect(await balanceOf(A.id)).toBe(4000);

    // Fournisseur injoignable pendant la relecture : rien n'est décidé, aucun remboursement.
    transfers.lookupFails = true;
    await expect(withdrawals.check(res.body.withdrawal.id)).rejects.toThrow();
    expect(await balanceOf(A.id)).toBe(4000);

    // Relecture : le transfert existe → PROCESSING, jamais renvoyé.
    transfers.lookupFails = false;
    advance(60 * 60_000);
    expect(await withdrawals.check(res.body.withdrawal.id)).toEqual({
      outcome: 'processing',
      status: 'PROCESSING',
    });
    expect(transfers.submissions).toHaveLength(1);

    transfers.setStatus(res.body.withdrawal.reference, 'SUCCESS');
    expect((await withdrawals.check(res.body.withdrawal.id)).status).toBe('SUCCEEDED');
    expect(await balanceOf(A.id)).toBe(4000);
  });

  it('par défaut, AUCUN renvoi : introuvable après un envoi incertain → reste ouvert, débité', async () => {
    const transfers = new FakeTransfers();
    transfers.onSubmit = () => ({ kind: 'uncertain', errorCode: 'CINETPAY_NETWORK' });
    const { app, withdrawals, advance } = setup({ transfers });
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;

    for (const wait of [0, 11 * 60_000, 24 * 60 * 60_000]) {
      advance(wait);
      expect(await withdrawals.check(withdrawal.id)).toEqual({
        outcome: 'unresolved',
        status: 'CREATED',
      });
    }
    expect(transfers.submissions).toHaveLength(1);
    expect(await balanceOf(A.id)).toBe(4000);
    const row = await database.sql.query<{ last_error_code: string }>(
      'SELECT last_error_code FROM withdrawals WHERE id = $1',
      [withdrawal.id],
    );
    expect(row.rows[0]?.last_error_code).toBe('PROVIDER_NOT_FOUND');
  });

  it('renvoi activé explicitement : seulement après le délai, MÊME référence', async () => {
    const transfers = new FakeTransfers();
    let first = true;
    const accept = transfers.onSubmit;
    transfers.onSubmit = (r) => {
      if (first) {
        first = false;
        return { kind: 'uncertain', errorCode: 'CINETPAY_NETWORK' }; // jamais arrivé chez CinetPay
      }
      return accept(r);
    };
    const { app, withdrawals, advance } = setup({ transfers, maxSubmissionAttempts: 3 });
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;

    expect(await withdrawals.check(withdrawal.id)).toEqual({ outcome: 'unresolved', status: 'CREATED' });
    expect(transfers.submissions).toHaveLength(1);

    advance(11 * 60_000);
    expect((await withdrawals.check(withdrawal.id)).status).toBe('PROCESSING');
    expect(transfers.submissions).toHaveLength(2);
    expect(transfers.submissions[1]?.merchantTransactionId).toBe(
      transfers.submissions[0]?.merchantTransactionId,
    );
    expect(await balanceOf(A.id)).toBe(4000);
  });

  it('échec définitif confirmé : FAILED, remboursé UNE seule fois, même en répétant', async () => {
    const { app, transfers, withdrawals } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    expect(await balanceOf(A.id)).toBe(4000);

    transfers.setStatus(withdrawal.reference, 'FAILED');
    const results = await Promise.all([
      withdrawals.check(withdrawal.id),
      withdrawals.check(withdrawal.id),
      withdrawals.check(withdrawal.id),
    ]);
    expect(results.map((r) => r.status)).toEqual(['FAILED', 'FAILED', 'FAILED']);
    expect(results.filter((r) => r.outcome === 'settled')).toHaveLength(1);
    expect(await balanceOf(A.id)).toBe(5000);
    expect((await withdrawals.check(withdrawal.id)).outcome).toBe('already_final');
    expect(await balanceOf(A.id)).toBe(5000);

    const tx = await database.sql.query<{ status: string; failure_code: string }>(
      `SELECT t.status, t.failure_code FROM wallet_transactions t
       JOIN withdrawals w ON w.wallet_transaction_id = t.id WHERE w.id = $1`,
      [withdrawal.id],
    );
    expect(tx.rows[0]).toEqual({ status: 'failed', failure_code: 'PROVIDER_FAILED' });
  });

  it('succès confirmé : SUCCEEDED une seule fois, débit définitif, référence et date enregistrées', async () => {
    const { app, transfers, withdrawals } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    transfers.setStatus(withdrawal.reference, 'SUCCESS');
    const [a, b] = await Promise.all([withdrawals.check(withdrawal.id), withdrawals.check(withdrawal.id)]);
    expect([a.outcome, b.outcome].sort()).toEqual(['already_final', 'settled']);
    expect(await balanceOf(A.id)).toBe(4000);
    const row = (
      await database.sql.query<{ status: string; provider_reference: string; completed_at: Date }>(
        'SELECT status, provider_reference, completed_at FROM withdrawals WHERE id = $1',
        [withdrawal.id],
      )
    ).rows[0];
    expect(row).toEqual(
      expect.objectContaining({
        status: 'SUCCEEDED',
        provider_reference: `cp-${withdrawal.reference}`,
        completed_at: expect.any(Date),
      }),
    );
  });

  it('un SUCCESS annoncé à la création n’est pas une preuve : PROCESSING jusqu’à la relecture', async () => {
    const transfers = new FakeTransfers();
    transfers.onSubmit = (r) => {
      transfers.remote.set(r.merchantTransactionId, {
        providerReference: `cp-${r.merchantTransactionId}`,
        providerStatus: 'PENDING',
      });
      return { kind: 'accepted', providerReference: `cp-${r.merchantTransactionId}`, providerStatus: 'SUCCESS' };
    };
    const { app } = setup({ transfers });
    const A = await player(app);
    await seed(A.id, 5000);
    expect((await A.withdraw(ok)).body.withdrawal.status).toBe('PROCESSING');
  });

  it('refus ANNONCÉ à la création : jamais remboursé sur ce seul message, retrait ouvert', async () => {
    const transfers = new FakeTransfers();
    transfers.onSubmit = () => ({ kind: 'rejected', providerStatus: 'INSUFFICIENT_BALANCE' });
    const { app, withdrawals, advance } = setup({ transfers });
    const A = await player(app);
    await seed(A.id, 5000);
    const res = await A.withdraw(ok);
    expect(res.status).toBe(202);
    expect(res.body.withdrawal).toEqual(
      expect.objectContaining({ status: 'CREATED', underReview: true }),
    );
    expect(await balanceOf(A.id)).toBe(4000);
    // Relectures « introuvable » : toujours aucune certitude, toujours aucun remboursement.
    advance(48 * 60 * 60_000);
    expect(await withdrawals.check(res.body.withdrawal.id)).toEqual({
      outcome: 'unresolved',
      status: 'CREATED',
    });
    expect(await balanceOf(A.id)).toBe(4000);
    expect(transfers.submissions).toHaveLength(1);
    const row = await database.sql.query<{ last_error_code: string; provider_status: string }>(
      'SELECT last_error_code, provider_status FROM withdrawals WHERE id = $1',
      [res.body.withdrawal.id],
    );
    expect(row.rows[0]).toEqual({
      last_error_code: 'PROVIDER_REJECTED',
      provider_status: 'INSUFFICIENT_BALANCE',
    });
  });

  it('refus annoncé puis transfert TROUVÉ en échec final : remboursé une fois (preuve relue)', async () => {
    const transfers = new FakeTransfers();
    transfers.onSubmit = (r) => {
      transfers.remote.set(r.merchantTransactionId, {
        providerReference: `cp-${r.merchantTransactionId}`,
        providerStatus: 'FAILED',
      });
      return { kind: 'rejected', providerStatus: 'FAILED' };
    };
    const { app } = setup({ transfers });
    const A = await player(app);
    await seed(A.id, 5000);
    const res = await A.withdraw(ok);
    expect(res.body.withdrawal).toEqual(
      expect.objectContaining({ status: 'FAILED', failureCode: 'PROVIDER_FAILED' }),
    );
    expect(await balanceOf(A.id)).toBe(5000);
  });

  it('demande NON envoyée (authentification avant envoi) : envoi non compté, retenté ensuite', async () => {
    const transfers = new FakeTransfers();
    const accept = transfers.onSubmit;
    let down = true;
    transfers.onSubmit = (r) =>
      down ? { kind: 'not_sent', errorCode: 'CINETPAY_AUTHENTICATION' } : accept(r);
    const { app, withdrawals } = setup({ transfers });
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    expect(withdrawal.status).toBe('CREATED');
    const attempts = async () =>
      (
        await database.sql.query<{ submission_attempts: number }>(
          'SELECT submission_attempts FROM withdrawals WHERE id = $1',
          [withdrawal.id],
        )
      ).rows[0]?.submission_attempts;
    expect(await attempts()).toBe(0);
    down = false;
    expect((await withdrawals.check(withdrawal.id)).status).toBe('PROCESSING');
    expect(await attempts()).toBe(1);
    expect(transfers.submissions.map((s) => s.merchantTransactionId)).toEqual([
      withdrawal.reference,
      withdrawal.reference,
    ]);
  });

  it('référence relue différente : rien n’est décidé (409 à la vérification)', async () => {
    const { app, transfers, withdrawals } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    transfers.remote.set(withdrawal.reference, { providerReference: 'autre', providerStatus: 'FAILED' });
    await expect(withdrawals.check(withdrawal.id)).rejects.toThrow('Retrait non vérifiable');
    expect(await balanceOf(A.id)).toBe(4000);
  });

  it('redémarrage : un retrait créé mais jamais envoyé est repris par la réconciliation', async () => {
    const { app, transfers, repository, makeService, advance, clock } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    // Arrêt du serveur juste après la création (avant l'envoi) : seule la base existe.
    const id = randomUUID();
    await repository.create({
      idempotencyKey: randomUUID(),
      withdrawal: {
        id,
        userId: A.id as never,
        walletTransactionId: randomUUID(),
        provider: 'cinetpay',
        operator: 'OM_CM',
        msisdnMasked: maskPhone(A.phone),
        tokens: 2000,
        amount: 2000,
        currency: 'XAF',
        status: 'CREATED',
        merchantTransactionId: 'LWrestart000000000000000001',
        submissionAttempts: 0,
        createdAt: clock(),
        updatedAt: clock(),
      },
    });
    expect(await balanceOf(A.id)).toBe(3000);
    advance(5 * 60_000);

    const restarted = makeService();
    const reconciler = new WithdrawalReconciler({
      withdrawals: restarted,
      repository,
      logger: createLogger({}, () => undefined),
      clock,
    });
    const report = await reconciler.tick();
    expect(report).toEqual(expect.objectContaining({ checked: 1, processing: 1 }));
    expect(transfers.submissions).toEqual([
      expect.objectContaining({ merchantTransactionId: 'LWrestart000000000000000001', phoneNumber: A.phone }),
    ]);

    transfers.setStatus('LWrestart000000000000000001', 'SUCCESS');
    advance(5 * 60_000);
    expect((await reconciler.tick()).settled).toBe(1);
    expect((await A.get(id)).body.withdrawal.status).toBe('SUCCEEDED');
    expect(await balanceOf(A.id)).toBe(3000);
  });

  it('historique et solde cohérents avec les écritures', async () => {
    const { app, transfers, withdrawals, advance } = setup();
    const A = await player(app);
    await seed(A.id, 10_000);
    const w1 = (await A.withdraw({ tokens: 1000, operator: 'MTN_CM' })).body.withdrawal;
    advance(1000);
    const w2 = (await A.withdraw({ tokens: 2000, operator: 'OM_CM' })).body.withdrawal;
    advance(1000);
    await A.withdraw({ tokens: 3000, operator: 'MTN_CM' });
    transfers.setStatus(w1.reference, 'SUCCESS');
    transfers.setStatus(w2.reference, 'FAILED');
    await withdrawals.check(w1.id);
    await withdrawals.check(w2.id);

    const { withdrawals: items } = (await A.history().expect(200)).body;
    expect(items.map((w: { tokens: number; status: string }) => [w.tokens, w.status])).toEqual([
      [3000, 'PROCESSING'],
      [2000, 'FAILED'],
      [1000, 'SUCCEEDED'],
    ]);
    for (const item of items) {
      expect(item.msisdn).toContain('*');
      expect(item.msisdn).not.toBe(A.phone);
      expect(item).not.toHaveProperty('providerReference');
    }
    expect(items[1].operatorLabel).toBe('Orange Money');
    // 10 000 − 1 000 (réussi) − 3 000 (en cours) ; les 2 000 échoués sont remboursés.
    expect(await balanceOf(A.id)).toBe(6000);
    const ledger = await database.sql.query<{ total: string }>(
      `SELECT coalesce(sum(tokens), 0) AS total FROM wallet_transactions
       WHERE user_id = $1 AND kind = 'withdrawal' AND status <> 'failed'`,
      [A.id],
    );
    expect(10_000 - Number(ledger.rows[0]?.total)).toBe(6000);
  });

  it('montants réservés (tournois, mises) jamais retirables : seul le DISPONIBLE compte', async () => {
    const { app, transfers } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    // Réservation simulée (même colonne que les inscriptions et le séquestre des mises).
    await database.sql.query('UPDATE wallets SET reserved = 4500 WHERE user_id = $1', [A.id]);
    const refused = await A.withdraw(ok);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('INSUFFICIENT_BALANCE');
    expect(transfers.submissions).toHaveLength(0);

    await database.sql.query('UPDATE wallets SET reserved = 4000 WHERE user_id = $1', [A.id]);
    expect((await A.withdraw(ok)).status).toBe(202);
    expect((await A.withdraw(ok)).status).toBe(409);
    const wallet = await database.sql.query<{ balance: string; reserved: string }>(
      'SELECT balance, reserved FROM wallets WHERE user_id = $1',
      [A.id],
    );
    expect(Number(wallet.rows[0]?.balance)).toBe(4000);
    expect(Number(wallet.rows[0]?.reserved)).toBe(4000);
  });

  it('envoi différé : destinataire modifié depuis la création → rien n’est envoyé', async () => {
    const { app, transfers, repository, withdrawals, clock } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    const id = randomUUID();
    await repository.create({
      idempotencyKey: randomUUID(),
      withdrawal: {
        id,
        userId: A.id as never,
        walletTransactionId: randomUUID(),
        provider: 'cinetpay',
        operator: 'MTN_CM',
        msisdnMasked: '+23*******999',
        tokens: 1000,
        amount: 1000,
        currency: 'XAF',
        status: 'CREATED',
        merchantTransactionId: 'LWrecipient00000000000000001',
        submissionAttempts: 0,
        createdAt: clock(),
        updatedAt: clock(),
      },
    });
    expect(await withdrawals.check(id)).toEqual({ outcome: 'unresolved', status: 'CREATED' });
    expect(transfers.submissions).toHaveLength(0);
    const row = await database.sql.query<{ last_error_code: string; submission_attempts: number }>(
      'SELECT last_error_code, submission_attempts FROM withdrawals WHERE id = $1',
      [id],
    );
    expect(row.rows[0]).toEqual({ last_error_code: 'RECIPIENT_CHANGED', submission_attempts: 0 });
  });

  it('journaux : ni numéro de téléphone ni notify_token sur tout le cycle', async () => {
    const { app, transfers, withdrawals, logLines } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    await request(app)
      .post('/api/withdrawals/cinetpay/notify')
      .send({
        notify_token: 'faux',
        merchant_transaction_id: withdrawal.reference,
        transaction_id: `cp-${withdrawal.reference}`,
      });
    transfers.setStatus(withdrawal.reference, 'FAILED');
    await withdrawals.check(withdrawal.id);
    const logs = logLines.join('\n');
    expect(logs).toContain('withdrawal settled');
    expect(logs).not.toContain(A.phone);
    expect(logs).not.toContain(A.phone.slice(1));
    expect(logs).not.toContain(`nt-${withdrawal.reference}`);
  });

  it('un autre joueur ne voit pas le retrait (404 identique)', async () => {
    const { app } = setup();
    const A = await player(app);
    const B = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    expect((await B.get(withdrawal.id)).status).toBe(404);
    expect((await B.get(randomUUID())).status).toBe(404);
    expect((await A.get(withdrawal.id)).status).toBe(200);
  });
});

// --- Notifications ----------------------------------------------------------------------------

describe('Notification de transfert CinetPay', () => {
  const notify = (app: Express, body: object) =>
    request(app).post('/api/withdrawals/cinetpay/notify').send(body);

  it('jeton valide : statut RELU puis réglé ; notification répétée : aucune écriture dupliquée', async () => {
    const { app, transfers } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    transfers.setStatus(withdrawal.reference, 'FAILED');
    const body = {
      notify_token: `nt-${withdrawal.reference}`,
      merchant_transaction_id: withdrawal.reference,
      transaction_id: `cp-${withdrawal.reference}`,
    };
    const responses = await Promise.all([notify(app, body), notify(app, body), notify(app, body)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(responses.every((r) => r.body.status === 'FAILED')).toBe(true);
    expect(await balanceOf(A.id)).toBe(5000);
    expect((await notify(app, body)).body.status).toBe('FAILED');
    expect(await balanceOf(A.id)).toBe(5000);
  });

  it('jeton ou référence invalides → 401 ; inconnue → 404 ; incomplète → 400 ; rien ne change', async () => {
    const { app, transfers } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    transfers.setStatus(withdrawal.reference, 'FAILED');
    const base = {
      notify_token: `nt-${withdrawal.reference}`,
      merchant_transaction_id: withdrawal.reference,
      transaction_id: `cp-${withdrawal.reference}`,
    };
    expect((await notify(app, { ...base, notify_token: 'faux' })).status).toBe(401);
    expect((await notify(app, { ...base, transaction_id: 'autre' })).status).toBe(401);
    expect((await notify(app, { ...base, merchant_transaction_id: 'LWinconnu' })).status).toBe(404);
    expect((await notify(app, { merchant_transaction_id: withdrawal.reference })).status).toBe(400);
    expect(await balanceOf(A.id)).toBe(4000);
    expect((await A.get(withdrawal.id)).body.withdrawal.status).toBe('FAILED');
  });

  it('empreinte du notify_token seulement, jamais le jeton en clair', async () => {
    const { app } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    const row = (
      await database.sql.query<{ notify_token_hash: string }>(
        'SELECT notify_token_hash FROM withdrawals WHERE id = $1',
        [withdrawal.id],
      )
    ).rows[0];
    expect(row?.notify_token_hash).toBe(
      createHash('sha256').update(`nt-${withdrawal.reference}`).digest('hex'),
    );
  });
});

// --- Administration ---------------------------------------------------------------------------

describe('Administration des retraits', () => {
  it('liste filtrée, détail audité, revérification idempotente et auditée ; 403 pour un joueur', async () => {
    const { app, transfers } = setup();
    const A = await player(app);
    await seed(A.id, 10_000);
    const w1 = (await A.withdraw(ok)).body.withdrawal;
    await A.withdraw(ok);
    const admin = await makeAdmin(app);

    const all = await admin.get('/api/admin/withdrawals').expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items[0].msisdn).toContain('*');
    const byRef = await admin.get(`/api/admin/withdrawals?q=${w1.reference}`).expect(200);
    expect(byRef.body.items.map((w: { id: string }) => w.id)).toEqual([w1.id]);
    expect((await admin.get('/api/admin/withdrawals?status=SUCCEEDED')).body.total).toBe(0);
    expect((await admin.get('/api/admin/withdrawals?status=PAID')).status).toBe(400);
    expect(
      (await admin.get('/api/admin/withdrawals?from=2026-10-11T00:00:00Z')).body.total,
    ).toBe(0);

    const detail = await admin.get(`/api/admin/withdrawals/${w1.id}`).expect(200);
    expect(detail.body.withdrawal).toEqual(
      expect.objectContaining({
        status: 'PROCESSING',
        walletTransaction: expect.objectContaining({ status: 'pending' }),
        verification: expect.objectContaining({ available: true }),
      }),
    );

    transfers.setStatus(w1.reference, 'SUCCESS');
    const key = `verify-${randomUUID()}`;
    const verify = () =>
      request(app)
        .post(`/api/admin/withdrawals/${w1.id}/verify`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('Idempotency-Key', key);
    const first = await verify().expect(200);
    expect(first.body).toEqual(expect.objectContaining({ replayed: false, status: 'SUCCEEDED' }));
    const lookups = transfers.lookups;
    expect((await verify().expect(200)).body.replayed).toBe(true);
    expect(transfers.lookups).toBe(lookups);

    const audit = await database.sql.query<{ action: string }>(
      `SELECT action FROM admin_audit_log WHERE target_id = $1 ORDER BY created_at`,
      [w1.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'WITHDRAWAL_VIEWED',
      'WITHDRAWAL_VERIFICATION_REQUESTED',
    ]);

    const playerToken = (await registerAndLogin(app)).accessToken;
    await request(app)
      .get('/api/admin/withdrawals')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(403);
  });

  it('aucune route ne permet de déclarer un retrait réussi', async () => {
    const { app } = setup();
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    const admin = await makeAdmin(app);
    for (const path of ['succeed', 'complete', 'status', 'settle']) {
      const res = await admin.post(`/api/admin/withdrawals/${withdrawal.id}/${path}`, { status: 'SUCCEEDED' });
      expect(res.status).toBe(404);
    }
    expect((await A.get(withdrawal.id)).body.withdrawal.status).toBe('PROCESSING');
  });
});

// --- Rapprochement des retraits bloqués (D-076) -------------------------------------------

describe('Rapprochement administratif (double validation)', () => {
  const HOUR = 60 * 60_000;
  const proposal = {
    providerTicket: 'CP-TICKET-4821',
    justification: 'CinetPay confirme par écrit que ce transfert n’a jamais été exécuté.',
  };

  /** Retrait bloqué : envoi incertain, transfert introuvable chez CinetPay. */
  async function blocked(transfers = new FakeTransfers()) {
    transfers.onSubmit = () => ({ kind: 'uncertain', errorCode: 'CINETPAY_TIMEOUT' });
    const ctx = setup({ transfers });
    const A = await player(ctx.app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body;
    const [first, second] = [await makeAdmin(ctx.app), await makeAdmin(ctx.app)];
    const base = `/api/admin/withdrawals/${withdrawal.id}`;
    return { ...ctx, A, withdrawal, first, second, base };
  }

  it('proposition puis approbation par un AUTRE administrateur : remboursé une seule fois', async () => {
    const { advance, A, withdrawal, first, second, base } = await blocked();

    const early = await first.post(`${base}/refund-requests`, proposal);
    expect(early.status).toBe(409);
    expect(early.body.details.reason).toBe('TOO_RECENT');

    advance(25 * HOUR);
    const proposed = await first.post(`${base}/refund-requests`, proposal);
    expect(proposed.status).toBe(201);
    expect(proposed.body).toEqual(
      expect.objectContaining({ outcome: 'proposed', status: 'PENDING' }),
    );
    const requestId = proposed.body.requestId as string;
    expect(await balanceOf(A.id)).toBe(4000);

    // Une seule demande en attente ; celui qui propose n'approuve jamais.
    expect((await second.post(`${base}/refund-requests`, proposal)).body.details.reason).toBe(
      'PENDING_REQUEST_EXISTS',
    );
    const self = await first.post(`${base}/refund-requests/${requestId}/approve`, {});
    expect(self.status).toBe(409);
    expect(self.body.details.reason).toBe('SAME_ADMIN');
    expect(await balanceOf(A.id)).toBe(4000);

    const approvals = await Promise.all([
      second.post(`${base}/refund-requests/${requestId}/approve`, {
        note: 'Confirmation vérifiée.',
      }),
      second.post(`${base}/refund-requests/${requestId}/approve`, {}),
    ]);
    expect(approvals.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await balanceOf(A.id)).toBe(5000);
    expect((await A.get(withdrawal.id)).body.withdrawal).toEqual(
      expect.objectContaining({ status: 'FAILED', failureCode: 'MANUAL_REFUND_CONFIRMED' }),
    );

    const audit = await database.sql.query<{ action: string }>(
      `SELECT action FROM admin_audit_log WHERE target_id = $1 AND action LIKE 'WITHDRAWAL_REFUND%'
       ORDER BY created_at`,
      [withdrawal.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'WITHDRAWAL_REFUND_PROPOSED',
      'WITHDRAWAL_REFUND_APPROVED',
    ]);
    const detail = await second.get(base).expect(200);
    expect(detail.body.withdrawal.reconciliation.refundRequests[0]).toEqual(
      expect.objectContaining({
        status: 'APPROVED',
        providerTicket: 'CP-TICKET-4821',
        providerStatusAtProposal: 'NOT_FOUND',
        providerStatusAtDecision: 'NOT_FOUND',
      }),
    );
  });

  it('le transfert réapparaît avant l’approbation : aucun remboursement', async () => {
    const { transfers, advance, A, withdrawal, first, second, base } = await blocked();
    advance(25 * HOUR);
    const { requestId } = (await first.post(`${base}/refund-requests`, proposal)).body;
    transfers.remote.set(withdrawal.reference, {
      providerReference: `cp-${withdrawal.reference}`,
      providerStatus: 'PENDING',
    });
    const res = await second.post(`${base}/refund-requests/${requestId}/approve`, {});
    expect(res.status).toBe(409);
    expect(res.body.details.reason).toBe('TRANSFER_EXISTS');
    expect(await balanceOf(A.id)).toBe(4000);
    expect((await A.get(withdrawal.id)).body.withdrawal.status).toBe('PROCESSING');
  });

  it('CinetPay confirme un SUCCÈS : réglé SUCCEEDED, remboursement refusé', async () => {
    const { transfers, advance, A, withdrawal, first, base } = await blocked();
    advance(25 * HOUR);
    transfers.remote.set(withdrawal.reference, {
      providerReference: `cp-${withdrawal.reference}`,
      providerStatus: 'SUCCESS',
    });
    const res = await first.post(`${base}/refund-requests`, proposal);
    expect(res.status).toBe(409);
    expect(res.body.details.reason).toBe('TRANSFER_SUCCEEDED');
    expect(await balanceOf(A.id)).toBe(4000);
    expect((await A.get(withdrawal.id)).body.withdrawal.status).toBe('SUCCEEDED');
  });

  it('CinetPay confirme un ÉCHEC final : remboursé par le chemin normal, sans demande', async () => {
    const { transfers, advance, A, withdrawal, first, base } = await blocked();
    advance(25 * HOUR);
    transfers.remote.set(withdrawal.reference, {
      providerReference: `cp-${withdrawal.reference}`,
      providerStatus: 'FAILED',
    });
    const res = await first.post(`${base}/refund-requests`, proposal);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'settled_by_provider', status: 'FAILED' });
    expect(await balanceOf(A.id)).toBe(5000);
  });

  it('CinetPay injoignable : 503, aucune demande, aucun remboursement', async () => {
    const { transfers, advance, A, first, base } = await blocked();
    advance(25 * HOUR);
    transfers.lookupFails = true;
    const res = await first.post(`${base}/refund-requests`, proposal);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WITHDRAWAL_PROVIDER_UNAVAILABLE');
    expect(await balanceOf(A.id)).toBe(4000);
    const count = await database.sql.query<{ n: string }>(
      'SELECT count(*) AS n FROM withdrawal_refund_requests',
    );
    expect(Number(count.rows[0]?.n)).toBe(0);
  });

  it('rejet motivé, puis nouvelle proposition possible ; saisies contrôlées', async () => {
    const { advance, A, first, second, base } = await blocked();
    advance(25 * HOUR);
    for (const body of [
      {},
      { ...proposal, providerTicket: '' },
      { ...proposal, justification: 'trop court' },
      { ...proposal, justification: 'Le joueur au 677 12 34 56 confirme ne rien avoir reçu.' },
    ]) {
      expect((await first.post(`${base}/refund-requests`, body)).status).toBe(400);
    }
    const { requestId } = (await first.post(`${base}/refund-requests`, proposal)).body;
    expect((await first.post(`${base}/refund-requests/${requestId}/reject`, {})).status).toBe(
      400,
    );
    const rejected = await first.post(`${base}/refund-requests/${requestId}/reject`, {
      note: 'Ticket incomplet, à reprendre.',
    });
    expect(rejected.body).toEqual(expect.objectContaining({ requestStatus: 'REJECTED' }));
    expect(await balanceOf(A.id)).toBe(4000);
    expect((await second.post(`${base}/refund-requests`, proposal)).status).toBe(201);
  });

  it('escalade : tracée dans l’audit, ni statut ni solde modifiés', async () => {
    const { A, first, base } = await blocked();
    const res = await first.post(`${base}/escalations`, {
      providerTicket: 'CP-ESC-77',
      note: 'Statut demandé au support CinetPay.',
    });
    expect(res.status).toBe(201);
    expect(await balanceOf(A.id)).toBe(4000);
    const detail = await first.get(base).expect(200);
    expect(detail.body.withdrawal.status).toBe('CREATED');
    expect(detail.body.withdrawal.reconciliation.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'WITHDRAWAL_ESCALATED',
          details: { providerTicket: 'CP-ESC-77', note: 'Statut demandé au support CinetPay.' },
        }),
      ]),
    );
  });

  it('un joueur n’accède à aucune action de rapprochement (403)', async () => {
    const { app, base } = await blocked();
    const token = (await registerAndLogin(app)).accessToken;
    await request(app)
      .post(`${base}/refund-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send(proposal)
      .expect(403);
  });

  it('payé APRÈS remboursement : anomalie notée et journalisée, rien n’est modifié', async () => {
    const transfers = new FakeTransfers();
    const { app, advance, withdrawals, logLines } = setup({ transfers });
    const A = await player(app);
    await seed(A.id, 5000);
    const { withdrawal } = (await A.withdraw(ok)).body; // PROCESSING, jeton de notification connu
    transfers.remote.delete(withdrawal.reference); // CinetPay ne le retrouve plus
    advance(25 * HOUR);
    const [first, second] = [await makeAdmin(app), await makeAdmin(app)];
    const base = `/api/admin/withdrawals/${withdrawal.id}`;
    const { requestId } = (await first.post(`${base}/refund-requests`, proposal)).body;
    await second.post(`${base}/refund-requests/${requestId}/approve`, {}).expect(200);
    expect(await balanceOf(A.id)).toBe(5000);

    transfers.remote.set(withdrawal.reference, {
      providerReference: `cp-${withdrawal.reference}`,
      providerStatus: 'SUCCESS',
    });
    await request(app)
      .post('/api/withdrawals/cinetpay/notify')
      .send({
        notify_token: `nt-${withdrawal.reference}`,
        merchant_transaction_id: withdrawal.reference,
        transaction_id: `cp-${withdrawal.reference}`,
      })
      .expect(200);
    const row = await database.sql.query<{ status: string; last_error_code: string }>(
      'SELECT status, last_error_code FROM withdrawals WHERE id = $1',
      [withdrawal.id],
    );
    expect(row.rows[0]).toEqual({ status: 'FAILED', last_error_code: 'PAID_AFTER_REFUND' });
    expect(await balanceOf(A.id)).toBe(5000);
    expect(logLines.join('\n')).toContain('withdrawal paid after refund');
    expect((await withdrawals.check(withdrawal.id)).outcome).toBe('already_final');
  });
});

describe('Transferts désactivés : relecture seulement', () => {
  it('aucune nouvelle demande, aucun envoi ; les retraits ouverts sont toujours réconciliés', async () => {
    const transfers = new FakeTransfers();
    const { app, repository, makeService, clock } = setup({ transfers });
    const A = await player(app);
    await seed(A.id, 5000);
    const processing = (await A.withdraw(ok)).body.withdrawal;
    // Un retrait créé mais jamais envoyé (arrêt du serveur) avant la désactivation.
    const neverSent = randomUUID();
    await repository.create({
      idempotencyKey: randomUUID(),
      withdrawal: {
        id: neverSent,
        userId: A.id as never,
        walletTransactionId: randomUUID(),
        provider: 'cinetpay',
        operator: 'MTN_CM',
        msisdnMasked: maskPhone(A.phone),
        tokens: 1000,
        amount: 1000,
        currency: 'XAF',
        status: 'CREATED',
        merchantTransactionId: 'LWdisabled000000000000000001',
        submissionAttempts: 0,
        createdAt: clock(),
        updatedAt: clock(),
      },
    });

    transfers.canSubmit = false; // CINETPAY_TRANSFERS_ENABLED=false ; relecture conservée
    const service = makeService();
    expect(service.available).toBe(false);
    await expect(
      service.request(A.id as never, { tokens: 1000, operator: 'MTN_CM' }, randomUUID()),
    ).rejects.toThrow('Fournisseur Mobile Money indisponible');

    transfers.setStatus(processing.reference, 'SUCCESS');
    expect((await service.check(processing.id)).status).toBe('SUCCEEDED');
    expect(await service.check(neverSent)).toEqual({ outcome: 'unresolved', status: 'CREATED' });
    expect(transfers.submissions).toHaveLength(1); // seul l'envoi d'avant la désactivation
    expect(await balanceOf(A.id)).toBe(3000);
  });
});
