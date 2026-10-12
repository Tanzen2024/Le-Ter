import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { UserId } from '../../../src/domain/users/user';
import { createPlatformFinanceServices } from '../../../src/services/platform-finance/create-platform-finance-services';
import type { TreasuryGateway } from '../../../src/services/platform-finance/treasury.gateway';
import type {
  TransferGateway,
  TransferLookup,
  TransferRequest,
  TransferSubmission,
} from '../../../src/services/withdrawals/transfer.gateway';
import { createLogger } from '../../../src/utils/logger';

/**
 * Retraits de la plateforme (D-078) sur un VRAI PostgreSQL : connexions parallèles (pool de
 * 20) et deux « instances » qui ne partagent que la base. Le verrou `LOCK TABLE … SHARE ROW
 * EXCLUSIVE` (approbations) et la revendication conditionnelle des envois (exécuteurs) sont
 * ici réellement mis en concurrence, ce que PGlite (une transaction à la fois) ne fait pas.
 *
 * Passerelles SIMULÉES (aucun appel réseau, aucun transfert réel). Exécuté seulement si
 * TEST_DATABASE_URL désigne une base de TEST distincte de DATABASE_URL ; schéma temporaire
 * supprimé à la fin.
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
    return true;
  }
}

const describeWithPostgres =
  url && !sameDatabase(url, applicationDatabaseUrl()) ? describe : describe.skip;
jest.setTimeout(120_000);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

class SharedFakeTransfers implements TransferGateway {
  canSubmit = true;
  canLookup = true;
  readonly submissions: TransferRequest[] = [];
  readonly remote = new Map<
    string,
    { providerReference: string; providerStatus: string; amount: number }
  >();
  async submit(r: TransferRequest): Promise<TransferSubmission> {
    this.submissions.push(r);
    await pause(randomInt(1, 20));
    this.remote.set(r.merchantTransactionId, {
      providerReference: `cp-${r.merchantTransactionId}`,
      providerStatus: 'PENDING',
      amount: r.amount,
    });
    return {
      kind: 'accepted',
      providerReference: `cp-${r.merchantTransactionId}`,
      providerStatus: 'PENDING',
    };
  }
  async lookup(id: string): Promise<TransferLookup> {
    await pause(randomInt(1, 10));
    const remote = this.remote.get(id);
    return remote
      ? { found: true, merchantTransactionId: id, currency: 'XAF', ...remote }
      : { found: false };
  }
}

const treasury: TreasuryGateway = {
  configured: true,
  environment: 'test',
  readBalance: () => Promise.resolve({ availableBalance: '1000000', currency: 'XAF' }),
};

describeWithPostgres('Retraits de la plateforme sur PostgreSQL réel', () => {
  const schema = `platform_payout_test_${randomUUID().replace(/-/g, '')}`;
  const logger = createLogger({}, () => undefined);
  let pool: Pool;
  let sql: SqlClient;
  let transfers: SharedFakeTransfers;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 20, options: `-c search_path=${schema}` });
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  const instance = () =>
    createPlatformFinanceServices({
      sql,
      logger,
      env: { enabled: false, fees: { bps: 100, fixed: 0 } },
      transferAvailability: { mode: 'sandbox', warnings: [] },
      transfers,
      treasuryGateway: treasury,
      execution: { enabled: true, mode: 'sandbox' },
    });

  async function user(role: 'user' | 'admin') {
    const id = randomUUID() as UserId;
    await sql.query(
      `INSERT INTO users (id, first_name, last_name, email, username, phone, password_hash, role, created_at, updated_at)
       VALUES ($1, 'Test', 'Plateforme', $2, $3, $4, 'not-a-real-hash', $5, now(), now())`,
      [
        id,
        `${id}@test.local`,
        `p_${id.slice(0, 8)}`,
        `+2376${String(randomInt(0, 99_999_999)).padStart(8, '0')}`,
        role,
      ],
    );
    return id;
  }

  /** Recettes 100 000, joueurs 300 000, solde relu 1 000 000 : plafond = 100 000. */
  async function seed() {
    transfers = new SharedFakeTransfers();
    const a = await user('admin');
    const b = await user('admin');
    const player = await user('user');
    await sql.query(
      `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, 300000, now(), now())`,
      [player],
    );
    const sessionId = randomUUID();
    const gameId = randomUUID();
    await sql.query(
      `INSERT INTO sessions (id, version, status, creator_id, created_at, updated_at, max_players) VALUES ($1, 1, 'open', $2, now(), now(), 2)`,
      [sessionId, a],
    );
    await sql.query(
      `INSERT INTO games (id, version, status, creator_id, max_players, state, created_at, updated_at, session_id, first_player_id)
       VALUES ($1, 1, 'waiting', $2, 2, '{}', now(), now(), $3, $2)`,
      [gameId, a, sessionId],
    );
    await sql.query(
      `INSERT INTO platform_ledger (id, game_id, kind, amount, fee_bps, currency, created_at) VALUES ($1, $2, 'GAME_COMMISSION', 100000, 500, 'XAF', now())`,
      [randomUUID(), gameId],
    );
    const beneficiaryId = randomUUID();
    await sql.query(
      `INSERT INTO platform_payout_beneficiaries (id, label, operator, msisdn, msisdn_masked, status, created_by, created_at, verified_by, verified_at)
       VALUES ($1, 'Compte MTN', 'MTN_CM', $2, '+2376** *** *00', 'ACTIVE', $3, now(), $4, now())`,
      [beneficiaryId, `+2376${String(randomInt(0, 99_999_999)).padStart(8, '0')}`, a, b],
    );
    const services = [instance(), instance()] as const;
    await services[0].treasury.observe();
    return { a, b, beneficiaryId, services };
  }

  it('approbations simultanées sur deux instances : la réservation ne dépasse jamais le plafond', async () => {
    const { a, b, beneficiaryId, services } = await seed();
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const { payout } = await services[0].payouts.create(
        a as UserId,
        { beneficiaryId, amount: 30_000, purpose: 'Concurrence' },
        randomUUID(),
      );
      ids.push(payout.id);
    }
    const results = await Promise.allSettled(
      ids.map((id, i) => services[i % 2]!.payouts.approve(b as UserId, id)),
    );
    const approved = results.filter((r) => r.status === 'fulfilled').length;
    expect(approved).toBe(3); // 3 × 30 300 ≤ 100 000 < 4 × 30 300
    const { rows } = await sql.query<{ reserved: string }>(
      `SELECT COALESCE(sum(amount + estimated_fee), 0)::text AS reserved FROM platform_payouts WHERE status = 'RESERVED'`,
    );
    expect(Number(rows[0]!.reserved)).toBeLessThanOrEqual(100_000);
  });

  it('deux exécuteurs simultanés : chaque retrait envoyé exactement une fois', async () => {
    const { a, b, beneficiaryId, services } = await seed();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { payout } = await services[0].payouts.create(
        a as UserId,
        { beneficiaryId, amount: 5_000, purpose: 'Concurrence' },
        randomUUID(),
      );
      await services[0].payouts.approve(b as UserId, payout.id);
      await services[0].payouts.release(b as UserId, payout.id);
      ids.push(payout.id);
    }
    await Promise.all([
      services[0].payouts.executeReady(10),
      services[1].payouts.executeReady(10),
      services[0].executor.tick(),
      services[1].executor.tick(),
    ]);
    const references = transfers.submissions.map((s) => s.merchantTransactionId);
    expect(new Set(references).size).toBe(references.length);
    expect(references).toHaveLength(4);
    const { rows } = await sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_payouts WHERE id = ANY($1) AND submission_attempts = 1`,
      [ids],
    );
    expect(rows[0]!.n).toBe(4);
  });
});
