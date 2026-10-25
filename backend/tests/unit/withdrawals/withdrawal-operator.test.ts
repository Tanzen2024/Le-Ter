import {
  WithdrawalOperatorNotAllowedError,
  withdrawalOperatorOfPhone,
  WithdrawalPhoneUnsupportedError,
} from '../../../src/domain/wallet/withdrawal';
import { toApiError } from '../../../src/middleware/api-errors';
import { parseWithdrawalInput } from '../../../src/validators/withdrawal.validators';

/**
 * Opérateur d'un retrait : déduit par le SERVEUR du numéro d'inscription (plan de numérotation
 * existant, `operatorOfPhone`), puis vérifié contre les opérateurs de retrait autorisés.
 * L'opérateur envoyé par le client n'est jamais lu.
 */
describe('withdrawalOperatorOfPhone', () => {
  it.each([
    ['+237671234567', 'MTN_CM'],
    ['+237650000000', 'MTN_CM'],
    ['+237684999999', 'MTN_CM'],
    ['+237691234567', 'OM_CM'],
    ['+237655000000', 'OM_CM'],
    ['+237689999999', 'OM_CM'],
  ])('%s → %s', (phone, operator) => {
    expect(withdrawalOperatorOfPhone(phone)).toEqual({ ok: true, operator });
  });

  it.each([
    ['Nexttel (66x)', '+237661234567'],
    ['fixe camerounais', '+237222123456'],
    ['hors Cameroun', '+2250701234567'],
    ['format local sans indicatif', '671234567'],
    ['trop court', '+23767123456'],
    ['vide', ''],
  ])('%s : refus PHONE_UNSUPPORTED, aucune bascule vers un autre opérateur', (_l, phone) => {
    expect(withdrawalOperatorOfPhone(phone)).toEqual({ ok: false, reason: 'PHONE_UNSUPPORTED' });
  });

  it('opérateur identifié mais non autorisé au retrait : refus OPERATOR_NOT_ALLOWED', () => {
    expect(withdrawalOperatorOfPhone('+237671234567', ['OM_CM'])).toEqual({
      ok: false,
      reason: 'OPERATOR_NOT_ALLOWED',
    });
    expect(withdrawalOperatorOfPhone('+237691234567', ['OM_CM'])).toEqual({
      ok: true,
      operator: 'OM_CM',
    });
  });
});

describe('erreurs métier explicites', () => {
  it('opérateur non autorisé → 422 WITHDRAWAL_OPERATOR_UNSUPPORTED', () => {
    expect(toApiError(new WithdrawalOperatorNotAllowedError())).toEqual(
      expect.objectContaining({
        status: 422,
        body: expect.objectContaining({ code: 'WITHDRAWAL_OPERATOR_UNSUPPORTED' }),
      }),
    );
  });

  it('numéro non pris en charge → 422 WITHDRAWAL_PHONE_UNSUPPORTED (inchangé)', () => {
    expect(toApiError(new WithdrawalPhoneUnsupportedError())).toEqual(
      expect.objectContaining({
        status: 422,
        body: expect.objectContaining({ code: 'WITHDRAWAL_PHONE_UNSUPPORTED' }),
      }),
    );
  });
});

describe('parseWithdrawalInput', () => {
  it.each([
    ['valide', { tokens: 1000, operator: 'OM_CM' }],
    ['inconnu', { tokens: 1000, operator: 'OM_CI' }],
    ['non textuel', { tokens: 1000, operator: { code: 'MTN_CM' } }],
    ['absent', { tokens: 1000 }],
  ])('opérateur %s : jamais lu ni renvoyé', (_l, body) => {
    expect(parseWithdrawalInput(body)).toEqual({ tokens: 1000 });
  });
});
