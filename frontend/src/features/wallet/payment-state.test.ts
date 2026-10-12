import {
  checkDepositAmount,
  DEFAULT_DEPOSIT_LIMITS,
  formatFcfa,
  formatTokens,
  paymentDisplay,
} from './payment-state';

describe('payment-state (D-050, D-085)', () => {
  it('limites par défaut : contrat CinetPay v1 (100 à 2 500 000 FCFA)', () => {
    expect(DEFAULT_DEPOSIT_LIMITS).toEqual({ min: 100, max: 2_500_000, currency: 'XAF' });
  });

  it.each([
    ['100', 100],
    ['1000', 1000],
    [' 2 500 000 ', 2_500_000],
    ['007500', 7500],
  ])('montant saisi %p valide → %i', (input, amount) => {
    expect(checkDepositAmount(input)).toEqual({ ok: true, amount });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['0', 'min'],
    ['99', 'min'],
    ['2500001', 'max'],
    ['99999999999999999999', 'min'],
    ['10.5', 'format'],
    ['10,5', 'format'],
    ['-100', 'format'],
    ['1e3', 'format'],
    ['abc', 'format'],
  ])('montant saisi %p refusé (%s)', (input, reason) => {
    expect(checkDepositAmount(input)).toMatchObject({ ok: false, reason });
  });

  it('limites du serveur prioritaires', () => {
    expect(checkDepositAmount('150', { min: 200, max: 1000 })).toMatchObject({ reason: 'min' });
    expect(checkDepositAmount('1001', { min: 200, max: 1000 })).toMatchObject({ reason: 'max' });
    expect(formatFcfa(500)).toBe(formatFcfa(500));
  });

  it('1 FCFA = 1 jeton', () => {
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

describe('payment-state — paiement direct (D-083)', () => {
  const direct = { amount: 2000, mode: 'DIRECT' as const, operator: 'MTN_CM' as const };

  it('en attente : « En attente de confirmation sur votre téléphone », jamais un succès', () => {
    expect(paymentDisplay({ ...direct, status: 'PENDING' })).toEqual({
      tone: 'pending',
      title: 'En attente de confirmation sur votre téléphone',
      detail: `Validez la demande MTN Mobile Money de ${formatFcfa(2000)} reçue sur votre téléphone. ${formatTokens(2000)} seront crédités dès la confirmation.`,
    });
  });

  it('statuts finaux identiques au paiement par page', () => {
    expect(paymentDisplay({ ...direct, status: 'SUCCESS' }).title).toBe('Paiement confirmé');
    expect(paymentDisplay({ ...direct, status: 'FAILED' }).title).toBe('Paiement échoué');
    expect(paymentDisplay({ ...direct, status: 'EXPIRED' }).title).toBe('Paiement expiré');
  });

  it('redirection (ou serveur antérieur, sans mode) : « Paiement en cours... »', () => {
    expect(paymentDisplay({ amount: 500, status: 'PENDING', mode: 'REDIRECT' }).title).toBe(
      'Paiement en cours...',
    );
    expect(paymentDisplay({ amount: 500, status: 'PENDING' }).title).toBe('Paiement en cours...');
  });
});
