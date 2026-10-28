# LeTer — Rapport final de mise à niveau (26/10/2026)

Voir aussi `AUDIT_INITIAL.md` (écarts brief / code) et `PLAN_MISE_A_NIVEAU.md`.

## A. Résumé exécutif

Le site vitrine `marketing/` est prêt techniquement pour `https://www.leter.cm` : contenu aligné
sur le brief et vérifié dans le backend, marque LeTer, documents juridiques complétés, SEO de
production (indexation, URL absolues, sitemap, robots, 404, Open Graph / X), en-têtes de
sécurité de production, GA4 prêt (désactivé, avec consentement), versionné dans Git.

**Il n'est pas encore publiable sans action humaine** : `www.leter.cm` n'existe pas dans le DNS,
le lien Android pointe vers l'**APK de TEST**, et plusieurs affirmations (achats, retraits,
parrainage en production) doivent être confirmées sur le serveur de production. Aucun calcul
financier, aucune règle de jeu, aucun flux de paiement n'a été modifié.

## B. Fichiers modifiés

### `marketing/` (dépôt Git imbriqué, 3 commits)

| Commit | Contenu |
|---|---|
| `6474bfc` | État de référence avant mise à niveau (retour arrière) |
| `6435333` | `.gitattributes` (LF), `package.json` (`engines.node >= 22.18`) |
| `f2ef6ea` | Mise à niveau : `src/site.mjs`, `src/i18n/{fr,en}.mjs`, `src/pages/{layout,home,legal,root}.mjs`, **nouveau** `src/pages/not-found.mjs`, `src/legal/documents.json` (resynchronisé), `scripts/{build,check,generate,serve}.mjs`, `public/.htaccess`, `public/assets/js/{config,lib,site}.js`, **nouveaux** `public/assets/js/analytics.js`, `public/assets/css/nojs.css`, `public/assets/img/{og-leter,favicon-32,apple-touch-icon}.png`, `public/assets/css/site.css`, `public/assets/img/logo.svg`, pages générées (`public/**`, `404.html`, `sitemap.xml`, `robots.txt`), `README.md`, `tests/*.mjs` |

Retour arrière : `git -C marketing reset --hard 6474bfc` (ou `revert`).

### Dépôt principal — **non commités** (le dépôt contient d'autres modifications en cours)

| Fichier | Changement |
|---|---|
| `frontend/src/constants/app-config.ts` | `LEGAL_INFO` renseigné (LAMAT, Douala, e-mail, 26/10/2026, République du Cameroun, 18) ; type `LegalText` (chaîne ou `{ fr, en }`) |
| `frontend/src/features/legal/types.ts` | `resolveLegalInfo` accepte une valeur traduite (rétrocompatible) |
| `frontend/src/features/legal/content/{terms,privacy}.{fr,en}.ts` | « Le Ter » → « LeTer » ; e-mail **facultatif** (CGU §4, Politique §3), conforme à D-135 |
| `frontend/src/features/legal/LegalDocumentScreen.test.tsx` | Test des repères avec une configuration explicitement vide ; nouveau test des documents publiés |
| `docs/mise-a-niveau/*.md` | Audit, plan, ce rapport |

## C. Fonctionnalités ajoutées (site)

Section « Jetons et mises » ; 2 questions de FAQ (coût, retrait) ; page 404 bilingue ;
`sitemap.xml` avec hreflang ; image de partage 1200 × 630 et balises X/Twitter ; Open Graph sur la
page racine (aperçu des liens de parrainage) ; favicons PNG ; GA4 avec bandeau de consentement,
retrait de l'accord et événement `app_download` ; menu mobile sans JavaScript ; section
« site web » dans la politique ; mentions légales.

## D. Fonctionnalités corrigées

Règles Fap-Fap (couleur demandée, contrôle) et GARAM TIA (cartes au centre, 21 objectif de GARAM
seulement) ; champs d'inscription ; « Boutique en préparation » → recharge disponible ;
parrainage annoncé actif (avertissement masqué, réactivable par `config.js`) ; tournois (phrase
« aucun tournoi annoncé » retirée) ; registre (vouvoiement) ; marque ; CGU (e-mail obligatoire) ;
grammaire « droit de Cameroun » ; `noindex` retiré ; URL relatives en production ; HSTS, cache,
compression absents ; accessibilité de la note du hero ; `engines` Node.

## E. Volontairement non modifié

- **Backend** : règlement des parties (commission sur les mises des perdants, Kora), règle 2K,
  retraits, CinetPay, parrainage, tournois. Aucun écart du brief n'a été « corrigé » dans le
  code : les écarts sont listés en H.
- **Règles de GARAM TIA** (`GARAM_TERRE_SIZE`).
- **Identifiant Android** `com.anonymous.leter` (rapport d'impact ci-dessous).
- **Icône de l'application** (icône par défaut d'Expo) : à fournir.
- **Captures d'écran et preuve sociale** : aucune dans le dépôt ; rien n'a été fabriqué.
- **Police** : toujours en TTF (aucun outil de conversion WOFF2 sur le poste, P3).
- **Libellé « EN » du sélecteur** (`aria-label="English"`) : conservé, le test d'i18n l'impose ;
  écart mineur WCAG 2.5.3.

## F. Tests

| Vérification | Résultat |
|---|---|
| `marketing` : `npm run lint` | ✅ aucun problème |
| `marketing` : `npm test` | ✅ **76/76** (63 avant ; 13 tests ajoutés, aucun supprimé) |
| `marketing` : clone neuf, lint + tests | ✅ 75/75 (suite de fidélité à l'application sautée, `frontend/` absent du clone) |
| `marketing` : `npm run build` | ✅ `dist/` contrôlé, URL absolues `https://www.leter.cm`, `version.txt` |
| SEO | ✅ sitemap (8 URL + hreflang), robots avec Sitemap, aucune page `noindex` hors 404, og:image absolue sur toutes les pages |
| Liens | ✅ contrôle statique (ancres, fichiers, mailto) ; APK `https://api-beta.leter.cm/downloads/le-ter-test.apk` → HTTP 200, 118 Mo |
| Rendu | ✅ captures Edge headless à 768 et 1 280 px ; 320–414 px non mesurables en headless (largeur minimale ≈ 500 px) : **à vérifier sur appareil** |
| `frontend` : jest `src/features/legal` | ✅ 11/11 |
| `frontend` : `tsc --noEmit`, eslint (fichiers modifiés) | ✅ |
| `frontend` : jest complet | ⚠ 1er passage 13 suites en échec, 2e passage 4 suites, **toutes par dépassement de délai (30 s) sous charge** ; les 4 relancées en série : ✅ 40/40. Aucune ne touche aux fichiers modifiés. |
| `backend` | Non exécuté : aucun fichier backend modifié |

## G. Risques restants

_Mise à jour du 27/10/2026 : décisions du propriétaire consignées dans D-172 ; site : commit `4854d40` (76/76 tests)._

1. **APK de TEST publié** : il se connecte à `api-beta.leter.cm` (base TEST, CinetPay sandbox).
   Un joueur public y créerait son compte sur le serveur de test, avec des paiements fictifs.
2. **`www.leter.cm` : NXDOMAIN** au 26/10/2026. Sans DNS, certificat et vhost, rien n'est en ligne.
3. **Annonces non prouvées en production** : achats (CinetPay vide sur PROD d'après l'exploitation
   du 26/10), retraits (`CINETPAY_TRANSFERS_ENABLED=false`, transferts non activés chez CinetPay),
   crédit du parrainage (`REFERRAL_REWARDS_ENABLED`).
4. **Fraude au parrainage** documentée par D-169 si le crédit est activé avec R-34 / R-42 ouverts.
5. **Commission invisible pour le joueur** dans l'application.
6. **Conformité jeux d'argent** (mises, gains, retraits) non établie.

## H. Points nécessitant validation humaine

| Sujet | Question |
|---|---|
| Conformité juridique | Mises, gains et retraits Mobile Money au regard du droit camerounais ; textes CGU, politique, mentions (FR et EN) |
| Pays | **Décidé (D-172)** : cible = tous les pays MTN / Orange Money ; **non implémenté** (code limité au Cameroun) → `ETUDE_MULTI_PAYS.md` : liste des pays, couverture CinetPay, devises, validation juridique |
| GARAM TIA | **Décidé (D-172)** : n + 1, le code fait foi ; site mis à jour |
| Commission | **Décidé (D-172)** : D-074 / D-080 font foi (mises des perdants, tranche de la mise) ; site mis à jour. **Reste ouvert** : l'afficher au joueur dans l'application |
| Kora | **Confirmé (D-172)** : perte de 2 × la mise ; expliqué sur le site |
| Google Play / APK | Créer la console, construire l'APK de production, remplacer le lien de TEST |
| Package ID | Voir ci-dessous |
| Parrainage | Activation en production malgré D-169 (R-34, R-42) |
| Analytics / cookies | Créer la propriété GA4, valider le bandeau et la section « site web » |
| Mentions légales | Forme juridique, immatriculation, directeur de la publication, hébergeur |
| Tournois | Conditions (droits d'entrée, récompenses) affichées dans l'application |
| Visuels | Captures d'écran réelles, icône de l'application (actuellement celle d'Expo) |

### Rapport d'impact : identifiant Android `com.anonymous.leter`

- **Utilisé dans** : `frontend/app.json` (`android.package`) et `frontend/android/app/build.gradle`
  (`namespace`, `applicationId` ; dossier généré, à ne pas modifier à la main). Aucun Firebase,
  aucun `google-services.json`, aucun OAuth ; le lien profond `leter://` ne dépend pas du package ;
  le backend ne le référence pas.
- **Doit-il changer ?** Oui avant la **première** publication Google Play : il devient alors
  définitif, et `com.anonymous.*` est le défaut d'Expo (PR-06 de `docs/production-readiness.md`).
- **Impacts d'un changement** : nouvelle application aux yeux d'Android ; les APK de test déjà
  installés ne se mettent pas à jour (désinstallation puis réinstallation, données locales
  perdues, comptes intacts côté serveur) ; EAS associe des identifiants de signature au package
  (nouveau keystore à générer ou à rattacher) ; `frontend/android/` à régénérer
  (`npx expo prebuild --clean`) ; documentation (`docs/android-apk-test.md`,
  `docs/deploiement-vps.md`) à mettre à jour.
- **Décision attendue** : l'identifiant définitif (par exemple `cm.leter.app`).

## I. Procédure de déploiement sur https://www.leter.cm

Détail complet et exemple Nginx : `marketing/README.md`, « Déploiement ».

1. **DNS** (Cloudflare) : `A www` et `A @` → adresse du serveur web.
2. **Certificat** : Let's Encrypt pour `www.leter.cm` et `leter.cm`.
3. **Serveur** : vhost Nginx (racine `/var/www/le-ter-site/current`, `error_page 404`, gzip,
   cache, en-têtes et CSP du README) ou Apache avec `AllowOverride All`.
4. **Variables / configuration** : `config.js` (APK de production, GA4 si validé) ;
   backend : `REFERRAL_DOWNLOAD_URL=https://www.leter.cm/`.
5. **Build** : `cd marketing && npm run lint && npm test && npm run build`.
6. **Publication** : `rsync -a --delete dist/ serveur:/var/www/le-ter-site/releases/<date>/`, puis
   `ln -sfn` vers `current` (retour arrière : repointer `current`).
7. **Vérifications** : commandes `curl` du README (HTTPS, redirection `leter.cm` → `www`, HSTS,
   CSP, 404, `robots.txt`, `sitemap.xml`, type MIME des `.js`), aperçu WhatsApp d'un lien
   `?ref=`, Search Console (sitemap), PageSpeed Insights, test réel sur téléphone (320 à 414 px).
