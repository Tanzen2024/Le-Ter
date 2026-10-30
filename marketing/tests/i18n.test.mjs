import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { chooseLanguage, languageSwitchHref } from '../public/assets/js/lib.js';
import { absolutizeSeoUrls } from '../scripts/build.mjs';
import { DICTIONARIES, renderSite } from '../scripts/generate.mjs';
import { LANGUAGES, ROUTES, relativeHref } from '../src/site.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, 'public', path), 'utf8');
const LOCALIZED = Object.values(ROUTES).flatMap((byLang) => LANGUAGES.map((lang) => [lang, byLang[lang]]));

/** Liste « a.b.c » des clés feuilles d'un dictionnaire (indices compris pour les tableaux). */
function keys(value, prefix = '') {
  if (typeof value === 'string') return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

/** Copie du dictionnaire où chaque texte est remplacé par un marqueur. */
function marked(value) {
  if (typeof value === 'string') return '§';
  if (Array.isArray(value)) return value.map(marked);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, marked(child)]));
}

const head = (html) => html.slice(0, html.indexOf('</head>'));
const attr = (html, pattern) => html.match(pattern)?.[1];

describe('dictionnaires', () => {
  it('fr et en ont exactement les mêmes clés', () => {
    assert.deepEqual(keys(DICTIONARIES.en), keys(DICTIONARIES.fr));
  });

  it('aucune valeur vide', () => {
    for (const lang of LANGUAGES) {
      for (const key of keys(DICTIONARIES[lang])) {
        const value = key.split('.').reduce((node, part) => node[part], DICTIONARIES[lang]);
        assert.ok(value.trim().length > 0, `${lang}.${key}`);
      }
    }
  });
});

describe('pages générées', () => {
  it('public/ est à jour avec src/ (npm run generate)', () => {
    for (const [path, html] of Object.entries(renderSite())) {
      assert.equal(read(path), html, `${path} n'est plus à jour : lancer npm run generate`);
    }
  });

  it('aucun texte visible écrit en dur dans les gabarits (tout vient des dictionnaires)', () => {
    const pages = renderSite({ fr: marked(DICTIONARIES.fr), en: marked(DICTIONARIES.en) });
    // Noms propres et codes qui ne se traduisent pas.
    const allowed = /LeTer|Fap-Fap|GARAM TIA|Français|English|\bFR\b|\bEN\b|\b2026\b|[LETR]\b/g;
    for (const [path, html] of Object.entries(pages)) {
      if (path === 'index.html') continue; // page racine : volontairement bilingue
      const body = html.slice(html.indexOf('<body>'));
      // Textes juridiques de l'application (src/legal/documents.json) : vérifiés par legal.test.mjs.
      const withoutLegal = body.replace(/<h1>(?!§)[^<]*<\/h1>|<section>[\s\S]*?<\/section>|<p class="legal-updated">§ [^<]*<\/p>/g, '');
      const visible = withoutLegal
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<svg[\s\S]*?<\/svg>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/§/g, '')
        .replace(allowed, '')
        .replace(/[\s\d.,:;!?«»()|·©‹›\-–—/'"]/g, '');
      assert.equal(visible, '', `${path} : texte non localisé « ${visible.slice(0, 80)} »`);

      for (const [, name, value] of html.matchAll(/\s(aria-label|alt|title|data-label|data-copied|data-copy-failed|data-support-label|content)="([^"]*)"/g)) {
        if (name === 'content' || name === 'alt') continue; // valeurs techniques / images décoratives (alt="")
        assert.ok(value === '§' || /^(Français|English)$/.test(value), `${path} : ${name}="${value}" non localisé`);
      }
    }
  });
});

describe('SEO international', () => {
  for (const [lang, path] of LOCALIZED) {
    it(`${path} : lang, title, description, Open Graph et hreflang réciproques`, () => {
      const html = read(path);
      const h = head(html);
      const routeId = Object.keys(ROUTES).find((id) => ROUTES[id][lang] === path);
      assert.match(html, new RegExp(`<html lang="${lang}">`));
      assert.match(h, new RegExp(`<meta property="og:locale" content="${lang === 'fr' ? 'fr_FR' : 'en_US'}">`));
      assert.equal(attr(h, /<link rel="canonical" href="([^"]+)">/), relativeHref(path, path));
      assert.equal(attr(h, /<meta property="og:url" content="([^"]+)">/), relativeHref(path, path));
      for (const other of LANGUAGES) {
        assert.equal(attr(h, new RegExp(`hreflang="${other}" href="([^"]+)"`)), relativeHref(path, ROUTES[routeId][other]));
      }
      assert.ok(attr(h, /hreflang="x-default" href="([^"]+)"/));
    });
  }

  it('title et description différents entre fr et en (pas de doublon)', () => {
    for (const byLang of Object.values(ROUTES)) {
      const [fr, en] = LANGUAGES.map((lang) => head(read(byLang[lang])));
      assert.notEqual(attr(fr, /<title>([^<]+)<\/title>/), attr(en, /<title>([^<]+)<\/title>/));
      assert.notEqual(attr(fr, /name="description" content="([^"]+)"/), attr(en, /name="description" content="([^"]+)"/));
    }
  });

  it('accueil : titres et descriptions traduits', () => {
    assert.match(head(read('fr/index.html')), /<title>LeTer — Jeux de cartes multijoueur sur mobile/);
    assert.match(head(read('en/index.html')), /<title>LeTer — Multiplayer card games on mobile/);
    assert.match(head(read('en/index.html')), /<meta property="og:title" content="LeTer — the card game that brings players together">/);
  });

  it('x-default : la page racine pour l\'accueil, la version française pour les documents', () => {
    assert.match(head(read('fr/index.html')), /hreflang="x-default" href="\.\.\/"/);
    assert.match(head(read('en/legal/terms-of-use.html')), /hreflang="x-default" href="\.\.\/\.\.\/fr\/legal\/conditions-utilisation\.html"/);
  });

  it('build avec SITE_URL : canonical, hreflang et og:url absolus', () => {
    const html = absolutizeSeoUrls(read('en/legal/terms-of-use.html'), 'en/legal/terms-of-use.html', 'https://site.test');
    assert.match(html, /<link rel="canonical" href="https:\/\/site\.test\/en\/legal\/terms-of-use\.html">/);
    assert.match(html, /hreflang="fr" href="https:\/\/site\.test\/fr\/legal\/conditions-utilisation\.html"/);
    assert.match(html, /<meta property="og:url" content="https:\/\/site\.test\/en\/legal\/terms-of-use\.html">/);
    const home = absolutizeSeoUrls(read('fr/index.html'), 'fr/index.html', 'https://site.test/');
    assert.match(home, /hreflang="x-default" href="https:\/\/site\.test\/"/);
    assert.match(home, /hreflang="en" href="https:\/\/site\.test\/en\/"/);
  });
});

describe('sélecteur de langue et page racine', () => {
  for (const [lang, path] of LOCALIZED) {
    it(`${path} : FR | EN dans l'en-tête, langue active marquée, lien vers la même page`, () => {
      const html = read(path);
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
      const routeId = Object.keys(ROUTES).find((id) => ROUTES[id][lang] === path);
      assert.match(header, /<div class="lang-switch" role="group" aria-label="[^"]+" data-lang-switch>/);
      for (const other of LANGUAGES) {
        const link = header.match(new RegExp(`<a href="([^"]+)" hreflang="${other}" lang="${other}" aria-label="[^"]+"( aria-current="true")?`));
        assert.ok(link, `${other} absent`);
        assert.equal(link[1], relativeHref(path, ROUTES[routeId][other]));
        assert.equal(Boolean(link[2]), other === lang);
      }
    });
  }

  it("racine : x-default, liens vers /fr/ et /en/, français sans JavaScript, script de choix", () => {
    const html = read('index.html');
    assert.match(html, /<html lang="fr">/);
    assert.match(html, /hreflang="x-default" href="\.\/"/);
    assert.match(html, /href="fr\/" hreflang="fr"/);
    assert.match(html, /href="en\/" hreflang="en"/);
    assert.match(html, /<noscript><meta http-equiv="refresh" content="0; url=fr\/"><\/noscript>/);
    assert.match(html, /<script type="module" src="assets\/js\/lang-redirect\.js"><\/script>/);
  });

  it('seule la racine charge lang-redirect.js : /fr/ et /en/ ne redirigent jamais', () => {
    for (const [, path] of LOCALIZED) assert.doesNotMatch(read(path), /lang-redirect/);
  });

  it('chooseLanguage : choix mémorisé, puis navigateur (dans son ordre), puis français', () => {
    assert.equal(chooseLanguage('en', ['fr-FR']), 'en');
    assert.equal(chooseLanguage('fr', ['en-US']), 'fr');
    assert.equal(chooseLanguage(null, ['en-US', 'fr']), 'en');
    assert.equal(chooseLanguage(null, ['fr-CM', 'en']), 'fr');
    assert.equal(chooseLanguage(null, ['de-DE', 'en-GB']), 'en');
    assert.equal(chooseLanguage(null, ['de-DE', 'es']), 'fr');
    assert.equal(chooseLanguage('xx', []), 'fr');
    assert.equal(chooseLanguage(null, undefined), 'fr');
  });

  it('languageSwitchHref : même page dans l\'autre langue, ?ref= et #section gardés', () => {
    assert.equal(
      languageSwitchHref('http://localhost/le-ter/marketing/public/en/', '?ref=AB3K7MPQ', '#tournois'),
      'http://localhost/le-ter/marketing/public/en/?ref=AB3K7MPQ#tournois',
    );
    assert.equal(languageSwitchHref('https://site.test/fr/legal/conditions-utilisation.html', '', ''), 'https://site.test/fr/legal/conditions-utilisation.html');
  });

  it('les scripts utilisent ces fonctions et la même clé de mémorisation', () => {
    const redirect = readFileSync(join(ROOT, 'public/assets/js/lang-redirect.js'), 'utf8');
    assert.match(redirect, /localStorage\.getItem\('leter-language'\)/);
    assert.match(redirect, /chooseLanguage\(stored, languages\)/);
    assert.match(redirect, /`\$\{language\}\/\$\{window\.location\.search\}\$\{window\.location\.hash\}`/);
    const site = readFileSync(join(ROOT, 'public/assets/js/site.js'), 'utf8');
    assert.match(site, /localStorage\.setItem\('leter-language', link\.dataset\.lang\)/);
    assert.match(site, /languageSwitchHref\(link\.href, window\.location\.search, window\.location\.hash\)/);
  });
});

describe('SEO de production', () => {
  it('sitemap.xml : toutes les pages localisées, URL absolues www.leter.cm, alternatives hreflang', () => {
    const sitemap = read('sitemap.xml');
    for (const [, path] of LOCALIZED) {
      const url = `https://www.leter.cm/${path.replace(/index\.html$/, '')}`;
      assert.ok(sitemap.includes(`<loc>${url}</loc>`), url);
    }
    assert.equal((sitemap.match(/<url>/g) ?? []).length, LOCALIZED.length);
    assert.doesNotMatch(sitemap, /404\.html/);
  });

  it('robots.txt déclare le sitemap ; aucune page ne porte noindex sauf la 404', () => {
    assert.match(read('robots.txt'), /^Sitemap: https:\/\/www\.leter\.cm\/sitemap\.xml$/m);
    for (const [, path] of LOCALIZED) assert.doesNotMatch(read(path), /name="robots" content="noindex"/, path);
    assert.doesNotMatch(read('index.html'), /noindex/);
    assert.match(read('404.html'), /<meta name="robots" content="noindex">/);
  });

  it('image de partage absolue, Open Graph et X/Twitter sur toutes les pages, racine comprise', () => {
    for (const path of ['index.html', ...LOCALIZED.map(([, p]) => p)]) {
      const h = head(read(path));
      assert.match(h, /<meta property="og:image" content="https:\/\/www\.leter\.cm\/assets\/img\/og-leter\.png">/, path);
      assert.match(h, /<meta name="twitter:card" content="summary_large_image">/, path);
      assert.match(h, /<meta property="og:site_name" content="LeTer">/, path);
    }
  });

  it('404 : FR et EN, liens absolus vers /fr/ et /en/, aucun script', () => {
    const html = read('404.html');
    assert.match(html, /href="\/fr\/" hreflang="fr"/);
    assert.match(html, /href="\/en\/" hreflang="en"/);
    assert.match(html, /Page introuvable/);
    assert.match(html, /Page not found/);
    assert.doesNotMatch(html, /<script/);
  });

  it('build : URL absolues sur https://www.leter.cm par défaut', () => {
    const html = absolutizeSeoUrls(read('fr/index.html'), 'fr/index.html', 'https://www.leter.cm');
    assert.match(html, /<link rel="canonical" href="https:\/\/www\.leter\.cm\/fr\/">/);
  });
});
