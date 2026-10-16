import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { Tournament } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import {
  balances,
  createTournamentTestStack,
  fillWith,
  HOUR,
  seedAdmin,
  seedPlayers,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Préinscriptions aux propositions (D-108) sur un VRAI PostgreSQL : connexions réellement
 * parallèles et deux « instances » complètes qui ne partagent que la base. Couvre les
 * préinscriptions simultanées, l'approbation et le refus simultanés ou répétés, et la
 * libération des fonds : jamais de réservation, de notification ni d'audit en double.
 *
 * Exécutée seulement quand TEST_DATABASE_URL désigne une base de TEST dédiée ; jamais sur la
 * base de l'application (refus si l'URL est celle de DATABASE_URL, variable ou backend/.env).
 * Tout se passe dans un schéma temporaire, supprimé à la fin.
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

const isDedicatedTestDatabase = Boolean(url) && url !== applicationDatabaseUrl();
const describeWithPostgres = isDedicatedTestDatabase ? describe : describe.skip;
jest.setTimeout(120_000);

describeWithPostgres('Préinscriptions (D-108) sur PostgreSQL réel, deux instances', () => {
  const schema = `tournament_prereg_${randomUUID().replace(/-/g, '')}`;
  let pool: Pool;
  let sql: SqlClient;
  let instances: TournamentTestStack[] = [];
  const clock = new TestClock();

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 20, options: `-c search_path=${schema}` });
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
  });

  beforeEach(() => {
    clock.set(new Date());
    instances = [createTournamentTestStack(sql, clock), createTournamentTestStack(sql, clock)];
  });

  afterEach(async () => {
    await Promise.all(instances.map((i) => i.stop()));
    await sql.query('TRUNCATE games, users, tournaments CASCADE');
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  const [a, b] = [() => instances[0]!, () => instances[1]!];
  const on = (i: number) => (i % 2 === 0 ? a() : b());

  async function playersWith(count: number, balance: number): Promise<UserId[]> {
    return seedPlayers(
      sql,
      Array.from({ length: count }, (_, i) => `p${i}-${randomUUID()}`),
      balance,
    );
  }

  /** Proposition soumise par un joueur : en attente d'approbation, préinscriptions ouvertes. */
  async function proposal(extra = {}): Promise<{ t: Tournament; creator: UserId; admin: UserId }> {
    const [creator] = await playersWith(1, 5000);
    const admin = await seedAdmin(sql, `admin-${randomUUID()}`);
    const draft = await a().tournaments.createAsPlayer(
      creator!,
      tournamentInput(clock, 2 * HOUR, extra),
    );
    return { t: await a().tournaments.submit(draft.id, creator!), creator: creator!, admin };
  }

  const reservationStatuses = async (t: Tournament) =>
    (
      await sql.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM wallet_reservations
         WHERE tournament_id = $1 GROUP BY status ORDER BY status`,
        [t.id],
      )
    ).rows.map((r) => `${r.status}:${r.n}`);
  const count = async (query: string, params: unknown[]) =>
    Number((await sql.query<{ n: number }>(query, params)).rows[0]?.n ?? 0);
  const notifications = (t: Tournament, type: string) =>
    count(
      `SELECT count(*)::int AS n FROM notifications
       WHERE type = $2 AND payload->>'tournamentId' = $1`,
      [t.id, type],
    );
  const audits = (t: Tournament, action: string) =>
    count(
      `SELECT count(*)::int AS n FROM admin_audit_log WHERE target_id = $1 AND action = $2`,
      [t.id, action],
    );
  const reservedTotal = async (players: readonly UserId[]) =>
    (await Promise.all(players.map((p) => balances(sql, p)))).reduce((s, x) => s + x.reserved, 0);

  it('préinscriptions simultanées : capacité respectée, une réservation par inscrit', async () => {
    const { t } = await proposal({ maximumPlayers: 20 });
    await fillWith(a(), sql, t.id, 17);
    const players = await playersWith(8, 5000);
    const results = await Promise.allSettled(
      players.map((p, i) => on(i).tournaments.register(t.id, p)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason.name).toBe('TournamentFullError');
    }
    expect(await reservationStatuses(t)).toEqual(['ACTIVE:20']);
    expect(await reservedTotal(players)).toBe(3000);
  });

  it('même joueur, préinscription simultanée sur deux instances : une seule réservation', async () => {
    const { t } = await proposal();
    const [p] = await playersWith(1, 5000);
    const results = await Promise.allSettled([0, 1, 2].map((i) => on(i).tournaments.register(t.id, p!)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balances(sql, p!)).toEqual({ balance: 5000, reserved: 1000, available: 4000 });
    expect(await notifications(t, 'TOURNAMENT_REGISTRATION_CONFIRMED')).toBe(1);
  });

  it('double approbation simultanée : une seule publication, préinscriptions intactes', async () => {
    const { t, admin } = await proposal();
    const players = await playersWith(3, 5000);
    for (const p of players) await a().tournaments.register(t.id, p);

    const results = await Promise.allSettled([
      a().tournaments.approve(t.id, admin),
      b().tournaments.approve(t.id, admin),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.name).toBe('InvalidTournamentTransitionError');
    expect((await a().repository.findById(t.id))?.status).toBe('REGISTRATION_OPEN');
    expect(await reservationStatuses(t)).toEqual(['ACTIVE:3']);
    expect(await reservedTotal(players)).toBe(3000);
    // Créateur + 3 préinscrits, une fois chacun ; un seul audit.
    expect(await notifications(t, 'TOURNAMENT_APPROVED')).toBe(4);
    expect(await audits(t, 'TOURNAMENT_APPROVED')).toBe(1);
  });

  it('refus répétés simultanés : fonds libérés une fois, une notification et un audit', async () => {
    const { t, admin } = await proposal();
    const players = await playersWith(3, 5000);
    for (const p of players) await a().tournaments.register(t.id, p);

    const results = await Promise.allSettled(
      [0, 1, 2, 3].map((i) => on(i).tournaments.reject(t.id, admin)),
    );

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await reservationStatuses(t)).toEqual(['RELEASED:3']);
    for (const p of players) {
      expect(await balances(sql, p)).toEqual({ balance: 5000, reserved: 0, available: 5000 });
    }
    expect(await notifications(t, 'TOURNAMENT_CANCELLED')).toBe(4);
    expect(await audits(t, 'TOURNAMENT_REJECTED')).toBe(1);
  });

  it('approbation et refus simultanés : un seul gagne, état financier cohérent', async () => {
    const { t, admin } = await proposal();
    const players = await playersWith(2, 5000);
    for (const p of players) await a().tournaments.register(t.id, p);

    const [approve, reject] = await Promise.allSettled([
      a().tournaments.approve(t.id, admin),
      b().tournaments.reject(t.id, admin),
    ]);

    expect([approve!.status, reject!.status].filter((s) => s === 'fulfilled')).toHaveLength(1);
    const status = (await a().repository.findById(t.id))?.status;
    if (status === 'CANCELLED') {
      expect(await reservationStatuses(t)).toEqual(['RELEASED:2']);
      expect(await reservedTotal(players)).toBe(0);
    } else {
      expect(status).toBe('REGISTRATION_OPEN');
      expect(await reservationStatuses(t)).toEqual(['ACTIVE:2']);
      expect(await reservedTotal(players)).toBe(2000);
    }
  });

  it('préinscriptions pendant le refus : jamais une réservation active sur une proposition refusée', async () => {
    const { t, admin } = await proposal();
    const players = await playersWith(6, 5000);
    const results = await Promise.allSettled([
      ...players.map((p, i) => on(i).tournaments.register(t.id, p)),
      b().tournaments.reject(t.id, admin),
    ]);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason.name).toBe('TournamentRegistrationClosedError');
    }
    expect((await a().repository.findById(t.id))?.status).toBe('CANCELLED');
    expect(await reservationStatuses(t)).not.toContainEqual(expect.stringMatching(/^ACTIVE/));
    expect(await reservedTotal(players)).toBe(0);
  });

  it('retrait par le créateur et annulation admin simultanés : une seule libération', async () => {
    const { t, creator, admin } = await proposal();
    const players = await playersWith(2, 5000);
    for (const p of players) await a().tournaments.register(t.id, p);

    const results = await Promise.allSettled([
      a().tournaments.cancel(t.id, { userId: creator, isAdmin: false }),
      b().tournaments.cancel(t.id, { userId: admin, isAdmin: true }),
      a().tournaments.cancel(t.id, { userId: creator, isAdmin: false }),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await reservationStatuses(t)).toEqual(['RELEASED:2']);
    expect(await reservedTotal(players)).toBe(0);
    expect(await notifications(t, 'TOURNAMENT_CANCELLED')).toBe(2);
  });

  it('expiration à l’heure de début, avancée par les deux instances : rien n’est capturé', async () => {
    const { t } = await proposal();
    const players = await playersWith(2, 5000);
    for (const p of players) await a().tournaments.register(t.id, p);
    await fillWith(a(), sql, t.id);
    clock.set(t.startsAt);

    await Promise.all([a().tournaments.advance(t.id), b().tournaments.advance(t.id)]);

    expect((await a().repository.findById(t.id))?.status).toBe('CANCELLED');
    expect(await reservationStatuses(t)).toEqual(['RELEASED:20']);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM tournament_player_accounts WHERE tournament_id = $1`,
        [t.id],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM wallet_transactions WHERE kind = 'tournament_entry'
         AND user_id = ANY($1::uuid[])`,
        [players],
      ),
    ).toBe(0);
  });

  it('D-113 : soumissions simultanées sur deux instances pour la dernière place : une seule', async () => {
    const admin = await seedAdmin(sql, `admin-${randomUUID()}`);
    for (let i = 0; i < 4; i += 1) {
      await a().tournaments.createAsAdmin(admin, tournamentInput(clock, 2 * HOUR + i * 3 * HOUR));
    }
    const creators = await playersWith(4, 5000);
    const drafts = await Promise.all(
      creators.map((c, i) =>
        a().tournaments.createAsPlayer(c, tournamentInput(clock, 14 * HOUR + i * 3 * HOUR)),
      ),
    );
    const outcomes = await Promise.allSettled(
      drafts.map((d, i) => on(i).tournaments.submit(d.id, creators[i]!)),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM tournaments
         WHERE status IN ('SCHEDULED', 'REGISTRATION_OPEN', 'PENDING_APPROVAL')`,
        [],
      ),
    ).toBe(5);
  });

  it('D-113 : premières préinscriptions simultanées sur deux instances : figées une fois', async () => {
    const { t } = await proposal();
    const players = await playersWith(6, 5000);
    await Promise.all(players.map((p, i) => on(i).tournaments.register(t.id, p)));
    const frozen = await a().repository.findById(t.id);
    expect(frozen?.tokenSetupFrozenAt).toBeInstanceOf(Date);
    expect(await reservationStatuses(t)).toEqual(['ACTIVE:6']);
  });
});

if (!isDedicatedTestDatabase) {
  // Rend l'absence de configuration visible dans la sortie de Jest (jamais un faux succès).
  describe.skip(`Préinscriptions sur PostgreSQL réel : IGNORÉ — ${
    url ? 'TEST_DATABASE_URL est la base de l’application' : 'TEST_DATABASE_URL non défini'
  }`, () => {
    it('non exécuté', () => undefined);
  });
}
