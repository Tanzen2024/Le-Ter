import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FRONTEND_LEGAL, readAppDocuments, serializeSnapshot, SNAPSHOT } from '../scripts/sync-legal.mjs';
import { LANGUAGES, ROUTES } from '../src/site.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = (path) => readFileSync(join(ROOT, 'public', path), 'utf8');
const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));

/** Texte visible d'un fragment HTML (entités d'escapeHtml décodées). */
const text = (html) =>
  html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

describe('pied de page', () => {
  for (const lang of LANGUAGES) {
    it(`${lang} : relie les trois documents de la même langue, sans JavaScript`, () => {
      const home = page(ROUTES.home[lang]);
      for (const id of ['terms', 'privacy', 'notice']) {
        const href = ROUTES[id][lang].replace(`${lang}/`, '');
        assert.match(home, new RegExp(`<a href="${href}">`), href);
        assert.ok(existsSync(join(ROOT, 'public', ROUTES[id][lang])), ROUTES[id][lang]);
      }
    });
  }
});

describe('pages juridiques', () => {
  for (const lang of LANGUAGES) {
    for (const id of ['terms', 'privacy', 'notice']) {
      const path = ROUTES[id][lang];

      it(`${path} : document complet (aucun bandeau de projet, aucun repère), retour à l'accueil, lien vers l'autre langue`, () => {
        const html = page(path);
        assert.doesNotMatch(html, /Document en cours de finalisation|Document being finalized/);
        assert.doesNotMatch(text(html), /\[[A-Za-zÀ-ÿ][^\]]*\]/, 'repère entre crochets');
        assert.match(html, /LAMAT/);
        assert.match(html, /hugueslamat16@gmail\.com/);
        assert.match(html, /class="legal-back"><a href="\.\.\/">/);
        const other = LANGUAGES.find((l) => l !== lang);
        assert.match(html, new RegExp(`href="\\.\\./\\.\\./${ROUTES[id][other]}" hreflang="${other}"`));
        assert.match(html, new RegExp(`href="${ROUTES[id][lang].split('/').pop()}" aria-current="page"`));
      });
    }

    it(`${lang} : mentions légales (absentes de l'application) sans aucun texte juridique inventé`, () => {
      const html = page(ROUTES.notice[lang]);
      const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
      assert.equal((article.match(/<h2/g) ?? []).length, 0);
      assert.doesNotMatch(article, /Dernière mise à jour|Last updated/);
      assert.match(article, lang === 'fr' ? /Douala, Cameroun/ : /Douala, Cameroon/);
      // Informations encore inconnues : signalées, jamais inventées.
      assert.match(article, lang === 'fr' ? /forme juridique et numéro d'immatriculation/ : /legal form and registration number/);
    });

    it(`${lang} : la politique de confidentialité couvre aussi le site (stockage local, GA4 après accord, journaux)`, () => {
      const html = page(ROUTES.privacy[lang]);
      assert.match(html, /<section id="site-web">/);
      assert.match(html, /www\.leter\.cm/);
      assert.match(html, /Google Analytics 4/);
    });

    for (const id of ['terms', 'privacy']) {
      it(`${lang}/${id} : chaque titre et chaque paragraphe de l'instantané figure mot pour mot`, () => {
        const document = snapshot[lang][id];
        const visible = text(page(ROUTES[id][lang]));
        assert.equal(document.sections.length, 18);
        assert.ok(visible.includes(document.title));
        assert.ok(visible.includes(document.lastUpdated));
        for (const section of document.sections) {
          assert.ok(visible.includes(section.heading), section.heading);
          for (const paragraph of section.paragraphs) {
            const expected = paragraph.replace(/^•\s*/, '');
            assert.ok(visible.includes(expected), expected.slice(0, 60));
          }
        }
      });
    }
  }
});

describe("fidélité à l'application mobile", { skip: !existsSync(FRONTEND_LEGAL) && 'frontend/ absent' }, () => {
  it("src/legal/documents.json est identique aux textes de l'application (npm run legal:sync)", async () => {
    assert.equal(readFileSync(SNAPSHOT, 'utf8'), serializeSnapshot(await readAppDocuments()));
  });
});
