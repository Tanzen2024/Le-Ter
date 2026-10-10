import { CAMEROON, countryOfPhone, DEFAULT_COUNTRY, toNationalPhone } from './country';
import { formatFcfa, formatMoney } from './money';

describe('pays par défaut', () => {
  it('Cameroun : CM, +237, XAF', () => {
    expect(DEFAULT_COUNTRY).toBe(CAMEROON);
    expect(CAMEROON).toMatchObject({ code: 'CM', dialCode: '+237', currency: 'XAF' });
    expect(CAMEROON.name.fr).toBe('Cameroun');
  });
});

describe('affichage national', () => {
  it('retire l’indicatif du pays reconnu', () => {
    expect(toNationalPhone('+237692130271')).toBe('692130271');
    expect(countryOfPhone('+237692130271')).toBe(CAMEROON);
  });
  it('pays inconnu : numéro complet, pays indéterminé', () => {
    expect(toNationalPhone('+33612345678')).toBe('+33612345678');
    expect(countryOfPhone('+33612345678')).toBeUndefined();
  });
});

describe('formatMoney : présentation seulement, sans conversion', () => {
  it('XAF affiché en FCFA, milliers séparés', () => {
    expect(formatMoney(1000, 'XAF')).toBe('1 000 FCFA');
    expect(formatFcfa(7500)).toBe('7 500 FCFA');
    expect(formatFcfa(25000)).toBe('25 000 FCFA');
    expect(formatFcfa(500)).toBe('500 FCFA');
    expect(formatFcfa(0)).toBe('0 FCFA');
  });
});
