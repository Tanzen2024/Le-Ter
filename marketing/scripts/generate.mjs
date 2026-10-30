/**
 * Génération des pages (« npm run generate ») : gabarits src/pages/ + dictionnaires src/i18n/
 * + textes juridiques src/legal/documents.json → public/index.html, public/fr/**, public/en/**.
 *
 * Les pages générées sont conservées dans public/ : le site se prévisualise sans étape de build
 * (XAMPP, npm run serve). tests/i18n.test.mjs vérifie qu'elles sont à jour.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import en from '../src/i18n/en.mjs';
import fr from '../src/i18n/fr.mjs';
import { renderHome } from '../src/pages/home.mjs';
import { renderLegalDocument, renderLegalNotice } from '../src/pages/legal.mjs';
import { NOT_FOUND_PAGE, renderNotFound } from '../src/pages/not-found.mjs';
import { renderRoot } from '../src/pages/root.mjs';
import { INDEXABLE, LANGUAGES, ROOT_PAGE, ROUTES, SITE_URL } from '../src/site.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DICTIONARIES = { fr, en };

/** URL publique d'une page de ROUTES (un index.html est désigné par son dossier). */
const publicUrl = (path) => `${SITE_URL}/${path.replace(/index\.html$/, '')}`;

/**
 * sitemap.xml : chaque page localisée avec ses équivalents (hreflang). La page racine, simple
 * choix de langue, n'y figure pas ; la 404 non plus.
 */
export function renderSitemap() {
  const urls = Object.values(ROUTES).flatMap((byLang) =>
    LANGUAGES.map((lang) => {
      const alternates = LANGUAGES.map(
        (other) => `    <xhtml:link rel="alternate" hreflang="${other}" href="${publicUrl(byLang[other])}"/>`,
      ).join('\n');
      return `  <url>
    <loc>${publicUrl(byLang[lang])}</loc>
${alternates}
  </url>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

/** robots.txt : sitemap déclaré seulement si le site est indexable (src/site.mjs, INDEXABLE). */
export function renderRobots() {
  return INDEXABLE
    ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`
    : `# Site non indexable (INDEXABLE = false) : les pages portent aussi <meta name="robots" content="noindex">.\nUser-agent: *\nAllow: /\n`;
}

/** { 'chemin/relatif': contenu } pour tous les fichiers générés, avec les dictionnaires fournis. */
export function renderSite(dictionaries = DICTIONARIES) {
  const pages = { [ROOT_PAGE]: renderRoot(dictionaries), [NOT_FOUND_PAGE]: renderNotFound(dictionaries) };
  for (const lang of LANGUAGES) {
    const t = dictionaries[lang];
    pages[ROUTES.home[lang]] = renderHome(t, lang);
    pages[ROUTES.terms[lang]] = renderLegalDocument(t, lang, 'terms');
    pages[ROUTES.privacy[lang]] = renderLegalDocument(t, lang, 'privacy');
    pages[ROUTES.notice[lang]] = renderLegalNotice(t, lang);
  }
  pages['sitemap.xml'] = renderSitemap();
  pages['robots.txt'] = renderRobots();
  return pages;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [path, html] of Object.entries(renderSite())) {
    const file = join(ROOT, 'public', path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    console.log(`✓ public/${path}`);
  }
}
