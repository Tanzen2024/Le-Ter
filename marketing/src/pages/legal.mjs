import { readFileSync } from 'node:fs';

import { escapeHtml, pageContext, renderDocument } from './layout.mjs';

/**
 * Pages juridiques. Conditions d'utilisation et Politique de confidentialité : texte de
 * l'application mobile, mot pour mot, dans la langue de la page (src/legal/documents.json, tenu
 * à jour par `npm run legal:sync`) ; la politique reçoit en plus une section propre au site.
 * Mentions légales : absentes de l'application, rédigées dans src/i18n (legal.notice).
 */

const DOCUMENTS = JSON.parse(readFileSync(new URL('../legal/documents.json', import.meta.url), 'utf8'));

/** Paragraphes de l'application ; les lignes « • » consécutives deviennent une liste. */
function renderParagraphs(paragraphs) {
  const out = [];
  let bullets = [];
  const flush = () => {
    if (bullets.length === 0) return;
    out.push(`        <ul>\n${bullets.map((b) => `          <li>${escapeHtml(b)}</li>`).join('\n')}\n        </ul>`);
    bullets = [];
  };
  for (const paragraph of paragraphs) {
    if (paragraph.startsWith('•')) {
      bullets.push(paragraph.replace(/^•\s*/, ''));
    } else {
      flush();
      out.push(`        <p>${escapeHtml(paragraph)}</p>`);
    }
  }
  flush();
  return out.join('\n');
}

function article(content, ctx, t) {
  return `  <main id="contenu" class="section section-ivory">
    <article class="container narrow legal-doc">
${content}
      <p class="legal-back"><a href="${ctx.page('home')}">${t.common.backHome}</a></p>
    </article>
  </main>`;
}

/** Conditions d'utilisation (`terms`) ou Politique de confidentialité (`privacy`). */
export function renderLegalDocument(t, lang, id) {
  const ctx = pageContext(id, lang);
  const document = DOCUMENTS[lang][id];
  const sections = document.sections
    .map(
      (section) => `      <section>
        <h2>${escapeHtml(section.heading)}</h2>
${renderParagraphs(section.paragraphs)}
      </section>`,
    )
    .join('\n');
  // Politique de confidentialité : le texte de l'application, complété pour le site lui-même.
  const website =
    id === 'privacy'
      ? `
      <section id="site-web">
        <h2>${t.legal.website.heading}</h2>
${t.legal.website.paragraphs.map((p) => `        <p>${p}</p>`).join('\n')}
      </section>`
      : '';
  const content = `      <h1>${escapeHtml(document.title)}</h1>
      <p class="legal-updated">${t.legal.lastUpdated} ${escapeHtml(document.lastUpdated)}</p>
${sections}${website}`;
  return renderDocument(ctx, t, {
    comment: `Généré par marketing/scripts/generate.mjs depuis src/legal/documents.json (${DOCUMENTS.sources[lang][id]}) : ne pas modifier à la main.`,
    head: {
      title: document.title + t.meta.titleSuffix,
      description: t.meta[id].description,
      xDefault: ctx.page(id, 'fr'),
    },
    body: article(content, ctx, t),
  });
}

/**
 * Mentions légales : uniquement les informations fournies par le propriétaire (src/i18n,
 * legal.notice) ; les éléments encore inconnus sont listés comme « à compléter », jamais inventés.
 */
export function renderLegalNotice(t, lang) {
  const ctx = pageContext('notice', lang);
  const items = t.legal.notice.items
    .map(
      (item) => `        <div>
          <dt>${item.term}</dt>
          <dd>${item.text}</dd>
        </div>`,
    )
    .join('\n');
  const content = `      <h1>${t.meta.notice.title}</h1>
      <dl class="legal-facts">
${items}
      </dl>
      <div class="status-notice" role="note">
        <p>${t.legal.notice.pending}</p>
      </div>`;
  return renderDocument(ctx, t, {
    comment: "Généré par marketing/scripts/generate.mjs : document absent de l'application (src/i18n, legal.notice).",
    head: {
      title: t.meta.notice.title + t.meta.titleSuffix,
      description: t.meta.notice.description,
      xDefault: ctx.page('notice', 'fr'),
    },
    body: article(content, ctx, t),
  });
}
