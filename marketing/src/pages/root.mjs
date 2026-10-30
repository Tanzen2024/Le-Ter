import { BRAND, DEFAULT_LANGUAGE, INDEXABLE, LANGUAGE_NAMES, LANGUAGES, OG_LOCALES, ROOT_PAGE, ROUTES, relativeHref } from '../site.mjs';
import { escapeHtml, renderIcons, renderShareImage } from './layout.mjs';

/**
 * Page racine (x-default de l'accueil). Avec JavaScript, assets/js/lang-redirect.js ouvre
 * aussitôt la langue mémorisée, sinon celle du navigateur (fr ou en), sinon le français, en
 * gardant ?ref= et #section. Sans JavaScript : redirection vers le français. Seule page
 * volontairement bilingue ; /fr/ et /en/ ne redirigent jamais.
 */
export function renderRoot(dictionaries) {
  const href = (lang) => relativeHref(ROOT_PAGE, ROUTES.home[lang]);
  const fr = dictionaries.fr;
  const alternates = LANGUAGES.map(
    (lang) => `  <link rel="alternate" hreflang="${lang}" href="${href(lang)}">`,
  ).join('\n');
  const choices = LANGUAGES.map(
    (lang) =>
      `        <a class="btn ${lang === DEFAULT_LANGUAGE ? 'btn-primary' : 'btn-outline'}" href="${href(lang)}" hreflang="${lang}" lang="${lang}" data-lang="${lang}">${LANGUAGE_NAMES[lang]}</a>`,
  ).join('\n');
  const prompts = LANGUAGES.map(
    (lang) => `<span lang="${lang}">${escapeHtml(dictionaries[lang].common.languageSwitchLabel)}</span>`,
  ).join(' · ');
  return `<!doctype html>
<!-- Généré par marketing/scripts/generate.mjs (src/pages/root.mjs) : ne pas modifier à la main. -->
<html lang="${DEFAULT_LANGUAGE}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fr.meta.home.title)}</title>
  <meta name="description" content="${escapeHtml(fr.meta.home.description)}">
${INDEXABLE ? '' : '  <meta name="robots" content="noindex">\n'}  <meta name="theme-color" content="#06110D">
  <link rel="canonical" href="./">
${alternates}
  <link rel="alternate" hreflang="x-default" href="./">
  <!-- Aperçu des liens partagés (dont les invitations ?ref=) : textes de la langue par défaut. -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${BRAND}">
  <meta property="og:title" content="${escapeHtml(fr.meta.home.ogTitle)}">
  <meta property="og:description" content="${escapeHtml(fr.meta.home.ogDescription)}">
  <meta property="og:url" content="./">
  <meta property="og:locale" content="${OG_LOCALES[DEFAULT_LANGUAGE]}">
${renderShareImage({ title: fr.meta.home.ogTitle, description: fr.meta.home.ogDescription, imageAlt: fr.meta.shareImageAlt })}
  <noscript><meta http-equiv="refresh" content="0; url=${href(DEFAULT_LANGUAGE)}"></noscript>
${renderIcons((file) => file)}
  <link rel="stylesheet" href="assets/css/site.css">
  <script type="module" src="assets/js/lang-redirect.js"></script>
</head>
<body class="section-dark language-choice">
  <main id="contenu" class="container">
    <img src="assets/img/logo.svg" alt="" width="52" height="70">
    <h1>${BRAND}</h1>
    <p>${prompts}</p>
    <div class="actions">
${choices}
    </div>
  </main>
</body>
</html>
`;
}
