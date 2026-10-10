import { getCountries } from 'libphonenumber-js/max';

import { COUNTRY_NAMES_FR } from './country-names.fr';
import {
  ACCOUNT_CURRENCY,
  findPhoneCountry,
  localCurrencyOf,
  nationalExample,
  PHONE_COUNTRIES,
  sanitizeNationalInput,
  searchPhoneCountries,
  toE164,
} from './phone-countries';

describe('référentiel des pays de l’inscription', () => {
  it('couvre toutes les régions connues de libphonenumber, chacune nommée', () => {
    expect(getCountries().filter((c) => !COUNTRY_NAMES_FR[c])).toEqual([]);
    expect(PHONE_COUNTRIES).toHaveLength(getCountries().length);
    expect(PHONE_COUNTRIES.length).toBeGreaterThan(200);
  });

  it('nom, indicatif et code ISO internes ; liste triée par nom', () => {
    expect(findPhoneCountry('CM')).toEqual({ code: 'CM', name: 'Cameroun', dialCode: '+237' });
    expect(findPhoneCountry('FR')?.dialCode).toBe('+33');
    const names = PHONE_COUNTRIES.map((c) => c.name);
    expect(names.indexOf('Belgique')).toBeLessThan(names.indexOf('Cameroun'));
    expect(names.indexOf('Égypte')).toBeLessThan(names.indexOf('France'));
  });

  it.each([
    ["cote d'ivoire", "Côte d'Ivoire"],
    ['CÔTE D’IVOIRE', "Côte d'Ivoire"],
    ['camer', 'Cameroun'],
    ['SENEGAL', 'Sénégal'],
  ])('recherche %j → %s (sans casse ni accents)', (query, name) => {
    expect(searchPhoneCountries(query).map((c) => c.name)).toContain(name);
  });

  it('recherche vide : tous les pays ; recherche sans résultat : aucun', () => {
    expect(searchPhoneCountries('  ')).toBe(PHONE_COUNTRIES);
    expect(searchPhoneCountries('zzzz')).toEqual([]);
  });
});

describe('numéro national selon le pays choisi', () => {
  it.each([
    ['CM', '692130271', '+237692130271'],
    ['CM', '6 92 13 02 71', '+237692130271'],
    ['FR', '06 12 34 56 78', '+33612345678'],
    ['CI', '07 07 07 07 07', '+2250707070707'],
    ['SN', '77 123 45 67', '+221771234567'],
  ] as const)('%s + %j → %s', (code, national, e164) => {
    expect(toE164(code, national)).toBe(e164);
  });

  it('refuse un numéro invalide pour le pays (même s’il est valide ailleurs)', () => {
    expect(toE164('CM', '600000001')).toBeUndefined();
    expect(toE164('CM', '06 12 34 56 78')).toBeUndefined();
    expect(toE164('FR', '692130271')).toBeUndefined();
  });

  it('seuls chiffres et séparateurs sont saisissables : ni « + », ni lettres', () => {
    expect(sanitizeNationalInput('+237 69a2-13.02(71)')).toBe('237 692-13.02(71)');
  });

  it('exemple national pour le placeholder', () => {
    expect(nationalExample('CM')).toBe('6 71 23 45 67');
  });
});

describe('devise', () => {
  it('le compte de jeu reste en XAF quel que soit le pays (D-050)', () => {
    expect(ACCOUNT_CURRENCY).toBe('XAF');
  });

  it('devise locale seulement quand elle est certaine (zones franc CFA)', () => {
    expect(localCurrencyOf('CM')).toEqual({ code: 'XAF', symbol: 'FCFA' });
    expect(localCurrencyOf('SN')).toEqual({ code: 'XOF', symbol: 'FCFA' });
    expect(localCurrencyOf('FR')).toBeUndefined();
  });
});
