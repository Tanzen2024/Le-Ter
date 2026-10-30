# LeTer — site vitrine (français / English)

Site public de présentation de **LeTer**, application mobile de jeux de cartes multijoueur
(Fap-Fap, GARAM TIA), en **français (langue par défaut) et en anglais**, destiné à
**https://www.leter.cm**. Pages HTML statiques générées à partir de gabarits et de
dictionnaires, **sans framework ni dépendance npm**. Indépendant de `frontend/`, `backend/` et
`administration/` : il n'appelle aucune API, ne contient aucun secret et n'affiche aucune donnée
de joueur.

```
marketing/
├── src/                    ← SOURCES des pages (à modifier)
│   ├── site.mjs            marque, SITE_URL, INDEXABLE, langues, routes de chaque page
│   ├── i18n/fr.mjs         ★ tous les textes français
│   ├── i18n/en.mjs         ★ tous les textes anglais (mêmes clés)
│   ├── pages/layout.mjs    <head> SEO (canonical, hreflang, Open Graph, X/Twitter), en-tête, pied de page, consentement
│   ├── pages/home.mjs      accueil
│   ├── pages/legal.mjs     documents juridiques (+ section « site web » de la politique)
│   ├── pages/root.mjs      page racine : choix de la langue (x-default)
│   ├── pages/not-found.mjs page 404 bilingue
│   ├── pages/icons.mjs     icônes SVG (sans texte)
│   └── legal/documents.json  textes juridiques de l'application (npm run legal:sync)
├── public/                 ← site servi tel quel (pages GÉNÉRÉES par npm run generate)
│   ├── index.html          page racine (choix de la langue)
│   ├── 404.html, sitemap.xml, robots.txt   (générés)
│   ├── fr/index.html       accueil français ; fr/legal/ : documents juridiques
│   ├── en/index.html       accueil anglais ; en/legal/ : documents juridiques
│   ├── .htaccess           Apache : HTTPS, www, en-têtes de sécurité, 404, cache, compression
│   └── assets/
│       ├── css/site.css    styles (mobile d'abord), palette « Ébène & Laiton » de l'application
│       ├── css/nojs.css    sans JavaScript seulement : menu mobile déplié
│       ├── js/config.js    ★ liens officiels, assistance, parrainage, GA4
│       ├── js/lib.js       fonctions pures (code de parrainage, validation des liens, GA4)
│       ├── js/site.js      menu mobile, liens configurés, invitation ?ref=, sélecteur de langue
│       ├── js/analytics.js GA4, chargé seulement après consentement
│       ├── js/lang-redirect.js  page racine seulement : ouvre /fr/ ou /en/
│       ├── img/logo.svg    dos de carte « L » de l'application (TatamiCard), aussi favicon
│       ├── img/og-leter.png      image de partage 1200 × 630 (cartes L E T E R, Cinzel)
│       ├── img/favicon-32.png, img/apple-touch-icon.png
│       └── fonts/          Cinzel Bold (police des titres de l'application, licence OFL)
├── scripts/generate.mjs    src/ → public/ (npm run generate)
├── scripts/sync-legal.mjs  textes juridiques de l'application → src/legal/documents.json
├── scripts/check.mjs       contrôle statique (npm run lint)
├── scripts/build.mjs       build → dist/
├── scripts/serve.mjs       serveur local de prévisualisation (127.0.0.1 uniquement)
├── tests/                  site, i18n/SEO, legal (node:test)
└── dist/                   build de production (généré, ignoré par Git) ← SEUL dossier à publier
```

`marketing/` est un **dépôt Git autonome** (non suivi par le dépôt principal) :
`git -C marketing log` pour l'historique, un commit par groupe de changements.

## Lancer le site en local (Windows)

**Node.js 22.18 ou plus** : `npm test` et `npm run legal:sync` importent directement les
fichiers `.ts` de `frontend/` (suppression des types activée par défaut à partir de 22.18).
**Aucun `npm install`** n'est nécessaire.

```powershell
cd C:\xampp\htdocs\le-ter\marketing
npm run serve      # sources : http://127.0.0.1:4173/
npm run preview    # build puis sert dist/ : http://127.0.0.1:4173/
```

**Avec XAMPP** : démarrer Apache, puis ouvrir `http://localhost/le-ter/marketing/public/`
(ou directement `…/public/fr/` et `…/public/en/`). Tous les liens sont relatifs, sauf ceux de la
page 404 (chemins depuis la racine du domaine : sans style sous XAMPP, c'est attendu). Les
redirections HTTPS / www de `.htaccess` ne s'appliquent qu'à l'hôte `leter.cm`.
⚠ XAMPP expose tout `htdocs`, donc tout le dépôt, sur ce poste : acceptable en local
uniquement, jamais comme configuration de serveur public.

Le JavaScript est en modules ES : ouvrir les pages par `http://`, pas en `file://`. Sans
JavaScript, chaque page reste complète, les liens (dont FR | EN) fonctionnent, le menu mobile
est déplié et la page racine ouvre le français.

Pour tester l'invitation de parrainage : `http://127.0.0.1:4173/?ref=AB3K7MPQ` (ou
`/fr/?ref=…`, `/en/?ref=…`).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run generate` | Génère `public/index.html`, `404.html`, `sitemap.xml`, `robots.txt`, `public/fr/**` et `public/en/**` depuis `src/`. **À lancer après toute modification de `src/`.** |
| `npm run lint` | Contrôle statique : ancres et fichiers référencés, `alt`, un seul `h1`, `lang` cohérent avec le dossier, canonical et hreflang (sauf 404), pas de script ni de style en ligne (CSP), pas de ressource externe, types de fichiers autorisés, fichiers attendus (image de partage, favicons, 404, sitemap), syntaxe JS, configuration (https, e-mail, GA4). |
| `npm test` | Tests `node:test` : parrainage, configuration, CSP, contenu FR et EN (règles, jetons, inscription), parité des dictionnaires, pages à jour, **textes oubliés**, SEO (sitemap, robots, Open Graph, 404), sélecteur de langue, documents juridiques. |
| `npm run build` | Refuse des pages générées obsolètes, contrôle `public/`, copie dans `dist/`, rend absolues canonical, hreflang et og:url sur **`https://www.leter.cm`** (`SITE_URL=https://…` pour une autre adresse), ajoute `dist/version.txt`, recontrôle `dist/`. |
| `npm run legal:sync` | Recopie les textes juridiques de l'application dans `src/legal/documents.json` (puis `npm run generate`). |

## Langues (i18n)

### Fonctionnement

- **URL** : `/fr/…` et `/en/…`, une vraie page HTML par langue (aucune traduction chargée par
  le navigateur, aucun texte affiché par JavaScript). Les pages juridiques ont des noms
  localisés (`/fr/legal/conditions-utilisation.html` ↔ `/en/legal/terms-of-use.html`), déclarés
  dans `ROUTES` (`src/site.mjs`).
- **Page racine `/`** (x-default) : ouvre la langue mémorisée, sinon la première langue
  fr/en du navigateur, sinon le **français** ; garde `?ref=` et `#section`. Sans JavaScript :
  français. **`/fr/` et `/en/` ne redirigent jamais** : accès direct toujours possible, aucune
  boucle.
- **Sélecteur FR | EN** (en-tête, visible aussi sur mobile, hors du menu replié) : mène à la
  **même page** dans l'autre langue ; `site.js` y ajoute `?ref=` et la section courante
  (`#parrainage`…) et mémorise le choix (`localStorage`, clé `leter-language`). Langue active :
  `aria-current="true"` et soulignée ; chaque lien porte `lang`, `hreflang` et le nom complet de
  la langue (`aria-label="English"`) pour les lecteurs d'écran.
- **SEO** : `<html lang>`, `<title>`, description, Open Graph (`og:locale` + alternate),
  canonical propre à chaque langue, `hreflang` fr / en / x-default réciproques (x-default : la
  racine pour l'accueil, la version française pour les documents). `INDEXABLE` (`src/site.mjs`)
  vaut `true` : pages indexables, `sitemap.xml` déclaré dans `robots.txt` (`false` : `noindex` partout).
- Les identifiants de section (`#decouvrir`, `#parrainage`…) sont communs aux deux langues :
  c'est ce qui permet au sélecteur de garder la section affichée. Ne pas les traduire.

### Ajouter ou modifier un texte

1. Ajouter la clé **dans `src/i18n/fr.mjs` ET `src/i18n/en.mjs`**, au même endroit (même
   structure). Noms de clés en anglais, camelCase, regroupés par section (`hero.title`,
   `faq.account.q`…). Les tableaux (étapes, règles, FAQ) doivent avoir la même longueur.
2. L'utiliser dans le gabarit : `${t.section.cle}`. Les valeurs sont insérées telles quelles :
   seul un balisage en ligne simple est permis (`<em>`, `<strong>`, `<a href="#…">`). Dans un
   attribut (`aria-label`, `data-…`), passer par `escapeHtml(...)`.
3. Texte utilisé par JavaScript (message après une action) : le mettre dans un attribut
   `data-…` du HTML généré et le lire dans `site.js` (voir `data-copied`) — jamais de texte en
   dur dans `site.js`.
4. `npm run generate`, puis `npm test`.

Libellés de l'application cités dans le texte (« Inscription », « Aide et réclamations »,
« Parrainage », « Code de parrainage », « Mot de passe oublié ? ») : l'application ne les
affiche qu'en français. La version anglaise les cite tels quels, suivis d'une traduction entre
parenthèses ; à mettre à jour si l'application est traduite.

### Ajouter une page localisée

1. `src/site.mjs` : ajouter la route, un chemin par langue
   (`faq: { fr: 'fr/aide.html', en: 'en/help.html' }`).
2. `src/pages/<page>.mjs` : gabarit qui appelle `pageContext(id, lang)` et `renderDocument(...)`
   (layout.mjs fournit `<head>` SEO, en-tête avec sélecteur, pied de page). Liens internes :
   `ctx.page('home')`, ressources : `ctx.asset('assets/…')`.
3. Ses textes et métadonnées dans `fr.mjs` et `en.mjs`.
4. L'ajouter dans `renderSite()` (`scripts/generate.mjs`), puis `npm run generate` et
   `npm test` (les tests SEO et sélecteur parcourent automatiquement toutes les routes).

### Garde-fous automatiques

- `tests/i18n.test.mjs` : mêmes clés en fr et en, aucune valeur vide, pages générées à jour,
  **aucun texte visible ni `aria-label` écrit en dur** (le site est généré avec des marqueurs à
  la place de chaque texte : tout ce qui reste visible est forcément en dur), hreflang
  réciproques, titres et descriptions différents par langue.
- `npm run build` refuse de construire si `public/` n'est pas à jour avec `src/`.


## Configuration — `public/assets/js/config.js`

Une valeur vide signifie « pas encore disponible ». N'y inscrire que des adresses **officielles,
confirmées, en `https://`** (le lint refuse le reste). Valable pour les deux langues.

| Clé | Effet | État au 26/10/2026 |
|---|---|---|
| `downloads.android` | Bouton « Télécharger sur Android » actif (section Télécharger et accueil), note d'installation hors Google Play, statut « Disponible sur Android » | `https://api-beta.leter.cm/downloads/le-ter-test.apk` — ⚠ **APK de TEST** (serveur TEST), à remplacer par l'APK de production (`https://api.leter.cm/downloads/le-ter.apk`) puis par la fiche Google Play. Les tests exigent un lien `https://…leter.cm/….apk` : pour Google Play, adapter `tests/site.test.mjs`. |
| `downloads.ios` | Bouton iOS actif. Fiche App Store ou lien public TestFlight. | **Vide** : « Bientôt disponible sur iOS » |
| `supportUrl` | Lien d'assistance (page web) | **Vide** (aucune page d'assistance) |
| `supportEmail` | Lien `mailto:` dans la FAQ et le pied de page | `hugueslamat16@gmail.com` |
| `referral.rewardsActive` | `true` : aucun avertissement. `false` : réaffiche « crédit pas encore activé » | `true` (décision du propriétaire) — doit correspondre à `REFERRAL_REWARDS_ENABLED=true` en production (D-169) |
| `analytics.ga4MeasurementId` | GA4 chargé **après consentement** (bandeau, bouton « Mesure d'audience » en pied de page), événement `app_download` | **Vide** : aucune mesure, aucun bandeau |

### Google Analytics 4

1. Créer une propriété GA4 et un flux Web pour `https://www.leter.cm`, copier l'**ID de
   mesure** (`G-XXXXXXXXXX`, public : ce n'est pas un secret).
2. Le mettre dans `analytics.ga4MeasurementId`, puis `npm run lint && npm test`.
3. Fonctionnement : rien n'est chargé avant « Accepter » ; le choix est mémorisé
   (`localStorage`, clé `leter-analytics-consent`) ; « Refuser » ou un retrait ultérieur coupe
   l'envoi et efface les cookies `_ga`. La CSP autorise uniquement `www.googletagmanager.com`
   (script) et `*.google-analytics.com`, `*.analytics.google.com` (envoi).
4. ⚠ Les obligations de consentement dépendent du droit applicable : faire valider le bandeau et
   la section « site web » de la politique de confidentialité avant d'activer la mesure.

**Lien de parrainage** : quand `REFERRAL_DOWNLOAD_URL` (backend) vaudra `https://www.leter.cm/`,
le lien partagé par un joueur sera `https://www.leter.cm/?ref=CODE` ; la page racine l'ouvre dans
la langue du visiteur en gardant le code (aperçu WhatsApp : image de partage de la racine). La page
affiche le code (8 caractères sans 0/O/1/I), un bouton « Copier le code » et un lien
`leter://register?ref=CODE` pour qui a déjà l'application (R-44 (5) ; aucun deferred deep linking).

## Sources du contenu

| Contenu | Source |
|---|---|
| Identité de l'éditeur (LAMAT, Douala, Cameroun, e-mail, 18 ans, droit camerounais, date des documents) | Brief du propriétaire, 26/10/2026 ; `frontend/src/constants/app-config.ts` (`LEGAL_INFO`) |
| Fap-Fap (31 cartes, 5 cartes, 5 plis), GARAM TIA (35 cartes, 3 cartes, cartes au centre, 21), 2 à 4 joueurs | Brief ; `backend/src/domain/cards/card.ts`, `backend/src/domain/garam/` (D-035, D-119). Cartes au centre : n + 1 (`GARAM_TERRE_SIZE`, confirmé par le propriétaire le 27/10/2026) |
| 1 jeton = 1 FCFA, solde ≥ 2 × mise, perte jusqu'à 2 × mise (Kora), gagnant unique, commission prélevée sur les mises des perdants à un taux fixé par la tranche de la mise (confirmé le 27/10/2026) | Brief ; `backend/src/domain/payments/payment.ts`, `domain/rules/stake.ts`, `domain/rules/game-settlement.ts` (D-073, D-074, D-080). **Aucun barème publié** (test : aucun « % » dans la page) |
| Achats et retraits MTN / Orange Money, retrait ≥ 1 000 vers le numéro d'inscription ; ouverts aujourd'hui au Cameroun seulement (code), cible : tous les pays MTN / Orange Money (décision du 27/10/2026, non implémentée) | Brief ; `backend/src/domain/payments/payment.ts`, `domain/wallet/withdrawal.ts` (D-040, D-075, D-090) |
| Parrainage (1 000 jetons, 10 filleuls par palier, 5 000 jetons par palier) | D-161, `backend/src/domain/referrals/referral.ts` (`DEFAULT_REFERRAL_RULES`, modifiables dans l'administration) |
| Inscription (prénom, nom, pseudo, téléphone, mot de passe ; e-mail facultatif) | Brief ; D-135, D-139, `RegisterScreen` |
| Tournois | D-051, D-106, D-108 |
| Palette, cartes L E T E R, police Cinzel | `frontend/src/constants/theme.ts`, `TableDecor.tsx`, `LoginDecor.tsx` (D-140) |

Écarts entre le brief et le code, points à valider : `docs/mise-a-niveau/` (dépôt principal).

## Documents juridiques

| Page | FR | EN | Source |
|---|---|---|---|
| Conditions d'utilisation | `fr/legal/conditions-utilisation.html` | `en/legal/terms-of-use.html` | `frontend/src/features/legal/content/terms.{fr,en}.ts` (18 sections, mot pour mot) |
| Politique de confidentialité | `fr/legal/politique-confidentialite.html` | `en/legal/privacy-policy.html` | `…/privacy.{fr,en}.ts` (18 sections) **+ section « site web »** (`legal.website` dans `src/i18n`) |
| Mentions légales | `fr/legal/mentions-legales.html` | `en/legal/legal-notice.html` | `legal.notice` dans `src/i18n` : éditeur, adresse, contact ; forme juridique, immatriculation, directeur de la publication et hébergeur **signalés comme à compléter** |

Les textes de l'application ne se modifient **jamais ici** : corriger l'application, puis
`npm run legal:sync` (lit `frontend/` sans le modifier) et `npm run generate`. `npm test`
échoue si `src/legal/documents.json` diffère de l'application ou si une page ne reprend pas
chaque paragraphe mot pour mot. ⚠ Les repères sont remplis, mais **aucun texte n'a été validé
par un juriste**, ni en français ni en anglais.

## Avant publication

1. Remplacer l'APK de TEST par l'APK de production dans `config.js` (voir Configuration).
2. Vérifier en production : achats MTN / Orange Money, retraits (`CINETPAY_TRANSFERS_ENABLED`),
   crédit du parrainage (`REFERRAL_REWARDS_ENABLED`) — le site les annonce comme disponibles.
3. Faire valider par un juriste : CGU, politique (dont la section « site web » et GA4), mentions
   légales, et la conformité des mises, gains et retraits au droit applicable.
4. `npm run lint && npm test`, puis `npm run build` (URL absolues sur `https://www.leter.cm`).

## Déploiement sur https://www.leter.cm

**Ne publier que `marketing/dist/`.** Ne jamais donner comme racine web le dépôt
(`C:\xampp\htdocs\le-ter`, `/opt/le-ter/...`) ni `marketing/` : `backend/`, `administration/`,
`docs/`, `.git/` et les `.env` ne doivent jamais être accessibles.

Prérequis (au 26/10/2026, `www.leter.cm` **n'a aucun enregistrement DNS**) :

1. **DNS** (Cloudflare, zone `leter.cm`) : enregistrements `A` `www` et `@` (pour la
   redirection de `leter.cm`) vers l'adresse du serveur web.
2. **Certificat** : Let's Encrypt pour `www.leter.cm` et `leter.cm`.
3. **Serveur** : un site Nginx dédié (exemple ci-dessous), ou Apache avec `AllowOverride All`
   (`.htaccess` : `mod_rewrite`, `mod_headers`, `mod_expires`, `mod_deflate`).

Mise en ligne avec versions et retour arrière (exemple Linux) :

```bash
# sur le poste : npm run lint && npm test && npm run build, puis copier dist/ vers le serveur
rsync -a --delete marketing/dist/ serveur:/var/www/le-ter-site/releases/2026-10-26_1/
# sur le serveur : basculer le lien symbolique (atomique)
ln -sfn /var/www/le-ter-site/releases/2026-10-26_1 /var/www/le-ter-site/current
# retour arrière : repointer current vers la version précédente
ln -sfn /var/www/le-ter-site/releases/<version-precedente> /var/www/le-ter-site/current
```

`version.txt` (servi à la racine) indique la date, le commit et l'adresse de la version en ligne.

Exemple Nginx (même CSP que `.htaccess` et `serve.mjs`, vérifié par les tests) :

```nginx
server {
    listen 443 ssl http2;
    server_name www.leter.cm;
    ssl_certificate     /etc/letsencrypt/live/www.leter.cm/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.leter.cm/privkey.pem;

    root /var/www/le-ter-site/current;      # le contenu de dist/, rien d'autre
    index index.html;
    error_page 404 /404.html;

    gzip on;
    gzip_types text/css text/javascript application/javascript application/xml image/svg+xml font/ttf;

    include /etc/nginx/snippets/le-ter-site-headers.conf;

    location ~ /\. { deny all; }
    location / { try_files $uri $uri/ =404; }
    location ~* \.html$ {
        include /etc/nginx/snippets/le-ter-site-headers.conf;
        add_header Cache-Control "no-cache" always;
    }
    location /assets/ {
        include /etc/nginx/snippets/le-ter-site-headers.conf;
        expires 7d;
    }
}
# Redirections : http → https, leter.cm → www.leter.cm
server { listen 80; server_name www.leter.cm leter.cm; return 301 https://www.leter.cm$request_uri; }
server {
    listen 443 ssl http2;
    server_name leter.cm;
    ssl_certificate     /etc/letsencrypt/live/www.leter.cm/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.leter.cm/privkey.pem;
    return 301 https://www.leter.cm$request_uri;
}
```

`/etc/nginx/snippets/le-ter-site-headers.conf` (inclus aussi dans chaque `location` qui ajoute un
en-tête, car Nginx n'y hérite plus des `add_header` du serveur) :

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self'; img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com; font-src 'self'; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'" always;
```

Vérifications après mise en ligne :

```bash
curl -sI https://www.leter.cm/fr/ | grep -iE "^(HTTP|strict-transport|content-security|x-content)"
curl -sI http://leter.cm/ | grep -i "^location"                               # → https://www.leter.cm/
curl -s -o /dev/null -w "%{http_code}\n" https://www.leter.cm/nexiste-pas      # → 404
curl -s https://www.leter.cm/robots.txt; curl -s https://www.leter.cm/sitemap.xml | head
curl -sI https://www.leter.cm/assets/js/site.js | grep -i content-type        # → text/javascript
```

Puis : déclarer le sitemap dans Google Search Console, tester l'aperçu d'un lien
`https://www.leter.cm/?ref=AB3K7MPQ` sur WhatsApp, lancer PageSpeed Insights sur `/fr/`.
