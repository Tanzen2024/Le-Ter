import { PGlite } from '@electric-sql/pglite';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { pgliteSqlClient } from '../../fixtures/pglite';

/**
 * Migration 0046 (D-113) sur une base qui contient DÉJÀ des tournois : la colonne
 * `token_setup_frozen_at` est ajoutée vide (aucune proposition n'est figée rétroactivement),
 * jetons de départ et mise existants inchangés, aucune ligne réécrite.
 */
const MIGRATION = '0046_tournament_token_setup_freeze.sql';
const PROPOSAL = '11111111-1111-4111-8111-111111111111';
const PUBLISHED = '22222222-2222-4222-8222-222222222222';

jest.setTimeout(60_000);

let db: PGlite;
afterEach(() => db?.close());

it('colonne ajoutée vide, tournois existants intacts, migration rejouée sans effet', async () => {
  db = new PGlite();
  const sql = pgliteSqlClient(db);
  const all = await loadMigrations();
  expect(all.map((m) => m.name)).toContain(MIGRATION);
  await runMigrations(
    sql,
    all.filter((m) => m.name < MIGRATION),
  );

  await sql.query(
    `INSERT INTO tournaments (id, status, starts_at, ends_at, entry_fee, minimum_players,
       initial_tournament_tokens, stake_per_game, created_at, updated_at)
     VALUES ($1, 'PENDING_APPROVAL', '2026-11-01T17:00:00Z', '2026-11-01T19:00:00Z', 1000, 20,
       1000, 100, now(), now())`,
    [PROPOSAL],
  );
  await sql.query(
    `INSERT INTO tournaments (id, status, starts_at, ends_at, entry_fee, minimum_players,
       initial_tournament_tokens, stake_per_game, platform_fee_bps, published_at, blocked_until,
       registration_closes_at, created_at, updated_at)
     VALUES ($1, 'REGISTRATION_OPEN', '2026-11-02T17:00:00Z', '2026-11-02T19:00:00Z', 2000, 20,
       2000, 200, 1000, now(), '2026-11-02T19:00:00Z', '2026-11-02T17:00:00Z', now(), now())`,
    [PUBLISHED],
  );
  const before = await sql.query(
    `SELECT id, version, status, initial_tournament_tokens, stake_per_game, updated_at
     FROM tournaments ORDER BY id`,
  );

  await runMigrations(sql, all);
  const after = await sql.query(
    `SELECT id, version, status, initial_tournament_tokens, stake_per_game, updated_at
     FROM tournaments ORDER BY id`,
  );
  expect(after.rows).toEqual(before.rows);
  const frozen = await sql.query<{ token_setup_frozen_at: Date | null }>(
    'SELECT token_setup_frozen_at FROM tournaments ORDER BY id',
  );
  expect(frozen.rows).toEqual([{ token_setup_frozen_at: null }, { token_setup_frozen_at: null }]);

  // Déjà appliquée : rejouer le migrateur ne change rien.
  await runMigrations(sql, all);
  expect(
    (
      await sql.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM schema_migrations WHERE name = $1`,
        [MIGRATION],
      )
    ).rows[0]?.n,
  ).toBe(1);
});
