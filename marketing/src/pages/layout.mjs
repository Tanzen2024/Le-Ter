import {
  BRAND,
  INDEXABLE,
  LANGUAGE_CODES,
  LANGUAGE_NAMES,
  LANGUAGES,
  OG_LOCALES,
  ROUTES,
  SHARE_IMAGE,
  SITE_URL,
  relativeHref,
} from '../site.mjs';
import { ICON_SPRITE } from './icons.mjs';

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Image de partage (Open Graph et X/Twitter). Toujours absolue : les réseaux sociaux et
 * messageries (WhatsApp…) n'acceptent pas d'URL relative pour l'image.
 */
export function renderShareImage({ title, description, imageAlt }) {
  const image = `${SITE_URL}/${SHARE_IMAGE.path}`;
  return `  <meta property="og:image" content="${image}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="${SHARE_IMAGE.width}">
  <meta property="og:image:height" content="${SHARE_IMAGE.height}">
  <meta property="og:image:alt" content="${escapeHtml(imageAlt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${image}">
  <meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}">`;
}

/** Icônes : SVG pour les navigateurs récents, PNG pour les autres et l'écran d'accueil iOS. */
export function renderIcons(asset) {
  return `  <link rel="icon" href="${asset('assets/img/logo.svg')}" type="image/svg+xml">
  <link rel="icon" href="${asset('assets/img/favicon-32.png')}" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="${asset('assets/img/apple-touch-icon.png')}">`;
}

/**
 * Contexte d'une page : sa langue, son chemin et des liens relatifs vers les autres pages et
 * les ressources (valables sous XAMPP, dans dist/ et à la racine d'un domaine).
 */
export function pageContext(routeId, lang) {
  const path = ROUTES[routeId][lang];
  return {
    routeId,
    lang,
    path,
    page: (id, language = lang) => relativeHref(path, ROUTES[id][language]),
    asset: (file) => relativeHref(path, file),
  };
}

/**
 * <head> : titre et description traduits, canonical, hreflang (fr, en, x-default), Open Graph.
 * Les URL sont relatives ici ; `npm run build` les rend absolues si SITE_URL est défini.
 */
function renderHead(ctx, t, { title, description, ogTitle = title, ogDescription = description, xDefault }) {
  const alternates = LANGUAGES.map(
    (language) => `  <link rel="alternate" hreflang="${language}" href="${ctx.page(ctx.routeId, language)}">`,
  ).join('\n');
  const otherLocales = LANGUAGES.filter((l) => l !== ctx.lang)
    .map((l) => `  <meta property="og:locale:alternate" content="${OG_LOCALES[l]}">`)
    .join('\n');
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
${INDEXABLE ? '' : '  <meta name="robots" content="noindex">\n'}  <meta name="theme-color" content="#06110D">
  <link rel="canonical" href="${ctx.page(ctx.routeId)}">
${alternates}
  <link rel="alternate" hreflang="x-default" href="${xDefault}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${BRAND}">
  <meta property="og:title" content="${escapeHtml(ogTitle)}">
  <meta property="og:description" content="${escapeHtml(ogDescription)}">
  <meta property="og:url" content="${ctx.page(ctx.routeId)}">
  <meta property="og:locale" content="${OG_LOCALES[ctx.lang]}">
${otherLocales}
${renderShareImage({ title: ogTitle, description: ogDescription, imageAlt: t.meta.shareImageAlt })}
${renderIcons(ctx.asset)}
  <link rel="preload" href="${ctx.asset('assets/fonts/cinzel-700.ttf')}" as="font" type="font/ttf" crossorigin>
  <link rel="stylesheet" href="${ctx.asset('assets/css/site.css')}">
  <noscript><link rel="stylesheet" href="${ctx.asset('assets/css/nojs.css')}"></noscript>
  <script type="module" src="${ctx.asset('assets/js/site.js')}"></script>
</head>`;
}

/**
 * Sélecteur FR | EN : liens vers la même page dans l'autre langue (site.js y ajoute ?ref= et
 * #section, et mémorise le choix). Les codes et noms de langue ne se traduisent pas.
 */
function renderLanguageSwitch(ctx, t) {
  const links = LANGUAGES.map((language) => {
    const current = language === ctx.lang ? ' aria-current="true"' : '';
    return `<a href="${ctx.page(ctx.routeId, language)}" hreflang="${language}" lang="${language}" aria-label="${LANGUAGE_NAMES[language]}"${current} data-lang="${language}">${LANGUAGE_CODES[language]}</a>`;
  }).join('<span aria-hidden="true">|</span>');
  return `<div class="lang-switch" role="group" aria-label="${escapeHtml(t.common.languageSwitchLabel)}" data-lang-switch>${links}</div>`;
}

function renderHeader(ctx, t) {
  const brandHref = ctx.routeId === 'home' ? '#accueil' : ctx.page('home');
  const brand = `<a class="brand" href="${brandHref}">
        <img src="${ctx.asset('assets/img/logo.svg')}" alt="" width="26" height="35">
        <span>${BRAND}</span>
      </a>`;
  if (ctx.routeId !== 'home') {
    return `<header class="site-header">
    <nav class="nav container" aria-label="${escapeHtml(t.common.mainNavLabel)}">
      ${brand}
      <a class="back-link" href="${ctx.page('home')}">${t.common.backHome}</a>
      ${renderLanguageSwitch(ctx, t)}
    </nav>
  </header>`;
  }
  return `<header class="site-header">
    <nav class="nav container" aria-label="${escapeHtml(t.common.mainNavLabel)}">
      ${brand}
      <div class="nav-menu" id="nav-menu">
        <ul class="nav-links">
          <li><a href="#decouvrir">${t.nav.discover}</a></li>
          <li><a href="#fonctionnalites">${t.nav.features}</a></li>
          <li><a href="#jetons">${t.nav.tokens}</a></li>
          <li><a href="#parrainage">${t.nav.referral}</a></li>
          <li><a href="#tournois">${t.nav.tournaments}</a></li>
          <li><a href="#assistance">${t.nav.support}</a></li>
        </ul>
        <a class="btn btn-primary btn-small" href="#telecharger">
          <svg class="icon" aria-hidden="true"><use href="#i-download"/></svg>
          ${t.common.downloadCta}
        </a>
      </div>
      ${renderLanguageSwitch(ctx, t)}
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-menu">
        <svg class="icon" aria-hidden="true"><use href="#i-menu"/></svg>
        <span class="visually-hidden">${t.common.menu}</span>
      </button>
    </nav>
  </header>`;
}

function renderFooter(ctx, t) {
  const home = ctx.routeId === 'home' ? '' : ctx.page('home');
  const legal = [
    ['terms', t.footer.terms],
    ['privacy', t.footer.privacy],
    ['notice', t.footer.notice],
  ]
    .map(([id, label]) => {
      const current = id === ctx.routeId ? ' aria-current="page"' : '';
      return `          <li><a href="${ctx.page(id)}"${current}>${label}</a></li>`;
    })
    .join('\n');
  return `<footer class="site-footer section-dark">
    <div class="container footer-grid">
      <div class="footer-brand">
        <a class="brand" href="${home || '#accueil'}">
          <img src="${ctx.asset('assets/img/logo.svg')}" alt="" width="26" height="35">
          <span>${BRAND}</span>
        </a>
        <p>${t.footer.tagline}</p>
        <p class="footer-age">${t.footer.ageNotice}</p>
      </div>
      <nav aria-label="${escapeHtml(t.footer.siteNavLabel)}">
        <h2 class="footer-title">${t.footer.siteTitle}</h2>
        <ul>
          <li><a href="${home}#decouvrir">${t.nav.discover}</a></li>
          <li><a href="${home}#fonctionnalites">${t.nav.features}</a></li>
          <li><a href="${home}#parrainage">${t.nav.referral}</a></li>
          <li><a href="${home}#jetons">${t.nav.tokens}</a></li>
          <li><a href="${home}#tournois">${t.nav.tournaments}</a></li>
          <li><a href="${home}#assistance">${t.nav.support}</a></li>
          <li><a href="${home}#telecharger">${t.nav.download}</a></li>
        </ul>
      </nav>
      <nav aria-label="${escapeHtml(t.footer.legalNavLabel)}">
        <h2 class="footer-title">${t.footer.legalTitle}</h2>
        <ul>
${legal}
          <li><a data-support-link hidden>${t.footer.support}</a></li>
          <li><button class="link-button" type="button" data-consent-open hidden>${t.consent.manage}</button></li>
        </ul>
      </nav>
    </div>
    <div class="container footer-bottom">
      <p>© <span data-year>2026</span> ${BRAND}</p>
    </div>
  </footer>`;
}

/**
 * Consentement à la mesure d'audience (GA4). Affiché par analytics.js seulement si un
 * identifiant GA4 est configuré et qu'aucun choix n'a été fait ; rien n'est chargé avant
 * l'accord du visiteur.
 */
function renderConsent(ctx, t) {
  return `<div class="consent" role="region" aria-label="${escapeHtml(t.consent.label)}" data-consent hidden>
    <div class="container consent-inner">
      <p>${t.consent.text} <a href="${ctx.page('privacy')}#site-web">${t.consent.details}</a></p>
      <div class="actions">
        <button class="btn btn-primary btn-small" type="button" data-consent-choice="granted">${t.consent.accept}</button>
        <button class="btn btn-ghost-light btn-small" type="button" data-consent-choice="denied">${t.consent.refuse}</button>
      </div>
    </div>
  </div>`;
}

/** Document HTML complet d'une page localisée. */
export function renderDocument(ctx, t, { head, body, comment }) {
  return `<!doctype html>
<!-- ${comment} -->
<html lang="${ctx.lang}">
${renderHead(ctx, t, head)}
<body>
  <a class="skip-link" href="#contenu">${t.common.skipLink}</a>

${ICON_SPRITE}

  ${renderHeader(ctx, t)}

${body}

  ${renderFooter(ctx, t)}

  ${renderConsent(ctx, t)}
</body>
</html>
`;
}
