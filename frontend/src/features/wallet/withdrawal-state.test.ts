import { ApiError } from '../../lib/api-client';
import {
  checkWithdrawalAmount,
  formatPeriod,
  quotaText,
  withdrawalAvailabilityNotice,
  withdrawalDisplay,
  withdrawalErrorMessage,
} from './withdrawal-state';

const limits = { minTokens: 1000, maxTokens: 1_500_000, available: 5000 };

describe('checkWithdrawalAmount', () => {
  it('1 000 et plus : accepté ; 999 : refusé', () => {
    expect(checkWithdrawalAmount('1000', limits)).toEqual({ ok: true, tokens: 1000 });
    expect(checkWithdrawalAmount('999', limits)).toMatchObject({ ok: false, reason: 'below_min' });
  });

  it.each([
    ['', 'empty'],
    ['0', 'below_min'],
    ['-5', 'invalid'],
    ['1.5', 'invalid'],
    ['abc', 'invalid'],
    ['99999999999999999999', 'invalid'],
    ['2000000', 'above_max'],
    ['6000', 'insufficient'],
  ])('%p → %s (jamais converti en 0)', (input, reason) => {
    expect(checkWithdrawalAmount(input, limits)).toMatchObject({ ok: false, reason });
  });
});

describe('quota', () => {
  it('illimité : aucun texte ; borné : restant et période lisibles', () => {
    const base = { used: 0, nextAvailableAt: null };
    expect(quotaText({ ...base, count: null, periodMinutes: null, remaining: null })).toBeUndefined();
    expect(quotaText({ ...base, count: 3, periodMinutes: 1440, remaining: 2 })).toBe(
      '2 retraits restants sur 3 par période de 1 jour.',
    );
    expect(quotaText({ ...base, count: 5, periodMinutes: null, remaining: 5 })).toBe(
      '5 retraits restants sur 5 au total.',
    );
    expect(formatPeriod(7 * 1440)).toBe('7 jours');
    expect(formatPeriod(180)).toBe('3 heures');
    expect(formatPeriod(90)).toBe('90 minutes');
  });
});

describe('affichage', () => {
  it('statuts intermédiaires jamais présentés comme réussis', () => {
    expect(withdrawalDisplay('CREATED', 1000).tone).toBe('pending');
    expect(withdrawalDisplay('PROCESSING', 1000).tone).toBe('pending');
    expect(withdrawalDisplay('SUCCEEDED', 1000).tone).toBe('success');
    expect(withdrawalDisplay('FAILED', 1000).tone).toBe('error');
    // Vérification en cours (refus annoncé, issue inconnue) : ni réussite ni échec.
    expect(withdrawalDisplay('CREATED', 1000, true)).toEqual(
      expect.objectContaining({ tone: 'pending', label: 'Vérification en cours' }),
    );
    expect(withdrawalDisplay('FAILED', 1000, true).tone).toBe('error');
  });

  it('mode test : « effectué » seulement sur statut final, toujours marqué test', () => {
    expect(withdrawalDisplay('SUCCEEDED', 1000, false, true)).toEqual(
      expect.objectContaining({ tone: 'success', label: 'Retrait effectué (test)' }),
    );
    expect(withdrawalDisplay('PROCESSING', 1000, false, true).tone).toBe('pending');
    expect(withdrawalDisplay('CREATED', 1000, true, true).label).toBe('Vérification en cours');
  });

  it('messages d’erreur d’après le code du serveur', () => {
    expect(
      withdrawalErrorMessage(
        new ApiError(400, 'VALIDATION_ERROR', 'x', { tokens: 'Le retrait minimum est de 1000 jetons.' }),
      ),
    ).toBe('Le retrait minimum est de 1000 jetons.');
    expect(withdrawalErrorMessage(new ApiError(422, 'WITHDRAWAL_PHONE_UNSUPPORTED', 'Numéro non pris en charge.'))).toBe(
      'Numéro non pris en charge.',
    );
    expect(withdrawalErrorMessage(new Error('x'))).toBe('Retrait impossible. Réessayez.');
  });
});

describe('withdrawalAvailabilityNotice (D-077)', () => {
  it('production : rien à signaler', () => {
    expect(withdrawalAvailabilityNotice({ available: true, mode: 'live' })).toBeUndefined();
  });

  it('sandbox : environnement de test annoncé', () => {
    expect(withdrawalAvailabilityNotice({ available: true, mode: 'sandbox' })).toEqual({
      tone: 'test',
      message: 'Mode test : les retraits sont simulés, aucun argent réel n’est envoyé.',
    });
  });

  it('indisponible : motif compréhensible, détails de configuration jamais exposés', () => {
    const text = (reason?: string) =>
      withdrawalAvailabilityNotice({ available: false, mode: 'unavailable', reason })?.message;
    expect(text('PROVIDER_NOT_CONFIGURED')).toMatch(/pas encore ouverts/);
    expect(text('TRANSFERS_DISABLED')).toMatch(/fermés pour le moment/);
    for (const reason of ['LIVE_NOT_CONFIRMED', 'SANDBOX_IN_PRODUCTION', 'SCHEMA_OUTDATED', 'INCONNU']) {
      expect(text(reason)).toBe(
        'Les retraits Mobile Money sont momentanément indisponibles (maintenance du service).',
      );
    }
    expect(text()).toBe('Les retraits Mobile Money ne sont pas disponibles pour le moment.');
    expect(text('PROVIDER_NOT_CONFIGURED')).not.toMatch(/bientôt/);
  });

  it('serveur antérieur (sans mode) : seul « available » fait foi', () => {
    expect(withdrawalAvailabilityNotice({ available: true })).toBeUndefined();
    expect(withdrawalAvailabilityNotice({ available: false })?.tone).toBe('unavailable');
  });
});
