import {
  finalOutcomeOfTransferStatus,
  isSupportedWithdrawalPhone,
  isValidWithdrawalLimit,
  quotaWindowStart,
} from '../../../src/domain/wallet/withdrawal';
import { ValidationError } from '../../../src/validators/validation-error';
import {
  parseWithdrawalInput,
  parseWithdrawalLimitChange,
} from '../../../src/validators/withdrawal.validators';

/** Règles du retrait (D-075) : montant, opérateur, quota, numéros, statuts du fournisseur. */
describe('parseWithdrawalInput', () => {
  it.each([1000, 5000, 1_500_000])('%p jetons : accepté', (tokens) => {
    expect(parseWithdrawalInput({ tokens, operator: 'OM_CM' })).toEqual({
      tokens,
      operator: 'OM_CM',
    });
  });

  it.each([999, 0, -1, -1000, 1000.5, NaN, Infinity, -Infinity, 1_500_001, '1000', '', null, undefined, [], {}])(
    '%p : refusé, jamais converti',
    (tokens) => {
      expect(() => parseWithdrawalInput({ tokens, operator: 'MTN_CM' })).toThrow(ValidationError);
    },
  );

  it('corps absent ou tableau : refusé ; opérateur hors XAF : refusé', () => {
    expect(() => parseWithdrawalInput(undefined)).toThrow(ValidationError);
    expect(() => parseWithdrawalInput([1000])).toThrow(ValidationError);
    expect(() => parseWithdrawalInput({ tokens: 1000, operator: 'WAVE_SN' })).toThrow(
      ValidationError,
    );
  });
});

describe('parseWithdrawalLimitChange', () => {
  it('null = illimité ; entiers dans les bornes', () => {
    expect(parseWithdrawalLimitChange({ count: null, periodMinutes: null })).toEqual({
      count: null,
      periodMinutes: null,
    });
    expect(parseWithdrawalLimitChange({ count: 5, periodMinutes: 7 * 1440 })).toEqual({
      count: 5,
      periodMinutes: 10_080,
    });
  });

  it.each([
    { count: 0, periodMinutes: null },
    { count: 3, periodMinutes: -1 },
    { count: '3', periodMinutes: null },
    { count: Infinity, periodMinutes: null },
    { count: 3 },
    { periodMinutes: 60 },
    { count: 1001, periodMinutes: 60 },
    { count: 1, periodMinutes: 365 * 1440 + 1 },
  ])('%j : refusé', (body) => {
    expect(() => parseWithdrawalLimitChange(body)).toThrow(ValidationError);
  });
});

describe('quota et statuts', () => {
  it('fenêtre glissante ; période ∞ : aucune fenêtre', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    expect(quotaWindowStart({ count: 3, periodMinutes: 1440 }, now)).toEqual(
      new Date('2026-10-09T12:00:00Z'),
    );
    expect(quotaWindowStart({ count: 3, periodMinutes: null }, now)).toBeNull();
    expect(isValidWithdrawalLimit({ count: Infinity, periodMinutes: null })).toBe(false);
  });

  it('seuls SUCCESS, FAILED et INSUFFICIENT_BALANCE sont finaux', () => {
    expect(finalOutcomeOfTransferStatus('SUCCESS')).toBe('SUCCEEDED');
    expect(finalOutcomeOfTransferStatus('FAILED')).toBe('FAILED');
    expect(finalOutcomeOfTransferStatus('INSUFFICIENT_BALANCE')).toBe('FAILED');
    for (const status of ['PENDING', 'INITIATED', 'OK', 'TRANSACTION_EXIST', 'NOT_FOUND', '']) {
      expect(finalOutcomeOfTransferStatus(status)).toBeUndefined();
    }
  });

  it('numéros pris en charge : +237 et 9 chiffres', () => {
    expect(isSupportedWithdrawalPhone('+237670000000')).toBe(true);
    expect(isSupportedWithdrawalPhone('+2250701234567')).toBe(false);
    expect(isSupportedWithdrawalPhone('237670000000')).toBe(false);
  });
});
