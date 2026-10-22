import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Pool, type PoolClient } from 'pg';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { Tournament } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import {
  balances,
  createTournamentTestStack,
  fillWith,
  HOUR,
  saveTournamentSettings,
  seedAdmin,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Validation finale D-112 sur un VRAI PostgreSQL : verrous et transactions réels entre plusieurs
 * instances (connexions réellement parallèles), reprises après interruption (transaction
 * annulée, connexion tuée en pleine transaction), contrainte différée « gain hors plan ».
 *
 * SÉCURITÉ : exécutée seulement si TEST_DATABASE_URL désigne une base dont le NOM est exactement
 * `le_ter_test`, différente de DATABASE_URL (variable ou backend/.env). Tout se passe dans un
 * schéma temporaire supprimé à la fin ; la base de l'application n'est jamais ouverte.
 *
 * Cagnotte : 20 × 1 000 = 20 000 ; commission 10 % = 2 000 ; distribuable 18 000 →
 * 9 000 / 5 400 / 3 600.
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

function databaseName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\//, ''));
  } catch {
    return undefined;
  }
}

const isDedicatedTestDatabase =
  Boolean(url) && url !== applicationDatabaseUrl() && databaseName(url) === 'le_ter_test';
const describeWithPostgres = isDedicatedTestDatabase ? describe : describe.skip;
jest.setTimeout(240_000);

describeWithPostgres('D-112 sur PostgreSQL réel : versements concurrents et reprises', () => {
  const schema = `tournament_payouts_${randomUUID().replace(/-/g, '')}`;
  let pool: Pool;
  let sql: SqlClient;
  let instances: TournamentTestStack[] = [];
  const clock = new TestClock();

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 1 });
    // Garde-fou supplémentaire : la base réellement ouverte est bien la base de test.
    const { rows } = await admin.query<{ db: string }>('SELECT current_database() AS db');
    if (rows[0]?.db !== 'le_ter_test') {
      await admin.end();
      throw new Error(`Base inattendue (${rows[0]?.db}) : exécution refusée`);
    }
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 30, options: `-c search_path=${schema}` });
    // Une connexion est tuée volontairement (scénario d’interruption) : jamais d’erreur
    // non gérée du pool, la transaction concernée échoue normalement.
    pool.on('error', () => undefined);
    pool.on('connect', (client) => client.on('error', () => undefined));
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
  });

  beforeEach(async () => {
    clock.set(new Date());
    instances = [0, 1, 2].map(() => createTournamentTestStack(sql, clock));
    await saveTournamentSettings(sql);
  });

  afterEach(async () => {
    await Promise.all(instances.map((i) => i.stop()));
    await sql.query('DROP FUNCTION IF EXISTS test_prize_fault() CASCADE');
    await sql.query('TRUNCATE games, users, tournaments CASCADE');
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  const a = () => instances[0]!;
  const rows = async <T extends object>(text: string, params: unknown[] = []) =>
    (await sql.query<T>(text, params)).rows;

  /** Tournoi démarré (20 inscrits, prix capturés), horloge à la fin. */
  async function endedTournament(): Promise<Tournament> {
    const admin = await seedAdmin(sql, `admin-${randomUUID()}`);
    const t = await a().tournaments.createAsAdmin(admin, tournamentInput(clock, HOUR));
    await fillWith(a(), sql, t.id);
    clock.set(t.startsAt);
    await a().tournaments.advance(t.id);
    clock.set(t.endsAt);
    return t;
  }

  /** Classement publié, versements bloqués (écriture de commission altérée) : plan lisible. */
  async function heldAtPlan(t: Tournament) {
    await sql.query(
      `UPDATE platform_ledger SET amount = amount + 1
       WHERE tournament_id = $1 AND kind = 'TOURNAMENT_PLATFORM_FEE'`,
      [t.id],
    );
    await a().tournaments.advance(t.id);
    const plan = (await a().tournaments.payoutReport(t.id)).payouts;
    expect(plan.map((p) => p.amount)).toEqual([9_000, 5_400, 3_600]);
    return {
      plan,
      release: () =>
        sql.query(
          `UPDATE platform_ledger SET amount = amount - 1
           WHERE tournament_id = $1 AND kind = 'TOURNAMENT_PLATFORM_FEE'`,
          [t.id],
        ),
    };
  }

  /** Bilan financier observable : transactions de gain, lignes du plan, notifications. */
  async function ledger(t: Tournament) {
    const [prizes, credited, notices] = await Promise.all([
      rows<{ user_id: string; tokens: string; idempotency_key: string; id: string }>(
        `SELECT id, user_id, tokens, idempotency_key FROM wallet_transactions
         WHERE kind = 'tournament_prize' AND idempotency_key LIKE $1 ORDER BY idempotency_key`,
        [`tournament-prize:${t.id}:%`],
      ),
      rows<{ rank: number; wallet_transaction_id: string; status: string; attempts: number }>(
        `SELECT rank, wallet_transaction_id, status, attempts FROM tournament_payouts
         WHERE tournament_id = $1 ORDER BY rank`,
        [t.id],
      ),
      rows<{ rank: string; n: number }>(
        `SELECT payload->>'rank' AS rank, count(*)::int AS n FROM notifications
         WHERE type = 'TOURNAMENT_PRIZE_CREDITED' AND payload->>'tournamentId' = $1
         GROUP BY 1 ORDER BY 1`,
        [t.id],
      ),
    ]);
    return { prizes, credited, notices };
  }

  /** Aucune divergence : chaque CREDITED pointe une transaction du bon montant, et réciproquement. */
  async function expectConsistent(t: Tournament) {
    const { prizes, credited } = await ledger(t);
    const plan = (await a().tournaments.payoutReport(t.id)).payouts;
    for (const p of plan) {
      const tx = prizes.filter((x) => x.idempotency_key === p.idempotencyKey);
      if (p.status === 'CREDITED') {
        expect(tx).toHaveLength(1);
        expect(Number(tx[0]!.tokens)).toBe(p.amount);
        expect(tx[0]!.id).toBe(p.walletTransactionId);
      } else {
        expect(tx).toEqual([]);
      }
    }
    expect(prizes).toHaveLength(credited.filter((c) => c.status === 'CREDITED').length);
  }

  /** Connexions de CE schéma en attente d'un verrou (preuve d'un verrouillage réel). */
  const lockWaiters = async () =>
    Number(
      (
        await rows<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        )
      )[0]?.n ?? 0,
    );

  async function untilWaiters(min: number) {
    for (let i = 0; i < 100; i += 1) {
      if ((await lockWaiters()) >= min) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`moins de ${min} transactions en attente de verrou`);
  }

  it('A/B — trois instances paient en même temps, verrou du tournoi tenu : un seul crédit par gagnant', async () => {
    const t = await endedTournament();
    const { plan, release } = await heldAtPlan(t);
    await release();
    const before = new Map<string, number>();
    for (const p of plan) {
      before.set(p.playerId, (await balances(sql, p.playerId as UserId)).balance);
    }
    // Une connexion tient la ligne du tournoi : les trois instances DOIVENT attendre.
    const holder: PoolClient = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [t.id]);
      const runs = instances.map((i) => i.tournaments.advance(t.id));
      await untilWaiters(3);
      await holder.query('COMMIT');
      await Promise.all(runs);
    } finally {
      holder.release();
    }
    expect((await a().repository.findById(t.id))!.status).toBe('COMPLETED');
    const { prizes, notices } = await ledger(t);
    expect(prizes).toHaveLength(3);
    expect(notices).toEqual([
      { rank: '1', n: 1 },
      { rank: '2', n: 1 },
      { rank: '3', n: 1 },
    ]);
    for (const p of plan) {
      expect((await balances(sql, p.playerId as UserId)).balance).toBe(
        before.get(p.playerId)! + p.amount,
      );
    }
    const total = prizes.reduce((s, p) => s + Number(p.tokens), 0);
    expect(total).toBe(18_000);
    await expectConsistent(t);
  });

  it('C — deux workers reprennent le même versement FAILED en même temps : un seul crédit', async () => {
    const t = await endedTournament();
    const { plan, release } = await heldAtPlan(t);
    const second = plan[1]!;
    await sql.query(
      `CREATE OR REPLACE FUNCTION test_prize_fault() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.kind = 'tournament_prize' AND NEW.user_id = '${second.playerId}' THEN
           RAISE EXCEPTION 'panne simulée du compte de jeu';
         END IF;
         RETURN NEW;
       END; $$`,
    );
    await sql.query(
      `CREATE TRIGGER test_prize_fault BEFORE INSERT ON wallet_transactions
       FOR EACH ROW EXECUTE FUNCTION test_prize_fault()`,
    );
    await release();
    await a().tournaments.advance(t.id);
    expect((await ledger(t)).credited.map((c) => [c.rank, c.status, c.attempts])).toEqual([
      [1, 'CREDITED', 1],
      [2, 'FAILED', 1],
      [3, 'CREDITED', 1],
    ]);
    // Avant 60 s : aucune nouvelle tentative, même avec trois workers.
    await Promise.all(instances.map((i) => i.tournaments.advance(t.id)));
    expect((await ledger(t)).credited[1]).toMatchObject({ status: 'FAILED', attempts: 1 });

    await sql.query('DROP FUNCTION test_prize_fault() CASCADE');
    clock.advance(61_000);
    const before = (await balances(sql, second.playerId as UserId)).balance;
    await Promise.all(instances.flatMap((i) => [i.tournaments.advance(t.id), i.scheduler.tick()]));
    const { credited, prizes, notices } = await ledger(t);
    expect(credited[1]).toMatchObject({ status: 'CREDITED', attempts: 2 });
    expect(prizes).toHaveLength(3);
    expect(notices.find((n) => n.rank === '2')).toEqual({ rank: '2', n: 1 });
    expect((await balances(sql, second.playerId as UserId)).balance).toBe(before + 5_400);
    expect((await a().repository.findById(t.id))!.status).toBe('COMPLETED');
    await expectConsistent(t);
  });

  it('D — clôtures concurrentes : COMPLETED une fois, jamais avec un versement non crédité', async () => {
    const t = await endedTournament();
    const { plan, release } = await heldAtPlan(t);
    await sql.query(
      `CREATE OR REPLACE FUNCTION test_prize_fault() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.kind = 'tournament_prize' AND NEW.user_id = '${plan[2]!.playerId}' THEN
           RAISE EXCEPTION 'panne simulée du compte de jeu';
         END IF;
         RETURN NEW;
       END; $$`,
    );
    await sql.query(
      `CREATE TRIGGER test_prize_fault BEFORE INSERT ON wallet_transactions
       FOR EACH ROW EXECUTE FUNCTION test_prize_fault()`,
    );
    await release();
    await Promise.all(instances.map((i) => i.tournaments.advance(t.id)));
    expect((await a().repository.findById(t.id))!.status).toBe('DISTRIBUTING_PRIZES');
    // Même une écriture directe ne peut pas finaliser.
    await expect(
      sql.query(`UPDATE tournaments SET status = 'COMPLETED' WHERE id = $1`, [t.id]),
    ).rejects.toThrow(/versements non crédités/);

    await sql.query('DROP FUNCTION test_prize_fault() CASCADE');
    clock.advance(61_000);
    await Promise.all(instances.map((i) => i.tournaments.advance(t.id)));
    expect((await a().repository.findById(t.id))!.status).toBe('COMPLETED');
    const results = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
       WHERE type = 'TOURNAMENT_RESULTS_AVAILABLE' AND payload->>'tournamentId' = $1`,
      [t.id],
    );
    expect(results[0]!.n).toBe(20);
    expect((await ledger(t)).prizes).toHaveLength(3);
    await expectConsistent(t);
  });

  it('E — incohérence apparue pendant la distribution : aucun crédit de plus, clôture bloquée, motif visible', async () => {
    const t = await endedTournament();
    const { plan, release } = await heldAtPlan(t);
    await sql.query(
      `CREATE OR REPLACE FUNCTION test_prize_fault() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.kind = 'tournament_prize' AND NEW.user_id = '${plan[1]!.playerId}' THEN
           RAISE EXCEPTION 'panne simulée du compte de jeu';
         END IF;
         RETURN NEW;
       END; $$`,
    );
    await sql.query(
      `CREATE TRIGGER test_prize_fault BEFORE INSERT ON wallet_transactions
       FOR EACH ROW EXECUTE FUNCTION test_prize_fault()`,
    );
    await release();
    await a().tournaments.advance(t.id);
    await sql.query('DROP FUNCTION test_prize_fault() CASCADE');
    await sql.query(
      `UPDATE platform_ledger SET amount = amount + 7
       WHERE tournament_id = $1 AND kind = 'TOURNAMENT_PLATFORM_FEE'`,
      [t.id],
    );
    clock.advance(61_000);
    await Promise.all(instances.map((i) => i.tournaments.advance(t.id)));
    const blocked = await a().tournaments.payoutReport(t.id);
    expect(blocked.financialState).toBe('BLOCKED');
    expect(blocked.blockReasons).toContain('TOURNAMENT_FEE_ENTRY_MISMATCH');
    expect((await ledger(t)).prizes).toHaveLength(2);
    expect((await a().repository.findById(t.id))!.status).toBe('DISTRIBUTING_PRIZES');
    await expectConsistent(t);
  });

  it('interruption — connexion tuée EN PLEINE transaction de crédit : rien n’est écrit, reprise unique', async () => {
    const t = await endedTournament();
    const { plan, release } = await heldAtPlan(t);
    await release();
    const first = plan[0]!;
    const before = (await balances(sql, first.playerId as UserId)).balance;
    // Le portefeuille du 1er gagnant est tenu ailleurs : la transaction de crédit (qui détient
    // déjà les verrous du tournoi et du plan) attend, puis sa connexion est TUÉE (crash).
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE', [first.playerId]);
      const run = a()
        .tournaments.advance(t.id)
        .then(
          () => 'terminé',
          (err: Error) => err.message,
        );
      await untilWaiters(1);
      const killed = await holder.query<{ n: number }>(
        `SELECT count(pg_terminate_backend(pid))::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      expect(killed.rows[0]!.n).toBeGreaterThanOrEqual(1);
      await holder.query('ROLLBACK');
      await run;
    } finally {
      holder.release();
    }
    // Aucune trace du crédit interrompu.
    expect(
      await rows(`SELECT 1 FROM wallet_transactions WHERE idempotency_key = $1`, [
        first.idempotencyKey,
      ]),
    ).toEqual([]);
    expect((await balances(sql, first.playerId as UserId)).balance).toBe(before);
    expect((await ledger(t)).notices.find((n) => n.rank === '1')).toBeUndefined();

    // « Redémarrage » : nouvelles instances, un seul crédit.
    await Promise.all(instances.map((i) => i.stop()));
    instances = [0, 1].map(() => createTournamentTestStack(sql, clock));
    clock.advance(61_000);
    await Promise.all(instances.map((i) => i.tournaments.advance(t.id)));
    expect((await a().repository.findById(t.id))!.status).toBe('COMPLETED');
    expect((await balances(sql, first.playerId as UserId)).balance).toBe(before + first.amount);
    expect((await ledger(t)).prizes).toHaveLength(3);
    await expectConsistent(t);
  });

  it('interruption — panne après le crédit, avant le passage CREDITED (rollback) : aucun crédit fantôme', async () => {
    const t = await endedTournament();
    const { plan, release } = await heldAtPlan(t);
    const first = plan[0]!;
    const before = (await balances(sql, first.playerId as UserId)).balance;
    await sql.query(
      `CREATE OR REPLACE FUNCTION test_prize_fault() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.status = 'CREDITED' AND NEW.rank = 1 THEN
           RAISE EXCEPTION 'crash simulé après le crédit';
         END IF;
         RETURN NEW;
       END; $$`,
    );
    await sql.query(
      `CREATE TRIGGER test_prize_fault BEFORE UPDATE ON tournament_payouts
       FOR EACH ROW EXECUTE FUNCTION test_prize_fault()`,
    );
    await release();
    await a().tournaments.advance(t.id);
    expect((await balances(sql, first.playerId as UserId)).balance).toBe(before);
    expect((await ledger(t)).credited[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
    await expectConsistent(t);

    await sql.query('DROP FUNCTION test_prize_fault() CASCADE');
    clock.advance(61_000);
    await Promise.all(instances.map((i) => i.tournaments.advance(t.id)));
    expect((await balances(sql, first.playerId as UserId)).balance).toBe(before + first.amount);
    expect((await ledger(t)).prizes).toHaveLength(3);
    await expectConsistent(t);
  });

  it('contrainte différée réelle : un gain hors plan est refusé au COMMIT, avec son crédit', async () => {
    const t = await endedTournament();
    const { plan } = await heldAtPlan(t);
    const player = plan[0]!.playerId;
    const before = (await balances(sql, player as UserId)).balance;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
           created_at, updated_at, completed_at)
         VALUES ($1, $2, 'tournament_prize', 'succeeded', 9000, 'hors-plan', now(), now(), now())`,
        [randomUUID(), player],
      );
      await client.query('UPDATE wallets SET balance = balance + 9000 WHERE user_id = $1', [
        player,
      ]);
      await expect(client.query('COMMIT')).rejects.toThrow(/sans ligne créditée du plan/);
    } finally {
      client.release();
    }
    expect((await balances(sql, player as UserId)).balance).toBe(before);
  });
});

describeWithPostgres(
  'D-112 sur PostgreSQL réel : migration 0045 sur des données existantes',
  () => {
    const MIGRATION = '0045_tournament_payouts.sql';
    const schema = `tournament_payouts_mig_${randomUUID().replace(/-/g, '')}`;
    let pool: Pool;
    let sql: SqlClient;

    beforeAll(async () => {
      const admin = new Pool({ connectionString: url, max: 1 });
      const { rows } = await admin.query<{ db: string }>('SELECT current_database() AS db');
      if (rows[0]?.db !== 'le_ter_test') {
        await admin.end();
        throw new Error(`Base inattendue (${rows[0]?.db}) : exécution refusée`);
      }
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.end();
      pool = new Pool({ connectionString: url, max: 5, options: `-c search_path=${schema}` });
      sql = createPgSqlClient(pool);
    });
    afterAll(async () => {
      await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool?.end();
    });

    it('plans rattrapés avec l’état réel, aucune écriture de compte ni notification, migrateur idempotent', async () => {
      const all = await loadMigrations();
      await runMigrations(
        sql,
        all.filter((m) => m.name < MIGRATION),
      );
      const [ana, ben] = await seedAdmin(sql, 'ana').then(async (anaId) => [
        anaId,
        await seedAdmin(sql, 'ben'),
      ]);
      const paying = randomUUID();
      await sql.query(
        `INSERT INTO tournaments (game_type, id, status, starts_at, ends_at, entry_fee, minimum_players,
         platform_fee_bps, published_at, blocked_until, registration_closes_at, started_at,
         results_at, ranking_method, settlement_rule, created_at, updated_at)
       VALUES ('TER', $1, 'DISTRIBUTING_PRIZES', '2026-10-11T17:00:00Z', '2026-10-11T18:00:00Z', 500, 20,
         1000, now(), '2026-10-11T18:00:00Z', '2026-10-11T17:00:00Z', '2026-10-11T17:00:00Z',
         '2026-10-11T18:00:00Z', 'D106_CAPITAL_RATIO', 'D054_TAPIS', now(), now())`,
        [paying],
      );
      const prizeTx = randomUUID();
      await sql.query(
        `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
         created_at, updated_at, completed_at)
       VALUES ($1, $2, 'tournament_prize', 'succeeded', 900, $3, now(), now(), now())`,
        [prizeTx, ana, `tournament-prize:${paying}:1`],
      );
      for (const [rank, player, tx] of [
        [1, ana, prizeTx],
        [2, ben, null],
      ] as const) {
        await sql.query(
          `INSERT INTO tournament_results (tournament_id, rank, player_id, initial_tokens,
           remaining_tokens, games_played, games_won, prize_share_bps, prize_amount, created_at,
           prize_transaction_id, paid_at)
         VALUES ($1, $2, $3, 1000, 1000, 0, 0, 5000, 900, now(), $4, $5)`,
          [paying, rank, player, tx, tx ? new Date() : null],
        );
      }
      const snapshot = async () =>
        (
          await sql.query<{ tx: number; notices: number; balance: string }>(
            `SELECT (SELECT count(*)::int FROM wallet_transactions) AS tx,
                  (SELECT count(*)::int FROM notifications) AS notices,
                  (SELECT COALESCE(sum(balance), 0)::text FROM wallets) AS balance`,
          )
        ).rows[0];
      const before = await snapshot();
      expect(
        await runMigrations(
          sql,
          all.filter((m) => m.name <= MIGRATION),
        ),
      ).toEqual([MIGRATION]);
      expect(
        await runMigrations(
          sql,
          all.filter((m) => m.name <= MIGRATION),
        ),
      ).toEqual([]);
      expect(await snapshot()).toEqual(before);
      const plan = await sql.query<{ rank: number; status: string; n: number }>(
        `SELECT rank, status, count(*) OVER ()::int AS n FROM tournament_payouts
       WHERE tournament_id = $1 ORDER BY rank`,
        [paying],
      );
      expect(plan.rows.map((r) => [r.rank, r.status])).toEqual([
        [1, 'CREDITED'],
        [2, 'PENDING'],
      ]);
      await expect(
        sql.query(`UPDATE tournaments SET status = 'COMPLETED' WHERE id = $1`, [paying]),
      ).rejects.toThrow(/versements non crédités/);
    });
  },
);
