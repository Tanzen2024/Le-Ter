/**
 * Pays et devise de référence, en un seul endroit. Le drapeau et l'indicatif sont des
 * MÉTADONNÉES internes : ils ne sont jamais affichés dans le champ téléphone ni ajoutés au
 * numéro montré au joueur. Aucune détection du pays réel : sans autre information, le pays
 * est le Cameroun. Avoir une devise ici n'active aucun paiement : la devise des achats reste
 * celle fixée par le serveur (XAF, D-050).
 */
export type CurrencyCode = 'XAF';

export interface CountryConfig {
  /** Code ISO 3166-1 alpha-2. */
  code: string;
  name: { fr: string; en: string };
  flag: string;
  /** Indicatif international, avec le « + ». */
  dialCode: string;
  currency: CurrencyCode;
  /** Numéro national valide (sans indicatif ni espaces). */
  nationalNumber: RegExp;
}

/** Cameroun : numéros nationaux à 9 chiffres, fixes en 2, mobiles en 6. */
export const CAMEROON: CountryConfig = {
  code: 'CM',
  name: { fr: 'Cameroun', en: 'Cameroon' },
  flag: '🇨🇲',
  dialCode: '+237',
  currency: 'XAF',
  nationalNumber: /^[26]\d{8}$/,
};

export const DEFAULT_COUNTRY = CAMEROON;

/** Pays connus, reconnus par leur indicatif. */
const COUNTRIES: readonly CountryConfig[] = [CAMEROON];

/** Pays d'un numéro international, d'après son indicatif ; `undefined` s'il est inconnu. */
export function countryOfPhone(phone: string): CountryConfig | undefined {
  return COUNTRIES.find((c) => phone.startsWith(c.dialCode));
}

/**
 * Numéro affiché au joueur : sans l'indicatif de son pays (`+237692130271` → `692130271`).
 * Un numéro d'un pays inconnu reste complet, pour ne rien perdre.
 */
export function toNationalPhone(phone: string): string {
  const country = countryOfPhone(phone);
  return country ? phone.slice(country.dialCode.length) : phone;
}
