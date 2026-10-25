import {
  DEFAULT_REFERRAL_RULES,
  dueTiers,
  generateReferralCode,
  nextTierProgress,
  normalizeReferralCode,
} from '../../../src/domain/referrals/referral';

/** Règles pures du parrainage (D-161) : paliers progressifs et code personnel. */
const rules = DEFAULT_REFERRAL_RULES;
const credited = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ tier: i + 1, referralsRequired: (i + 1) * 10 }));

describe('dueTiers', () => {
  it.each([
    [9, 0, 0],
    [10, 0, 1],
    [19, 1, 0],
    [20, 1, 1],
    [29, 2, 0],
    [30, 2, 1],
    [40, 0, 4],
  ])('%i filleuls comptés, %i paliers crédités → %i palier(s) dû(s)', (count, done, due) => {
    expect(dueTiers(rules, credited(done), count)).toHaveLength(due);
  });

  it('ne crédite que la tranche supplémentaire, 5 000 jetons par palier', () => {
    expect(dueTiers(rules, credited(1), 20)).toEqual([{ tier: 2, referralsRequired: 20, amount: 5000 }]);
  });

  it('respecte un plafond configuré et un changement de taille sans rétroactivité', () => {
    expect(dueTiers({ ...rules, maxTiers: 2 }, credited(2), 100)).toEqual([]);
    expect(dueTiers({ ...rules, referralsPerTier: 5 }, credited(1), 15)).toEqual([
      { tier: 2, referralsRequired: 15, amount: 5000 },
    ]);
  });

  it('indique la progression vers le prochain palier', () => {
    expect(nextTierProgress(rules, credited(1), 13)).toEqual({
      tier: 2,
      referralsRequired: 20,
      remaining: 7,
      reward: 5000,
    });
    expect(nextTierProgress({ ...rules, maxTiers: 1 }, credited(1), 13)).toBeNull();
  });
});

describe('code personnel', () => {
  it('génère des codes lisibles et normalise la saisie', () => {
    const code = generateReferralCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(normalizeReferralCode(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `)).toBe(code);
    expect(normalizeReferralCode('ABCD0EFG')).toBeNull();
    expect(normalizeReferralCode('ABC')).toBeNull();
  });
});
