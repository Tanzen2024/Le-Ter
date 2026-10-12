import { operatorOfPhone } from '../../../src/domain/payments/payment';

/**
 * Opérateur du numéro d'inscription (D-090) : plan de numérotation camerounais, bornes incluses.
 * Tout le reste → null (aucun moyen de paiement proposé, jamais un choix arbitraire).
 */
describe('operatorOfPhone', () => {
  it.each([
    '+237650000000',
    '+237654999999',
    '+237670000000',
    '+237679999999',
    '+237680000000',
    '+237684999999',
    '+237692130271'.replace('69', '67'),
  ])('%s → MTN_CM', (phone) => {
    expect(operatorOfPhone(phone)).toBe('MTN_CM');
  });

  it.each([
    '+237655000000',
    '+237659999999',
    '+237685000000',
    '+237689999999',
    '+237690000000',
    '+237692130271',
    '+237699999999',
  ])('%s → OM_CM', (phone) => {
    expect(operatorOfPhone(phone)).toBe('OM_CM');
  });

  it.each([
    ['Nexttel 66x', '+237661234567'],
    ['fixe Camtel', '+237222123456'],
    ['préfixe 60x', '+237600000000'],
    ['autre pays', '+2250707070700'],
    ['sans indicatif', '692130271'],
    ['trop court', '+23769213027'],
    ['trop long', '+2376921302711'],
    ['espaces', '+237 692130271'],
    ['vide', ''],
  ])('%s (%s) → null', (_label, phone) => {
    expect(operatorOfPhone(phone)).toBeNull();
  });
});
