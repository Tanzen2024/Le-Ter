import request from 'supertest';

import type { Tournament } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import { adminLogin } from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import {
  balances,
  createTournamentTestStack,
  fillWith,
  fund,
  HOUR,
  saveTournamentSettings,
  seedAdmin,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Récompenses RÉELLES des tournois (D-112) : plan de versement écrit avec le classement,
 * validé par les contrôles financiers avant tout crédit, versement exact et unique au compte
 * de jeu, échec visible et repris, finalisation seulement quand tout est crédité, comptes
 * fictifs dissous sans aucun mouvement réel.
 *
 * Cagnotte : 20 inscrits × 1 000 FCFA = 20 000 ; commission 10 % = 2 000 ; distribuable
 * 18 000 ; répartition 50 / 30 / 20 → 9 000, 5 400, 3 600.
 */
jest.setTimeout(120_000);

let database: TestDatabase;
let stack: TournamentTestStack;
let admin: UserId;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  stack = createTournamentTestStack(database.sql, new TestClock());
  await saveTournamentSettings(database.sql);
  admin = await seedAdmin(database.sql);
});
afterEach(async () => {
  await stack.stop();
  await database.sql.query('DROP FUNCTION IF EXISTS test_prize_fault() CASCADE');
  await database.reset();
});

/** Tournoi publié, 20 inscrits (réservations), démarré : prix capturés. */
async function startedTournament(): Promise<Tournament> {
  const t = await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, HOUR));
  await fillWith(stack, database.sql, t.id);
  stack.clock.set(t.startsAt);
  return stack.tournaments.advance(t.id);
}

const sql = <T extends object>(text: string, params: unknown[] = []) =>
  database.sql.query<T>(text, params).then((r) => r.rows);

const prizeTransactions = (t: Tournament) =>
  sql<{ user_id: string; tokens: string; idempotency_key: string }>(
    `SELECT user_id, tokens, idempotency_key FROM wallet_transactions
     WHERE kind = 'tournament_prize' AND idempotency_key LIKE $1 ORDER BY idempotency_key`,
    [`tournament-prize:${t.id}:%`],
  );

/** Un crédit de gain échoue pour ce joueur (panne simulée de l'écriture du compte de jeu). */
async function failPrizeCreditFor(userId: string) {
  await database.sql.query(
    `CREATE OR REPLACE FUNCTION test_prize_fault() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.kind = 'tournament_prize' AND NEW.user_id = '${userId}' THEN
         RAISE EXCEPTION 'panne simulée du compte de jeu';
       END IF;
       RETURN NEW;
     END; $$`,
  );
  await database.sql.query(
    `CREATE TRIGGER test_prize_fault BEFORE INSERT ON wallet_transactions
     FOR EACH ROW EXECUTE FUNCTION test_prize_fault()`,
  );
}

describe('plan de versement et crédits réels', () => {
  it('plan exact, validé, crédité une fois ; COMPLETED ; comptes dissous sans mouvement réel', async () => {
    const t = await startedTournament();
    expect(t).toMatchObject({ grossPool: 20_000, platformFee: 2_000, prizePool: 18_000 });
    const before = new Map<string, number>();
    for (const r of await sql<{ player_id: string }>(
      'SELECT player_id FROM tournament_player_accounts WHERE tournament_id = $1',
      [t.id],
    )) {
      before.set(r.player_id, (await balances(database.sql, r.player_id as UserId)).balance);
    }

    stack.clock.set(t.endsAt);
    const done = await stack.tournaments.advance(t.id);
    expect(done.status).toBe('COMPLETED');

    const report = await stack.tournaments.payoutReport(t.id);
    expect(report.financialState).toBe('FINALIZED');
    expect(report.planValidatedAt).toBeDefined();
    expect(report.blockedAt).toBeUndefined();
    expect(report.payouts.map((p) => [p.rank, p.amount, p.status])).toEqual([
      [1, 9_000, 'CREDITED'],
      [2, 5_400, 'CREDITED'],
      [3, 3_600, 'CREDITED'],
    ]);
    expect(report.dueTotal).toBe(18_000);
    expect(report.creditedTotal).toBe(18_000);

    // Chaque gain = UNE transaction interne `tournament_prize` du bon montant, référencée.
    const txs = await prizeTransactions(t);
    expect(txs).toHaveLength(3);
    for (const p of report.payouts) {
      const tx = txs.find((x) => x.idempotency_key === p.idempotencyKey)!;
      expect(tx.user_id).toBe(p.playerId);
      expect(Number(tx.tokens)).toBe(p.amount);
      expect(p.walletTransactionId).toBeDefined();
      // Portefeuille réel crédité du montant exact.
      expect((await balances(database.sql, p.playerId as UserId)).balance).toBe(
        before.get(p.playerId)! + p.amount,
      );
    }
    // Les autres participants : portefeuille réel strictement inchangé (dissolution comprise).
    const winners = new Set(report.payouts.map((p) => p.playerId));
    for (const [playerId, balance] of before) {
      if (!winners.has(playerId)) {
        expect((await balances(database.sql, playerId as UserId)).balance).toBe(balance);
      }
    }
    const accounts = await sql<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM tournament_player_accounts
       WHERE tournament_id = $1 GROUP BY status`,
      [t.id],
    );
    expect(accounts).toEqual([{ status: 'DISSOLVED', n: 20 }]);
    // Une notification de gain par gagnant, émise avec le crédit ; jamais en double.
    const notices = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
       WHERE type = 'TOURNAMENT_PRIZE_CREDITED' AND payload->>'tournamentId' = $1`,
      [t.id],
    );
    expect(notices[0]!.n).toBe(3);

    // Reprise (planificateur, nouvelle commande, « redémarrage ») : rien n'est recrédité.
    await stack.tournaments.advance(t.id);
    await stack.scheduler.tick();
    const restarted = createTournamentTestStack(database.sql, stack.clock);
    try {
      await restarted.tournaments.advance(t.id);
      await restarted.scheduler.tick();
    } finally {
      await restarted.stop();
    }
    expect(await prizeTransactions(t)).toHaveLength(3);
  });

  it('incohérence financière : versements bloqués et visibles ; reprise automatique une fois cohérent', async () => {
    const t = await startedTournament();
    // Écriture de commission altérée : la cagnotte n'est plus prouvée par le journal.
    await database.sql.query(
      `UPDATE platform_ledger SET amount = amount + 1
       WHERE tournament_id = $1 AND kind = 'TOURNAMENT_PLATFORM_FEE'`,
      [t.id],
    );
    stack.clock.set(t.endsAt);
    const blocked = await stack.tournaments.advance(t.id);
    expect(blocked.status).toBe('RESULTS_VALIDATED');
    const report = await stack.tournaments.payoutReport(t.id);
    expect(report.financialState).toBe('BLOCKED');
    expect(report.blockReasons).toContain('TOURNAMENT_FEE_ENTRY_MISMATCH');
    expect(report.payouts.every((p) => p.status === 'PENDING')).toBe(true);
    expect(await prizeTransactions(t)).toEqual([]);

    // Données corrigées : contrôles rejoués, blocage levé, versements effectués.
    await database.sql.query(
      `UPDATE platform_ledger SET amount = amount - 1
       WHERE tournament_id = $1 AND kind = 'TOURNAMENT_PLATFORM_FEE'`,
      [t.id],
    );
    expect((await stack.tournaments.advance(t.id)).status).toBe('COMPLETED');
    const after = await stack.tournaments.payoutReport(t.id);
    expect(after.blockedAt).toBeUndefined();
    expect(after.financialState).toBe('FINALIZED');
    expect(await prizeTransactions(t)).toHaveLength(3);
  });

  it('échec d’un crédit : FAILED visible, les autres payés, jamais COMPLETED ; reprise sans double crédit', async () => {
    const t = await startedTournament();
    // Blocage temporaire pour figer le tournoi au classement publié et lire le plan.
    await database.sql.query(
      `UPDATE platform_ledger SET amount = amount + 1
       WHERE tournament_id = $1 AND kind = 'TOURNAMENT_PLATFORM_FEE'`,
      [t.id],
    );
    stack.clock.set(t.endsAt);
    await stack.tournaments.advance(t.id);
    const plan = (await stack.tournaments.payoutReport(t.id)).payouts;
    const second = plan.find((p) => p.rank === 2)!;
    const secondBefore = (await balances(database.sql, second.playerId as UserId)).balance;
    await failPrizeCreditFor(second.playerId);
    await database.sql.query(
      `UPDATE platform_ledger SET amount = amount - 1
       WHERE tournament_id = $1 AND kind = 'TOURNAMENT_PLATFORM_FEE'`,
      [t.id],
    );

    const paying = await stack.tournaments.advance(t.id);
    expect(paying.status).toBe('DISTRIBUTING_PRIZES');
    const failed = await stack.tournaments.payoutReport(t.id);
    expect(failed.financialState).toBe('PAYMENT_FAILED');
    expect(failed.payouts.map((p) => [p.rank, p.status])).toEqual([
      [1, 'CREDITED'],
      [2, 'FAILED'],
      [3, 'CREDITED'],
    ]);
    expect(failed.payouts[1]).toMatchObject({ attempts: 1 });
    expect(failed.payouts[1]!.lastError).toMatch(/panne simulée/);
    expect(failed.creditedTotal).toBe(9_000 + 3_600);
    // Aucune notification de gain pour un crédit qui n'a pas eu lieu.
    const notices = await sql<{ rank: string }>(
      `SELECT payload->>'rank' AS rank FROM notifications
       WHERE type = 'TOURNAMENT_PRIZE_CREDITED' AND payload->>'tournamentId' = $1 ORDER BY 1`,
      [t.id],
    );
    expect(notices.map((n) => n.rank)).toEqual(['1', '3']);
    // La base refuse la finalisation tant qu'un versement n'est pas crédité.
    await expect(
      database.sql.query(`UPDATE tournaments SET status = 'COMPLETED' WHERE id = $1`, [t.id]),
    ).rejects.toThrow(/versements non crédités/);

    // Avant le délai de reprise : pas de nouvelle tentative.
    await stack.tournaments.advance(t.id);
    expect((await stack.tournaments.payoutReport(t.id)).payouts[1]).toMatchObject({
      status: 'FAILED',
      attempts: 1,
    });

    // Panne résolue, délai écoulé : repris une fois, crédité une fois, tournoi finalisé.
    await database.sql.query('DROP FUNCTION test_prize_fault() CASCADE');
    stack.clock.advance(61_000);
    expect((await stack.tournaments.advance(t.id)).status).toBe('COMPLETED');
    const final = await stack.tournaments.payoutReport(t.id);
    expect(final.financialState).toBe('FINALIZED');
    expect(final.payouts[1]).toMatchObject({ status: 'CREDITED', attempts: 2 });
    expect(await prizeTransactions(t)).toHaveLength(3);
    expect((await balances(database.sql, second.playerId as UserId)).balance).toBe(
      secondBefore + 5_400,
    );
  });

  it('finalisation simultanée sur deux instances : chaque gain crédité une seule fois', async () => {
    const t = await startedTournament();
    stack.clock.set(t.endsAt);
    const other = createTournamentTestStack(database.sql, stack.clock);
    try {
      await Promise.all([
        stack.tournaments.advance(t.id),
        other.tournaments.advance(t.id),
        stack.scheduler.tick(),
        other.scheduler.tick(),
      ]);
    } finally {
      await other.stop();
    }
    expect((await stack.repository.findById(t.id))!.status).toBe('COMPLETED');
    expect(await prizeTransactions(t)).toHaveLength(3);
    const credited = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM tournament_payouts
       WHERE tournament_id = $1 AND status = 'CREDITED'`,
      [t.id],
    );
    expect(credited[0]!.n).toBe(3);
  });

  it('échec du signal temps réel : crédit unique, aucune reprise de crédit', async () => {
    const clock = stack.clock;
    await stack.stop();
    stack = createTournamentTestStack(database.sql, clock, {
      userEvents: {
        publish: () => {
          throw new Error('Redis indisponible');
        },
      },
    });
    const t = await startedTournament();
    stack.clock.set(t.endsAt);
    expect((await stack.tournaments.advance(t.id)).status).toBe('COMPLETED');
    await stack.tournaments.advance(t.id);
    expect(await prizeTransactions(t)).toHaveLength(3);
  });
});

describe('garde-fous en base du plan de versement', () => {
  it('plan immuable, crédit définitif, référence cohérente, un bénéficiaire par rang', async () => {
    const t = await startedTournament();
    stack.clock.set(t.endsAt);
    await stack.tournaments.advance(t.id);
    const [first] = (await stack.tournaments.payoutReport(t.id)).payouts;
    await expect(
      database.sql.query(
        `UPDATE tournament_payouts SET status = 'PENDING', wallet_transaction_id = NULL,
           credited_at = NULL WHERE tournament_id = $1 AND rank = 1`,
        [t.id],
      ),
    ).rejects.toThrow(/déjà créditée/);
    await expect(
      database.sql.query(
        `UPDATE tournament_payouts SET amount = amount + 1 WHERE tournament_id = $1 AND rank = 1`,
        [t.id],
      ),
    ).rejects.toThrow(/immuable/);
    await expect(
      database.sql.query('DELETE FROM tournament_payouts WHERE tournament_id = $1', [t.id]),
    ).rejects.toThrow(/immuable/);
    // Un autre rang au même bénéficiaire : refusé (contrainte d'unicité).
    await expect(
      database.sql.query(
        `INSERT INTO tournament_payouts (tournament_id, rank, player_id, amount, idempotency_key,
           status, created_at) VALUES ($1, 4, $2, 1, $3, 'PENDING', now())`,
        [t.id, first!.playerId, `tournament-prize:${t.id}:4`],
      ),
    ).rejects.toThrow();
    // Une transaction d'un autre montant ne peut pas servir de preuve de crédit.
    const [fourth] = await sql<{ player_id: string }>(
      'SELECT player_id FROM tournament_results WHERE tournament_id = $1 AND rank = 4',
      [t.id],
    );
    // Un « gain de tournoi » hors du plan officiel est refusé par la base (fin de transaction).
    await expect(
      database.sql.query(
        `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
           created_at, updated_at, completed_at)
         VALUES (gen_random_uuid(), $1, 'tournament_prize', 'succeeded', 999, 'bogus', now(),
           now(), now())`,
        [fourth!.player_id],
      ),
    ).rejects.toThrow(/sans ligne créditée du plan/);
    // Une autre écriture (dépôt) ne peut pas servir de preuve de crédit d'une récompense.
    const deposit = await sql<{ id: string }>(
      `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
         created_at, updated_at, completed_at)
       VALUES (gen_random_uuid(), $1, 'deposit', 'succeeded', 1, 'not-a-prize', now(), now(),
         now()) RETURNING id`,
      [fourth!.player_id],
    );
    await expect(
      database.sql.query(
        `INSERT INTO tournament_payouts (tournament_id, rank, player_id, amount, idempotency_key,
           status, wallet_transaction_id, created_at, credited_at)
         VALUES ($1, 4, $2, 1, $3, 'CREDITED', $4, now(), now())`,
        [t.id, fourth!.player_id, `tournament-prize:${t.id}:4`, deposit[0]!.id],
      ),
    ).rejects.toThrow(/incohérent avec le plan/);
  });

  it('jetons de tournoi → FCFA impossible : aucune mise, réservation ni gain réel pour une partie de tournoi', async () => {
    const t = await startedTournament();
    const players = await sql<{ player_id: string }>(
      'SELECT player_id FROM tournament_player_accounts WHERE tournament_id = $1 LIMIT 2',
      [t.id],
    );
    const seat = await stack.tournaments.join(t.id, players[0]!.player_id as UserId);
    await stack.tournaments.join(t.id, players[1]!.player_id as UserId);
    await expect(
      database.sql.query(
        `INSERT INTO game_settlements (game_id, session_id, stake, reserved_per_player,
           commission_bps, status, opened_at) VALUES ($1, $2, 100, 200, 0, 'RESERVED', now())`,
        [seat.gameId, seat.sessionId],
      ),
    ).rejects.toThrow(/aucun mouvement du compte de jeu réel/);
    await expect(
      database.sql.query(
        `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
           created_at, updated_at, completed_at, game_id)
         VALUES (gen_random_uuid(), $1, 'game_winnings', 'succeeded', 100, 'x', now(), now(),
           now(), $2)`,
        [players[0]!.player_id, seat.gameId],
      ),
    ).rejects.toThrow(/aucun mouvement du compte de jeu réel/);
    await expect(
      database.sql.query(
        `INSERT INTO wallet_reservations (id, wallet_id, game_id, amount, currency, status,
           created_at) VALUES (gen_random_uuid(), $1, $2, 200, 'XAF', 'ACTIVE', now())`,
        [players[0]!.player_id, seat.gameId],
      ),
    ).rejects.toThrow(/aucun mouvement du compte de jeu réel/);
  });
});

describe('API', () => {
  it('administration : rapport financier ; joueur : sa récompense réelle et son état', async () => {
    const winnerSession = await registerAndLogin(stack.app);
    const winner = winnerSession.userId as UserId;
    await fund(database.sql, winner, 5_000);
    const t = await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, HOUR));
    await stack.tournaments.register(t.id, winner);
    await fillWith(stack, database.sql, t.id);
    stack.clock.set(t.startsAt);
    await stack.tournaments.advance(t.id);
    stack.clock.set(t.endsAt);
    await stack.tournaments.advance(t.id);

    const adminUser = await registerAndLogin(stack.app);
    await database.sql.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [adminUser.userId]);
    const session = await adminLogin(
      stack.app,
      adminUser.email,
      adminUser.password,
      adminUser.userId,
    );
    const res = await request(stack.app)
      .get(`/api/admin/tournaments/${t.id}/payouts`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect(res.body).toMatchObject({
      financialState: 'FINALIZED',
      pool: { grossPool: 20_000, platformFee: 2_000, prizePool: 18_000, unallocatedPrize: 0 },
      dueTotal: 18_000,
      creditedTotal: 18_000,
      blocked: null,
    });
    expect(res.body.payouts).toHaveLength(3);
    expect(res.body.payouts[0]).toMatchObject({
      rank: 1,
      amount: 9_000,
      status: 'CREDITED',
      reference: `tournament-prize:${t.id}:1`,
    });
    expect(res.body.payouts[0].walletTransactionId).toEqual(expect.any(String));
    // Un joueur n'y a pas accès.
    await request(stack.app)
      .get(`/api/admin/tournaments/${t.id}/payouts`)
      .set('Authorization', `Bearer ${winnerSession.accessToken}`)
      .expect(403);

    const mine = await request(stack.app)
      .get(`/api/tournaments/${t.id}/results`)
      .set('Authorization', `Bearer ${winnerSession.accessToken}`)
      .expect(200);
    const rank = mine.body.me.rank as number;
    if (rank <= 3) {
      expect(mine.body.me.payout).toMatchObject({
        amount: [9_000, 5_400, 3_600][rank - 1],
        status: 'CREDITED',
      });
    } else {
      expect(mine.body.me.payout).toBeNull();
    }
  });
});

describe('atomicité, reprise et contrôles en cours de distribution (D-112)', () => {
  /** Tournoi bloqué au classement publié (plan lisible), puis débloqué. */
  async function publishedPlan() {
    const t = await startedTournament();
    await database.sql.query(
      `UPDATE platform_ledger SET amount = amount + 1
       WHERE tournament_id = $1 AND kind = 'TOURNAMENT_PLATFORM_FEE'`,
      [t.id],
    );
    stack.clock.set(t.endsAt);
    await stack.tournaments.advance(t.id);
    const plan = (await stack.tournaments.payoutReport(t.id)).payouts;
    const unblock = () =>
      database.sql.query(
        `UPDATE platform_ledger SET amount = amount - 1
         WHERE tournament_id = $1 AND kind = 'TOURNAMENT_PLATFORM_FEE'`,
        [t.id],
      );
    return { t, plan, unblock };
  }

  it('panne APRÈS le crédit du compte de jeu, AVANT le passage CREDITED : tout est annulé, puis un seul crédit', async () => {
    const { t, plan, unblock } = await publishedPlan();
    const first = plan[0]!;
    const before = (await balances(database.sql, first.playerId as UserId)).balance;
    // La mise à jour du plan échoue pour le rang 1 : le crédit du compte de jeu, déjà écrit
    // dans la même transaction, doit disparaître avec elle.
    await database.sql.query(
      `CREATE OR REPLACE FUNCTION test_prize_fault() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.status = 'CREDITED' AND NEW.rank = 1 THEN
           RAISE EXCEPTION 'crash simulé après le crédit';
         END IF;
         RETURN NEW;
       END; $$`,
    );
    await database.sql.query(
      `CREATE TRIGGER test_prize_fault BEFORE UPDATE ON tournament_payouts
       FOR EACH ROW EXECUTE FUNCTION test_prize_fault()`,
    );
    await unblock();
    await stack.tournaments.advance(t.id);
    const failed = await stack.tournaments.payoutReport(t.id);
    expect(failed.payouts[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
    // Jamais « compte crédité + versement non crédité » : aucune écriture, solde inchangé.
    expect((await balances(database.sql, first.playerId as UserId)).balance).toBe(before);
    const rank1Tx = await sql(`SELECT 1 FROM wallet_transactions WHERE idempotency_key = $1`, [
      first.idempotencyKey,
    ]);
    expect(rank1Tx).toEqual([]);
    expect((await stack.repository.findById(t.id))!.status).toBe('DISTRIBUTING_PRIZES');

    await database.sql.query('DROP FUNCTION test_prize_fault() CASCADE');
    stack.clock.advance(61_000);
    expect((await stack.tournaments.advance(t.id)).status).toBe('COMPLETED');
    expect((await balances(database.sql, first.playerId as UserId)).balance).toBe(
      before + first.amount,
    );
    const report = await stack.tournaments.payoutReport(t.id);
    // Audit : tentatives et dernier motif d'échec conservés après le succès.
    expect(report.payouts[0]).toMatchObject({ status: 'CREDITED', attempts: 2 });
    expect(report.payouts[0]!.lastError).toMatch(/crash simulé/);
    expect(await prizeTransactions(t)).toHaveLength(3);
  });

  it('incohérence apparue PENDANT la distribution : versements restants et clôture bloqués, puis reprise', async () => {
    const { t, plan, unblock } = await publishedPlan();
    await failPrizeCreditFor(plan[1]!.playerId);
    await unblock();
    await stack.tournaments.advance(t.id);
    expect((await stack.tournaments.payoutReport(t.id)).payouts.map((p) => p.status)).toEqual([
      'CREDITED',
      'FAILED',
      'CREDITED',
    ]);
    // La panne disparaît, mais la cagnotte devient incohérente avant la reprise.
    await database.sql.query('DROP FUNCTION test_prize_fault() CASCADE');
    await database.sql.query(
      `UPDATE platform_ledger SET amount = amount + 7
       WHERE tournament_id = $1 AND kind = 'TOURNAMENT_PLATFORM_FEE'`,
      [t.id],
    );
    stack.clock.advance(61_000);
    expect((await stack.tournaments.advance(t.id)).status).toBe('DISTRIBUTING_PRIZES');
    const blocked = await stack.tournaments.payoutReport(t.id);
    expect(blocked.financialState).toBe('BLOCKED');
    expect(blocked.blockReasons).toContain('TOURNAMENT_FEE_ENTRY_MISMATCH');
    expect(blocked.payouts[1]).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(await prizeTransactions(t)).toHaveLength(2);

    await database.sql.query(
      `UPDATE platform_ledger SET amount = amount - 7
       WHERE tournament_id = $1 AND kind = 'TOURNAMENT_PLATFORM_FEE'`,
      [t.id],
    );
    expect((await stack.tournaments.advance(t.id)).status).toBe('COMPLETED');
    const final = await stack.tournaments.payoutReport(t.id);
    expect(final.blockedAt).toBeUndefined();
    expect(final.financialState).toBe('FINALIZED');
    expect(await prizeTransactions(t)).toHaveLength(3);
  });

  it('trois instances simultanées après une panne : chaque gain crédité une seule fois', async () => {
    const { t, plan, unblock } = await publishedPlan();
    await failPrizeCreditFor(plan[2]!.playerId);
    await unblock();
    const others = [
      createTournamentTestStack(database.sql, stack.clock),
      createTournamentTestStack(database.sql, stack.clock),
    ];
    try {
      await Promise.all([stack, ...others].map((s) => s.tournaments.advance(t.id)));
      await database.sql.query('DROP FUNCTION test_prize_fault() CASCADE');
      stack.clock.advance(61_000);
      await Promise.all([stack, ...others].map((s) => s.tournaments.advance(t.id)));
      await Promise.all([stack, ...others].map((s) => s.scheduler.tick()));
    } finally {
      await Promise.all(others.map((o) => o.stop()));
    }
    expect((await stack.repository.findById(t.id))!.status).toBe('COMPLETED');
    expect(await prizeTransactions(t)).toHaveLength(3);
    const notices = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
       WHERE type = 'TOURNAMENT_PRIZE_CREDITED' AND payload->>'tournamentId' = $1`,
      [t.id],
    );
    expect(notices[0]!.n).toBe(3);
  });
});
