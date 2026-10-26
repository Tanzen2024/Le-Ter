# Retraits Mobile Money (compte de jeu → Mobile Money)

Décisions : **D-075** (`docs/decisions.md`), **D-163** (opérateur déduit par le serveur, remplace
D-075 sur ce seul point). Socle : **D-040** (compte de jeu), **D-050** (CinetPay).

Le compte de jeu reste la **seule source de vérité**. Un retrait débite les jetons à sa
création (transaction `withdrawal` en attente) et n'est réglé que sur un statut **final relu
chez CinetPay**. Un échec confirmé est remboursé **une seule fois**.

## Règles

| Règle | Valeur |
|---|---|
| Montant | entier de jetons, **≥ 1 000**, ≤ 1 500 000 (plafond d'un transfert CinetPay, SDK officiel) |
| Conversion | **1 jeton = 1 FCFA** (XAF) |
| Identité | compte de l'identité authentifiée (JWT), jamais un identifiant du corps de la requête |
| Destinataire | **numéro d'inscription** (`users.phone`) de ce compte, jamais un numéro saisi ; +237 seulement |
| Opérateur | **déduit par le serveur** du numéro d'inscription (D-163, voir « Opérateur ») ; jamais choisi par le joueur |
| Opérateurs autorisés | `OM_CM` (Orange Money), `MTN_CM` (MTN Mobile Money) : les seuls opérateurs CinetPay en XAF (`WITHDRAWAL_OPERATORS`) |
| Frais Le Ter | aucun. Les frais du transfert (`fee_amount`) sont à la charge du compte marchand CinetPay ; ils sont enregistrés s'ils sont renvoyés, visibles par l'administration |
| Téléphone vérifié | non exigé (R-34 ouverte, aucune vérification SMS n'existe) |
| Compte | `users.status = 'active'` exigé |
| Délai de réception | non documenté par CinetPay : jamais affiché |

## Opérateur (D-163)

1. Le compte est celui de l'identité authentifiée ; le destinataire est son numéro d'inscription.
2. Le serveur déduit l'opérateur de ce numéro par la règle déjà utilisée pour les achats :
   `withdrawalOperatorOfPhone` (`domain/wallet/withdrawal.ts`) vérifie le format `+237` + 9
   chiffres, appelle `operatorOfPhone` (plan de numérotation camerounais, D-090), puis exige que
   l'opérateur obtenu figure dans `WITHDRAWAL_OPERATORS`.
3. Le champ `operator` envoyé par le client est **ignoré** : `parseWithdrawalInput` ne renvoie
   que `{ tokens }`, sans lire ni valider `operator`. Les applications déjà installées peuvent
   continuer à l'envoyer ; il ne détermine jamais l'opérateur utilisé. Aucune bascule vers un
   autre opérateur en cas de doute.
4. Refus, **avant toute écriture** (aucune réservation de jetons, aucun envoi) :
   numéro invalide, hors +237 ou opérateur indéterminable → `422 WITHDRAWAL_PHONE_UNSUPPORTED` ;
   opérateur identifié mais non autorisé au retrait → `422 WITHDRAWAL_OPERATOR_UNSUPPORTED`.
5. L'opérateur déduit est enregistré sur le retrait (`withdrawals.operator`) et transmis à
   CinetPay (`payment_method`).
6. Les contrôles de montant et l'idempotence restent ceux de D-075 ; le rejeu compare la clé et
   le montant, pas l'opérateur (voir « Cycle de vie »).
7. La politique (`GET /api/wallet/withdrawals`) applique la même règle : `msisdnSupported` est
   vrai seulement si le numéro est +237 ET si son opérateur déduit est autorisé.
8. Les retraits créés **avant** cette correction conservent l'opérateur enregistré à leur
   création ; ils n'ont pas été modifiés, et leurs envois différés ou relectures l'utilisent
   toujours.
   Pour les repérer : `npm run withdrawals:check-operators` (`:prod` après build), en lecture
   seule. Il liste les retraits `CREATED` / `PROCESSING` dont l'opérateur enregistré diffère de
   celui déduit aujourd'hui du numéro (identifiant, statut, opérateurs ; jamais le numéro) ;
   code de sortie 2 s'il en trouve. Un écart se traite par rapprochement administratif.

## Fournisseur : API de transfert CinetPay v1

Contrats relevés dans le **code source** du SDK officiel `cinetpay/cinetpay-js`
(`src/api/transfer.ts`, `src/types/transfer.ts`, `src/constants/statuses.ts`, fixtures de
tests), le 2026-10-10. **À recouper en sandbox** avant toute mise en production.

| Opération | Requête | Réponse utilisée |
|---|---|---|
| Transfert | `POST /v1/transfer` (Bearer) `{ currency, merchant_transaction_id (1–30), phone_number (+E.164), amount (100–1 500 000), payment_method, reason (1–255), notify_url (≤ 120) }` | `{ code, status (PENDING, SUCCESS…), transaction_id, merchant_transaction_id, notify_token, amount, fee_amount, phone_number, currency }` |
| Statut | `GET /v1/transfer/{transaction_id \| merchant_transaction_id}` (Bearer) | `{ code, status, transaction_id, merchant_transaction_id, amount, fee_amount, user? }` ; `NOT_FOUND` (404) si inconnu |
| Notification | `POST notify_url` `{ notify_token, merchant_transaction_id, transaction_id, user? }` quand un statut final est atteint | aucune signature : `notify_token` comparé (empreinte SHA-256, temps constant), puis statut **relu** |

Statuts finaux (SDK `isFinalStatus`) : `SUCCESS`, `FAILED`, `INSUFFICIENT_BALANCE` (solde
**marchand** insuffisant), `TRANSACTION_EXIST` (référence marchande déjà utilisée : le transfert
existe, il est relu). Tous les autres (`PENDING`, `INITIATED`…) laissent le retrait en traitement.

Même client que les achats (`CinetPayClient`, jeton partagé, `CINETPAY_TIMEOUT_MS`). Le numéro,
le `notify_token`, la clé et le mot de passe ne sont jamais journalisés.

## Cycle de vie

```text
POST /api/wallet/withdrawals { tokens }                 (JWT + Idempotency-Key)
     (un champ `operator`, envoyé par d'anciens clients, est IGNORÉ : D-163)
  1. validation (≥ 1 000, entier ; aucun autre champ lu)             400
  2. Idempotency-Key déjà vue + même montant → même retrait (rejeu)  200/202
     même clé, autre montant                                         409 IDEMPOTENCY_KEY_REUSED
  3. transferts activés ? compte actif ?                             503 / 403
     opérateur DÉDUIT du numéro d'inscription : numéro +237 et
     opérateur identifié ?                                           422 WITHDRAWAL_PHONE_UNSUPPORTED
     opérateur autorisé au retrait ?                                 422 WITHDRAWAL_OPERATOR_UNSUPPORTED
  4. UNE transaction SQL :
       verrou du portefeuille (FOR UPDATE)
       → quota compté sous ce verrou                                 429 WITHDRAWAL_LIMIT_REACHED
       → solde DISPONIBLE (solde − réservé tournois)                 409 INSUFFICIENT_BALANCE
       → wallet_transactions (withdrawal, pending) + débit
       → withdrawals (CREATED, operator déduit, merchant_transaction_id = LW + 26 hex)
  5. envoi revendiqué (UPDATE conditionnel), POST /v1/transfer :
       accepté      → PROCESSING (référence, empreinte du notify_token)
       non envoyé   → envoi non compté (échec AVANT POST /v1/transfer), retenté plus tard
       refusé       → reste CREATED (PROVIDER_REJECTED), transfert relu ; JAMAIS remboursé
                      sur ce seul message (D-076)
       existe déjà  → statut relu
       incertain    → reste CREATED (erreur notée), relu plus tard
  ← 202 { withdrawal: { id, reference, status, operator, operatorLabel, msisdn (masqué), … },
          balance, replayed }
```

| Statut | Sens | Solde |
|---|---|---|
| `CREATED` | débité ; transfert pas encore accepté, ou issue de l'envoi inconnue | débité |
| `PROCESSING` | accepté par CinetPay, en attente du statut final | débité |
| `SUCCEEDED` | `SUCCESS` relu chez CinetPay ; référence et date de confirmation enregistrées | débit définitif |
| `FAILED` | échec final relu chez CinetPay, ou remboursement à double validation (D-076) | **remboursé une fois** |

Aucune annulation : un transfert envoyé ne peut pas être rappelé. Le joueur ne peut changer
aucun statut ; l'administration ne peut jamais déclarer un retrait réussi (voir « Récupération
d'un retrait bloqué »).

### Incertitude et renvoi

- Délai dépassé, réseau, HTTP 5xx, réponse illisible, code inconnu : **rien n'est décidé**.
- Relecture `GET /v1/transfer/{merchant_transaction_id}` : le transfert existe → son statut
  s'applique ; il est introuvable → le retrait reste ouvert (`PROVIDER_NOT_FOUND`).
- **Renvoi automatique désactivé par défaut** (`CINETPAY_TRANSFER_MAX_SUBMISSIONS=1`). Il ne
  doit être relevé (2 ou 3) qu'après confirmation en sandbox que `NOT_FOUND` est fiable et
  qu'une référence réutilisée est refusée (`TRANSACTION_EXIST`). Activé : renvoi seulement si
  l'envoi précédent date d'au moins 10 min, avec la **même** référence marchande. Au-delà :
  rapprochement par l'administration.
- Envoi différé (reprise après arrêt, renvoi) : le numéro d'inscription relu doit correspondre
  au numéro masqué enregistré à la création ; sinon rien n'est envoyé (`RECIPIENT_CHANGED`).
- Statut relu incohérent (référence, montant ou devise) : rien n'est décidé
  (`PROVIDER_MISMATCH`, 409 à la vérification).

### Réconciliation (`WithdrawalReconciler`)

Au démarrage puis toutes les `CINETPAY_RECONCILE_INTERVAL_MS` : retraits `CREATED` /
`PROCESSING` d'au moins 60 s, non relus depuis 60 s, 20 par passage. Un retrait jamais envoyé
(arrêt du serveur entre la création et l'envoi) est envoyé **seulement si les nouveaux
transferts sont activés** ; les autres sont relus (même chemin que la notification).

Le réconciliateur tourne dès que les identifiants CinetPay sont configurés, **même avec
`CINETPAY_TRANSFERS_ENABLED=false`** : désactiver les nouveaux transferts n'interrompt ni la
relecture, ni les notifications, ni les revérifications des retraits déjà ouverts, et n'envoie
aucun transfert. Après une erreur : nouvelle tentative différée (1 min, doublée, plafond
30 min). Arrêt propre : le retrait en cours se termine avant la fermeture de la base.

## Récupération d'un retrait bloqué (D-076)

Un retrait reste **ouvert** (jetons réservés) tant que son issue n'est pas prouvée. Il en sort
par l'une des trois voies suivantes, et par aucune autre :

| Issue | Preuve exigée | Effet |
|---|---|---|
| Transfert réussi | `SUCCESS` relu chez CinetPay | `SUCCEEDED`, débit définitif |
| Échec définitif | `FAILED` / `INSUFFICIENT_BALANCE` relu chez CinetPay | `FAILED`, remboursé une fois |
| Remboursement manuel | voir ci-dessous (4 conditions cumulées) | `FAILED` (`MANUAL_REFUND_CONFIRMED`), remboursé une fois |

**Preuves exigées avant un remboursement manuel** (toutes vérifiées par le serveur) :

1. retrait ouvert depuis **au moins 24 h** (création ou dernier envoi) ;
2. référence de la **confirmation écrite de CinetPay** (ticket ou courriel du support) attestant
   que le transfert n'a pas été exécuté, et une justification ;
3. relecture **fraîche** chez CinetPay « introuvable » à la proposition ET à l'approbation. Un
   transfert trouvé n'est jamais remboursé à la main : réussi → `SUCCEEDED` ; échec final →
   règlement normal ; en cours → refus (`TRANSFER_EXISTS`, escalade). CinetPay injoignable →
   503, aucune décision ;
4. **double validation** : proposée par un administrateur, approuvée par un AUTRE (contrainte en
   base). Une seule demande en attente et une seule approuvée par retrait.

« Introuvable » seul n'est **jamais** une preuve suffisante.

**Escalade** : tant que la preuve n'est pas réunie (transfert introuvable sans confirmation
écrite, transfert bloqué en `PENDING`, statut incohérent), l'administrateur ouvre un ticket chez
CinetPay avec la **référence de retrait** (`LW…`), la référence CinetPay si elle existe, le
montant, la date d'envoi et l'opérateur (jamais le numéro complet), puis enregistre l'escalade
(référence du ticket, note) dans le détail du retrait.

**Après coup** : si CinetPay annonce un succès pour un retrait déjà remboursé (notification,
revérification), l'anomalie `PAID_AFTER_REFUND` est notée et journalisée. Rien n'est débité
automatiquement ; le rapprochement se fait avec le joueur et CinetPay.

Toutes les étapes (consultation, revérification, escalade, proposition, approbation, rejet)
sont inscrites au journal d'audit avec l'identité de l'administrateur.

| Route (admin) | Corps |
|---|---|
| `POST /api/admin/withdrawals/:id/escalations` | `{ providerTicket?, note }` |
| `POST /api/admin/withdrawals/:id/refund-requests` | `{ providerTicket, justification }` |
| `POST /api/admin/withdrawals/:id/refund-requests/:requestId/approve` | `{ note? }` |
| `POST /api/admin/withdrawals/:id/refund-requests/:requestId/reject` | `{ note }` |

## Quota

Paramètres `system_settings` (migration 0031) : `withdrawal_limit_count` (entier 1–1 000) et
`withdrawal_limit_period` (minutes, 1 à 365 jours). Ligne absente ou JSON `null` = **∞** ;
jamais `Infinity` (contrainte SQL : `null` ou entier ≥ 1).

| n | t | Effet |
|---|---|---|
| ∞ | ∞ | aucune limite (défaut) |
| 3 | 24 h | au plus 3 retraits dans toute fenêtre glissante de 24 h |
| 5 | 7 jours | au plus 5 retraits dans toute fenêtre glissante de 7 jours |
| 1 | ∞ | au plus 1 retrait au total |
| ∞ | 24 h | aucune limite (la période seule ne limite rien) |

- **Comptent** : `CREATED`, `PROCESSING`, `SUCCEEDED` (une demande en cours compte : deux demandes
  simultanées ne contournent pas le quota).
- **Ne comptent pas** : demandes refusées avant création, retraits `FAILED` (jetons remboursés).
- Concurrence : le quota est compté **sous le verrou du portefeuille**, dans la transaction qui
  crée le retrait. Toutes les demandes d'un joueur se suivent, sur toutes les instances.

## API

| Route | Accès | Réponse |
|---|---|---|
| `POST /api/wallet/withdrawals` | JWT, Idempotency-Key, 10/min/joueur | `202 { withdrawal, balance, replayed }` ; `200` si déjà final ; `400`, `403 WITHDRAWAL_NOT_ALLOWED`, `409 INSUFFICIENT_BALANCE` / `IDEMPOTENCY_KEY_REUSED`, `422 WITHDRAWAL_PHONE_UNSUPPORTED` / `WITHDRAWAL_OPERATOR_UNSUPPORTED`, `429 WITHDRAWAL_LIMIT_REACHED`, `503 MOBILE_MONEY_UNAVAILABLE` |
| `GET /api/wallet/withdrawals` | JWT | `{ withdrawals (50 derniers), policy (minimum, opérateurs, numéro masqué, `msisdnSupported` selon D-163, quota restant) }` |
| `GET /api/wallet/withdrawals/:id` | JWT, propriétaire | `{ withdrawal }` (relu chez CinetPay si ouvert, 15 s min.) ; `404` identique sinon |
| `POST /api/withdrawals/cinetpay/notify` | public, 120/min/IP | `200 { received, status }` ; `400` ; `401 NOTIFICATION_REJECTED` ; `404` ; `409` ; `502` |
| `GET /api/admin/withdrawals` | admin | liste paginée ; filtres `status`, `from`, `to`, `q` (référence), `userId` |
| `GET /api/admin/withdrawals/:id` | admin (audité) | détail, transaction du compte de jeu, envois, historique des vérifications |
| `POST /api/admin/withdrawals/:id/verify` | admin, Idempotency-Key (audité) | revérification CinetPay (même chemin que la réconciliation) |
| `GET\|PATCH /api/admin/settings/withdrawal-limit` | admin (PATCH audité) | `{ count, periodMinutes, updatedAt, bounds }` ; `null` = ∞ |

## Configuration (`backend/.env`)

| Variable | Rôle |
|---|---|
| `CINETPAY_TRANSFERS_ENABLED` | `false` par défaut. `true` seulement une fois le transfert **activé et approvisionné** sur le compte marchand CinetPay |
| `CINETPAY_TRANSFER_NOTIFY_URL` | requis si activé : URL publique de `/api/withdrawals/cinetpay/notify` (≤ 120 caractères, HTTPS en production) |
| `CINETPAY_TRANSFER_MAX_SUBMISSIONS` | 1 à 3, défaut **1** (aucun renvoi automatique) ; voir « Incertitude et renvoi » |
| `CINETPAY_TRANSFERS_LIVE_CONFIRMED` | `false` par défaut. Exigé **en plus** de l'activation avec une clé `sk_live_` : attestation que les prérequis de production sont validés (D-077). Sans effet en sandbox |

### États (D-077)

| État | Conditions | Effet |
|---|---|---|
| `unavailable` | un prérequis manque (motif stable : `PROVIDER_NOT_CONFIGURED`, `TRANSFERS_DISABLED`, `LIVE_NOT_CONFIRMED`, `LIVE_OUTSIDE_PRODUCTION`, `SANDBOX_IN_PRODUCTION`, `ENVIRONMENT_MISMATCH`, `NOTIFY_URL_NOT_PUBLIC`, `SCHEMA_OUTDATED`) | 503 avant toute écriture ; relecture des retraits ouverts conservée si CinetPay est configuré |
| `sandbox` | `sk_test_`, transferts activés, `NODE_ENV` ≠ `production`, migrations appliquées | transferts simulés par CinetPay ; l'application affiche « Environnement de test » |
| `live` | `sk_live_`, transferts activés, `CINETPAY_TRANSFERS_LIVE_CONFIRMED=true`, `NODE_ENV=production`, notification HTTPS publique, migrations appliquées | transferts réels |

L'état est journalisé au démarrage et visible dans l'administration (Paramètres → État des
services). Il est exposé au joueur par `GET /api/wallet` (`withdrawalMode`,
`withdrawalUnavailableReason`) et `GET /api/wallet/withdrawals` (`policy.mode`).

Les identifiants sont ceux des achats (`CINETPAY_API_KEY`, `CINETPAY_API_PASSWORD`).

## Données (migrations `0031_withdrawals.sql`, `0032_withdrawal_refund_reviews.sql`)

`withdrawals` : `id`, `user_id`, `wallet_transaction_id` (UNIQUE), `provider`, `operator` (déduit
par le serveur depuis D-163),
`msisdn_masked` (jamais le numéro complet), `tokens`, `amount`, `currency`, `status`,
`merchant_transaction_id` (UNIQUE), `provider_reference` (UNIQUE), `provider_status`,
`fee_amount`, `notify_token_hash` (SHA-256), `failure_code`, `last_error_code`,
`last_error_at`, `submission_attempted_at`, `submission_attempts`, `last_checked_at`,
`created_at`, `updated_at`, `completed_at`. Contraintes : `completed_at` ⇔ statut final,
`failure_code` ⇔ FAILED, référence CinetPay obligatoire en PROCESSING / SUCCEEDED,
`tokens ≥ 1000`.

## Tests

Aucun transfert réel : fournisseur simulé (`FakeTransfers`) et `fetch` simulé.

- `backend/tests/integration/withdrawals/withdrawal-api.test.ts` : minimum, valeurs invalides,
  solde, montants réservés non retirables, destinataire, quota (défaut ∞, fenêtre, expiration,
  concurrence, FAILED non compté, paramètres invalides, audit), double clic, réponse ambiguë,
  aucun renvoi par défaut, renvoi activé avec la même référence, destinataire modifié, échec et
  succès uniques, notifications (valide, répétée, falsifiée), redémarrage, journaux sans numéro
  ni jeton, historique et solde cohérents, administration ; opérateur déduit du numéro
  d'inscription (D-163) : opérateur du client ignoré (autre opérateur, inconnu, absent), numéro
  non pris en charge refusé sans réservation, rejeu avec un autre opérateur.
- `backend/tests/unit/payments/cinetpay-transfer.test.ts` : contrat `POST /v1/transfer`,
  `GET /v1/transfer/{id}`, classement des réponses.
- `backend/tests/unit/wallet/withdrawal-rules.test.ts`, `cinetpay-env.test.ts`.
- `backend/tests/unit/withdrawals/withdrawal-operator.test.ts` : déduction de l'opérateur,
  opérateur non autorisé, erreurs 422, `operator` du client jamais lu (D-163).
- `frontend/src/features/wallet/WithdrawalPanel.test.tsx`, `withdrawal-state.test.ts`.
- `administration/tests/withdrawal-limit.test.ts`.

**PostgreSQL réel** : `backend/tests/integration/withdrawals/postgres-withdrawal-concurrency.test.ts`
(deux instances, pool de 20 connexions, fournisseur simulé partagé) : quota sous 12 demandes
simultanées, solde juste suffisant, double clic massif, remboursements concurrents (relectures,
approbation manuelle contre échec confirmé, double approbation), notification et réconciliation
simultanées, redémarrage avec deux réconciliateurs, échec réseau puis relectures. Exécution :
`TEST_DATABASE_URL=<base de test dédiée> npm test -- tests/integration/withdrawals/postgres-withdrawal-concurrency.test.ts`.

**Limite** : PGlite exécute les transactions une par une ; les tests de concurrence vérifient la
logique, la sérialisation réelle repose sur le verrou `FOR UPDATE` de PostgreSQL (même
mécanisme que les retraits et réservations existants).

## Avant le premier transfert réel

1. Compte marchand CinetPay : **transfert activé** pour le Cameroun (XAF), solde de transfert
   approvisionné, éventuelle liste blanche d'IP (`NOT_ALLOWED`) renseignée.
2. `CINETPAY_TRANSFERS_ENABLED=true`, `CINETPAY_TRANSFER_NOTIFY_URL` publique (HTTPS).
   L'état doit être `sandbox` au démarrage (journal, administration).
3. Sandbox : un retrait de 1 000 jetons vers un numéro de test, vérifier `POST /v1/transfer`,
   la notification, `GET /v1/transfer/{id}` et le règlement (statut, solde, `fee_amount`).
4. Vérifier en particulier : la réponse réelle de création (code, statut), le comportement de
   `TRANSACTION_EXIST` sur une référence réutilisée, la forme de `NOT_FOUND`.
5. `npm run withdrawals:check-operators:prod` sur la base de production : aucun écart
   d'opérateur parmi les retraits ouverts (voir « Opérateur », point 8).
6. Seulement après la validation sandbox : clé `sk_live_`, `NODE_ENV=production`,
   `CINETPAY_TRANSFERS_LIVE_CONFIRMED=true` ; vérifier l'état `live` dans l'administration.
