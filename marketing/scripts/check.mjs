/**
 * Contrôle statique du site vitrine (« npm run lint ») : liens internes, fichiers référencés,
 * accessibilité de base, politique de sécurité (aucun script ou style en ligne), fichiers
 * autorisés et configuration (aucune URL non https, aucune adresse d'exemple).
 *
 * Utilisable seul (`node scripts/check.mjs [dossier]`) ou importé par build.mjs et les tests.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SHARE_IMAGE } from '../src/site.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Seuls ces types de fichiers peuvent être publiés. */
const ALLOWED_EXTENSIONS = new Set(['.html', '.css', '.js', '.svg', '.ttf', '.txt', '.xml', '.png', '.webp', '.ico']);
/** Page d'erreur : ni canonical ni hreflang (elle répond à n'importe quelle adresse). */
const ERROR_PAGES = new Set(['404.html']);
/** Identifiant de mesure GA4 (public, ce n'est pas un secret) : « G-XXXXXXXXXX ». */
const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]{4,16}$/;
const ALLOWED_DOTFILES = new Set(['.htaccess']);
/** Schémas de lien acceptés dans le HTML en plus des chemins locaux et des ancres. */
const EXTERNAL_LINK = /^(https:|mailto:|leter:)/;
const PLACEHOLDER_HOSTS = /(example\.(com|org|net)|localhost|127\.0\.0\.1|\.local\b|trycloudflare\.com)/i;

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function checkHtml(file, dir, errors) {
  const html = readFileSync(file, 'utf8');
  const where = relative(dir, file);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

  // Langue du document : celle de son dossier (fr/, en/) ; la page racine est en français.
  const folder = where.split(/[\\/]/)[0];
  const expectedLang = folder === 'en' ? 'en' : 'fr';
  if (!html.includes(`<html lang="${expectedLang}">`)) errors.push(`${where} : <html lang="${expectedLang}"> attendu`);
  const errorPage = ERROR_PAGES.has(where.split(/[\/]/).join('/'));
  if (!errorPage && !/<link rel="canonical" href="[^"]+">/.test(html)) errors.push(`${where} : canonical absent`);
  for (const lang of errorPage ? [] : ['fr', 'en', 'x-default']) {
    if (!html.includes(`hreflang="${lang}" href=`)) errors.push(`${where} : hreflang="${lang}" absent`);
  }
  if (!/<meta name="viewport"/.test(html)) errors.push(`${where} : balise viewport absente`);
  if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) errors.push(`${where} : exactement un <h1> attendu`);
  if (/\sstyle="/.test(html)) errors.push(`${where} : attribut style en ligne (interdit par la CSP)`);
  if (/\son[a-z]+="/i.test(html)) errors.push(`${where} : gestionnaire d'événement en ligne`);

  for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
    if (!/\ssrc="/.test(tag)) errors.push(`${where} : script en ligne (interdit par la CSP)`);
  }
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt="/.test(tag)) errors.push(`${where} : image sans attribut alt : ${tag}`);
  }
  for (const [, id] of html.matchAll(/(?:aria-controls|aria-labelledby)="([^"]+)"/g)) {
    if (!ids.has(id)) errors.push(`${where} : référence ARIA vers un id absent : ${id}`);
  }

  for (const [, attr, value] of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
    if (value.startsWith('#')) {
      if (value.length > 1 && !ids.has(value.slice(1))) errors.push(`${where} : ancre sans cible : ${value}`);
    } else if (EXTERNAL_LINK.test(value)) {
      if (attr === 'src') errors.push(`${where} : ressource externe chargée : ${value}`);
      if (PLACEHOLDER_HOSTS.test(value)) errors.push(`${where} : adresse d'exemple ou locale : ${value}`);
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
      errors.push(`${where} : lien non autorisé : ${value}`);
    } else if (value === '') {
      errors.push(`${where} : ${attr} vide`);
    } else if (!existsSync(join(dirname(file), value.split(/[?#]/)[0]))) {
      errors.push(`${where} : fichier introuvable : ${value}`);
    }
  }
}

function checkCss(file, dir, errors) {
  const css = readFileSync(file, 'utf8');
  for (const [, value] of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    if (/^(data:|#)/.test(value)) continue;
    if (/^[a-z]+:|^\/\//i.test(value)) {
      errors.push(`${relative(dir, file)} : ressource externe : ${value}`);
    } else if (!existsSync(join(dirname(file), value))) {
      errors.push(`${relative(dir, file)} : fichier introuvable : ${value}`);
    }
  }
}

function checkJsSyntax(file, dir, errors) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    errors.push(`${relative(dir, file)} : erreur de syntaxe\n${error.stderr?.toString() ?? ''}`);
  }
}

async function checkConfig(dir, errors) {
  const path = join(dir, 'assets/js/config.js');
  if (!existsSync(path)) {
    errors.push('assets/js/config.js absent');
    return;
  }
  const { SITE_CONFIG } = await import(`${pathToFileURL(path).href}?t=${Date.now()}`);
  const urls = {
    'downloads.android': SITE_CONFIG.downloads?.android,
    'downloads.ios': SITE_CONFIG.downloads?.ios,
    supportUrl: SITE_CONFIG.supportUrl,
  };
  for (const [key, value] of Object.entries(urls)) {
    if (typeof value !== 'string') errors.push(`config.${key} : chaîne attendue`);
    else if (value !== '' && !value.startsWith('https://')) errors.push(`config.${key} : https:// attendu`);
    else if (PLACEHOLDER_HOSTS.test(value)) errors.push(`config.${key} : adresse d'exemple ou locale`);
  }
  if (SITE_CONFIG.supportEmail !== '' && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(SITE_CONFIG.supportEmail ?? '')) {
    errors.push('config.supportEmail : adresse e-mail invalide');
  }
  const ga4 = SITE_CONFIG.analytics?.ga4MeasurementId;
  if (typeof ga4 !== 'string' || (ga4 !== '' && !GA4_MEASUREMENT_ID.test(ga4))) {
    errors.push('config.analytics.ga4MeasurementId : vide ou « G-XXXXXXXXXX » attendu');
  }
  if (typeof SITE_CONFIG.referral?.rewardsActive !== 'boolean') {
    errors.push('config.referral.rewardsActive : true ou false attendu');
  }
}

/** Liste des erreurs du site contenu dans `dir` (vide si tout est correct). */
export async function checkSite(dir = join(ROOT, 'public')) {
  const errors = [];
  if (!existsSync(join(dir, 'index.html'))) return [`${dir} : index.html absent`];
  // Fichiers publics attendus par les balises (image de partage, favicons) et par le serveur (404).
  for (const required of [SHARE_IMAGE.path, 'assets/img/favicon-32.png', 'assets/img/apple-touch-icon.png', '404.html', 'sitemap.xml']) {
    if (!existsSync(join(dir, required))) errors.push(`${required} absent`);
  }

  for (const file of listFiles(dir)) {
    const name = relative(dir, file);
    const base = name.split(/[\\/]/).pop();
    if (base.startsWith('.') && !ALLOWED_DOTFILES.has(base)) errors.push(`${name} : fichier caché non autorisé`);
    else if (!base.startsWith('.') && !ALLOWED_EXTENSIONS.has(extname(base).toLowerCase())) {
      errors.push(`${name} : type de fichier non autorisé dans le site public`);
    }
    if (file.endsWith('.html')) checkHtml(file, dir, errors);
    if (file.endsWith('.css')) checkCss(file, dir, errors);
    if (file.endsWith('.js')) checkJsSyntax(file, dir, errors);
  }
  await checkConfig(dir, errors);
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? join(ROOT, 'public'));
  const errors = await checkSite(dir);
  if (errors.length > 0) {
    console.error(`✗ ${errors.length} problème(s) dans ${relative(ROOT, dir) || dir} :`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`✓ ${relative(ROOT, dir) || dir} : aucun problème détecté.`);
}
