import {
  findOperatorMismatches,
  type OpenWithdrawalRow,
} from '../../../src/services/withdrawals/withdrawal-operator-audit';

/**
 * Retraits ouverts créés avant D-163 : leur opérateur (choisi par le client) est comparé à
 * celui que le serveur déduit aujourd'hui du numéro d'inscription. Lecture seule ; le rapport
 * ne contient jamais le numéro.
 */
const row = (over: Partial<OpenWithdrawalRow>): OpenWithdrawalRow => ({
  withdrawalId: 'w-1',
  status: 'CREATED',
  operator: 'MTN_CM',
  phone: '+237671234567',
  ...over,
});

describe('findOperatorMismatches', () => {
  it('opérateur conforme au numéro : aucun écart', () => {
    expect(
      findOperatorMismatches([row({}), row({ withdrawalId: 'w-2', operator: 'OM_CM', phone: '+237691234567' })]),
    ).toEqual([]);
  });

  it('opérateur imposé par le client avant D-163 : écart signalé, sans numéro', () => {
    const mismatches = findOperatorMismatches([
      row({ withdrawalId: 'w-3', status: 'PROCESSING', operator: 'OM_CM', phone: '+237671234567' }),
    ]);
    expect(mismatches).toEqual([
      { withdrawalId: 'w-3', status: 'PROCESSING', storedOperator: 'OM_CM', deduced: 'MTN_CM' },
    ]);
    expect(JSON.stringify(mismatches)).not.toContain('671234567');
  });

  it('numéro devenu non pris en charge : motif de refus signalé', () => {
    expect(findOperatorMismatches([row({ withdrawalId: 'w-4', phone: '+237622000000' })])).toEqual([
      { withdrawalId: 'w-4', status: 'CREATED', storedOperator: 'MTN_CM', deduced: 'PHONE_UNSUPPORTED' },
    ]);
  });
});
