import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { pgliteSqlClient } from '../../fixtures/pglite';
import { seedPlayers } from '../../fixtures/tournaments';

/**
 * Migration 0045 (D-112) sur une base contenant DÉJÀ des classements publiés : chaque gain
 * reçoit sa ligne de plan avec son état RÉEL (versé → CREDITED avec sa transaction, non versé
 * → PENDING) ; les tournois en cours de versement ou terminés sont marqués « plan validé ».
 */
const MIGRATION = '0045_tournament_payouts.sql';
jest.setTimeout(60_000);

let db: PGlite;
afterEach(() => db?.close());

it('plans des classements existants : état réel de chaque gain, aucun crédit ajouté', async () => {
  db = new PGlite();
  const sql = pgliteSqlClient(db);
  const all = await loadMigrations();
  expect(all.map((m) => m.name)).toContain(MIGRATION);
  await runMigrations(
    sql,
    all.filter((m) => m.name < MIGRATION),
  );
  const [ana, ben] = await seedPlayers(sql, ['ana', 'ben'], 0);
  const paying = randomUUID();
  const done = randomUUID();
  for (const [id, status, day] of [
    [paying, 'DISTRIBUTING_PRIZES', '2026-10-11T17:00:00Z'],
    [done, 'COMPLETED', '2026-10-10T17:00:00Z'],
  ] as const) {
    await sql.query(
      `INSERT INTO tournaments (id, status, starts_at, ends_at, entry_fee, minimum_players,
         platform_fee_bps, published_at, blocked_until, registration_closes_at, started_at,
         results_at, ranking_method, settlement_rule, created_at, updated_at)
       VALUES ($1, $2, $3::timestamptz, $3::timestamptz + interval '1 hour', 500, 20, 1000,
         now(), $3::timestamptz + interval '1 hour', $3::timestamptz, $3::timestamptz,
         $3::timestamptz + interval '1 hour', 'D106_CAPITAL_RATIO', 'D054_TAPIS', now(), now())`,
      [id, status, day],
    );
  }
  const prize = async (tournament: string, rank: number, player: string) => {
    const id = randomUUID();
    await sql.query(
      `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
         created_at, updated_at, completed_at)
       VALUES ($1, $2, 'tournament_prize', 'succeeded', 900, $3, now(), now(), now())`,
      [id, player, `tournament-prize:${tournament}:${rank}`],
    );
    return id;
  };
  const result = (tournament: string, rank: number, player: string, txId: string | null) =>
    sql.query(
      `INSERT INTO tournament_results (tournament_id, rank, player_id, initial_tokens,
         remaining_tokens, games_played, games_won, prize_share_bps, prize_amount, created_at,
         prize_transaction_id, paid_at)
       VALUES ($1, $2, $3, 1000, 1000, 0, 0, 5000, 900, now(), $4, $5)`,
      [tournament, rank, player, txId, txId ? new Date() : null],
    );
  await result(paying, 1, ana!, await prize(paying, 1, ana!));
  await result(paying, 2, ben!, null);
  await result(done, 1, ana!, await prize(done, 1, ana!));
  const prizesBefore = await sql.query(`SELECT id FROM wallet_transactions`);

  expect(
    await runMigrations(
      sql,
      all.filter((m) => m.name <= MIGRATION),
    ),
  ).toEqual([MIGRATION]);

  const plans = await sql.query<{ tournament_id: string; rank: number; status: string }>(
    `SELECT tournament_id, rank, status FROM tournament_payouts ORDER BY tournament_id, rank`,
  );
  const byKey = new Map(plans.rows.map((r) => [`${r.tournament_id}:${r.rank}`, r.status]));
  expect(byKey.get(`${paying}:1`)).toBe('CREDITED');
  expect(byKey.get(`${paying}:2`)).toBe('PENDING');
  expect(byKey.get(`${done}:1`)).toBe('CREDITED');
  expect(plans.rows).toHaveLength(3);
  const validated = await sql.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM tournaments WHERE payout_plan_validated_at IS NOT NULL`,
  );
  expect(validated.rows[0]!.n).toBe(2);
  // Aucune écriture du compte de jeu ajoutée par la migration.
  expect((await sql.query(`SELECT id FROM wallet_transactions`)).rows).toHaveLength(
    prizesBefore.rows.length,
  );
  // Le tournoi en cours de versement ne peut pas être finalisé avant le dernier crédit.
  await expect(
    sql.query(`UPDATE tournaments SET status = 'COMPLETED' WHERE id = $1`, [paying]),
  ).rejects.toThrow(/versements non crédités/);
});
