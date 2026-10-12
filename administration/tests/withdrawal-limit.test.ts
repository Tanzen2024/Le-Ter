import { describe, expect, it } from 'vitest';

import {
  describeWithdrawalLimit,
  parseLimitForm,
} from '@/features/withdrawals/withdrawal-limit-card';

/** Quota de retraits (D-075) : ∞ par défaut, saisie validée avant l'envoi au serveur. */
const bounds = { maxCount: 1000, maxPeriodMinutes: 365 * 1440 };
const base = {
  countUnlimited: false,
  count: '3',
  periodUnlimited: false,
  period: '24',
  unit: 'hours' as const,
};

describe('quota de retraits', () => {
  it('description : illimité, fenêtre glissante, total', () => {
    expect(describeWithdrawalLimit({ count: null, periodMinutes: null })).toMatch(/illimités/);
    expect(describeWithdrawalLimit({ count: 3, periodMinutes: 1440 })).toBe(
      'Au plus 3 retraits par joueur sur toute période glissante de 1 jour.',
    );
    expect(describeWithdrawalLimit({ count: 1, periodMinutes: null })).toMatch(/au total/);
  });

  it('saisie valide : n = 3, t = 24 h ; n = 5, t = 7 jours ; retour à ∞', () => {
    expect(parseLimitForm(base, bounds).limit).toEqual({ count: 3, periodMinutes: 1440 });
    expect(
      parseLimitForm({ ...base, count: '5', period: '7', unit: 'days' }, bounds).limit,
    ).toEqual({ count: 5, periodMinutes: 10_080 });
    expect(
      parseLimitForm({ ...base, countUnlimited: true, periodUnlimited: true }, bounds).limit,
    ).toEqual({ count: null, periodMinutes: null });
  });

  it.each([
    [{ count: '0' }, 'count'],
    [{ count: '-1' }, 'count'],
    [{ count: '1.5' }, 'count'],
    [{ count: '' }, 'count'],
    [{ count: 'Infinity' }, 'count'],
    [{ count: '1001' }, 'count'],
    [{ period: '0' }, 'period'],
    [{ period: '400', unit: 'days' as const }, 'period'],
  ])('%j : refusé (%s)', (patch, field) => {
    const result = parseLimitForm({ ...base, ...patch }, bounds);
    expect(result.limit).toBeUndefined();
    expect(result.errors).toHaveProperty(field);
  });
});
