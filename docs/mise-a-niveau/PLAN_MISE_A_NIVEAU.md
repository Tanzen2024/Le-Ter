# LeTer — Plan de mise à niveau (26/10/2026)

Fondé sur `AUDIT_INITIAL.md`. Ordre : stabilité > compatibilité > sécurité > exactitude métier
> SEO > esthétique. Aucun calcul financier, aucune règle de jeu, aucun flux de paiement n'est
modifié par ce plan.

## Sauvegarde

- `marketing/` : commit de référence de l'état actuel dans son dépôt Git, puis un commit par
  groupe de changements (retour arrière : `git -C marketing revert` ou `checkout`).
- `frontend/` : changements limités aux textes et à la configuration juridiques, non commités
  (le dépôt principal contient d'autres modifications en cours) ; liste exacte dans le rapport
  final.

## P0 — Bloquant

| ID | Changement | Fichiers | Raison | Risque | Stratégie | Test |
|---|---|---|---|---|---|---|
| P0-1 | Commit de référence du site | `marketing/` (dépôt imbriqué) | Aucun retour arrière possible | Faible | Commit sans `dist/` (ignoré), sans secret | `git -C marketing status` |
| P0-2 | Identité légale dans l'application | `frontend/src/constants/app-config.ts`, `frontend/src/features/legal/types.ts` | Repères `[…]` | Faible | Valeurs du propriétaire ; valeur FR/EN possible pour pays et date (rétrocompatible) | jest `LegalDocumentScreen`, tsc, lint |
| P0-3 | CGU / politique : e-mail facultatif, marque LeTer | `frontend/src/features/legal/content/*.ts` | Contraire à D-135 | Faible | Texte seul, 18 sections conservées | idem |
| P0-4 | Resynchroniser les documents du site | `marketing/src/legal/documents.json` | Textes de l'application | Faible | `npm run legal:sync` | `tests/legal.test.mjs` |
| P0-5 | Lien de téléchargement Android | `marketing/public/assets/js/config.js` | Demande du propriétaire | **Élevé** (APK de TEST) | `https://api-beta.leter.cm/downloads/le-ter-test.apk`, à remplacer par l'APK PROD | test de configuration |
| P0-6 | Contact officiel | `config.js` | Aucun contact | Faible | `supportEmail` | lint, tests |
| P0-7 | Domaine et indexation | `marketing/src/site.mjs`, `scripts/build.mjs` | `noindex`, URLs relatives | Moyen | `SITE_URL` par défaut `https://www.leter.cm`, `INDEXABLE = true` | tests SEO, build |
| P0-8 | Mentions légales | `marketing/src/pages/legal.mjs`, `src/i18n` | Page vide | Faible | Uniquement les informations fournies ; manques signalés | tests |

## P1 — Important

| ID | Changement | Fichiers | Risque | Test |
|---|---|---|---|---|
| P1-1 | Marque « LeTer » sur tout le site | `src/i18n/*`, `layout.mjs`, `logo.svg` | Faible | tests i18n |
| P1-2 | Contenu produit : règles Fap-Fap / GARAM TIA, inscription, 18+, mises, solde 2K, gagnant unique, commission sans barème, achats MTN/Orange (Cameroun), retraits ≥ 1 000 vers le numéro d'inscription, aucune partie gratuite | `src/i18n/*`, `home.mjs` | Moyen (exactitude) | tests de contenu |
| P1-3 | Parrainage actif (`rewardsActive: true`), vouvoiement | `config.js`, `src/i18n/*` | Élevé (D-169) | tests |
| P1-4 | Tournois disponibles | `src/i18n/*` | Faible | tests |
| P1-5 | Politique : section « site web » | `src/pages/legal.mjs`, `src/i18n/*` | Faible | tests légaux |
| P1-6 | Image Open Graph 1200×630, balises OG/Twitter sur toutes les pages, racine comprise | `public/assets/img/`, `layout.mjs`, `root.mjs` | Faible | lint, tests SEO |
| P1-7 | `sitemap.xml`, `robots.txt` avec Sitemap | `scripts/generate.mjs` | Faible | tests |
| P1-8 | Page 404 bilingue | `public/404.html`, `.htaccess`, `check.mjs` | Faible | lint |
| P1-9 | En-têtes de production : HSTS, cache, compression, `ErrorDocument` | `public/.htaccess`, README (Nginx) | Moyen (serveur) | vérification `curl -I` après déploiement |
| P1-10 | GA4 désactivé par défaut, chargé **après consentement** uniquement, CSP élargie à Google | `config.js`, `assets/js/analytics.js`, CSP | Moyen (vie privée) | lint, tests |

## P2 — Amélioration

| ID | Changement | Fichiers | Test |
|---|---|---|---|
| P2-1 | Menu mobile utilisable sans JavaScript | `site.css`, `site.js` | tests, contrôle visuel |
| P2-2 | Favicons PNG / apple-touch-icon (dérivés du logo du site, pas de l'icône Expo) | `public/assets/img/` | lint |
| P2-3 | Accessibilité : libellé « EN », note du hero hors `role="img"` | `layout.mjs`, `home.mjs` | tests |
| P2-4 | `engines.node >= 22.18` et README | `package.json`, `README.md` | `npm test` |

## P3 — Optionnel / plus tard

- Police en WOFF2 (outil de conversion absent du poste), captures d'écran réelles (à fournir),
  données structurées, nouveau package Android (rapport d'impact seulement, voir rapport final).

## Hors périmètre volontaire (aucune modification)

Calculs de mise, de commission et de gain ; Kora ; règles des jeux ; CinetPay (achats et
transferts) ; retraits ; parrainage côté serveur ; tournois côté serveur ; identifiant Android ;
icône de l'application.
