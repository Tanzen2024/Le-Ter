# Paiements CinetPay (achat de jetons)

Décision : **D-050** (`docs/decisions.md`). Socle du compte de jeu : **D-040**.

Le **compte de jeu** (`wallets`, `wallet_transactions`) reste la **seule source de vérité**.
CinetPay est le fournisseur du port existant `MobileMoneyGateway` : il n'y a ni second
portefeuille ni système de paiement parallèle. Un paiement ne crédite jamais lui-même ; il
est réglé avec sa transaction `deposit` par le règlement idempotent du compte de jeu.

## Règles validées (D-050)

| Règle | Valeur |
|---|---|
| API | **Nouvelle API CinetPay v1** uniquement (pas l'ancienne v2 `api-checkout`, `site_id`, `x-token`) |
| Conversion | **1 FCFA = 1 jeton** (R-13 tranchée pour l'achat) |
| Devise | **XAF** uniquement, fixée par le serveur |
| Montants | **500, 1 000, 2 000, 5 000 FCFA** (R-16 tranchée pour l'achat) |
| Partie | Aucun `gameId` : le compte de jeu appartient au joueur, pas à une partie |
| Identité | Toujours `getAuth(res).userId` (JWT) ; tout `playerId`/`userId` du corps est ignoré |
| Téléphone vérifié | Non exigé (R-34 reste ouverte) |
| Retrait | **Hors périmètre** : refusé proprement (`503 MOBILE_MONEY_UNAVAILABLE`), rien n'est débité |

## API CinetPay v1 utilisée

Contrats relevés dans le **code source** des SDK officiels `cinetpay/cinetpay-js`
(commit `570964f`, 2026-03-21) et `cinetpay/cinetpay-go` (commit `0012dcb`) : client HTTP,
authentification, types, fixtures de tests et exemple de webhook. `docs.cinetpay.com` était
injoignable (DNS) depuis le poste de développement : **à recouper en sandbox**.

| Opération | Requête | Réponse utilisée |
|---|---|---|
| Authentification | `POST /v1/oauth/login` `{ api_key, api_password }` | `{ code: 200, status: "OK", access_token, token_type: "bearer", expires_in }` |
| Création | `POST /v1/payment` (Bearer) `{ currency, merchant_transaction_id (≤ 30), amount (100–2 500 000), lang, designation, client_email, client_first_name, client_last_name, success_url, failed_url, notify_url (≤ 120, http(s)), channel }` | `{ code: 200, status: "OK", payment_token, notify_token, transaction_id, merchant_transaction_id, payment_url, details: { status: "INITIATED", must_be_redirected } }` |
| Statut | `GET /v1/payment/{transaction_id \| payment_token \| merchant_transaction_id}` (Bearer) | `{ code, status, merchant_transaction_id, transaction_id, user }` |
| Notification | `POST notify_url`, JSON `{ notify_token, merchant_transaction_id, transaction_id, user }` | aucune signature : **`notify_token`** à comparer en temps constant, puis statut **relu** |

- **Jeton** : durée annoncée `expires_in` (86 400 s dans les fixtures) ; le SDK le met en cache
  23 h (82 800 s). Le client garde `min(expires_in, 82 800) − 300 s`. Code `1003` /
  `EXPIRED_TOKEN` → nouvelle authentification et nouvel essai, **une seule fois**.
- **Statuts** : `SUCCESS` (100), `INITIATED` (2001), `PENDING` (2002), `EXPIRED` (2003),
  `FAILED` (2010), `INSUFFICIENT_BALANCE` (2005), etc.
- **Environnements** : clé `sk_test_…` → sandbox `https://api.cinetpay.net` ; clé `sk_live_…`
  → production `https://api.cinetpay.co`.
- **Limite connue** : la réponse de statut documentée ne contient **ni montant ni devise**.
  Le serveur les compare s'ils sont présents ; sinon, il s'appuie sur le fait que le montant
  et la devise ont été fixés **par le serveur** à l'initialisation, et que les deux
  identifiants (`transaction_id`, `merchant_transaction_id`) correspondent.

## Flux

```text
POST /api/wallet/deposits { tokens: 1000, currency?: "XAF" }   (JWT + Idempotency-Key)
  → WalletService : montant autorisé ? → transaction deposit `pending`
  → MobileMoneyGateway = CinetPayGateway
      → payments : ligne PENDING (merchant_transaction_id = LT + 26 hex)
      → POST /v1/payment
      → provider_reference, payment_url, SHA-256(notify_token) enregistrés
  ← 202 { transaction, balance, payment: { id, status: PENDING, amount, currency, paymentUrl } }

Application → page CinetPay (expo-web-browser) → le joueur paie
CinetPay → success_url/failed_url = GET /api/payments/cinetpay/return/:paymentId
         → page HTML (aucune issue affichée) → leter://payment/return?paymentId=…
Application → GET /api/payments/:id → statut RÉEL affiché

CinetPay → POST /api/payments/cinetpay/notify
  1. corps complet ? (400)            2. paiement retrouvé par merchant_transaction_id ? (404)
  3. SHA-256(notify_token) = empreinte, comparaison en temps constant ? (401)
  4. transaction_id = provider_reference ? (401)
  5. déjà réglé ? → 200 « déjà traité », rien ne change
  6. GET /v1/payment/{transaction_id} (serveur à serveur ; injoignable → 502, CinetPay renvoie)
  7. références identiques, montant et devise identiques s'ils sont renvoyés ? (409, rien crédité)
  8. SUCCESS → SUCCESS · FAILED / INSUFFICIENT_BALANCE → FAILED · EXPIRED → EXPIRED
     · autre (INITIATED, PENDING…) → reste PENDING (statut fournisseur noté)
  9. règlement atomique (ci-dessous) → 200
```

`GET /api/payments/:id` revérifie aussi un paiement **en attente** auprès de CinetPay (au plus
une fois toutes les 10 s par paiement), au cas où la notification ne serait pas arrivée. Le
règlement suit alors exactement le même chemin (étapes 6 à 9).

## Idempotence et atomicité

`PostgresPaymentRepository.settle` exécute, dans **une seule** transaction SQL :

1. `SELECT … FROM payments WHERE id = $1 FOR UPDATE` : deux notifications simultanées se suivent ;
2. `settleWalletTransaction(tx, …)` : **le même code que `WalletRepository.settle()`**
   (`settle()` n'en est qu'une enveloppe `transaction(...)`). Il verrouille le portefeuille puis
   la transaction, et ne crédite que lors du passage `pending` → `succeeded` ;
3. mise à jour du statut du paiement, seulement s'il était encore `PENDING`.

Toute erreur provoque un ROLLBACK complet (ni crédit ni statut). Le double crédit est
impossible pour trois raisons : le verrou sur le paiement, le verrou et le contrôle `pending`
de la transaction du compte de jeu, et `UNIQUE (wallet_transaction_id)`. Le statut du paiement
suit toujours l'issue réelle du compte de jeu : il n'est jamais `SUCCESS` sans crédit. Un
paiement confirmé chez CinetPay après l'abandon de l'achat est marqué `FAILED` avec
`metadata.anomaly = PAID_AFTER_WALLET_FAILURE`, pour un rapprochement manuel.

Côté client, une **Idempotency-Key** par appui : un double appui ou un renvoi rejoue le même
paiement (même `id`, même URL), sans nouvelle initialisation CinetPay.

## Données (migration `0017_payments.sql`)

`payments` : `id`, `wallet_transaction_id` (UNIQUE, FK), `provider` (`cinetpay`),
`merchant_transaction_id` (1–30, UNIQUE par fournisseur), `provider_reference` (UNIQUE par
fournisseur), `amount` (> 0), `currency` (`XAF`), `status` (`PENDING` | `SUCCESS` | `FAILED`
| `EXPIRED`), `provider_status`, `payment_method`, `payment_url`, `notify_token_hash`
(SHA-256 hex), `metadata` (jsonb), `created_at`, `updated_at`, `completed_at`.
Contraintes : `completed_at` posé si et seulement si le paiement est réglé ; `SUCCESS` exige
une référence fournisseur ; référence et empreinte vont ensemble.

**Jamais stockés ni journalisés** : clé et mot de passe API, en-tête `Authorization`, jeton
d'accès, `notify_token` en clair, `payment_token`, numéro de téléphone.

## API Le Ter

| Route | Accès | Réponse |
|---|---|---|
| `POST /api/wallet/deposits` | JWT, Idempotency-Key, 10/min/joueur | `202 { transaction, balance, payment }` ; `400` montant ou devise invalide ; `422 PAYMENT_PROFILE_INCOMPLETE` ; `503 MOBILE_MONEY_UNAVAILABLE` |
| `GET /api/payments/:id` | JWT, **propriétaire seulement** | `200 { payment: { id, status, amount, currency, tokens, paymentUrl?, createdAt, completedAt? } }` ; `404 PAYMENT_NOT_FOUND` (inconnu **ou** d'un autre joueur) |
| `POST /api/payments/cinetpay/notify` | public, 120/min/IP | `200 { received, status }` ; `400` ; `401 NOTIFICATION_REJECTED` ; `404` ; `409 PAYMENT_VERIFICATION_FAILED` ; `502 PAYMENT_PROVIDER_UNAVAILABLE` |
| `GET /api/payments/cinetpay/return/:paymentId` | public | page HTML → `leter://payment/return?paymentId=…` (aucun effet) |

`GET /api/wallet` expose aussi `withdrawalAvailable` (faux avec CinetPay).

## Configuration (`backend/.env`, jamais commité)

| Variable | Rôle |
|---|---|
| `CINETPAY_API_KEY`, `CINETPAY_API_PASSWORD` | identifiants v1 ; vides = CinetPay désactivé (achats refusés proprement) |
| `CINETPAY_BASE_URL` | facultatif ; déduit du préfixe de la clé |
| `CINETPAY_NOTIFY_URL` | URL publique de `/api/payments/cinetpay/notify` (≤ 120 caractères, HTTPS en production) |
| `CINETPAY_RETURN_URL` | URL publique de `/api/payments/cinetpay/return` (l'identifiant y est ajouté) |
| `CINETPAY_APP_RETURN_URL` | défaut `leter://payment/return` |
| `CINETPAY_TIMEOUT_MS` | défaut 15 000 (1 000 à 60 000) |

`CINETPAY_SITE_ID` n'existe pas en v1 et n'est pas utilisé. Une configuration incomplète ou
incohérente bloque le démarrage, sans jamais recopier une valeur dans l'erreur.

## Prénom et nom (exigence CinetPay)

Les deux SDK officiels valident `client_first_name` et `client_last_name` à **2 à 255
caractères** avant tout appel ; un compte Le Ter accepte 1 à 50 caractères. Les règles du compte
ne changent pas et rien n'est complété à la place du joueur. `CinetPayGateway.assertCollectionEligible`
(méthode facultative du port) est appelée par `WalletService` **avant toute écriture** : un
prénom ou un nom d'une lettre → `422 PAYMENT_PROFILE_INCOMPLETE` (champs concernés dans
`fields`), aucune transaction, aucun paiement, aucun appel CinetPay. Le compte n'est ni bloqué
ni modifié. Les valeurs sont envoyées sans espaces de bord. Aucune modification du profil
n'existe encore dans l'application : le message oriente vers l'assistance.

## Sandbox : état et premier paiement

### État vérifié le 2026-10-08 (sans aucun identifiant)

| Vérification | Résultat |
|---|---|
| DNS + HTTPS `api.cinetpay.net` | OK, certificat valide |
| `POST /v1/oauth/login` (corps vide) | `422 { code: 1004, status: INVALID_PARAMS }` : route présente |
| `POST /v1/payment` (sans jeton) | `422 { code: 1002, status: INVALID_TOKEN }` : route présente, Bearer exigé |
| `GET /v1/payment/{id}` (sans jeton) | `422 { code: 1002, status: INVALID_TOKEN }` : route présente |
| `docs.cinetpay.com` | non résolu (DNS) |

CinetPay répond **HTTP 422** (et non 401) aux erreurs de paramètres et de jeton : le client
traite `1003 EXPIRED_TOKEN` avant le statut HTTP (renouvellement une fois) et `1002` comme une
erreur sans boucle (tests unitaires dédiés).

### Prérequis

1. Dans `backend/.env` (ignoré par Git ; un bloc vide y est préparé) : `CINETPAY_API_KEY=sk_test_…`,
   `CINETPAY_API_PASSWORD=…`. Ne jamais les coller dans un ticket, un chat ou une capture.
2. **Webhook joignable depuis Internet.** `localhost`, `127.0.0.1` et `192.168.x.x` ne le sont
   pas. En local, il faut un tunnel HTTPS temporaire vers le port du backend (ex. Cloudflare
   Tunnel, ngrok). C'est un service tiers : à choisir et lancer par le propriétaire du projet.
   Puis :
   `CINETPAY_NOTIFY_URL=https://<tunnel>/api/payments/cinetpay/notify` et
   `CINETPAY_RETURN_URL=https://<tunnel>/api/payments/cinetpay/return` (120 caractères max,
   identifiant compris : vérifié au démarrage).
3. Application : `EXPO_PUBLIC_API_URL` vers le même backend. Pour le retour automatique dans
   l'application, une build de développement (scheme `leter`). En Expo Go, fermer la page :
   l'écran relit le statut.
4. Compte de test avec un prénom et un nom d'au moins 2 caractères.

### Premier paiement : 500 XAF (manuel, un seul à la fois)

1. `cd backend && npm run db:migrate && npm run dev`. Le log doit contenir
   « CinetPay configuré (achats) » avec `cinetpayBaseUrl: https://api.cinetpay.net`. Une
   configuration incomplète bloque le démarrage avec un message sans valeur.
2. `cd frontend && npx expo start`, se connecter.
3. Noter le solde : `SELECT balance FROM wallets WHERE user_id = '<userId>';` (absent = 0).
4. Boutique → Acheter → **500 FCFA**. Attendu : réponse 202, page CinetPay ouverte, logs
   `cinetpay response` (`POST /v1/oauth/login` puis `POST /v1/payment`, `apiCode: 200`) et
   `cinetpay payment initialized`.
5. Payer sur la page sandbox.
6. Logs attendus, dans l'ordre : `cinetpay notification received` → `cinetpay response`
   (`GET /v1/payment/{id}`) → `cinetpay payment verified` (`providerStatus: SUCCESS`, et si
   `amountReturned`/`currencyReturned` sont à `true`, le montant et la devise ont été comparés)
   → `cinetpay payment settled` (`status: SUCCESS`, `walletTransactionStatus: succeeded`).
7. L'écran affiche « Paiement confirmé +500 jetons » (lu via `GET /api/payments/:id`).
8. Vérification SQL :

```sql
SELECT p.id, p.provider, p.status, p.amount, p.currency, p.provider_reference,
       p.provider_status, p.merchant_transaction_id, p.completed_at,
       t.id AS wallet_transaction_id, t.status AS wallet_status, t.tokens,
       w.balance
FROM payments p
JOIN wallet_transactions t ON t.id = p.wallet_transaction_id
JOIN wallets w ON w.user_id = t.user_id
WHERE p.id = '<paymentId>';
```

Attendu : `provider = cinetpay`, `status = SUCCESS`, `amount = 500`, `currency = XAF`,
`provider_reference` égal au `transaction_id` CinetPay, `wallet_status = succeeded`,
`tokens = 500`, `balance` égal au solde noté + 500, `notify_token_hash` de 64 caractères hex
(le jeton lui-même n'apparaît nulle part).

9. **Idempotence** : si CinetPay renvoie la notification, le log
   `cinetpay notification already processed` apparaît et le solde ne change pas. Une
   notification au jeton faux renvoie 401 (`cinetpay notification rejected`, `reason: token`).
   Le `notify_token` n'étant jamais stocké ni journalisé, rejouer la notification d'origine à
   la main est impossible par construction ; ce cas est couvert par les tests (×3 et simultané).

### Scénarios négatifs

| Scénario | Comment l'obtenir | Attendu |
|---|---|---|
| FAILED | refus ou échec sur la page sandbox (selon les options du sandbox) | `status = FAILED`, `wallet_status = failed` (`PAYMENT_FAILED`), solde inchangé |
| PENDING | page ouverte sans payer | `status = PENDING`, aucun crédit ; « Paiement en cours... » |
| EXPIRED | laisser la page expirer (délai fixé par CinetPay, non documenté) | `status = EXPIRED`, `PAYMENT_EXPIRED`, solde inchangé |
| Notification dupliquée | renvoi par CinetPay | 200 « déjà traité », solde inchangé |
| Notification invalide | `curl -X POST <tunnel>/api/payments/cinetpay/notify -H 'Content-Type: application/json' -d '{"notify_token":"x","merchant_transaction_id":"<id>","transaction_id":"y"}'` | 401, rien ne change |

### Les quatre montants

Seulement après validation complète de 500 XAF, un par un : 1 000, 2 000, puis 5 000 XAF.
Chaque fois : `amount = tokens` et un solde augmenté exactement du montant.

### À relever pendant le sandbox

Ces points ne sont pas documentés par les SDK :
- présence de `amount` et `currency` dans le statut (log `cinetpay payment verified`) ;
- renvoi des notifications après une réponse non-2xx ;
- délai d'expiration ;
- moyen d'obtenir FAILED ;
- acceptation des URL de retour par CinetPay.

## Application mobile

Boutique → **Acheter** : « Recharger mon wallet », puis 500 / 1 000 / 2 000 / 5 000 FCFA.
Le serveur crée le paiement, la page CinetPay s'ouvre (`WebBrowser.openAuthSessionAsync`,
retour `Linking.createURL('payment/return')`), et l'écran suit le statut **lu sur le
serveur** : « Paiement en cours... » (relu toutes les 3 s), « Paiement confirmé +1 000
jetons », « Paiement échoué », « Paiement expiré ». Le solde est rechargé depuis le serveur dès
que le statut est final. La route `app/payment/return.tsx` ne conclut jamais elle-même :
elle relit `GET /api/payments/:id`. Cette route est **hors** `Stack.Protected`. Ouverte à
froid par le lien pendant la restauration de la session, une garde fausse redirigerait vers
l'accueil (comportement documenté d'Expo Router) et perdrait le lien. L'écran attend donc la
session, renvoie vers la connexion sans session, et le serveur ne montre un paiement qu'à son
titulaire.

En Expo Go, `Linking.createURL` produit une URL `exp://…`. Pour tester le retour automatique,
il faut une build de développement (scheme `leter`), ou régler `CINETPAY_APP_RETURN_URL`.
Sinon, le joueur ferme la page et l'écran relit le statut.
