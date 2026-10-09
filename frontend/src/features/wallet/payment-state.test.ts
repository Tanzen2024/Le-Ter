import { DEPOSIT_AMOUNTS, formatFcfa, formatTokens, paymentDisplay } from './payment-state';

describe('payment-state (D-050)', () => {
  it('montants proposés : 500, 1 000, 2 000, 5 000 FCFA', () => {
    expect(DEPOSIT_AMOUNTS.map(formatFcfa)).toEqual([
      '500 FCFA',
      '1 000 FCFA',
      '2 000 FCFA',
      '5 000 FCFA',
    ]);
  });

  it('1 FCFA = 1 jeton', () => {
    expect(formatTokens(1)).toBe('1 jeton');
    expect(formatTokens(1000)).toBe('1 000 jetons');
  });

  it.each([
    ['PENDING', 'pending', 'Paiement en cours...'],
    ['SUCCESS', 'success', 'Paiement confirmé'],
    ['FAILED', 'error', 'Paiement échoué'],
    ['EXPIRED', 'error', 'Paiement expiré'],
  ] as const)('statut serveur %s → %s « %s »', (status, tone, title) => {
    expect(paymentDisplay({ status, amount: 1000 })).toMatchObject({ tone, title });
  });

  it('succès : « +1 000 jetons »', () => {
    expect(paymentDisplay({ status: 'SUCCESS', amount: 1000 }).detail).toBe(
      '+1 000 jetons',
    );
  });
});
