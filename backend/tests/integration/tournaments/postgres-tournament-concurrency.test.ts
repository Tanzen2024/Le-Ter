import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { PlayerId } from '../../../src/domain/game/game-id';
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
 * Tournois (D-054, D-055) sur un VRAI PostgreSQL : connexions réellement parallèles et deux
 * « instances » complètes (GameService, SessionService, TournamentService distincts) qui ne
 * partagent que la base. Couvre l'inscription avec réservation et l'attribution des tables.
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

describeWithPostgres('Tournois sur PostgreSQL réel (concurrence, plusieurs instances)', () => {
  const schema = `tournament_test_${randomUUID().replace(/-/g, '')}`;
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

  async function published(extra = {}) {
    const admin = await seedAdmin(sql, `admin-${randomUUID()}`);
    return a().tournaments.createAsAdmin(admin, tournamentInput(clock, HOUR, extra));
  }

  async function playersWith(count: number, balance: number): Promise<UserId[]> {
    return seedPlayers(
      sql,
      Array.from({ length: count }, (_, i) => `p${i}-${randomUUID()}`),
      balance,
    );
  }

  it('créations simultanées sur deux instances : jamais plus de 5 tournois en attente (D-059)', async () => {
    const admin = await seedAdmin(sql, `admin-${randomUUID()}`);
    const slot = (i: number) => {
      const startsIn = HOUR + i * 3 * HOUR;
      return tournamentInput(clock, startsIn, {
        endsAt: new Date(clock.now().getTime() + startsIn + HOUR),
      });
    };
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 === 0 ? a() : b()).tournaments.createAsAdmin(admin, slot(i)),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason.name).toBe('TooManyWaitingTournamentsError');
    }
    const { rows } = await sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tournaments
       WHERE status IN ('SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'STARTING')`,
    );
    expect(rows[0]!.n).toBe(5);
  });

  it('même créneau créé simultanément sur deux instances : un seul tournoi (D-059)', async () => {
    const admin = await seedAdmin(sql, `admin-${randomUUID()}`);
    const results = await Promise.allSettled(
      [0, 30, 0, 45].map((offsetMin, i) =>
        (i % 2 === 0 ? a() : b()).tournaments.createAsAdmin(
          admin,
          tournamentInput(clock, HOUR + offsetMin * 60_000),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason.name).toBe('TournamentOverlapError');
    }
  });

  it('inscriptions simultanées sur deux instances : capacité respectée, une réservation par inscrit', async () => {
    const t = await published({ maximumPlayers: 20 });
    await fillWith(a(), sql, t.id, 17);
    const players = await playersWith(8, 5000);
    const results = await Promise.allSettled(
      players.map((p, i) => (i % 2 === 0 ? a() : b()).tournaments.register(t.id, p)),
    );
    const accepted = results.filter((r) => r.status === 'fulfilled');
    expect(accepted).toHaveLength(3);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason.name).toBe('TournamentFullError');
    }
    const { rows } = await sql.query<{ n: number; total: string }>(
      `SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::text AS total
       FROM wallet_reservations WHERE tournament_id = $1 AND status = 'ACTIVE'`,
      [t.id],
    );
    expect(rows[0]).toEqual({ n: 20, total: '20000' });
    const reserved = await Promise.all(players.map((p) => balances(sql, p)));
    expect(reserved.filter((x) => x.reserved === 1000)).toHaveLength(3);
    expect(reserved.filter((x) => x.reserved === 0)).toHaveLength(5);
  });

  it('même joueur, double inscription simultanée sur deux instances : une seule réservation', async () => {
    const t = await published();
    const [p] = await playersWith(1, 5000);
    const results = await Promise.allSettled([
      a().tournaments.register(t.id, p!),
      b().tournaments.register(t.id, p!),
      a().tournaments.register(t.id, p!),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balances(sql, p!)).toEqual({ balance: 5000, reserved: 1000, available: 4000 });
  });

  it('solde juste suffisant pour une seule inscription : deux tournois, une seule réservation', async () => {
    const first = await published();
    const second = await a().tournaments.createAsAdmin(
      await seedAdmin(sql, `admin-${randomUUID()}`),
      tournamentInput(clock, 4 * HOUR),
    );
    const [p] = await playersWith(1, 1000);
    const results = await Promise.allSettled([
      a().tournaments.register(first.id, p!),
      b().tournaments.register(second.id, p!),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balances(sql, p!)).toEqual({ balance: 1000, reserved: 1000, available: 0 });
  });

  it('attribution simultanée des tables sur deux instances : tables de 4, aucune orpheline', async () => {
    const t = await published();
    const players = await playersWith(8, 5000);
    for (const p of players) await a().tournaments.register(t.id, p);
    await fillWith(a(), sql, t.id); // minimum de 20 participants (D-057)
    clock.set(t.startsAt);
    await a().tournaments.advance(t.id);

    const seats = await Promise.all(
      players.map((p, i) => (i % 2 === 0 ? a() : b()).tournaments.join(t.id, p)),
    );
    const tables = new Map<string, number>();
    for (const s of seats) tables.set(s.sessionId, (tables.get(s.sessionId) ?? 0) + 1);
    expect([...tables.values()].sort()).toEqual([4, 4]);

    const linked = await sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM tournament_sessions WHERE tournament_id = $1',
      [t.id],
    );
    expect(linked.rows[0]!.n).toBe(2);
    const orphans = await sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions s
       WHERE NOT EXISTS (SELECT 1 FROM tournament_sessions ts WHERE ts.session_id = s.id)`,
    );
    expect(orphans.rows[0]!.n).toBe(0);
    // Sièges distincts à chaque table (lus par un joueur assis à cette table).
    for (const [sessionId] of tables) {
      const seated = players[seats.findIndex((x) => x.sessionId === sessionId)]!;
      const { session } = await a().sessions.getSession(
        sessionId as never,
        seated as string as PlayerId,
      );
      const active = session.players.filter((p) => p.active);
      expect(active).toHaveLength(4);
      expect(new Set(active.map((p) => p.seat)).size).toBe(4);
    }
  });
});

if (!isDedicatedTestDatabase) {
  // Rend l'absence de configuration visible dans la sortie de Jest (jamais un faux succès).
  describe.skip(`Tournois sur PostgreSQL réel : IGNORÉ — ${
    url ? 'TEST_DATABASE_URL est la base de l’application' : 'TEST_DATABASE_URL non défini'
  }`, () => {
    it('non exécuté', () => undefined);
  });
}
