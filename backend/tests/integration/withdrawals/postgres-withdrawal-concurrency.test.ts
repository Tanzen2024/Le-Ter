import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { UserId } from '../../../src/domain/users/user';
import { maskPhone } from '../../../src/domain/wallet/wallet';
import { PostgresUserRepository } from '../../../src/repositories/postgres-user.repository';
import { PostgresWalletRepository } from '../../../src/repositories/postgres-wallet.repository';
import { PostgresWithdrawalRepository } from '../../../src/repositories/postgres-withdrawal.repository';
import type {
  TransferGateway,
  TransferLookup,
  TransferRequest,
  TransferSubmission,
} from '../../../src/services/withdrawals/transfer.gateway';
import { WithdrawalReconciler } from '../../../src/services/withdrawals/withdrawal-reconciler';
import { WithdrawalService } from '../../../src/services/withdrawals/withdrawal.service';
import { createLogger } from '../../../src/utils/logger';

/**
 * Retraits (D-075, D-076) sur un VRAI PostgreSQL : connexions réellement parallèles (pool de
 * 20) et deux « instances » de WithdrawalService qui ne partagent que la base. Contrairement à
 * PGlite (transactions exécutées une par une), les verrous `FOR UPDATE`, les UPDATE
 * conditionnels et les index uniques sont ici réellement mis en concurrence.
 *
 * Fournisseur de transfert SIMULÉ (aucun appel réseau, aucun transfert réel), partagé par les
 * deux instances comme le serait CinetPay, avec des délais pour entrelacer les transactions.
 *
 * Exécutée seulement quand TEST_DATABASE_URL désigne une base de TEST dédiée : refus si elle
 * désigne la même base (hôte, port, nom) que DATABASE_URL (variable ou backend/.env). Tout se
 * passe dans un schéma temporaire, supprimé à la fin.
 */
const url = process.env.TEST_DATABASE_URL;

function applicationDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = resolve(__dirname, '../../../.env');
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  return line
    ?.replace(/^\s*DATABASE_URL\s*=\s*/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

/** Même base = même hôte (localhost ≡ 127.0.0.1), même port, même nom ; identifiants ignorés. */
function sameDatabase(a: string, b: string | undefined): boolean {
  if (!b) return false;
  try {
    const [x, y] = [new URL(a), new URL(b)];
    const host = (h: string) => (h === 'localhost' || h === '::1' ? '127.0.0.1' : h);
    return (
      host(x.hostname) === host(y.hostname) &&
      (x.port || '5432') === (y.port || '5432') &&
      x.pathname === y.pathname
    );
  } catch {
    return true; // URL illisible : par prudence, considérée comme la base de l'application
  }
}

const isDedicatedTestDatabase = Boolean(url) && !sameDatabase(url!, applicationDatabaseUrl());
const describeWithPostgres = isDedicatedTestDatabase ? describe : describe.skip;
jest.setTimeout(120_000);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** CinetPay simulé et PARTAGÉ par les instances ; délais aléatoires pour entrelacer. */
class SharedFakeTransfers implements TransferGateway {
  canSubmit = true;
  canLookup = true;
  readonly submissions: TransferRequest[] = [];
  readonly remote = new Map<string, { providerReference: string; providerStatus: string }>();
  lookupFails = false;
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

  async submit(r: TransferRequest): Promise<TransferSubmission> {
    this.submissions.push(r);
    await pause(randomInt(5, 25));
    return this.onSubmit(r);
  }

  async lookup(merchantTransactionId: string): Promise<TransferLookup> {
    await pause(randomInt(1, 15));
    if (this.lookupFails) throw new Error('CinetPay injoignable (simulé)');
    const remote = this.remote.get(merchantTransactionId);
    return remote ? { found: true, merchantTransactionId, ...remote } : { found: false };
  }

  setStatus(merchantTransactionId: string, providerStatus: string) {
    const remote = this.remote.get(merchantTransactionId);
    if (!remote) throw new Error('transfert inconnu');
    remote.providerStatus = providerStatus;
  }
}

describeWithPostgres('Retraits sur PostgreSQL réel (concurrence, deux instances)', () => {
  const schema = `withdrawal_test_${randomUUID().replace(/-/g, '')}`;
  const logger = createLogger({}, () => undefined);
  let pool: Pool;
  let sql: SqlClient;
  let now = new Date();
  const clock = () => now;
  let transfers: SharedFakeTransfers;
  let instances: [WithdrawalService, WithdrawalService];
  let repository: PostgresWithdrawalRepository;

  const makeInstance = () =>
    new WithdrawalService({
      // Un dépôt PAR instance : seule la base est partagée.
      withdrawals: new PostgresWithdrawalRepository(sql),
      wallets: new PostgresWalletRepository(sql),
      users: new PostgresUserRepository(sql),
      gateway: transfers,
      logger,
      clock,
      options: { readRecheckMs: 0 },
    });

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 20, options: `-c search_path=${schema}` });
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
  });

  beforeEach(() => {
    now = new Date();
    transfers = new SharedFakeTransfers();
    repository = new PostgresWithdrawalRepository(sql);
    instances = [makeInstance(), makeInstance()];
  });

  afterEach(async () => {
    await sql.query('TRUNCATE users CASCADE');
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  /**
   * Compte camerounais (+237) avec un solde de départ, comme après des achats. Numéro MTN
   * (préfixe 67x) : l'opérateur du retrait est déduit du numéro d'inscription (D-163), un
   * numéro hors plan MTN / Orange serait refusé avant toute écriture.
   */
  async function player(balance: number, role: 'user' | 'admin' = 'user') {
    const id = randomUUID() as UserId;
    const phone = `+23767${String(randomInt(0, 9_999_999)).padStart(7, '0')}`;
    await sql.query(
      `INSERT INTO users (id, first_name, last_name, email, username, phone, password_hash, role,
         created_at, updated_at)
       VALUES ($1, 'Test', 'Retrait', $2, $3, $4, 'not-a-real-hash', $5, now(), now())`,
      [id, `${id}@test.local`, `w_${id.slice(0, 8)}`, phone, role],
    );
    if (balance > 0) {
      await sql.query(
        `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, $2, now(), now())`,
        [id, balance],
      );
    }
    return { id, phone };
  }

  const balanceOf = async (userId: string) =>
    Number(
      (
        await sql.query<{ balance: string }>('SELECT balance FROM wallets WHERE user_id = $1', [
          userId,
        ])
      ).rows[0]?.balance ?? 0,
    );

  /** Invariant : solde = départ − somme des retraits non échoués ; transactions cohérentes. */
  async function expectLedgerConsistent(userId: string, initial: number) {
    const { rows } = await sql.query<{ open: string; failed_refunded: string; mismatched: string }>(
      `SELECT
         coalesce(sum(w.tokens) FILTER (WHERE w.status <> 'FAILED'), 0) AS open,
         count(*) FILTER (WHERE w.status = 'FAILED' AND t.status <> 'failed') AS failed_refunded,
         count(*) FILTER (WHERE (w.status = 'SUCCEEDED') <> (t.status = 'succeeded'))
           AS mismatched
       FROM withdrawals w JOIN wallet_transactions t ON t.id = w.wallet_transaction_id
       WHERE w.user_id = $1`,
      [userId],
    );
    expect(await balanceOf(userId)).toBe(initial - Number(rows[0]!.open));
    expect(Number(rows[0]!.failed_refunded)).toBe(0);
    expect(Number(rows[0]!.mismatched)).toBe(0);
  }

  const ok = { tokens: 1000, operator: 'MTN_CM' as const };
  const pick = (i: number) => instances[i % 2]!;

  it('quota d’une place : 12 demandes simultanées sur 2 instances → un seul retrait, un seul débit, un seul envoi', async () => {
    const admin = await player(0, 'admin');
    await repository.setLimit({
      limit: { count: 1, periodMinutes: 60 },
      actorId: admin.id,
      auditId: randomUUID(),
      now,
    });
    const A = await player(10_000);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => pick(i).request(A.id, ok, randomUUID())),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason.name] : []));
    expect(new Set(errors)).toEqual(new Set(['WithdrawalLimitReachedError']));
    expect(await balanceOf(A.id)).toBe(9000);
    expect(transfers.submissions).toHaveLength(1);
    await expectLedgerConsistent(A.id, 10_000);
  });

  it('solde juste suffisant : 10 demandes simultanées → jamais de solde négatif', async () => {
    const A = await player(3000);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => pick(i).request(A.id, ok, randomUUID())),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(await balanceOf(A.id)).toBe(0);
    expect(transfers.submissions).toHaveLength(3);
    await expectLedgerConsistent(A.id, 3000);
  });

  it('double clic massif : même Idempotency-Key ×10 sur 2 instances → un seul retrait', async () => {
    const A = await player(5000);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => pick(i).request(A.id, ok, key)),
    );
    expect(new Set(results.map((r) => r.withdrawal.id)).size).toBe(1);
    expect(await balanceOf(A.id)).toBe(4000);
    expect(transfers.submissions).toHaveLength(1);
    await expectLedgerConsistent(A.id, 5000);
  });

  it('échec confirmé relu 10 fois en parallèle (2 instances) : UN seul remboursement', async () => {
    const A = await player(5000);
    const { withdrawal } = await pick(0).request(A.id, ok, randomUUID());
    transfers.setStatus(withdrawal.reference, 'FAILED');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => pick(i).check(withdrawal.id)),
    );
    expect(results.filter((r) => r.outcome === 'settled')).toHaveLength(1);
    expect(results.every((r) => r.status === 'FAILED')).toBe(true);
    expect(await balanceOf(A.id)).toBe(5000);
    await expectLedgerConsistent(A.id, 5000);
  });

  it('remboursement manuel approuvé ET échec confirmé simultanés : UN seul remboursement', async () => {
    transfers.onSubmit = () => ({ kind: 'uncertain', errorCode: 'CINETPAY_TIMEOUT' });
    const [admin1, admin2] = [await player(0, 'admin'), await player(0, 'admin')];
    const A = await player(5000);
    const { withdrawal } = await pick(0).request(A.id, ok, randomUUID());
    now = new Date(now.getTime() + 25 * 60 * 60_000);
    const proposal = await pick(0).proposeRefund(withdrawal.id, admin1.id, {
      providerTicket: 'CP-RACE-1',
      justification: 'Confirmation écrite du support CinetPay reçue pour ce transfert.',
    });
    if (proposal.outcome !== 'proposed') throw new Error('proposition attendue');

    // L'approbation relit « introuvable » ; puis CinetPay publie un échec final, relu en même temps.
    const approval = pick(1).decideRefund(withdrawal.id, proposal.request.id, admin2.id, {
      approve: true,
    });
    transfers.remote.set(withdrawal.reference, {
      providerReference: `cp-${withdrawal.reference}`,
      providerStatus: 'FAILED',
    });
    const checks = Array.from({ length: 6 }, (_, i) => pick(i).check(withdrawal.id));
    await Promise.allSettled([approval, ...checks]);

    const row = (
      await sql.query<{ status: string }>('SELECT status FROM withdrawals WHERE id = $1', [
        withdrawal.id,
      ])
    ).rows[0];
    expect(row?.status).toBe('FAILED');
    expect(await balanceOf(A.id)).toBe(5000);
    await expectLedgerConsistent(A.id, 5000);
  });

  it('deux approbations simultanées de la même demande : une seule aboutit', async () => {
    transfers.onSubmit = () => ({ kind: 'uncertain', errorCode: 'CINETPAY_TIMEOUT' });
    const [admin1, admin2, admin3] = [
      await player(0, 'admin'),
      await player(0, 'admin'),
      await player(0, 'admin'),
    ];
    const A = await player(5000);
    const { withdrawal } = await pick(0).request(A.id, ok, randomUUID());
    now = new Date(now.getTime() + 25 * 60 * 60_000);
    const proposal = await pick(0).proposeRefund(withdrawal.id, admin1.id, {
      providerTicket: 'CP-RACE-2',
      justification: 'Confirmation écrite du support CinetPay reçue pour ce transfert.',
    });
    if (proposal.outcome !== 'proposed') throw new Error('proposition attendue');
    const results = await Promise.allSettled([
      pick(0).decideRefund(withdrawal.id, proposal.request.id, admin2.id, { approve: true }),
      pick(1).decideRefund(withdrawal.id, proposal.request.id, admin3.id, { approve: true }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balanceOf(A.id)).toBe(5000);
    const requests = await sql.query<{ status: string }>(
      'SELECT status FROM withdrawal_refund_requests WHERE withdrawal_id = $1',
      [withdrawal.id],
    );
    expect(requests.rows.map((r) => r.status)).toEqual(['APPROVED']);
    await expectLedgerConsistent(A.id, 5000);
  });

  it('notification et réconciliation simultanées (succès) : réglé une fois, débit définitif', async () => {
    const A = await player(5000);
    const { withdrawal } = await pick(0).request(A.id, ok, randomUUID());
    transfers.setStatus(withdrawal.reference, 'SUCCESS');
    const notification = {
      notify_token: `nt-${withdrawal.reference}`,
      merchant_transaction_id: withdrawal.reference,
      transaction_id: `cp-${withdrawal.reference}`,
    };
    const reconcilers = [0, 1].map(
      (i) =>
        new WithdrawalReconciler({
          withdrawals: pick(i),
          repository: new PostgresWithdrawalRepository(sql),
          logger,
          clock: () => new Date(now.getTime() + 5 * 60_000),
        }),
    );
    const results = await Promise.all([
      pick(0).handleNotification(notification),
      pick(1).handleNotification(notification),
      reconcilers[0]!.tick(),
      reconcilers[1]!.tick(),
      pick(0).check(withdrawal.id),
    ]);
    const settledCount =
      results.filter((r) => 'outcome' in r && r.outcome === 'settled').length +
      results.reduce((n, r) => n + ('checked' in r ? r.settled : 0), 0);
    expect(settledCount).toBeGreaterThanOrEqual(1);
    const tx = await sql.query<{ status: string }>(
      `SELECT t.status FROM wallet_transactions t JOIN withdrawals w
         ON w.wallet_transaction_id = t.id WHERE w.id = $1`,
      [withdrawal.id],
    );
    expect(tx.rows).toEqual([{ status: 'succeeded' }]);
    expect(await balanceOf(A.id)).toBe(4000);
    expect(transfers.submissions).toHaveLength(1);
    await expectLedgerConsistent(A.id, 5000);
  });

  it('redémarrage : retrait créé jamais envoyé, repris par 2 réconciliateurs simultanés → UN envoi', async () => {
    const A = await player(5000);
    const id = randomUUID();
    await repository.create({
      idempotencyKey: randomUUID(),
      withdrawal: {
        id,
        userId: A.id,
        walletTransactionId: randomUUID(),
        provider: 'cinetpay',
        operator: 'OM_CM',
        msisdnMasked: maskPhone(A.phone),
        tokens: 2000,
        amount: 2000,
        currency: 'XAF',
        status: 'CREATED',
        merchantTransactionId: `LWrestart${randomUUID().replace(/-/g, '').slice(0, 19)}`,
        submissionAttempts: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
    // Nouvelles instances (après redémarrage) : rien en mémoire, tout est relu dans PostgreSQL.
    const restarted = [makeInstance(), makeInstance()];
    const later = () => new Date(now.getTime() + 5 * 60_000);
    const reconcilers = restarted.map(
      (service) =>
        new WithdrawalReconciler({
          withdrawals: service,
          repository: new PostgresWithdrawalRepository(sql),
          logger,
          clock: later,
        }),
    );
    await Promise.all([...reconcilers.map((r) => r.tick()), restarted[0]!.check(id)]);
    expect(transfers.submissions).toHaveLength(1);
    const row = (
      await sql.query<{ status: string; submission_attempts: number }>(
        'SELECT status, submission_attempts FROM withdrawals WHERE id = $1',
        [id],
      )
    ).rows[0];
    expect(row).toEqual({ status: 'PROCESSING', submission_attempts: 1 });
    expect(await balanceOf(A.id)).toBe(3000);
    await expectLedgerConsistent(A.id, 5000);
  });

  it('échec réseau puis consultations parallèles : ni remboursement, ni second envoi', async () => {
    transfers.onSubmit = (r) => {
      // Le transfert est créé chez CinetPay, mais la réponse est perdue.
      transfers.remote.set(r.merchantTransactionId, {
        providerReference: `cp-${r.merchantTransactionId}`,
        providerStatus: 'PENDING',
      });
      return { kind: 'uncertain', errorCode: 'CINETPAY_NETWORK' };
    };
    const A = await player(5000);
    const { withdrawal } = await pick(0).request(A.id, ok, randomUUID());
    expect(withdrawal.status).toBe('CREATED');

    transfers.lookupFails = true;
    const failing = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => pick(i).check(withdrawal.id)),
    );
    expect(failing.every((r) => r.status === 'rejected')).toBe(true);
    expect(await balanceOf(A.id)).toBe(4000);

    transfers.lookupFails = false;
    now = new Date(now.getTime() + 2 * 60 * 60_000);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => pick(i).check(withdrawal.id)),
    );
    expect(results.every((r) => r.status === 'PROCESSING')).toBe(true);
    expect(transfers.submissions).toHaveLength(1);
    expect(await balanceOf(A.id)).toBe(4000);
    await expectLedgerConsistent(A.id, 5000);
  });
});
