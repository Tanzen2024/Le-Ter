import { computePrizes, type TournamentId } from '../../../src/domain/tournaments/tournament';
import {
  payoutIdempotencyKey,
  payoutPlanAnomalies,
  planPayouts,
  tournamentFinancialState,
} from '../../../src/domain/tournaments/tournament-payouts';

/** Plan de versement des récompenses réelles (D-112) : fonctions pures. */
const T = '11111111-1111-4111-8111-111111111111' as TournamentId;
const RULES = [
  { rank: 1, shareBps: 5000 },
  { rank: 2, shareBps: 3000 },
  { rank: 3, shareBps: 2000 },
];

/** Classement de `n` joueurs avec la répartition officielle de `pool`. */
function ranking(pool: number, n: number, rules = RULES) {
  const { prizes } = computePrizes(pool, rules, n);
  const byRank = new Map(prizes.map((p) => [p.rank, p.amount]));
  return Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    playerId: `p${i + 1}`,
    prizeAmount: byRank.get(i + 1) ?? 0,
  }));
}
const planOf = (results: ReturnType<typeof ranking>) =>
  planPayouts(
    T,
    results.map((r) => ({ rank: r.rank, playerId: r.playerId, amount: r.prizeAmount })),
  );

describe('plan', () => {
  it('une ligne par rang récompensé, référence unique et stable (compatible D-054)', () => {
    const plan = planOf(ranking(18_000, 20));
    expect(plan).toEqual([
      { rank: 1, playerId: 'p1', amount: 9_000, idempotencyKey: payoutIdempotencyKey(T, 1) },
      { rank: 2, playerId: 'p2', amount: 5_400, idempotencyKey: payoutIdempotencyKey(T, 2) },
      { rank: 3, playerId: 'p3', amount: 3_600, idempotencyKey: payoutIdempotencyKey(T, 3) },
    ]);
    expect(payoutIdempotencyKey(T, 2)).toBe(`tournament-prize:${T}:2`);
  });

  it('arrondi déterministe : parts à l’entier inférieur, reste au 1er rang, somme exacte', () => {
    const thirds = [
      { rank: 1, shareBps: 3334 },
      { rank: 2, shareBps: 3333 },
      { rank: 3, shareBps: 3333 },
    ];
    const results = ranking(1_001, 5, thirds);
    const plan = planOf(results);
    expect(plan.map((p) => p.amount)).toEqual([335, 333, 333]);
    expect(plan.reduce((s, p) => s + p.amount, 0)).toBe(1_001);
    expect(
      payoutPlanAnomalies({
        prizePool: 1_001,
        unallocatedPrize: 0,
        prizeRules: thirds,
        results,
        payouts: plan,
      }),
    ).toEqual([]);
  });

  it('moins de classés que de rangs payés : part non attribuée hors plan, total exact', () => {
    const results = ranking(10_000, 2);
    const unallocated = computePrizes(10_000, RULES, 2).unallocated;
    expect(unallocated).toBe(2_000);
    expect(
      payoutPlanAnomalies({
        prizePool: 10_000,
        unallocatedPrize: unallocated,
        prizeRules: RULES,
        results,
        payouts: planOf(results),
      }),
    ).toEqual([]);
  });
});

describe('contrôles avant tout crédit', () => {
  const results = ranking(18_000, 20);
  const plan = planOf(results);
  const check = (over: Partial<Parameters<typeof payoutPlanAnomalies>[0]>) =>
    payoutPlanAnomalies({
      prizePool: 18_000,
      unallocatedPrize: 0,
      prizeRules: RULES,
      results,
      payouts: plan,
      ...over,
    });

  it('plan conforme : aucun motif', () => {
    expect(check({})).toEqual([]);
  });

  it('montant altéré, bénéficiaire changé, doublon, ligne manquante ou en trop : bloqué', () => {
    expect(
      check({ payouts: plan.map((p) => (p.rank === 2 ? { ...p, amount: 5_401 } : p)) }),
    ).toEqual(
      expect.arrayContaining(['PLAN_AMOUNT_MISMATCH', 'PLAN_TOTAL_MISMATCH', 'PLAN_EXCEEDS_POOL']),
    );
    expect(
      check({ payouts: plan.map((p) => (p.rank === 2 ? { ...p, playerId: 'p9' } : p)) }),
    ).toContain('PLAN_BENEFICIARY_MISMATCH');
    expect(check({ payouts: plan.map((p) => ({ ...p, playerId: 'p1' })) })).toContain(
      'PLAN_DUPLICATE_BENEFICIARY',
    );
    expect(check({ payouts: plan.slice(0, 2) })).toEqual(
      expect.arrayContaining(['PLAN_ROW_MISSING', 'PLAN_TOTAL_MISMATCH']),
    );
    expect(check({ payouts: [...plan, { rank: 4, playerId: 'p4', amount: 1 }] })).toContain(
      'PLAN_ROW_UNEXPECTED',
    );
  });

  it('classement non conforme à la répartition officielle, cagnotte ou règles absentes : bloqué', () => {
    const tampered = results.map((r) => (r.rank === 1 ? { ...r, prizeAmount: 8_000 } : r));
    expect(check({ results: tampered })).toContain('PLAN_RULES_MISMATCH');
    expect(check({ results: results.filter((r) => r.rank !== 5) })).toContain(
      'RANKING_NOT_CONTIGUOUS',
    );
    expect(check({ prizePool: undefined })).toEqual(['PRIZE_POOL_MISSING']);
    expect(check({ prizeRules: [] })).toContain('PRIZE_RULES_MISSING');
  });
});

describe('état financier', () => {
  const credited = { status: 'CREDITED' as const };
  it.each([
    ['REGISTRATION_OPEN', false, [], 'NOT_STARTED'],
    ['IN_PROGRESS', false, [], 'IN_PROGRESS'],
    ['RESULTS_VALIDATED', false, [{ status: 'PENDING' as const }], 'PLAN_PENDING_VALIDATION'],
    ['RESULTS_VALIDATED', true, [{ status: 'PENDING' as const }], 'BLOCKED'],
    ['DISTRIBUTING_PRIZES', false, [credited, { status: 'PENDING' as const }], 'PAYING'],
    ['DISTRIBUTING_PRIZES', false, [credited, { status: 'FAILED' as const }], 'PAYMENT_FAILED'],
    ['COMPLETED', false, [credited, credited], 'FINALIZED'],
    ['CANCELLED', false, [], 'CANCELLED'],
  ] as const)('%s (bloqué : %s) → %s', (status, blocked, payouts, expected) => {
    expect(tournamentFinancialState({ status, blocked, payouts: [...payouts] })).toBe(expected);
  });
});
