import { PGlite } from '@electric-sql/pglite';

import { loadMigrations, runMigrations, type Migration } from '../../../src/database/migrator';
import { PGLITE_TIMEOUT_MS, pgliteSqlClient } from '../../fixtures/pglite';

const migration = (name: string, sql: string): Migration => ({ name, sql, checksum: `sum-${sql}` });

// Chaque test démarre une base PGlite neuve (voir PGLITE_TIMEOUT_MS).
jest.setTimeout(PGLITE_TIMEOUT_MS);

describe('runMigrations', () => {
  let db: PGlite;

  beforeEach(() => {
    db = new PGlite();
  });
  afterEach(() => db.close());

  it('applique les migrations du dépôt une seule fois', async () => {
    const sql = pgliteSqlClient(db);
    const migrations = await loadMigrations();

    expect(migrations.map((m) => m.name)).toContain('0001_create_games.sql');
    expect(await runMigrations(sql, migrations)).toEqual(migrations.map((m) => m.name));
    expect(await runMigrations(sql, migrations)).toEqual([]);

    const { rows } = await sql.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'admin_audit_log',
      'admin_sessions',
      'detection_alerts',
      'detection_positions',
      'detection_scores',
      'detection_signals',
      'game_chat_messages',
      'game_players',
      'games',
      'notifications',
      'payments',
      'platform_ledger',
      'refresh_tokens',
      'schema_migrations',
      'session_decision_rounds',
      'session_decisions',
      'session_players',
      'sessions',
      'system_settings',
      'tournament_games',
      'tournament_player_accounts',
      'tournament_prize_rules',
      'tournament_registrations',
      'tournament_results',
      'tournament_sessions',
      'tournaments',
      'users',
      'wallet_reservations',
      'wallet_transactions',
      'wallets',
    ]);
  });

  it("n'applique que les nouvelles migrations, dans l'ordre", async () => {
    const sql = pgliteSqlClient(db);
    const first = migration('0001_a.sql', 'CREATE TABLE a (id int)');
    await runMigrations(sql, [first]);

    const applied = await runMigrations(sql, [
      first,
      migration('0002_b.sql', 'CREATE TABLE b (id int)'),
    ]);
    expect(applied).toEqual(['0002_b.sql']);
  });

  it('annule tout si une migration échoue', async () => {
    const sql = pgliteSqlClient(db);
    await expect(
      runMigrations(sql, [
        migration('0001_a.sql', 'CREATE TABLE a (id int)'),
        migration('0002_broken.sql', 'CREATE TABLE oops ('),
      ]),
    ).rejects.toThrow();

    const { rows } = await sql.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name IN ('a', 'schema_migrations')`,
    );
    expect(rows).toEqual([]);
  });

  it('refuse une migration déjà appliquée puis modifiée', async () => {
    const sql = pgliteSqlClient(db);
    await runMigrations(sql, [migration('0001_a.sql', 'CREATE TABLE a (id int)')]);

    await expect(
      runMigrations(sql, [migration('0001_a.sql', 'CREATE TABLE a (id bigint)')]),
    ).rejects.toThrow('Migration déjà appliquée puis modifiée : 0001_a.sql');
  });

  it('refuse une base migrée par une version plus récente du code', async () => {
    const sql = pgliteSqlClient(db);
    await runMigrations(sql, [
      migration('0001_a.sql', 'CREATE TABLE a (id int)'),
      migration('0002_b.sql', 'CREATE TABLE b (id int)'),
    ]);

    await expect(
      runMigrations(sql, [migration('0001_a.sql', 'CREATE TABLE a (id int)')]),
    ).rejects.toThrow('Migrations appliquées absentes du code : 0002_b.sql');
  });
});
