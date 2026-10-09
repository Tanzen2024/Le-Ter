import { PGlite } from '@electric-sql/pglite';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { pgliteSqlClient } from '../../fixtures/pglite';
import { seedPlayers } from '../../fixtures/tournaments';

/**
 * Migration 0025 (D-062) sur une base qui contient DÉJÀ des tournois et des résultats : les
 * tournois publiés pas encore classés reçoivent les poids initiaux (50 / 50) ; les tournois
 * déjà classés et leurs résultats historiques restent intacts (poids et score NULL).
 */
const MIGRATION = '0025_tournament_weighted_ranking.sql';
const RUNNING = '11111111-1111-4111-8111-111111111111';
const DONE = '22222222-2222-4222-8222-222222222222';
const DRAFT = '33333333-3333-4333-8333-333333333333';

jest.setTimeout(60_000);

let db: PGlite;
afterEach(() => db?.close());

it('poids initiaux pour les tournois non classés ; historique conservé tel quel', async () => {
  db = new PGlite();
  const sql = pgliteSqlClient(db);
  const all = await loadMigrations();
  expect(all.map((m) => m.name)).toContain(MIGRATION);
  await runMigrations(
    sql,
    all.filter((m) => m.name < MIGRATION),
  );

  const [player] = await seedPlayers(sql, ['ana'], 5000);
  const insert = (id: string, status: string, startsAt: string, endsAt: string) =>
    sql.query(
      `INSERT INTO tournaments (id, status, starts_at, ends_at, entry_fee, minimum_players,
         platform_fee_bps, published_at, blocked_until, registration_closes_at,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, 20, 1000,
         CASE WHEN $2 = 'DRAFT' THEN NULL ELSE now() END,
         CASE WHEN $2 = 'DRAFT' THEN NULL ELSE $4::timestamptz END,
         CASE WHEN $2 = 'DRAFT' THEN NULL ELSE $3::timestamptz END, now(), now())`,
      [id, status, startsAt, endsAt],
    );
  await insert(RUNNING, 'IN_PROGRESS', '2026-10-12T17:00:00Z', '2026-10-12T18:00:00Z');
  await insert(DONE, 'COMPLETED', '2026-10-11T17:00:00Z', '2026-10-11T18:00:00Z');
  await insert(DRAFT, 'DRAFT', '2026-10-13T17:00:00Z', '2026-10-13T18:00:00Z');
  await sql.query(
    `INSERT INTO tournament_results (tournament_id, rank, player_id, initial_tokens,
       remaining_tokens, games_played, games_won, created_at)
     VALUES ($1, 1, $2, 1000, 1400, 6, 4, now())`,
    [DONE, player],
  );

  expect(await runMigrations(sql, all.filter((m) => m.name <= MIGRATION))).toEqual([MIGRATION]);

  const weights = await sql.query<{ id: string; t: number | null; g: number | null }>(
    `SELECT id, ranking_tokens_weight_bps AS t, ranking_games_weight_bps AS g
       FROM tournaments ORDER BY id`,
  );
  expect(weights.rows).toEqual([
    { id: RUNNING, t: 5000, g: 5000 },
    { id: DONE, t: null, g: null },
    { id: DRAFT, t: null, g: null },
  ]);
  const results = await sql.query(
    'SELECT rank, remaining_tokens, games_played, score FROM tournament_results',
  );
  expect(results.rows).toEqual([{ rank: 1, remaining_tokens: 1400, games_played: 6, score: null }]);

  // Somme des poids garantie par la base.
  await expect(
    sql.query(
      `UPDATE tournaments SET ranking_tokens_weight_bps = 6000, ranking_games_weight_bps = 5000
        WHERE id = $1`,
      [RUNNING],
    ),
  ).rejects.toThrow(/tournaments_ranking_weights_check/);
  // Nouveaux paramètres acceptés par system_settings.
  await sql.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('tournament_ranking_tokens_weight_percent', '60'::jsonb, now())`,
  );
});
