import { BRAND, DEFAULT_LANGUAGE, LANGUAGES, ROUTES } from '../site.mjs';

/**
 * Page 404 (servie par Apache `ErrorDocument` ou Nginx `error_page`) : une seule page, en
 * français et en anglais, car la langue de l'adresse demandée est inconnue. Elle peut être
 * servie à n'importe quelle profondeur (/fr/a/b/c) : chemins absolus depuis la racine du site,
 * aucun JavaScript, jamais indexée. Sous XAMPP (/le-ter/marketing/public/), le style ne charge
 * pas : c'est attendu, seule la racine d'un domaine est visée.
 */
export const NOT_FOUND_PAGE = '404.html';

export function renderNotFound(dictionaries) {
  const homes = LANGUAGES.map((lang) => {
    const t = dictionaries[lang].notFound;
    const href = `/${ROUTES.home[lang].replace(/index\.html$/, '')}`;
    return `      <div class="not-found-lang" lang="${lang}">
        <p>${t.text}</p>
        <a class="btn ${lang === DEFAULT_LANGUAGE ? 'btn-primary' : 'btn-outline'}" href="${href}" hreflang="${lang}">${t.cta}</a>
      </div>`;
  }).join('\n');
  const titles = LANGUAGES.map((lang) => `<span lang="${lang}">${dictionaries[lang].notFound.title}</span>`).join(
    '<span aria-hidden="true"> · </span>',
  );
  return `<!doctype html>
<!-- Généré par marketing/scripts/generate.mjs (src/pages/not-found.mjs) : ne pas modifier à la main. -->
<html lang="${DEFAULT_LANGUAGE}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${dictionaries[DEFAULT_LANGUAGE].notFound.title} — ${BRAND}</title>
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#06110D">
  <link rel="icon" href="/assets/img/logo.svg" type="image/svg+xml">
  <link rel="icon" href="/assets/img/favicon-32.png" type="image/png" sizes="32x32">
  <link rel="stylesheet" href="/assets/css/site.css">
</head>
<body class="section-dark language-choice">
  <main id="contenu" class="container not-found">
    <a href="/" class="not-found-logo"><img src="/assets/img/logo.svg" alt="${BRAND}" width="52" height="70"></a>
    <p class="not-found-code" aria-hidden="true">404</p>
    <h1>${titles}</h1>
${homes}
  </main>
</body>
</html>
`;
}
