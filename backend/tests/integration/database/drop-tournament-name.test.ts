import { PGlite } from '@electric-sql/pglite';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { PGLITE_TIMEOUT_MS, pgliteSqlClient } from '../../fixtures/pglite';
import { seedPlayers } from '../../fixtures/tournaments';

/**
 * Migration 0024 (D-060) sur une base qui contient DÉJÀ des tournois : les colonnes `name`
 * et `description` disparaissent ; identifiants, relations, inscriptions et le reste des
 * données sont conservés ; le nom est retiré des notifications existantes.
 */
const MIGRATION = '0024_drop_tournament_name_description.sql';
const TOURNAMENT = '11111111-1111-4111-8111-111111111111';

jest.setTimeout(60_000);

let db: PGlite;
afterEach(() => db?.close());

it('supprime name et description, conserve tournoi, inscription et notification', async () => {
  db = new PGlite();
  const sql = pgliteSqlClient(db);
  const all = await loadMigrations();
  expect(all.map((m) => m.name)).toContain(MIGRATION);
  await runMigrations(
    sql,
    all.filter((m) => m.name < MIGRATION),
  );

  // Données « historiques », écrites avec l'ancien schéma.
  const [player] = await seedPlayers(sql, ['ana'], 5000);
  await sql.query(
    `INSERT INTO tournaments (id, name, description, status, starts_at, ends_at, entry_fee,
       minimum_players, created_at, updated_at)
     VALUES ($1, 'Tournoi du samedi', 'Ancienne description', 'DRAFT',
       '2026-10-12T17:00:00Z', '2026-10-12T18:00:00Z', 1000, 20, now(), now())`,
    [TOURNAMENT],
  );
  await sql.query(
    `INSERT INTO tournament_registrations (id, tournament_id, user_id, status, registered_at)
     VALUES ('22222222-2222-4222-8222-222222222222', $1, $2, 'REGISTERED', now())`,
    [TOURNAMENT, player],
  );
  await sql.query(
    `INSERT INTO notifications (id, user_id, type, payload, dedupe_key, created_at)
     VALUES ('33333333-3333-4333-8333-333333333333', $1, 'TOURNAMENT_APPROVED',
       jsonb_build_object('tournamentId', $2::text, 'name', 'Tournoi du samedi',
         'startsAt', '2026-10-12T17:00:00.000Z'), 'approved:x', now())`,
    [player, TOURNAMENT],
  );

  expect(await runMigrations(sql, all.filter((m) => m.name <= MIGRATION))).toEqual([MIGRATION]);

  const columns = await sql.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'tournaments'`,
  );
  const names = columns.rows.map((c) => c.column_name);
  expect(names).not.toContain('name');
  expect(names).not.toContain('description');
  expect(names).toEqual(expect.arrayContaining(['id', 'status', 'starts_at', 'ends_at']));

  const kept = await sql.query<{ id: string; status: string; entry_fee: string }>(
    'SELECT id, status, entry_fee::text AS entry_fee FROM tournaments WHERE id = $1',
    [TOURNAMENT],
  );
  expect(kept.rows).toEqual([{ id: TOURNAMENT, status: 'DRAFT', entry_fee: '1000' }]);
  const registrations = await sql.query<{ tournament_id: string; user_id: string }>(
    'SELECT tournament_id, user_id FROM tournament_registrations',
  );
  expect(registrations.rows).toEqual([{ tournament_id: TOURNAMENT, user_id: player }]);
  const notification = await sql.query<{ payload: Record<string, unknown> }>(
    'SELECT payload FROM notifications',
  );
  expect(notification.rows[0]!.payload).toEqual({
    tournamentId: TOURNAMENT,
    startsAt: '2026-10-12T17:00:00.000Z',
  });

  // Rejouer les migrations ne refait rien (déjà appliquée).
  expect(await runMigrations(sql, all.filter((m) => m.name <= MIGRATION))).toEqual([]);
}, PGLITE_TIMEOUT_MS * 2);
