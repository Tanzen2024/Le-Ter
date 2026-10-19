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

### 2.1 Points d'attention en temps réel (D-116)

- `GET /attention` → `{ generatedAt, alerts { newDetectionAlerts, pendingTournamentApprovals, stalePendingPayments, overdueTurns }, reconciliationAnomalies }` (mêmes calculs que `/dashboard`).
- `GET /events` → flux `text/event-stream` : `ready {}`, `attention { source: DETECTION_ALERT | TOURNAMENT_APPROVAL }`, `end { code }` (jeton expiré, session close, `SERVER_SHUTDOWN`). Aucune donnée métier. Sans bus de signaux : 503 `REALTIME_UNAVAILABLE`.
- En-tête `X-Admin-Passive: 1` sur un `GET` : session contrôlée sans enregistrer d'activité (relectures automatiques). Côté Next.js : `/api/admin/events` est une route dédiée (`app/api/admin/events/route.ts`) qui ne renouvelle jamais le jeton.

## 3. Joueurs

| Méthode | Chemin | Paramètres | Réponse | Audit |
|---|---|---|---|---|
| GET | `/users` | `q` (pseudo, nom, email, téléphone, identifiant), `status` (`active`/`disabled`/`suspended`), `role`, `sort` (`created_desc`, `created_asc`, `username_asc`), pagination | page de joueurs, **téléphone masqué**, `suspension` et `chatRestriction` en cours | non |
| GET | `/users/:userId` | — | `{ user }` : profil, solde, réservé, parties, paiements, `suspension`, `chatRestriction` | `USER_VIEWED` |
| GET | `/users/:userId/games` | pagination | page de parties | non |
| GET | `/users/:userId/transactions` | pagination | page de transactions | non |

404 `USER_NOT_FOUND`.

### 3.1 Gestion des joueurs (D-079, [MODERATION.md](MODERATION.md))

L'administrateur responsable est toujours l'appelant authentifié ; un champ inconnu du corps
(par exemple `actorId`) est refusé (400). Aucune route ne supprime un compte, ne crédite ni ne
débite un solde.

| Méthode | Chemin | Corps / paramètres | Réponse | Audit |
|---|---|---|---|---|
| GET | `/users/:userId/moderation` | — | `{ serverTime, suspension, chatRestriction, security { lastLoginAt, lastSessionActivityAt, activeSessions }, isSelf, limits }` (aucun jeton) | non |
| GET | `/users/:userId/sanctions` | pagination | suspensions, restrictions, avertissements (`state` : `ACTIVE`, `EXPIRED`, `LIFTED`, `RECORDED`) | non |
| GET | `/users/:userId/notes` | pagination | notes internes (texte retiré si supprimée) | non |
| GET | `/users/:userId/moderation-log` | pagination, `includeViews` | lignes `admin_audit_log` du joueur (sans `USER_VIEWED` par défaut) | non |
| POST | `/users/:userId/disable` · `/enable` | `{ reason }` | `{ status, changed, revokedSessions }` | `USER_DISABLED` / `USER_ENABLED` |
| POST | `/users/:userId/suspension` | `{ reason, comment?, endsAt? }` (absente : indéterminée) | 201 `{ sanctionId, revokedSessions }` | `USER_SUSPENDED` |
| POST | `/users/:userId/suspension/lift` | `{ reason }` | `{ sanctionId }` | `USER_SUSPENSION_LIFTED` |
| POST | `/users/:userId/sessions/revoke` | `{ reason? }` | `{ revokedSessions }` | `USER_SESSIONS_REVOKED` |
| POST | `/users/:userId/chat-restriction` | `{ reason, comment?, endsAt? }` | 201 `{ sanctionId }` | `USER_CHAT_RESTRICTED` |
| POST | `/users/:userId/chat-restriction/lift` | `{ reason }` | `{ sanctionId }` | `USER_CHAT_RESTRICTION_LIFTED` |
| POST | `/users/:userId/warnings` | `Idempotency-Key` ; `{ reason, playerMessage?, comment? }` | 201 (200 si rejouée) `{ sanctionId, delivered, replayed }` | `USER_WARNED` |
| POST | `/users/:userId/notes` | `Idempotency-Key` ; `{ body }` | 201 (200 si rejouée) `{ noteId, replayed }` | `USER_NOTE_ADDED` |
| POST | `/users/:userId/notes/:noteId/delete` | `{ reason }` | `{ noteId }` | `USER_NOTE_DELETED` |

Erreurs : 403 `SELF_ACTION_FORBIDDEN`, 409 `LAST_ADMIN`, 409 `ALREADY_SUSPENDED`,
`ALREADY_CHAT_RESTRICTED`, `NOT_SUSPENDED`, `NOT_CHAT_RESTRICTED`, `NOTE_ALREADY_DELETED`,
404 `USER_NOT_FOUND` / `NOTE_NOT_FOUND`, 409 `IDEMPOTENCY_KEY_REUSED`. Côté joueur :
403 `ACCOUNT_SUSPENDED` (connexion, `details.suspendedUntil`), 403 `CHAT_RESTRICTED` (envoi).

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

## 6 bis. Retraits des revenus de la plateforme (D-078, [platform-payouts.md](../platform-payouts.md))

Préfixe `/platform-finance`. L'acteur est toujours l'administrateur connecté ; aucun statut,
frais, initiateur ni approbateur n'est lu dans la requête.

| Méthode | Chemin | Réponse |
|---|---|---|
| GET | `/platform-finance` | `{ revenue, treasury { state, confirmedAvailable (null = non confirmée), obligations, free, anomalies }, fees, withdrawable { amount, ceiling, blockers }, execution, reconciliationRequired }` |
| GET | `/platform-finance/treasury` | 20 dernières relectures du solde CinetPay |
| POST | `/platform-finance/treasury/observe` | relecture `GET /v1/balances` (auditée) → `{ observation }` |
| POST | `/platform-finance/reconcile` | relectures seulement, aucun envoi (audité) |
| GET/POST | `/platform-finance/beneficiaries` | liste (numéros masqués) / `{ label, msisdn }` |
| POST | `/platform-finance/beneficiaries/:id/verify` · `/disable` | `{ note }` (autre administrateur) |
| GET | `/platform-finance/payouts` | `page`, `limit`, `status` |
| POST | `/platform-finance/payouts` | `Idempotency-Key` ; `{ beneficiaryId, amount, purpose }` → 201 / 200 rejeu |
| GET | `/platform-finance/payouts/:id` | détail, `actions` permises, `events` (audité) |
| POST | `/platform-finance/payouts/:id/approve` · `reject` · `cancel` | `{ note }` (requis pour rejet et annulation) |
| POST | `/platform-finance/payouts/:id/release` | 503 `PLATFORM_PAYOUTS_DISABLED` tant que l'exécution est désactivée |
| POST | `/platform-finance/payouts/:id/check` | relecture du transfert chez CinetPay |

Refus métier : `409/403 PLATFORM_PAYOUT_REFUSED` + `details.reason`. Public :
`POST /api/platform-payouts/cinetpay/notify` (jeton vérifié, statut relu).

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
- Barème de commission des parties (D-074) : `GET|PATCH /settings/game-commission`, PATCH
  `{ tiers: [{ minStake, maxStake | null, percent }] }` (barème complet, audité
  `GAME_COMMISSION_UPDATED`) ; écran Paramètres › « Commission des parties ordinaires »
  (`features/settings/game-commission-card.tsx`), simulation indicative côté navigateur.
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
