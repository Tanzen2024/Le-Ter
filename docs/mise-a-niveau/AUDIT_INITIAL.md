# LeTer — Audit initial avant mise à niveau (26/10/2026)

Audit en lecture seule de `C:\xampp\htdocs\le-ter\`, réalisé avant toute modification de la
mise à niveau. Il confronte le brief du propriétaire (« sources de vérité métier ») au code,
qui reste la source de vérité technique.

Légende des risques : **Élevé** = argent, données ou conformité ; **Moyen** = fonctionnalité
ou crédibilité ; **Faible** = confort.

## 1. Architecture constatée

| Compartiment | Technologie | Rôle | État Git |
|---|---|---|---|
| `backend/` | Node.js, Express, TypeScript, PostgreSQL (`pg`, sans ORM), Redis | API, autorité sur toutes les règles (jeux, mises, paiements, retraits, parrainage, tournois) | suivi (`main`), modifications locales en cours d'autres sessions |
| `frontend/` | Expo / React Native, Expo Router | Application mobile (Android ; iOS non configuré) | suivi |
| `administration/` | back-office | Administration | suivi |
| `marketing/` | HTML/CSS/JS statiques générés par Node, sans dépendance | Site vitrine FR/EN | **dépôt Git imbriqué sans aucun commit** ; non suivi par le dépôt principal |
| `docs/` | Markdown | Source de vérité fonctionnelle (`decisions.md`, `TODO.md`…) | suivi |

Infrastructure (d'après `docs/deploiement-vps.md`) : VPS Contabo, Nginx, environnements TEST
(`api-beta.leter.cm`, port 3001) et PROD (`api.leter.cm`, port 3000), DNS chez Cloudflare.

## 2. Écarts entre le brief et le code (à arbitrer, rien n'a été modifié dans le métier)

| # | Sujet | Brief | Code / documentation | Risque | Traitement retenu |
|---|---|---|---|---|---|
| E1 | GARAM TIA, cartes au centre | `n − 1` cartes face visible | `GARAM_TERRE_SIZE = {2: 3, 3: 4, 4: 5}` soit **`n + 1`** (`backend/src/domain/garam/garam-rules.ts:30`) | Moyen | Règle du jeu **non modifiée**. Le site ne cite plus de nombre de cartes au centre. **Validation humaine.** |
| E2 | Commission | Prélevée sur le pot `n × K`, variable selon le montant total | Prélevée sur les **mises des perdants** (`brut = K × (n − 1)`), taux fixé par la **tranche de la mise K** ; `commission = floor(brut × taux)` en entiers (`backend/src/domain/rules/game-settlement.ts`). Le gagnant récupère sa mise et reçoit `brut − commission`. | Élevé | Calcul **non modifié**. Le site dit seulement qu'une commission est prélevée et que le gagnant unique reçoit le reste, sans barème. **Validation humaine du modèle.** |
| E3 | Perte maximale | Chaque joueur mise K | Une victoire par **Kora** (Fap-Fap) fait perdre **2 × K** à chaque perdant (`KORA_LOSS_MULTIPLIER`) : c'est la raison de la règle du solde ≥ 2K (D-073) | Élevé (information du joueur) | Le site l'explique en une phrase. |
| E4 | Commission « visible dans l'application » | Affichée au moment approprié | **Aucun écran joueur n'affiche la commission** (seuls les écrans d'administration des tournois en parlent) | Élevé (information du consommateur) | Non traité (application). **Validation humaine / évolution à décider.** |
| E5 | Devises et pays | Devise locale selon le pays, conversion | **Une seule devise (XAF)** ; achats MTN_CM / OM_CM ; retraits limités aux numéros **+237** (`backend/src/domain/payments/payment.ts`, `domain/wallet/withdrawal.ts`). Aucune conversion, aucune liste de pays. | Moyen | Le site annonce le **Cameroun** uniquement. Aucune conversion annoncée. |
| E6 | Retraits « instantanés » | Fonctionnels | `CINETPAY_TRANSFERS_ENABLED=false` par défaut ; transferts CinetPay **non activés** sur le compte au 26/10/2026 (`docs/deploiement-vps.md`) | Élevé | Texte rédigé sans garantie de délai. **À vérifier sur PROD avant publication.** |
| E7 | Achats « fonctionnels en production » | MTN / Orange Money | Validés en **sandbox sur TEST** ; CinetPay **vide sur PROD** au 26/10/2026 (mémoire d'exploitation) | Élevé | **À vérifier sur PROD avant publication.** |
| E8 | Parrainage « récompenses fonctionnelles » | Disponible au lancement | `REFERRAL_REWARDS_ENABLED=false` par défaut (D-169) ; D-169 décrit un **scénario de fraude** (≈ +50 % par cycle) tant que R-34 (téléphone non vérifié) et R-42 (récompenses retirables) sont ouverts | Élevé | Site aligné sur la décision du propriétaire ; **activation serveur et risque de fraude à valider.** |
| E9 | APK à publier | `/var/www/le-ter-downloads/test/` | Servi à `https://api-beta.leter.cm/downloads/le-ter-test.apk` (200, 118 Mo) : **application de TEST** connectée au **serveur de TEST** (paiements sandbox) ; l'espace PROD `/var/www/le-ter-downloads/prod/` est vide | Élevé | Lien publié **à la demande du propriétaire** ; remplacer par l'APK de production dès qu'il existe. |
| E10 | Domaine `https://www.leter.cm` « disponible, HTTPS OK » | — | `www.leter.cm` : **NXDOMAIN** (aucun enregistrement DNS) ; seuls `api` et `api-beta` existent | Élevé | Le site est construit pour `https://www.leter.cm` ; **DNS, vhost et certificat à créer.** |
| E11 | Captures d'écran « disponibles » | — | **Aucune capture** dans le dépôt (icônes et diagrammes UML seulement) | Moyen | Aucune fausse capture. **À fournir.** |
| E12 | Preuve sociale « disponible » | — | **Aucun élément** (ni avis, ni statistique, ni partenaire) | Faible | Rien ajouté. |
| E13 | Commission non affichée sur le site | Ne pas afficher | Le site n'en affichait pas | — | Conservé. |
| E14 | Inscription | Prénom, nom, pseudo, téléphone, mot de passe ; e-mail facultatif | Conforme dans l'application (D-135, `RegisterScreen`) ; **les CGU §4 disent l'e-mail obligatoire** ; le site omettait prénom et nom | Moyen | Textes corrigés. |

## 3. Constats par compartiment

### Site vitrine (`marketing/`)
- Bon socle : génération FR/EN, CSP stricte, lint et 63 tests verts, build fonctionnel.
- Manques : `noindex` partout, pas de sitemap, pas de 404, pas d'image Open Graph, page racine
  sans OG (cible des liens de parrainage), pas de HSTS ni cache ni compression dans
  `.htaccess`, police TTF de 77 Ko, menu mobile inutilisable sans JavaScript, nom de marque
  « Le-Ter », section parrainage au tutoiement, informations économiques absentes.
- `engines.node >= 20`, mais `npm test` et `legal:sync` importent des fichiers `.ts` de
  `frontend/` : Node **22.18** au minimum (suppression des types activée par défaut).
- Dépôt Git imbriqué sans commit : aucun retour arrière possible.

### Application (`frontend/`)
- `LEGAL_INFO` entièrement `null` : repères `[…]` dans les CGU et la politique.
- CGU §4 : e-mail présenté comme obligatoire (contraire à D-135).
- Marque « Le Ter » dans les documents juridiques.
- `android.package = com.anonymous.leter` (défaut Expo) dans `app.json` et
  `frontend/android/app/build.gradle` ; aucun Firebase, aucun `google-services.json` ; schéma de
  lien profond `leter` indépendant du package. **Icône de l'application = icône par défaut
  d'Expo.** Profil EAS `production` = AAB (Play Store), `preview` = APK.
- `EXPO_PUBLIC_SUPPORT_URL` vide.

### Backend (`backend/`)
- Calculs monétaires en **entiers** (`Number.isSafeInteger`, `floor` sur points de base) : pas de
  flottant, arrondi en faveur du joueur. Aucun changement nécessaire.
- Règle 2K (`GAME_STAKE_BALANCE_MULTIPLIER = 2`), retrait minimum 1 000, numéro d'inscription
  imposé, 1 jeton = 1 FCFA : conformes au brief.
- 6 suites d'intégration échouent déjà à l'identique sur `f428637` (configuration Jest,
  « dynamic import … without --experimental-vm-modules »), selon la mémoire d'exploitation.

## 4. Tests disponibles

| Compartiment | Commandes |
|---|---|
| marketing | `npm run lint`, `npm test` (node:test), `npm run build` |
| frontend | `npx expo lint`, `npx tsc --noEmit`, `npx jest` |
| backend | `npm run typecheck`, `npm run lint`, `npm test` |

## 5. Risques principaux

1. Publier un site qui distribue l'**APK de TEST** (serveur TEST, paiements sandbox).
2. Annoncer achats, retraits et parrainage alors que leur activation sur PROD n'est pas prouvée.
3. Activer le crédit du parrainage avec le scénario de fraude documenté par D-169.
4. Conformité jeu d'argent (mises, gains, retraits Mobile Money) non établie (T-07 / PR-02).
5. Changer l'identifiant Android après une publication sur le Play Store est impossible.
