/**
 * Langues et pages du site vitrine. Ajouter une page : une entrée dans ROUTES (un chemin par
 * langue), un gabarit dans src/pages/ et ses textes dans src/i18n/{fr,en}.mjs (README.md).
 */

/** Le français est la langue par défaut (page racine sans JavaScript, x-default des documents). */
export const DEFAULT_LANGUAGE = 'fr';
export const LANGUAGES = ['fr', 'en'];

/** Nom de chaque langue dans sa propre langue : affiché tel quel, jamais traduit. */
export const LANGUAGE_NAMES = { fr: 'Français', en: 'English' };
export const LANGUAGE_CODES = { fr: 'FR', en: 'EN' };
export const OG_LOCALES = { fr: 'fr_FR', en: 'en_US' };

/** Nom officiel de la marque (identifiants techniques exclus : leter://, le-ter…). */
export const BRAND = 'LeTer';

/**
 * Adresse publique du site, sans « / » final : URL absolues du build (canonical, hreflang,
 * og:url), image de partage, sitemap.xml et robots.txt. `SITE_URL` peut la remplacer au build.
 */
export const SITE_URL = 'https://www.leter.cm';

/**
 * true : pages indexables, sitemap déclaré dans robots.txt. false : toutes les pages portent
 * <meta name="robots" content="noindex">. Après un changement, `npm run generate`.
 */
export const INDEXABLE = true;

/** Image de partage (Open Graph, X/Twitter), 1200 × 630, relative à la racine du site. */
export const SHARE_IMAGE = { path: 'assets/img/og-leter.png', width: 1200, height: 630 };

/** Chemin de chaque page, par langue, relatif à public/ (et dist/). */
export const ROUTES = {
  home: { fr: 'fr/index.html', en: 'en/index.html' },
  terms: { fr: 'fr/legal/conditions-utilisation.html', en: 'en/legal/terms-of-use.html' },
  privacy: { fr: 'fr/legal/politique-confidentialite.html', en: 'en/legal/privacy-policy.html' },
  notice: { fr: 'fr/legal/mentions-legales.html', en: 'en/legal/legal-notice.html' },
};

/** Page racine : choix de la langue (x-default de l'accueil). */
export const ROOT_PAGE = 'index.html';

/**
 * Lien relatif de `from` vers `to` (chemins de ROUTES) : fonctionne sous XAMPP
 * (/le-ter/marketing/public/), depuis dist/ et à la racine d'un domaine. Un index.html est
 * désigné par son dossier (« ../en/ »).
 */
export function relativeHref(from, to) {
  const fromParts = from.split('/').slice(0, -1);
  const toParts = to.split('/');
  let common = 0;
  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) common += 1;
  const up = fromParts.length - common;
  const rest = toParts.slice(common);
  if (rest[rest.length - 1] === 'index.html') rest[rest.length - 1] = '';
  const href = '../'.repeat(up) + rest.join('/');
  return href === '' ? './' : href;
}
