/**
 * Build de production (« npm run build ») : vérifie que les pages générées sont à jour,
 * contrôle public/, le copie dans dist/ et y ajoute version.txt (date et commit), puis
 * recontrôle dist/. dist/ est le SEUL dossier à publier.
 *
 * SITE_URL (ex. SITE_URL=https://le-ter.example) : canonical, hreflang et og:url de dist/
 * deviennent des URL absolues, comme le recommandent les moteurs de recherche. Sans SITE_URL
 * (domaine pas encore choisi), ils restent relatifs.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkSite } from './check.mjs';
import { renderSite } from './generate.mjs';
import { SITE_URL } from '../src/site.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'public');
const OUTPUT = join(ROOT, 'dist');

/** Rend absolues les URL SEO d'une page publiée à `pagePath` (relatif à la racine du site). */
export function absolutizeSeoUrls(html, pagePath, siteUrl) {
  const base = new URL(pagePath, siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`);
  const absolute = (href) => new URL(href, base).href;
  return html
    .replace(/(<link rel="(?:canonical|alternate)"(?: hreflang="[^"]+")? href=")([^"]+)(")/g, (_, a, href, b) => a + absolute(href) + b)
    .replace(/(<meta property="og:url" content=")([^"]+)(")/g, (_, a, href, b) => a + absolute(href) + b);
}

function listHtml(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listHtml(path);
    return path.endsWith('.html') ? [path] : [];
  });
}

function fail(title, errors) {
  console.error(`✗ ${title} :`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, stdio: 'pipe' }).toString().trim();
  } catch {
    return 'inconnu';
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stale = Object.entries(renderSite())
    .filter(([path, html]) => {
      try {
        return readFileSync(join(SOURCE, path), 'utf8') !== html;
      } catch {
        return true;
      }
    })
    .map(([path]) => `public/${path} n'est pas à jour : lancer npm run generate`);
  if (stale.length > 0) fail('pages générées obsolètes, build annulé', stale);

  const sourceErrors = await checkSite(SOURCE);
  if (sourceErrors.length > 0) fail('public/ contient des erreurs, build annulé', sourceErrors);

  // Adresse de production par défaut (src/site.mjs) ; SITE_URL la remplace (préproduction…).
  const siteUrl = (process.env.SITE_URL ?? SITE_URL).trim();
  if (siteUrl !== '' && !/^https:\/\/[^/]+/.test(siteUrl)) fail('SITE_URL invalide', ['https://<domaine> attendu']);

  rmSync(OUTPUT, { recursive: true, force: true });
  cpSync(SOURCE, OUTPUT, { recursive: true });
  if (siteUrl !== '') {
    for (const file of listHtml(OUTPUT)) {
      const pagePath = relative(OUTPUT, file).split('\\').join('/');
      writeFileSync(file, absolutizeSeoUrls(readFileSync(file, 'utf8'), pagePath, siteUrl));
    }
  }
  writeFileSync(
    join(OUTPUT, 'version.txt'),
    `LeTer site vitrine\nbuild: ${new Date().toISOString()}\ncommit: ${gitCommit()}\nsite: ${siteUrl || '(URL relatives)'}\n`,
  );

  const outputErrors = await checkSite(OUTPUT);
  if (outputErrors.length > 0) fail('dist/ contient des erreurs', outputErrors);

  console.log('✓ Build terminé : marketing/dist/ (seul dossier à publier).');
  if (siteUrl === '') console.log('  ⚠ SITE_URL non défini : canonical et hreflang restent relatifs (à définir avant publication).');
}
