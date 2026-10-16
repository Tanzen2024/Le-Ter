import { PGlite } from '@electric-sql/pglite';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { pgliteSqlClient } from '../../fixtures/pglite';
import { seedPlayers } from '../../fixtures/tournaments';

/**
 * Migration 0043 (D-106) sur une base qui contient DÉJÀ des tournois et des parties : les
 * parties des tables de tournoi reçoivent leur `tournament_id`, les parties ordinaires
 * restent sans tournoi, les tournois déjà démarrés gardent la méthode D-062, et les
 * résultats historiques restent intacts.
 */
const MIGRATION = '0043_tournament_closure_results.sql';
const STARTED = '11111111-1111-4111-8111-111111111111';
const UPCOMING = '22222222-2222-4222-8222-222222222222';
const TABLE = '33333333-3333-4333-8333-333333333333';
const ORDINARY = '44444444-4444-4444-8444-444444444444';
const TABLE_GAME = '55555555-5555-4555-8555-555555555555';
const ORDINARY_GAME = '66666666-6666-4666-8666-666666666666';

jest.setTimeout(60_000);

let db: PGlite;
afterEach(() => db?.close());

it('rattachement des parties existantes, méthode D-062 conservée, historique intact', async () => {
  db = new PGlite();
  const sql = pgliteSqlClient(db);
  const all = await loadMigrations();
  expect(all.map((m) => m.name)).toContain(MIGRATION);
  await runMigrations(
    sql,
    all.filter((m) => m.name < MIGRATION),
  );

  const [ana] = await seedPlayers(sql, ['ana'], 5000);
  const tournament = (id: string, status: string, day: string, startedAt: string | null) =>
    sql.query(
      `INSERT INTO tournaments (id, status, starts_at, ends_at, entry_fee, minimum_players,
         platform_fee_bps, published_at, blocked_until, registration_closes_at, started_at,
         created_at, updated_at)
       VALUES ($1, $2, $3::timestamptz, $3::timestamptz + interval '1 hour', 500, 20, 1000,
         now(), $3::timestamptz + interval '1 hour', $3::timestamptz, $4, now(), now())`,
      [id, status, day, startedAt],
    );
  await tournament(STARTED, 'IN_PROGRESS', '2026-10-12T17:00:00Z', '2026-10-12T17:00:00Z');
  await tournament(UPCOMING, 'REGISTRATION_OPEN', '2026-10-13T17:00:00Z', null);
  for (const session of [TABLE, ORDINARY]) {
    await sql.query(
      `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at, updated_at)
       VALUES ($1, 1, 'open', $2, 4, now(), now())`,
      [session, ana],
    );
  }
  await sql.query(
    `INSERT INTO tournament_sessions (id, tournament_id, session_id, created_at)
     VALUES (gen_random_uuid(), $1, $2, now())`,
    [STARTED, TABLE],
  );
  for (const [game, session] of [
    [TABLE_GAME, TABLE],
    [ORDINARY_GAME, ORDINARY],
  ]) {
    await sql.query(
      `INSERT INTO games (id, version, status, creator_id, max_players, state, created_at,
         updated_at, session_id, first_player_id)
       VALUES ($1, 1, 'waiting', $2, 4, '{"recentCommandIds": []}'::jsonb, now(), now(), $3, $2)`,
      [game, ana, session],
    );
  }
  await sql.query(
    `INSERT INTO tournament_results (tournament_id, rank, player_id, initial_tokens,
       remaining_tokens, games_played, games_won, created_at, score)
     VALUES ($1, 1, $2, 1000, 1400, 6, 4, now(), 28.4355)`,
    [STARTED, ana],
  );

  expect(await runMigrations(sql, all.filter((m) => m.name <= MIGRATION))).toEqual([MIGRATION]);

  const games = await sql.query<{ id: string; tournament_id: string | null }>(
    'SELECT id, tournament_id FROM games ORDER BY id',
  );
  expect(games.rows).toEqual([
    { id: TABLE_GAME, tournament_id: STARTED },
    { id: ORDINARY_GAME, tournament_id: null },
  ]);
  const methods = await sql.query<{ id: string; ranking_method: string | null }>(
    'SELECT id, ranking_method FROM tournaments ORDER BY id',
  );
  expect(methods.rows).toEqual([
    { id: STARTED, ranking_method: 'D062_SATURATING' },
    { id: UPCOMING, ranking_method: null },
  ]);
  const results = await sql.query<{ score: string; ranking_method: string | null }>(
    'SELECT score::text AS score, ranking_method FROM tournament_results',
  );
  expect(results.rows).toEqual([{ score: '28.4355', ranking_method: null }]);
});
