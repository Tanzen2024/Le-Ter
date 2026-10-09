# API d'administration — contrats

Base : `/api/admin` du backend (appelée par la passerelle Next.js, jamais par le navigateur).

**Autorisations communes** (toutes les routes sauf `POST /auth/login`) :
`Authorization: Bearer <access token>` → `requireAuth` (401 `UNAUTHENTICATED`) →
`requireRole('admin')` (403 `FORBIDDEN`) → `requireAdminSession` (401
`ADMIN_SESSION_REQUIRED` ou `ADMIN_SESSION_EXPIRED`). L'acteur est toujours le compte du
jeton ; aucun identifiant d'acteur n'est lu dans la requête. Administration non configurée
(base ou `JWT_SECRET` absents) : 503 `ADMIN_UNAVAILABLE` sur toutes les routes.

**Erreurs** : `{ error, code, message, fields? }`, message fixe en français ; validation :
400 `VALIDATION_ERROR` avec `fields` (paramètre inconnu ou répété refusé).
**Pagination** : `page` (≥ 1, défaut 1), `limit` (1 à 100, défaut 25) ; réponse
`{ page, limit, total, items }`. **Dates** : ISO 8601 ; période `[from, to)` ; tableau de bord
et rapports : 366 jours au plus, défaut 30 jours.

## 1. Session

| Méthode | Chemin | Requête | Réponse | Erreurs |
|---|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `{ user, accessToken, refreshToken, session, displayRole: 'SUPER_ADMIN' }` | 400, 401 `INVALID_CREDENTIALS` (même réponse pour compte inconnu, mauvais mot de passe, compte non admin), 429 `RATE_LIMITED` |
| POST | `/auth/logout` | — | 204 | — |
| GET | `/auth/session` | — | `{ user, displayRole, session: { startedAt, expiresAt, lastActivityAt, idleExpiresAt, absoluteLifetimeSeconds, idleTimeoutSeconds } }` | — |

Règles : rôle `admin` vérifié AVANT l'ouverture d'une session ; refresh token borné à
8 h ; audit `ADMIN_LOGIN_SUCCEEDED`, `ADMIN_LOGIN_FAILED` (motif), `ADMIN_LOGOUT`,
`ADMIN_SESSION_EXPIRED`. Le renouvellement de l'access token utilise la route existante
`POST /api/auth/refresh` (borne absolue respectée).

## 2. Tableau de bord

`GET /dashboard?from&to` → `{ period, generatedAt, definitions, players { total, newInPeriod, active, admins }, games { waiting, inProgress, createdInPeriod, finishedInPeriod, byStatusInPeriod }, tournaments[{status,count}], payments[{status,count,amount}], platformRevenue, alerts { newDetectionAlerts, pendingTournamentApprovals, stalePendingPayments, overdueTurns }, reconciliationAnomalies, series[{day,newPlayers,activePlayers,gamesStarted,paymentsSucceeded,paymentsAmount,platformRevenue}], recentAdminActivity }`

## 3. Joueurs

| Méthode | Chemin | Paramètres | Réponse | Audit |
|---|---|---|---|---|
| GET | `/users` | `q` (pseudo, nom, email, téléphone, identifiant), `status` (`active`/`disabled`), `role`, `sort` (`created_desc`, `created_asc`, `username_asc`), pagination | page de joueurs, **téléphone masqué** | non |
| GET | `/users/:userId` | — | `{ user }` : profil, solde, réservé, parties, paiements, `actions.suspend.available = false` | `USER_VIEWED` |
| GET | `/users/:userId/games` | pagination | page de parties | non |
| GET | `/users/:userId/transactions` | pagination | page de transactions | non |

404 `USER_NOT_FOUND`. Aucune route de suspension, de modification ni de suppression.

## 4. Parties

| Méthode | Chemin | Paramètres | Réponse |
|---|---|---|---|
| GET | `/games` | `status`, `from`, `to`, `playerId`, `sessionId`, `tournamentId`, `gameId`, `anomaly` (`STALE_WAITING`, `LONG_RUNNING`, `OVERDUE_TURN`), pagination | page de parties : identifiant, statut, joueurs (pseudo, siège, fuite), dates, durée, fin, gagnant, tournoi, anomalies |
| GET | `/games/:gameId` | — | `{ game }` : idem + session, créateur, J1, nombre de messages, alertes, mention de confidentialité |

**Jamais** de main, carte, paquet, pli ni `state` : le DTO est construit à partir de
colonnes en liste blanche (test automatisé). 404 `GAME_NOT_FOUND`. Lecture seule.

## 5. Finances et paiements

| Méthode | Chemin | Paramètres | Réponse | Audit |
|---|---|---|---|---|
| GET | `/finance/overview` | `from`, `to` | achats par statut (« pas un revenu »), mouvements des comptes de jeu, soldes des joueurs, recettes de la plateforme, solde du compte plateforme, `unsupported` | non |
| GET | `/wallet-transactions` | `kind`, `status`, `userId`, `from`, `to`, `q` (référence exacte), pagination | page de transactions | non |
| GET | `/payments` | `status`, `userId`, `from`, `to`, `minAmount`, `maxAmount`, `q`, pagination | page de paiements | non |
| GET | `/payments/:paymentId` | — | `{ payment }` + `initializationFailure`, `settlementAnomaly`, `verification { available, providerConfigured, history }` | `PAYMENT_VIEWED` |
| POST | `/payments/:paymentId/verify` | en-tête `Idempotency-Key` (8–128) | `{ replayed, outcome: settled \| already_processed \| pending \| already_final \| error, status?, reason? }` | `PAYMENT_VERIFICATION_REQUESTED` (résultat) |

Revérification : `PaymentService.verifyForAdmin` → `verifyAndSettle` existant (statut relu
chez CinetPay, références, montant et devise contrôlés, règlement idempotent). Même clé :
résultat rejoué sans nouvel appel ; clé déjà utilisée pour un autre paiement : 409
`IDEMPOTENCY_KEY_REUSED` ; CinetPay non configuré : 503 `PAYMENT_PROVIDER_UNAVAILABLE` ;
404 `PAYMENT_NOT_FOUND`. Jamais `notify_token_hash` ni `payment_url` dans les réponses.

## 6. Rapprochement et compte de la plateforme

| Méthode | Chemin | Réponse |
|---|---|---|
| GET | `/reconciliation/anomalies` | `{ generatedAt, summary { total, critical, warning, byType }, checked, thresholds, guaranteedByDatabase, items[{ type, severity, domain, reference { kind, id, label }, date, amount, currency, compared[{ label, expected, actual }], explanation, state: 'OPEN' }] }` |
| GET | `/platform-account` | `{ name, technicalId: 'platform_ledger', nature, currency, computedBalance, byKind, entries, firstEntryAt, lastEntryAt, treasury { integrated: false }, outgoing { supported: false }, ordinaryGamesCommission { defined: false }, reconciliation { tournamentAnomalies, status } }` |
| GET | `/platform-account/entries` | `kind`, `tournamentId`, `from`, `to`, pagination → écritures avec origine (tournoi), taux, cagnotte brute |

Contrôles : paiements (statut vs achat, montant vs jetons, hors barème, attente ancienne,
référence manquante, achat sans paiement) et tournois (les six contrôles de l'audit §8.5).
Lecture seule, 500 lignes au plus par contrôle.

## 7. Rapports, journal, système

| Méthode | Chemin | Réponse | Audit |
|---|---|---|---|
| GET | `/reports/:report` (`players`, `games`, `tournaments`, `payments`, `commissions`, `reconciliation`, `admin-activity`) `?from&to` | `{ report, period, generatedAt, criteria, columns, rows }` | non |
| GET | `/reports/:report/csv` | CSV UTF-8 (BOM), colonnes en liste blanche, formules neutralisées, 10 000 lignes au plus | `REPORT_EXPORTED` |
| GET | `/audit-log` | `action`, `outcome`, `actorId`, `targetType`, `targetId`, `from`, `to`, pagination → événements | non |
| GET | `/system` | état PostgreSQL / Redis, CinetPay configuré et mode (jamais de valeur), politique de session, seuils, fuseau, `maintenance.available = false` | non |

## 8. Routes administratives existantes réutilisées (inchangées, désormais derrière la session admin)

- Détection (D-049) : `GET /detection/alerts`, `GET /detection/alerts/:id`,
  `GET /detection/alerts/:id/signals`, `GET /detection/subjects/:key/score-history`,
  `PATCH /detection/alerts/:id/status` `{ status, expectedStatus }`.
- Paramètres (D-053) : `GET|PATCH /settings/detection` `{ enabled }`.
- Tournois (D-054, D-055) : `GET|PATCH /tournaments/settings`, `GET|POST /tournaments`,
  `GET|PATCH /tournaments/:id`, `POST /tournaments/:id/{approve,reject,cancel}`,
  `GET /tournaments/:id/{registrations,results,results.csv}`. La liste renvoie les 100
  tournois les plus récemment créés.

## 9. Passerelle Next.js (même origine que les pages)

| Méthode | Chemin | Rôle |
|---|---|---|
| POST | `/api/session/login` | contrôle d'`Origin`, appel de `/api/admin/auth/login`, cookies posés, **aucun jeton dans la réponse** |
| POST | `/api/session/logout` | Origin + jeton CSRF ; fin de session côté backend (après renouvellement si nécessaire) ; cookies effacés |
| GET / POST / PATCH | `/api/admin/*` | relais vers `/api/admin/*` ; Origin + jeton CSRF sur POST/PATCH ; renouvellement transparent ; 403 `CSRF_REJECTED`, 401, 502 `BACKEND_UNAVAILABLE` |
