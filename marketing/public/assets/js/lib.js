/**
 * Fonctions pures du site vitrine (aucun accès au DOM) : utilisées par site.js et testées
 * sous Node (tests/site.test.mjs).
 */

/**
 * Forme du code de parrainage, identique au serveur (backend/src/domain/referrals/referral.ts) :
 * 8 caractères, sans 0/O ni 1/I. Le site ne vérifie que la forme : seul le serveur sait si le
 * code existe.
 */
const REFERRAL_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

/** Code saisi ou reçu dans l'URL, normalisé ; null si la forme est impossible. */
export function normalizeReferralCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

/** Code de parrainage présent dans une chaîne de requête (`?ref=…`), ou null. */
export function referralCodeFromSearch(search) {
  try {
    return normalizeReferralCode(new URLSearchParams(search).get('ref') ?? '');
  } catch {
    return null;
  }
}

/** Adresse absolue en https://, sinon null (une valeur vide signifie « pas encore disponible »). */
export function httpsUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Adresse e-mail plausible, sinon null. */
export function emailAddress(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(trimmed) ? trimmed : null;
}

/** Identifiant de mesure GA4 (« G-XXXXXXXXXX »), sinon null (vide = mesure désactivée). */
export function ga4MeasurementId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  return /^G-[A-Z0-9]{4,16}$/.test(trimmed) ? trimmed : null;
}

/** Langues du site ; la première est la langue par défaut. */
export const SITE_LANGUAGES = ['fr', 'en'];

/**
 * Langue ouverte par la page racine : le choix mémorisé, sinon la première langue du site
 * trouvée dans les préférences du navigateur (dans leur ordre), sinon le français.
 */
export function chooseLanguage(stored, browserLanguages) {
  if (SITE_LANGUAGES.includes(stored)) return stored;
  for (const tag of browserLanguages ?? []) {
    const primary = String(tag).toLowerCase().split('-')[0];
    if (SITE_LANGUAGES.includes(primary)) return primary;
  }
  return SITE_LANGUAGES[0];
}

/**
 * Lien du sélecteur de langue : même page dans l'autre langue, en gardant la requête
 * (?ref=CODE) et la section courante (#parrainage) de la page actuelle.
 */
export function languageSwitchHref(href, search, hash) {
  const target = new URL(href);
  target.search = search;
  target.hash = hash;
  return target.href;
}

/** Lien qui ouvre l'application déjà installée sur l'écran d'inscription, code prérempli (D-161). */
export function appRegisterLink(code) {
  return `leter://register?ref=${encodeURIComponent(code)}`;
}
