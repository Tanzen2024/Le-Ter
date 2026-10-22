import { PGlite } from '@electric-sql/pglite';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { pgliteSqlClient } from '../../fixtures/pglite';

/**
 * Migration 0051 (D-124) sur une base qui contient DÉJÀ des tournois : ils deviennent des
 * tournois de Fap-Fap (TER, les seuls ayant existé) sans qu'aucune ligne soit réécrite ; la
 * colonne n'a AUCUNE valeur par défaut et le jeu ne se modifie plus.
 */
const MIGRATION = '0051_tournament_game_type.sql';
const EXISTING = '11111111-1111-4111-8111-111111111111';
const NEW_ONE = '22222222-2222-4222-8222-222222222222';

jest.setTimeout(60_000);

let db: PGlite;
afterEach(() => db?.close());

it('tournois existants en TER, aucune valeur par défaut, jeu immuable', async () => {
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
       created_at, updated_at)
     VALUES ($1, 'DRAFT', '2026-11-01T17:00:00Z', '2026-11-01T19:00:00Z', 1000, 20,
       now(), now())`,
    [EXISTING],
  );
  const before = await sql.query('SELECT id, version, updated_at FROM tournaments');

  await runMigrations(sql, all);
  expect((await sql.query('SELECT id, version, updated_at FROM tournaments')).rows).toEqual(
    before.rows,
  );
  const existing = await sql.query<{ game_type: string }>(
    'SELECT game_type FROM tournaments WHERE id = $1',
    [EXISTING],
  );
  expect(existing.rows).toEqual([{ game_type: 'TER' }]);

  // Aucune valeur par défaut : un tournoi sans jeu est refusé par la base.
  const column = await sql.query<{ column_default: string | null; is_nullable: string }>(
    `SELECT column_default, is_nullable FROM information_schema.columns
     WHERE table_name = 'tournaments' AND column_name = 'game_type'`,
  );
  expect(column.rows).toEqual([{ column_default: null, is_nullable: 'NO' }]);
  const insert = (gameType: string | null, garamVariant: number | null = null) =>
    sql.query(
      `INSERT INTO tournaments (id, game_type, garam_variant, status, starts_at, ends_at,
         entry_fee, minimum_players, created_at, updated_at)
       VALUES ($1, $2, $3, 'DRAFT', '2026-11-02T17:00:00Z', '2026-11-02T19:00:00Z', 1000, 20,
         now(), now())`,
      [NEW_ONE, gameType, garamVariant],
    );
  await expect(insert(null)).rejects.toThrow();
  await expect(insert('FAP_FAP')).rejects.toThrow();
  // D-127 (migration 0052) : un tournoi GARAM porte toujours sa variante, Fap-Fap jamais.
  await expect(insert('GARAM')).rejects.toThrow();
  await expect(insert('TER', 15)).rejects.toThrow();
  await insert('GARAM', 15);

  // Jeu fixé à la création.
  await expect(
    sql.query(`UPDATE tournaments SET game_type = 'GARAM' WHERE id = $1`, [EXISTING]),
  ).rejects.toThrow(/immuable/);
});
