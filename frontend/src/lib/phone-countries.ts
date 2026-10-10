import {
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max';
import examples from 'libphonenumber-js/mobile/examples';

import { COUNTRY_NAMES_FR } from './country-names.fr';

/**
 * Pays de l'inscription (D-070) : nom affiché, indicatif et règles de numérotation. Les règles
 * viennent de libphonenumber, les MÊMES que celles du serveur, qui reste l'autorité et
 * reconstruit lui-même le numéro international. Le drapeau, l'indicatif, le code ISO et la
 * devise ne sont jamais affichés dans la liste des pays.
 */
export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 : donnée transmise au serveur. */
  code: CountryCode;
  name: string;
  /** « +237 » : affiché à côté du champ, jamais saisi. */
  dialCode: string;
}

/**
 * Devise du compte de jeu : fixée par le serveur (XAF, D-050), quel que soit le pays. Le pays
 * ne change ni la devise du compte, ni les soldes, ni les paiements.
 */
export const ACCOUNT_CURRENCY = 'XAF' as const;

/**
 * Devise locale de quelques pays, informative : seules les deux zones franc CFA, où elle est
 * certaine. Un pays absent n'a pas de devise supposée. Aucune conversion n'en découle.
 */
const CFA_CURRENCIES: Readonly<Record<string, { code: 'XAF' | 'XOF'; symbol: 'FCFA' }>> = {
  ...Object.fromEntries(
    ['CM', 'CF', 'TD', 'CG', 'GQ', 'GA'].map((c) => [c, { code: 'XAF', symbol: 'FCFA' }]),
  ),
  ...Object.fromEntries(
    ['BJ', 'BF', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG'].map((c) => [
      c,
      { code: 'XOF', symbol: 'FCFA' },
    ]),
  ),
};

export function localCurrencyOf(code: string) {
  return CFA_CURRENCIES[code];
}

/** Minuscules, sans accents ni apostrophe typographique : « Côte d’Ivoire » → « cote d'ivoire ». */
const ACCENTS: Readonly<Record<string, string>> = {
  à: 'a',
  á: 'a',
  â: 'a',
  ã: 'a',
  ä: 'a',
  å: 'a',
  æ: 'ae',
  ç: 'c',
  è: 'e',
  é: 'e',
  ê: 'e',
  ë: 'e',
  ì: 'i',
  í: 'i',
  î: 'i',
  ï: 'i',
  ñ: 'n',
  ò: 'o',
  ó: 'o',
  ô: 'o',
  õ: 'o',
  ö: 'o',
  œ: 'oe',
  ù: 'u',
  ú: 'u',
  û: 'u',
  ü: 'u',
  ý: 'y',
  ÿ: 'y',
  '’': "'",
  ʼ: "'",
};

export function foldForSearch(value: string): string {
  return Array.from(value.trim().toLowerCase(), (c) => ACCENTS[c] ?? c).join('');
}

/** Tous les pays connus à la fois de libphonenumber et de la liste des noms, par nom. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = getCountries()
  .filter((code) => COUNTRY_NAMES_FR[code] !== undefined)
  .map((code) => ({
    code,
    name: COUNTRY_NAMES_FR[code] as string,
    dialCode: `+${getCountryCallingCode(code)}`,
  }))
  .sort((a, b) => (foldForSearch(a.name) < foldForSearch(b.name) ? -1 : 1));

const BY_CODE = new Map(PHONE_COUNTRIES.map((c) => [c.code as string, c]));

export function findPhoneCountry(code: string): PhoneCountry | undefined {
  return BY_CODE.get(code);
}

/** Recherche par nom, insensible à la casse et aux accents. */
export function searchPhoneCountries(query: string): readonly PhoneCountry[] {
  const q = foldForSearch(query);
  if (!q) return PHONE_COUNTRIES;
  return PHONE_COUNTRIES.filter((c) => foldForSearch(c.name).includes(q));
}

/** Exemple de numéro national, pour le placeholder : « 6 71 23 45 67 » au Cameroun. */
export function nationalExample(code: CountryCode): string | undefined {
  return getExampleNumber(code, examples)?.formatNational();
}

/**
 * Le numéro saisi n'accepte que des chiffres et les séparateurs usuels : ni « + », ni
 * indicatif tapé à la main (l'indicatif est un élément distinct, non modifiable).
 */
export function sanitizeNationalInput(value: string): string {
  return value.replace(/[^\d\s.()-]/g, '');
}

/**
 * Numéro national valide pour CE pays → E.164 (affichage et contrôle immédiat ; le serveur
 * refait la même vérification). `undefined` : numéro invalide pour le pays choisi.
 */
export function toE164(code: CountryCode, national: string): string | undefined {
  const parsed = parsePhoneNumberFromString(sanitizeNationalInput(national), code);
  return parsed && parsed.isValid() && parsed.country === code ? parsed.number : undefined;
}
