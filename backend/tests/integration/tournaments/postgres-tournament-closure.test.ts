import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { Tournament } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import {
  createTournamentTestStack,
  fillWith,
  finishedCopy,
  HOUR,
  MINUTE,
  saveTournamentSettings,
  seedAdmin,
  seedPlayers,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Clôture des tournois (D-106) sur un VRAI PostgreSQL : migration 0043 sur des données
 * existantes représentatives, verrou partagé entre un démarrage de partie et la clôture,
 * finalisation et règlement concurrents sur deux instances, relecture après « redémarrage ».
 *
 * Exécutée seulement quand TEST_DATABASE_URL désigne une base de TEST dédiée ; jamais sur la
 * base de l'application (refus si l'URL est celle de DATABASE_URL, variable ou backend/.env).
 * Tout se passe dans des schémas temporaires, supprimés à la fin.
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
jest.setTimeout(180_000);

/** Schéma temporaire et client SQL sur ce schéma. */
async function temporarySchema() {
  const schema = `tournament_d106_${randomUUID().replace(/-/g, '')}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const pool = new Pool({ connectionString: url, max: 20, options: `-c search_path=${schema}` });
  return {
    pool,
    sql: createPgSqlClient(pool),
    async drop() {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    },
  };
}

describeWithPostgres('migration 0043 sur des données existantes (PostgreSQL réel)', () => {
  const MIGRATION = '0043_tournament_closure_results.sql';
  let db: Awaited<ReturnType<typeof temporarySchema>>;

  beforeAll(async () => {
    db = await temporarySchema();
  });
  afterAll(() => db?.drop());

  it('rattache, conserve l’historique, protège le classement sans bloquer les versements', async () => {
    const all = await loadMigrations();
    await runMigrations(
      db.sql,
      all.filter((m) => m.name < MIGRATION),
    );
    const sql = db.sql;
    const [ana, ben] = await seedPlayers(sql, ['ana', 'ben'], 5000);
    const ids = {
      running: randomUUID(),
      distributing: randomUUID(),
      completed: randomUUID(),
      cancelled: randomUUID(),
      open: randomUUID(),
    };
    const tournament = (id: string, status: string, day: string, started: boolean, extra = '') =>
      sql.query(
        // Schéma d'avant 0043 : pas encore de `game_type` (0051 le pose à 'TER' sur l'existant).
        `INSERT INTO tournaments (id, status, starts_at, ends_at, entry_fee, minimum_players,
           platform_fee_bps, published_at, blocked_until, registration_closes_at, started_at,
           created_at, updated_at ${extra ? ', cancellation_reason, cancelled_at' : ''})
         VALUES ($1, $2, $3::timestamptz, $3::timestamptz + interval '1 hour', 500, 20, 1000,
           now(), $3::timestamptz + interval '1 hour', $3::timestamptz,
           CASE WHEN $4 THEN $3::timestamptz END, now(), now()
           ${extra ? ", 'INSUFFICIENT_PLAYERS', now()" : ''})`,
        [id, status, day, started],
      );
    await tournament(ids.running, 'IN_PROGRESS', '2026-10-12T17:00:00Z', true);
    await tournament(ids.distributing, 'DISTRIBUTING_PRIZES', '2026-10-11T17:00:00Z', true);
    await tournament(ids.completed, 'COMPLETED', '2026-10-10T17:00:00Z', true);
    await tournament(ids.cancelled, 'CANCELLED', '2026-10-09T17:00:00Z', false, 'x');
    await tournament(ids.open, 'REGISTRATION_OPEN', '2026-10-20T17:00:00Z', false);

    // Deux tables du tournoi en cours et une table ordinaire.
    const [table, table2, ordinary] = [randomUUID(), randomUUID(), randomUUID()];
    for (const session of [table, table2, ordinary]) {
      await sql.query(
        `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at,
           updated_at) VALUES ($1, 1, 'open', $2, 4, now(), now())`,
        [session, ana],
      );
    }
    for (const session of [table, table2]) {
      await sql.query(
        `INSERT INTO tournament_sessions (id, tournament_id, session_id, created_at)
         VALUES ($1, $2, $3, now())`,
        [randomUUID(), ids.running, session],
      );
    }
    const games = { first: randomUUID(), second: randomUUID(), plain: randomUUID() };
    for (const [game, session] of [
      [games.first, table],
      [games.second, table2],
      [games.plain, ordinary],
    ] as const) {
      await sql.query(
        `INSERT INTO games (id, version, status, creator_id, max_players, state, created_at,
           updated_at, session_id, first_player_id)
         VALUES ($1, 1, 'waiting', $2, 4, '{"recentCommandIds": []}'::jsonb, now(), now(), $3, $2)`,
        [game, ana, session],
      );
    }

    // Classement en cours de versement : rang 1 versé, rang 2 pas encore.
    const prizeTx = randomUUID();
    await sql.query(
      `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
         created_at, updated_at, completed_at)
       VALUES ($1, $2, 'tournament_prize', 'succeeded', 900, $3, now(), now(), now())`,
      [prizeTx, ana, `tournament-prize:${ids.distributing}:1`],
    );
    for (const [rank, player, paid] of [
      [1, ana, true],
      [2, ben, false],
    ] as const) {
      await sql.query(
        `INSERT INTO tournament_results (tournament_id, rank, player_id, initial_tokens,
           remaining_tokens, games_played, games_won, prize_share_bps, prize_amount, created_at,
           score, prize_transaction_id, paid_at)
         VALUES ($1, $2, $3, 1000, 1200, 3, 2, 5000, 900, now(), 28.4355, $4, $5)`,
        [ids.distributing, rank, player, paid ? prizeTx : null, paid ? new Date() : null],
      );
    }

    expect(
      await runMigrations(
        sql,
        all.filter((m) => m.name <= MIGRATION),
      ),
    ).toEqual([MIGRATION]);
    // Migrations suivantes (0044 règlement, 0045 plan de versement…), puis relance : rien à refaire.
    expect(await runMigrations(sql, all)).toEqual(
      all.filter((m) => m.name > MIGRATION).map((m) => m.name),
    );
    expect(await runMigrations(sql, all)).toEqual([]);

    const attached = await sql.query<{ id: string; tournament_id: string | null }>(
      'SELECT id, tournament_id FROM games',
    );
    const byId = new Map(attached.rows.map((r) => [r.id, r.tournament_id]));
    expect(byId.get(games.first)).toBe(ids.running);
    expect(byId.get(games.second)).toBe(ids.running);
    expect(byId.get(games.plain)).toBeNull();
    const methods = await sql.query<{ id: string; ranking_method: string | null }>(
      'SELECT id, ranking_method FROM tournaments',
    );
    const method = new Map(methods.rows.map((r) => [r.id, r.ranking_method]));
    expect(method.get(ids.running)).toBe('D062_SATURATING');
    expect(method.get(ids.distributing)).toBe('D062_SATURATING');
    expect(method.get(ids.completed)).toBe('D062_SATURATING');
    expect(method.get(ids.cancelled)).toBeNull();
    expect(method.get(ids.open)).toBeNull();

    // Le versement restant reste possible (une fois), le classement ne bouge plus. Depuis 0045
    // (D-112), un gain réel n'existe qu'avec sa ligne CREDITED du plan, dans la même transaction.
    const prizeTx2 = randomUUID();
    const paid = await sql.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
           created_at, updated_at, completed_at)
         VALUES ($1, $2, 'tournament_prize', 'succeeded', 900, $3, now(), now(), now())`,
        [prizeTx2, ben, `tournament-prize:${ids.distributing}:2`],
      );
      await tx.query(
        `UPDATE tournament_payouts SET status = 'CREDITED', wallet_transaction_id = $3,
           credited_at = now() WHERE tournament_id = $1 AND rank = $2`,
        [ids.distributing, 2, prizeTx2],
      );
      return tx.query(
        `UPDATE tournament_results SET prize_transaction_id = $3, paid_at = now()
         WHERE tournament_id = $1 AND rank = $2 AND paid_at IS NULL`,
        [ids.distributing, 2, prizeTx2],
      );
    });
    expect(paid.rowCount).toBe(1);
    // Hors plan, un gain réel est refusé.
    await expect(
      sql.query(
        `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
           created_at, updated_at, completed_at)
         VALUES ($1, $2, 'tournament_prize', 'succeeded', 900, 'hors-plan', now(), now(), now())`,
        [randomUUID(), ben],
      ),
    ).rejects.toThrow(/sans ligne créditée du plan/);
    await expect(
      sql.query(
        `UPDATE tournament_results SET paid_at = now() WHERE tournament_id = $1 AND rank = 1`,
        [ids.distributing],
      ),
    ).rejects.toThrow(/gain déjà versé/);
    await expect(
      sql.query(`UPDATE tournament_results SET score = 99 WHERE tournament_id = $1`, [
        ids.distributing,
      ]),
    ).rejects.toThrow(/immuable/);
    await expect(
      sql.query('DELETE FROM tournament_results WHERE tournament_id = $1', [ids.distributing]),
    ).rejects.toThrow(/immuable/);
    const scores = await sql.query<{ score: string }>(
      'SELECT score::text AS score FROM tournament_results WHERE tournament_id = $1',
      [ids.distributing],
    );
    expect(scores.rows.map((r) => r.score)).toEqual(['28.4355', '28.4355']);

    // Rattachements protégés : jamais modifiés, jamais incohérents avec la table.
    await expect(
      sql.query('UPDATE games SET tournament_id = $2 WHERE id = $1', [games.plain, ids.running]),
    ).rejects.toThrow(/immuable/);
    await expect(
      sql.query(
        `INSERT INTO games (id, version, status, creator_id, max_players, state, created_at,
           updated_at, session_id, first_player_id, tournament_id)
         VALUES ($1, 1, 'waiting', $2, 4, '{"recentCommandIds": []}'::jsonb, now(), now(), $3,
           $2, $4)`,
        [randomUUID(), ana, ordinary, ids.running],
      ),
    ).rejects.toThrow(/différent de celui de sa table/);
    await expect(
      sql.query(
        `INSERT INTO tournament_games (game_id, tournament_id, session_id, status, stake, pot,
           transfers, void_reason, settled_at)
         VALUES ($1, $2, $3, 'VOID', 0, 0, '{}'::jsonb, 'TEST', now())`,
        [games.first, ids.completed, table],
      ),
    ).rejects.toThrow(/appartient pas au tournoi/);
  });
});

describeWithPostgres('clôture concurrente (PostgreSQL réel, deux instances)', () => {
  let db: Awaited<ReturnType<typeof temporarySchema>>;
  let sql: SqlClient;
  let instances: TournamentTestStack[] = [];
  const clock = new TestClock();
  const [a, b] = [() => instances[0]!, () => instances[1]!];

  beforeAll(async () => {
    db = await temporarySchema();
    sql = db.sql;
    await runMigrations(sql, await loadMigrations());
  });
  afterAll(() => db?.drop());
  beforeEach(async () => {
    clock.set(new Date());
    instances = [createTournamentTestStack(sql, clock), createTournamentTestStack(sql, clock)];
    await saveTournamentSettings(sql);
  });
  afterEach(async () => {
    await Promise.all(instances.map((i) => i.stop()));
    await sql.query('TRUNCATE games, users, tournaments CASCADE');
  });

  async function started(): Promise<{ t: Tournament; ana: UserId; ben: UserId }> {
    const admin = await seedAdmin(sql, `admin-${randomUUID()}`);
    const t = await a().tournaments.createAsAdmin(admin, tournamentInput(clock, HOUR));
    const [ana, ben] = await seedPlayers(sql, [`ana-${randomUUID()}`, `ben-${randomUUID()}`], 5000);
    await a().tournaments.register(t.id, ana!);
    await a().tournaments.register(t.id, ben!);
    await fillWith(a(), sql, t.id);
    clock.set(t.startsAt);
    return { t: await a().tournaments.advance(t.id), ana: ana!, ben: ben! };
  }

  it('un démarrage de partie et la clôture ne se croisent jamais (verrou partagé)', async () => {
    const { t, ana, ben } = await started();
    const seat = await a().tournaments.join(t.id, ana);
    await a().tournaments.join(t.id, ben);
    const closing = await db.pool.connect();
    try {
      // La clôture tient la ligne du tournoi et change son statut, sans encore valider.
      await closing.query('BEGIN');
      await closing.query('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [t.id]);
      await closing.query(`UPDATE tournaments SET status = 'CALCULATING_RESULTS' WHERE id = $1`, [
        t.id,
      ]);
      // Le démarrage passe le contrôle applicatif (état validé encore IN_PROGRESS), puis
      // attend le verrou partagé du garde-fou en base.
      const start = b().games.startGame(seat.gameId as GameId, ana as string as PlayerId);
      const outcome = start.then(
        () => 'started',
        (err: Error) => err.message,
      );
      await new Promise((r) => setTimeout(r, 1_500));
      await closing.query('COMMIT');
      expect(await outcome).toMatch(/TOURNAMENT_GAME_START_CLOSED/);
    } finally {
      closing.release();
    }
    const game = await sql.query<{ status: string }>('SELECT status FROM games WHERE id = $1', [
      seat.gameId,
    ]);
    expect(game.rows).toEqual([{ status: 'waiting' }]);
  });

  it('règlement et finalisation simultanés sur deux instances : une seule fois chacun', async () => {
    const { t, ana, ben } = await started();
    const seat = await a().tournaments.join(t.id, ana);
    await a().tournaments.join(t.id, ben);
    await a().games.startGame(seat.gameId as GameId, ana as string as PlayerId);
    const game = (await a().games.findGame(seat.gameId as GameId))!;
    const done = finishedCopy(game, ben, clock.now());
    await Promise.all([a().tournaments.settleGame(done), b().tournaments.settleGame(done)]);
    await a().games.finishGame(seat.gameId as GameId); // la vraie partie se termine
    await Promise.all(instances.map((i) => i.tournaments.idle()));
    const settled = await sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM tournament_games WHERE game_id = $1',
      [seat.gameId],
    );
    expect(settled.rows[0]!.n).toBe(1);
    expect((await a().repository.findAccount(t.id, ben))!.currentTokens).toBe(1100);

    clock.set(new Date(t.endsAt.getTime() + MINUTE));
    await Promise.all([a().tournaments.advance(t.id), b().tournaments.advance(t.id)]);
    await Promise.all([a().scheduler.tick(), b().scheduler.tick()]);
    expect((await a().repository.findById(t.id))!.status).toBe('COMPLETED');
    const counts = await sql.query<{ results: number; notices: number; prizes: number }>(
      `SELECT (SELECT count(*)::int FROM tournament_results WHERE tournament_id = $1) AS results,
              (SELECT count(*)::int FROM notifications WHERE type = 'TOURNAMENT_RESULTS_AVAILABLE'
                 AND payload->>'tournamentId' = $2) AS notices,
              (SELECT count(*)::int FROM wallet_transactions WHERE kind = 'tournament_prize'
                 AND idempotency_key LIKE $3) AS prizes`,
      [t.id, t.id, `tournament-prize:${t.id}:%`],
    );
    expect(counts.rows).toEqual([{ results: 20, notices: 20, prizes: 3 }]);

    // « Redémarrage » : une nouvelle instance relit le classement publié, identique.
    const before = await a().tournaments.officialResults(t.id, ana);
    const restarted = createTournamentTestStack(sql, clock);
    try {
      const after = await restarted.tournaments.officialResults(t.id, ana);
      expect(after.rows).toEqual(before.rows);
      expect(after.me?.rank).toBe(before.me?.rank);
    } finally {
      await restarted.stop();
    }
  });
});
