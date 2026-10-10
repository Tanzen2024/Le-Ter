/**
 * Formats d'affichage (français, fuseau Africa/Douala comme le backend). Aucune donnée
 * n'est inventée : une valeur absente s'affiche « — ».
 */
export const TIMEZONE = 'Africa/Douala';
export const LOCALE = 'fr-FR';
export const EMPTY = '—';

const dateTime = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  dateStyle: 'short',
  timeStyle: 'short',
});
const dateOnly = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, dateStyle: 'medium' });
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : EMPTY;
}

export function formatDate(value: string | null | undefined): string {
  return value ? dateOnly.format(new Date(value)) : EMPTY;
}

/** Jour `AAAA-MM-JJ` (série du backend) → « 9 oct. ». */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? EMPTY : integer.format(value);
}

/**
 * Espace insécable (U+00A0), même convention que l'application mobile : « 1 000 » et « FCFA »
 * ne sont jamais coupés en fin de ligne. `Intl` sépare les milliers par une espace fine
 * (U+202F) : elle est ramenée à cette même espace.
 */
const NBSP = ' ';

/** Montant en francs CFA (XAF), sans décimale ; 1 FCFA = 1 jeton (D-050). */
export function formatXaf(value: number | null | undefined): string {
  return value === null || value === undefined
    ? EMPTY
    : `${integer.format(value).replace(/\s/g, NBSP)}${NBSP}FCFA`;
}

/** Coefficient multiplicateur (D-071) : « 10 », « 0,5 », 2 décimales au plus. */
export function formatCoefficient(value: number | null | undefined): string {
  return value === null || value === undefined
    ? EMPTY
    : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}

export function formatTokens(value: number | null | undefined): string {
  return value === null || value === undefined ? EMPTY : `${integer.format(value)} jetons`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return EMPTY;
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatPercentFromBps(bps: number | null | undefined): string {
  return bps === null || bps === undefined ? EMPTY : `${(bps / 100).toLocaleString(LOCALE)} %`;
}

/** Identifiant raccourci pour l'affichage (l'identifiant complet reste disponible). */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : EMPTY;
}

/** Début du jour local (Africa/Douala, UTC+1 sans heure d'été) en instant ISO. */
export function localDayStartIso(day: string): string {
  return new Date(`${day}T00:00:00+01:00`).toISOString();
}

/** Jour local (AAAA-MM-JJ) d'un instant, dans le fuseau d'affichage. */
export function localDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(date);
}
