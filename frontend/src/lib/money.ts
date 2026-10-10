import type { CurrencyCode } from './country';

/**
 * Formatage des MONTANTS d'argent, en un seul endroit. Présentation uniquement : aucune
 * conversion, la valeur reçue est affichée telle quelle. Les jetons, unité de jeu, ne
 * passent pas par ici.
 */
const CURRENCY_LABELS: Record<CurrencyCode, string> = { XAF: 'FCFA' };

/**
 * Espace insécable (convention française) : « 1 000 » et « FCFA » ne sont jamais coupés en
 * fin de ligne. Une seule convention pour toute l'application (boutique, tournois).
 */
const NBSP = ' ';

/** Groupes de milliers : « 1 000 », « 25 000 ». */
function groupThousands(value: number): string {
  const [integer, decimals] = String(value).split('.');
  const grouped = (integer ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return decimals ? `${grouped},${decimals}` : grouped;
}

/** « 1 000 FCFA » pour `XAF`. */
export function formatMoney(amount: number, currency: CurrencyCode): string {
  return `${groupThousands(amount)}${NBSP}${CURRENCY_LABELS[currency]}`;
}

/** Montant en francs CFA (XAF). */
export const formatFcfa = (amount: number) => formatMoney(amount, 'XAF');
