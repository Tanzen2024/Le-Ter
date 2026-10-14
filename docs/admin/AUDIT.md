# Audit initial — Administration Le Ter et remplacement de l'appellation Katika

- **Date** : 2026-10-09 · **Branche** : `feat/le-ter-session-game-engine` · **Dernier commit** : `5e191fb`
- **Portée** : lecture seule. Seul ce fichier a été créé. Aucun code applicatif, migration,
  dépendance ni configuration n'a été modifié. Les fichiers `.env` n'ont pas été lus : seuls
  les **noms** des variables de `backend/.env.example` sont cités.
- **Décisions validées (rappel, non rediscutées)** :
  - D-059 : `SUPER_ADMIN` = rôle `admin` existant ; aucun nouveau rôle ;
  - D-060 : « Katika » = **compte financier central des commissions** (pas un rôle, pas
    l'administrateur) ; l'appellation est remplacée par **« Compte financier de la plateforme
    Le-Ter »**, la fonction comptable est conservée ;
  - joueur actif = participation à au moins une partie créée sur la période, compté une fois ;
  - session admin : 8 h absolues, 30 min d'inactivité, contrôlées côté serveur ;
  - toutes les routes `/api/admin/*` exigent la session admin ; les écrans admin du mobile
    deviennent incompatibles (documenté, lot séparé) ;
  - suspension désactivée en V1 ; consultations de détail joueur et paiement auditées, pas
    les listes ; compte administrateur dédié ; `TRUST_PROXY` désactivé par défaut.
- **Légende** : ✅ constaté dans le code · 💡 recommandation · ❓ décision nécessaire.

---

## 1. Architecture réelle du projet

```
le-ter/
├─ AGENTS.md          règles du dépôt (pas de workspace npm, pas de shared/ sans décision)
├─ administration/    VIDE (vérifié, fichiers cachés compris)
├─ backend/           API Express + WebSocket, PostgreSQL, Redis
├─ frontend/          application mobile Expo (contient des écrans /admin)
└─ docs/              spécifications, décisions D-001 → D-058, TODO, diagrammes
```

✅ Chaque application a son `package.json` et son `package-lock.json` ; aucune racine npm.

**Backend, par couches** : `routes/` (montage, `requireAuth`, `requireRole`, limites) →
`controllers/` (validation, DTO) → `services/` (`GameService`, `SessionService`,
`TournamentService`, `PaymentService`, `WalletService`, `DetectionAdminService`…) →
`repositories/` (ports + `postgres-*`, SQL paramétré) → `database/` (`SqlClient`,
migrateur). `domain/` (moteur `ter-engine.ts`, règles, tournois, paiements) ne dépend
d'aucune infrastructure.

- REST sous `/api` ; un WebSocket (`realtime-gateway.ts`) : première trame
  `{ type: 'auth', token }` obligatoire sous 10 s, sinon fermeture `4401`.
- Chaque service est optionnel au démarrage (`server.ts`) : sans base ou sans `JWT_SECRET`,
  les routes concernées répondent `503`.
- Minuteurs : échéances en PostgreSQL, reconstruites par `DeadlineSupervisor`.

**Déploiement** : ✅ seul `backend/docker-compose.yml` existe (PostgreSQL 18-alpine,
Redis 8-alpine, identifiants factices, ports locaux). Ni Dockerfile, ni CI, ni reverse proxy,
ni configuration d'hébergement : **l'infrastructure de production est inconnue**.

**État Git avant intervention** : ✅ 62 fichiers suivis modifiés et 2 supprimés
(`frontend/app/session/[sessionId].tsx`, `frontend/src/features/games/DealAnimation.tsx`),
+11 523 / −5 442 lignes ; 135 entrées non suivies hors `docs/admin/` (migrations
`0008`→`0022`, paiements, tournois, portefeuille, détection, chat, admin mobile, docs).
Rien dans `administration/`. Ces travaux ne sont pas les miens : ils ne seront ni annulés,
ni restaurés, ni commités avec l'administration. Fichiers que je toucherai : §16.

---

## 2. Technologies et versions détectées

| Application | Versions (`package.json`) |
|---|---|
| Backend | Node ≥ 22 (local v22.23.0, npm 11.14.1), TypeScript ~6.0.3 strict, Express ^5.2.1, pg ^8.23.1, redis ^6.3.0, ws ^8.22.0, jsonwebtoken ^9.0.3, bcryptjs ^3.0.3 ; Jest ^30.5.2, ts-jest, Supertest, PGlite ^0.5.8 ; ESLint ^10, Prettier ^3.9 |
| Mobile | Expo ~57.0.27, Expo Router ~57.0.25, React 19.2.3, React Native 0.86.3, TypeScript ~6.0.3, Jest ~29.7 |
| Infra locale | PostgreSQL 18, Redis 8 |
| Administration (cible ; dernières versions publiées, `npm view`, 2026-10-09) | Next.js 16.4.0 (Node ≥ 20.9, React ^19), Tailwind CSS 4.3.3, shadcn CLI 4.21.4, TanStack Query 5.104.1, React Hook Form 7.89.0, @hookform/resolvers 5.9.1, Zod 4.6.5, lucide-react 1.54.0, Recharts 3.10.1, Vitest 5.0.3. À l'installation, je retiendrai les dernières versions publiées depuis au moins deux semaines et compatibles entre elles. |

---

## 3. Fonctionnalités existantes

| Domaine | Constat ✅ |
|---|---|
| Comptes | Inscription (rôle forcé à `user`), connexion email + mot de passe, refresh rotatif (empreinte SHA-256 stockée), logout, `GET /me`. **Une session active par compte** (R-32, index unique partiel). `users.status` ∈ {`active`, `disabled`} : `disabled` bloque connexion et jetons, mais **aucune route** ne change ce statut. |
| Rôles | `users.role` ∈ {`user`, `admin`} (CHECK). `admin` attribué **uniquement** par `npm run user:role -- <email> admin`. |
| Parties | Sessions de table 2/3/4 sièges fixes, 5 plis, minuteur 20 s, carte automatique au timeout, Continuer/Quitter 20 s (D-064), gain instantané, fuite. `games.status` ∈ {`waiting`, `in_progress`, `finished`} ; `end_reason` ∈ {`INSTANT_WIN`, `CONTROL_AFTER_LAST_TRICK`, `INSTANT_WIN_TIE`, `ADMIN_STOP`}. `games.stake_amount` est **enregistré mais aucun mouvement d'argent n'est exécuté** pour une partie ordinaire (§7). |
| Arrêt exceptionnel | CLI `npm run game:finish` (`ADMIN_STOP`). Aucune route HTTP. |
| Chat | Messages de partie, WebSocket + Redis Pub/Sub. |
| Compte de jeu | §7. |
| Paiements | §9. |
| Tournois | Cycle D-054 → D-058 complet (12 statuts), réservation, cagnotte, commission, jetons de tournoi, classement, gains, notifications, planificateur. |
| Compte plateforme | `platform_ledger` (§8). |
| Anti-collusion | Signaux, géolocalisation, comportement, scores, alertes, administration des alertes, interrupteur global. |
| Paramètres | `system_settings` : `detection_enabled`, `tournament_platform_fee_percent`, `initial_tournament_tokens`, `default_tournament_stake`, `maximum_pending_tournaments_per_player`, `tournament_transition_minutes`. **Pas de mode maintenance.** |
| Admin mobile | `frontend/app/admin/**` : interrupteur de détection, tournois (liste, création, détail, paramètres), via `admin-api.ts` et `admin-tournaments-api.ts`. |

---

## 4. Routes administratives disponibles

✅ Vérifiées dans `routes/*.ts`. Toutes : `requireAuth` (401) puis `requireRole('admin')`
(403) ; le rôle est relu en base à chaque requête (`AuthService.authenticate`).

| # | Méthode | Chemin | Effet | Audit écrit |
|---|---|---|---|---|
| 1 | GET | `/api/admin/detection/alerts` | liste paginée (`page`, `limit`, filtres, `sort` en liste blanche) | — |
| 2 | GET | `/api/admin/detection/alerts/:alertId` | détail + score | — |
| 3 | GET | `/api/admin/detection/alerts/:alertId/signals` | signaux minimisés | — |
| 4 | GET | `/api/admin/detection/subjects/:subjectKey/score-history` | historique du score | — |
| 5 | PATCH | `/api/admin/detection/alerts/:alertId/status` | `{ status, expectedStatus? }` | `ALERT_STATUS_CHANGED` |
| 6 | GET | `/api/admin/settings/detection` | `{ enabled, updatedAt }` | — |
| 7 | PATCH | `/api/admin/settings/detection` | `{ enabled }` | `DETECTION_ENABLED` / `DISABLED` |
| 8 | GET | `/api/admin/tournaments/settings` | paramètres tournois | — |
| 9 | PATCH | `/api/admin/tournaments/settings` | modification | `TOURNAMENT_SETTINGS_UPDATED` |
| 10 | GET | `/api/admin/tournaments` | liste (`?status=A,B`) | — |
| 11 | POST | `/api/admin/tournaments` | création publiée | `TOURNAMENT_CREATED` |
| 12 | GET | `/api/admin/tournaments/:id` | détail | — |
| 13 | PATCH | `/api/admin/tournaments/:id` | modification avant verrouillage | `TOURNAMENT_UPDATED` |
| 14 | POST | `/api/admin/tournaments/:id/approve` | approuver une proposition | `TOURNAMENT_APPROVED` |
| 15 | POST | `/api/admin/tournaments/:id/reject` | refuser | `TOURNAMENT_REJECTED` |
| 16 | POST | `/api/admin/tournaments/:id/cancel` | annuler avant démarrage | `TOURNAMENT_CANCELLED` |
| 17 | GET | `/api/admin/tournaments/:id/registrations` | inscriptions, réservations | — |
| 18 | GET | `/api/admin/tournaments/:id/results` | résultats | — |
| 19 | GET | `/api/admin/tournaments/:id/results.csv` | export | — |

Les 19 routes et les 12 routes tournoi (n° 8 à 19) sont confirmées. L'audit est écrit dans
la même transaction que l'action (`postgres-detection-admin.repository.ts:154`,
`postgres-detection-settings.repository.ts:57`, `postgres-tournament.repository.ts:715`).

**Consommateurs actuels** : les écrans `frontend/app/admin/**` (routes 6-7 et 8-19), avec une
session mobile (refresh 30 j). Une fois la session admin exigée, ces écrans recevront `401`
(incompatibilité documentée ; leur retrait ou leur migration est un lot séparé).

**API joueur à préserver (aucun changement)** : `/api/auth/*`, `/api/games/*`,
`/api/sessions/*`, `/api/wallet/*`, `/api/payments/*` (dont `POST /cinetpay/notify` public et
`GET /cinetpay/return/:paymentId`), `/api/tournaments/*`, `/api/notifications/*`,
`/api/games/:id/chat/messages`, `/api/games/:id/geolocation|position`, `/api/health`,
WebSocket temps réel.

---

## 5. API manquantes

Toutes sous `/api/admin`, derrière `requireAuth` → `requireRole('admin')` →
`requireAdminSession`. 💡

| Rubrique | Endpoint | Remarque |
|---|---|---|
| Session | `POST /auth/login`, `POST /auth/logout`, `GET /auth/session` | refuse un compte non `admin` **avant** de créer la session ; audit succès / échec / déconnexion / expiration |
| Tableau de bord | `GET /dashboard?from&to` | agrégats SQL réels (§15) |
| Joueurs | `GET /users`, `GET /users/:id` (audité `USER_VIEWED`), `GET /users/:id/games`, `GET /users/:id/transactions` | lecture seule |
| Parties | `GET /games`, `GET /games/:id` | DTO minimisé (R-02) |
| Finances | `GET /finance/overview?from&to` | volumes par nature, sans mélange revenu / achats |
| Transactions | `GET /wallet-transactions` | filtres référence, période, joueur, statut, type |
| Paiements | `GET /payments`, `GET /payments/:id` (audité `PAYMENT_VIEWED`), `POST /payments/:id/verify` (`Idempotency-Key`, audité) | revérification via `PaymentService` existant |
| Rapprochement | `GET /reconciliation/anomalies?type&from&to` | lecture seule (§8, §9) |
| Compte plateforme | `GET /platform-account`, `GET /platform-account/entries` | §8 |
| Rapports | `GET /reports/:report?from&to` (+ `.csv` quand utile) | réutilisent les mêmes requêtes que les rubriques |
| Journal | `GET /audit-log` | lecture seule |
| Système | `GET /system` | PostgreSQL/Redis, CinetPay configuré oui/non, mode sandbox/production (jamais de valeur) |

**Volontairement non créés** : suspension / réactivation, action sur une partie, crédit ou
débit manuel, remboursement, retrait, écriture dans `platform_ledger`, transfert depuis le
compte plateforme, mode maintenance, suppression de compte, de partie ou de tournoi, création
d'administrateur.

---

## 6. Règles métier des parties et des tournois (respectées, non modifiées)

**Parties** (D-030 → D-036) : une partie active par joueur (index unique) ; capacité 2/3/4 ;
seul le créateur démarre, dès 2 joueurs ; distribution 3 puis 2 cartes ; sens antihoraire ;
5 plis exactement, le 5e automatique ; obligation de suivre la famille ; contrôle au plus
fort de la famille d'entrée ; fuite au tour 1 seulement ; gain instantané (6 combinaisons
rangées, analysées par le serveur) ; minuteur 20 s puis carte automatique déterministe ;
Continuer/Quitter 20 s (D-064). Toute mutation passe par `GameService` (sérialisée par `gameId`,
versionnée). **L'administration ne fait que lire.**

**Tournois** (D-054 → D-058, D-103) : création admin (publiée) ou proposition joueur (brouillon →
approbation) ; aucun chevauchement (contrainte d'exclusion GiST) ; durée entre les bornes des
paramètres, **45 à 120 min** par défaut (D-104) ;
participants entre les bornes des paramètres, **20 à ∞** par défaut (maximum ≥ minimum) ; inscription = réservation du prix d'entrée,
capturée au démarrage, libérée si annulation ; **annulation uniquement avant capture**
(« les paiements sont définitifs ») ; commission copiée à la publication puis immuable ;
jetons de tournoi ; jusqu'à 10 rangs payés (somme = 100 %) ; classement déterministe sans ex
æquo ; gains versés un par un, idempotents. L'administration réutilise les routes existantes
sans contourner `validateTournamentInput`.

**Règles À CLARIFIER (non tranchées ici)** : R-02 (Kora), R-05 (coût de la fuite), R-06
(départage provisoire), R-12, R-13 (retrait, mises), R-14, R-16, R-33, R-34, R-35, R-36
(conséquences d'une alerte), et la **commission sur les parties ordinaires** (§8.4).

---

## 7. Fonctionnement financier existant

✅ **Compte de jeu (D-040)** — source de vérité des joueurs :

| Table | Rôle | Contraintes |
|---|---|---|
| `wallets` | un compte par joueur : `balance`, `reserved` | `balance ≥ 0`, `0 ≤ reserved ≤ balance` |
| `wallet_transactions` | toute variation de solde | `kind` ∈ {`deposit`, `withdrawal`, `tournament_entry`, `tournament_prize`} ; `status` ∈ {`pending`, `succeeded`, `failed`} ; idempotence `(user_id, idempotency_key)` ; `failed` ⇔ `failure_code` |
| `wallet_reservations` | prix d'entrée réservé | `ACTIVE` → `CAPTURED` (lien `capture_transaction_id`) ou `RELEASED`/`EXPIRED` ; une réservation vivante par inscription |
| `payments` | détail CinetPay d'un `deposit` (1–1) | §9 |
| `platform_ledger` | recettes de la plateforme | §8 |

Unité : jetons ; 1 FCFA = 1 jeton pour l'achat et les tournois (D-050, D-054) ; devise
unique `XAF` (CHECK partout). Aucune autre devise n'existe : aucune conversion n'est à faire.

**Flux d'un tournoi** (`TournamentService.startTournament` / `calculateResults` /
versement) :

```
inscription  → wallet_reservations ACTIVE (reserved += prix)
démarrage    → capture : wallet_transactions 'tournament_entry' (succeeded) par joueur
               cagnotte brute = prix × participants
               commission = floor(brute × fee_bps / 10 000)          → platform_ledger TOURNAMENT_PLATFORM_FEE
               cagnotte des gains = brute − commission
résultats    → gains = floor(cagnotte × part) par rang, reste d'arrondi au 1er rang
               part des rangs non occupés                            → platform_ledger UNALLOCATED_PRIZE
versement    → wallet_transactions 'tournament_prize' (succeeded), lien tournament_results.prize_transaction_id
```

**Parties ordinaires** : `stakeTransfers` (`domain/rules/stake.ts`) calcule des transferts
**théoriques** mais n'est appelé nulle part ; aucun débit, crédit ni prélèvement n'est
exécuté. ✅ **Aucune commission n'existe sur les parties ordinaires.**

---

## 8. Rôle réel de `platform_ledger` — le compte financier de la plateforme

### 8.1 Constat ✅

```sql
platform_ledger (id, tournament_id NOT NULL → tournaments, kind, amount ≥ 0, fee_bps,
                 currency = 'XAF', created_at,
                 UNIQUE (tournament_id, kind))
kind ∈ { TOURNAMENT_PLATFORM_FEE, UNALLOCATED_PRIZE }
```

- Écrit **uniquement** par `PostgresTournamentRepository.recordPlatformEntry`
  (`INSERT … ON CONFLICT platform_ledger_once DO NOTHING` : idempotent), dans la transaction
  du démarrage (commission) ou du calcul des résultats (part non attribuée).
- C'est un **journal d'écritures de recettes** de la plateforme, en entrée seulement. Ce
  n'est ni un compte utilisateur, ni un portefeuille avec solde stocké, ni un mécanisme de
  calcul (le calcul est dans `computePool` / `computePrizes`).
- Aucune écriture de sortie, aucun transfert, aucun versement vers un compte bancaire ou
  Mobile Money n'existe.

### 8.2 Conclusion

`platform_ledger` **est** le compte financier central visé par D-060 : il reçoit les
commissions de tournoi (et les parts de gains non attribuées). Il est réutilisé tel quel ;
**aucun second compte n'est créé**.

### 8.3 Ce qui peut être affiché de façon fiable

| Donnée | Source | Fiabilité |
|---|---|---|
| Identité fonctionnelle | « Compte financier de la plateforme Le-Ter » | libellé |
| Identifiant technique | `platform_ledger` (table ; il n'existe pas de ligne « compte ») | ✅ |
| Devise | `XAF` | ✅ |
| Commissions perçues | `SUM(amount) WHERE kind = 'TOURNAMENT_PLATFORM_FEE'` | ✅ |
| Parts non attribuées | `SUM(amount) WHERE kind = 'UNALLOCATED_PRIZE'` | ✅ |
| Historique, date, origine | lignes + `tournament_id` (origine toujours un tournoi) | ✅ |
| **Solde comptable** | somme des écritures (aucune sortie modélisée, donc entrées = solde du journal) | ✅ calculé, libellé « solde comptable calculé — aucune sortie n'est prise en charge » |
| Trésorerie réellement disponible chez CinetPay / en banque | non intégrée | **Indisponible** (affiché comme tel) |
| Revenu sur parties ordinaires | inexistant | 0 écriture ; affiché « aucune commission sur les parties ordinaires (non définie) » |

### 8.4 Éléments manquants (documentés, non inventés)

- **Commission sur les parties ordinaires** : spécification d'origine (« prélèvement d'un
  pourcentage non chiffré ») jamais modélisée ; reste un **point métier ouvert** (taux,
  assiette, moment du prélèvement, effet sur les mises). Rien n'est implémenté.
- **Sorties du compte plateforme** (versement, retrait, frais fournisseur) : aucune règle.
- **Lien écriture → transactions sources** : non stocké, mais reconstructible par
  `tournament_id` (réservations capturées, résultats), ce qui suffit au rapprochement.

### 8.5 Contrôles de rapprochement du compte plateforme (lecture seule) 💡

Pour chaque tournoi démarré :

1. `tournaments.platform_fee` = écriture `TOURNAMENT_PLATFORM_FEE` (présente et égale) ;
2. `platform_fee` = `floor(gross_pool × platform_fee_bps / 10 000)` ;
3. `gross_pool` = somme des `tournament_entry` liées aux réservations `CAPTURED` du tournoi
   = `entry_fee × participants` ;
4. `gross_pool` = `platform_fee + prize_pool` (aussi garanti par un CHECK) ;
5. `prize_pool` = somme des `tournament_results.prize_amount` + `unallocated_prize`, et
   `unallocated_prize` > 0 ⇔ écriture `UNALLOCATED_PRIZE` égale ;
6. tournoi `COMPLETED` ⇒ tous les gains > 0 ont un `prize_transaction_id` `succeeded` de même
   montant.

---

## 9. Intégration CinetPay

✅ API v1, **achats seulement** (500 / 1 000 / 2 000 / 5 000 XAF). `payments.status` ∈
{`PENDING`, `SUCCESS`, `FAILED`, `EXPIRED`} + `provider_status` brut.

**Confirmation** (`PaymentService`) : notification → paiement retrouvé → `notify_token`
comparé en temps constant à son empreinte → référence identique → **statut relu chez
CinetPay de serveur à serveur** → références, montant, devise vérifiés → statut final →
règlement atomique et idempotent (crédit une seule fois, via le règlement du compte de jeu).
Le corps d'une notification n'est jamais une preuve. Un `PENDING` lu par son joueur est
revérifié au plus toutes les 10 s.

**Contraintes** : `SUCCESS` impossible sans `provider_reference` ; unicité
`(provider, merchant_transaction_id)` et `(provider, provider_reference)` ; `PENDING` ⇔
`completed_at IS NULL`.

**Inexistant** ✅ : remboursement, statut « remboursé », retrait
(`disbursementAvailable = false`), crédit manuel, relevé marchand CinetPay.

**Tests** : `FakeCinetPay` — aucun appel réel.

**Rapprochement des paiements (lecture seule)** 💡 :

| Anomalie | Contrôle |
|---|---|
| Incohérence de statut | `SUCCESS` ↔ `deposit` ≠ `succeeded` ; `FAILED`/`EXPIRED` ↔ `succeeded` ; `PENDING` ↔ transaction finale |
| Écart de montant | `payments.amount` ≠ `wallet_transactions.tokens` (1 FCFA = 1 jeton) |
| Écart de devise | impossible (CHECK `XAF`) : affiché « garanti par la base » |
| Référence manquante | `deposit` sans `payments` ; `PENDING` sans `provider_reference` au-delà du seuil |
| En attente ancienne | `PENDING` au-delà d'un seuil d'affichage (💡 30 min, filtre, pas une règle) |
| Doublon de référence | impossible (contraintes uniques) : affiché « garanti par la base » |
| Montant hors barème | montant ∉ {500, 1 000, 2 000, 5 000} |

« État de traitement » d'une anomalie : il n'existe aucune table de suivi. En V1, l'état est
**calculé** (« ouverte » tant que la condition est vraie, « résolue » sinon) ; un suivi manuel
nécessiterait une table et une règle (non proposé sans besoin confirmé).

**Revérification** : nouvelle méthode publique de `PaymentService` appelant le
`verifyAndSettle` existant, sans modifier le flux joueur ; double traitement empêché par le
règlement idempotent existant + `Idempotency-Key` ; résultat (`settled`,
`already_processed`, `pending`, erreur fournisseur) audité et affiché tel quel.

---

## 10. Authentification et sécurité existantes

| Mécanisme | Constat ✅ |
|---|---|
| Identité | JWT HS256 (`JWT_SECRET` ≥ 32 car.), `sub` UUID ; chaque requête relit session, statut et rôle en base. |
| Sessions | Access 15 min (défaut), refresh 30 j rotatif, une session par compte, révocation au logout. |
| Rôles | `requireRole` lit la session serveur, jamais le client ; aucune route d'élévation ; inscription forcée à `user`. |
| Mots de passe | bcrypt ; comparaison factice si compte inconnu. |
| Limitation | `createRateLimiter` : fenêtre fixe **en mémoire, par instance**, clé `req.ip` par défaut. Login : 10 / 15 min par IP + email, 100 / 15 min par IP. |
| Proxy | `trust proxy` **non configuré** : `req.ip` = pair TCP ; `X-Forwarded-For` ignoré. |
| En-têtes | `no-store`, `nosniff`, `X-Frame-Options: DENY`, CSP `default-src 'none'`, CORP `same-origin`. |
| CORS | **Absent**. |
| Corps | JSON ≤ 32 ko. |
| Erreurs | `{ error, code, message }`, messages fixes, `requestId` sur 500. |
| Journaux | jamais mot de passe, jeton, `Authorization`, `notify_token`. |
| Base | une seule `DATABASE_URL` : l'application est vraisemblablement propriétaire des tables (invérifiable sans accès à la base cible). |

---

## 11. Références à l'appellation Katika

Recherche insensible à la casse sur tout le dépôt (suivis et non suivis, `.docx`
décompressés, diagrammes examinés visuellement).

### 11.1 Constat

✅ **Aucune référence fonctionnelle** : pas de rôle, type, constante, condition, table,
colonne, donnée, écran, texte d'interface, test, script ni configuration. Le mobile n'en
contient aucune. Le rôle en base reste limité à `('user', 'admin')`. **Aucune migration de
données n'est nécessaire.** Certaines docs présentaient Katika comme un rôle (R-09) : D-060
corrige cette lecture (compte financier, pas rôle).

### 11.2 Inventaire et traitement

| Emplacement | Contexte | Traitement |
|---|---|---|
| `backend/src/domain/users/user.ts:36` | commentaire du rôle `admin` | reformulé : `admin` = SUPER_ADMIN (D-059) ; plus de renvoi à R-09 |
| `backend/src/cli/set-user-role.ts:12` | commentaire | idem |
| `backend/src/domain/rules/stake.ts:7` | « pas de prélèvement du Katika » | « aucune commission plateforme sur les parties ordinaires (non définie) » |
| `backend/migrations/0002_…sql:20`, `0017_admin_role_and_audit.sql:6` | commentaires de migrations **appliquées** | **intacts** : le migrateur compare une empreinte SHA-256 de chaque fichier ; toute modification bloquerait `db:migrate` (D-026). Référence historique justifiée. |
| `docs/TODO.md` l.19 (R-09), l.108, l.125, l.157 | règle et tâches | R-09 **TRANCHÉ (D-059, D-060)** ; « compte Katika » → compte financier de la plateforme ; commission des parties ordinaires gardée comme point ouvert |
| `docs/architecture.md:45`, `authentication.md:56,226`, `detection.md:226`, `game-domain.md:68` | docs actives | reformulées selon le contexte |
| `docs/decisions.md` l.429, 866, 1321, 1401, 1514, 1525, 1645 | décisions passées | **intactes** ; D-059 et D-060 ajoutées et les remplacent sur ce point |
| `SPECIFICATION FONCTIONNELLE DE LE TER.docx` (6), `Voici des critères…docx` (1), `Diagramme_de_classe_de_LE_TER.jpg` (classe `Katika` : `id`, `solde`, `getSolde()`, liée à `Compte`) | documents sources | **intacts** (AGENTS.md) ; déclarés remplacés par D-060 dans la documentation active |

### 11.3 Correspondance fonctionnelle

| Notion d'origine | Équivalent actuel |
|---|---|
| Compte Katika (`solde`) | Compte financier de la plateforme Le-Ter = `platform_ledger`, solde comptable calculé |
| Commission de tournoi | `TOURNAMENT_PLATFORM_FEE` (taux par tournoi, `platform_fee_bps`) |
| Prélèvement sur chaque partie | **non modélisé** → point métier ouvert |
| Organisation des tournois | rôle `admin` (indépendant du compte financier) |

---

## 12. Migrations et contraintes de base

✅ 22 fichiers, appliqués par ordre **alphabétique** du nom, en une transaction, sous verrou
consultatif, avec empreinte SHA-256 vérifiée (`database/migrator.ts`).

| Fichier | Contenu |
|---|---|
| 0001 | `games`, `game_players` |
| 0002 | `users`, `refresh_tokens` (une session active par utilisateur) |
| 0003 / 0004 | lien parties-utilisateurs, une partie active par joueur |
| 0005 / 0006 / 0007 / 0008 / 0009 | sessions, sièges, décisions, `end_reason`, arrivées, nom et mot de passe de table |
| 0010 | `wallets`, `wallet_transactions` |
| 0011 / 0012 / 0014 / 0015 / 0016 | détection |
| 0013 | chat |
| **0017**_admin_role_and_audit | rôle `admin`, `admin_audit_log` |
| **0017**_payments | `payments` |
| *(pas de 0018)* | — |
| 0019 / 0021 / 0022 | tournois, finances de tournoi, `platform_ledger`, notifications |
| 0020 | `system_settings`, extension de l'audit |

Constats :
- deux fichiers `0017` et aucun `0018` : fonctionne (tri par nom) ; **ne rien renommer** ;
- prochaine migration : **`0023`** (nom libre vérifié) ;
- `admin_audit_log` (état après 0021) : `actor_id uuid NOT NULL → users`, `action` et
  `target_type` en liste fermée (CHECK), `target_id` nul seulement pour `SYSTEM_SETTING`,
  `details jsonb`. **Un échec de connexion sur un compte inconnu ne peut pas être enregistré.**
  Aucun déclencheur ni droit SQL n'empêche `UPDATE` / `DELETE`.
- index de liste existants : `games (status, created_at DESC)`,
  `wallet_transactions (user_id, created_at DESC)`, `payments` partiel `PENDING`,
  `admin_audit_log (actor_id, created_at DESC)` et `(target_type, target_id, created_at)`.
  Il manque des index pour les listes admin globales (`payments.created_at`,
  `wallet_transactions.created_at`, `users.created_at`) : à ajouter dans `0023` après
  `EXPLAIN`.

**Migration `0023` prévue** 💡 (préparée et testée sur PGlite, jamais appliquée à une base
partagée sans votre accord) :
- `admin_sessions` (`session_id`, `user_id`, `started_at`, `last_activity_at`,
  `absolute_expires_at`, `ended_at`, `end_reason`) ;
- `admin_audit_log` : `actor_id` nullable **uniquement** pour `ADMIN_LOGIN_FAILED` (CHECK),
  colonne `outcome` (`SUCCESS` / `FAILURE`), nouvelles actions (`ADMIN_LOGIN_SUCCEEDED`,
  `ADMIN_LOGIN_FAILED`, `ADMIN_LOGOUT`, `ADMIN_SESSION_EXPIRED`, `USER_VIEWED`,
  `PAYMENT_VIEWED`, `PAYMENT_VERIFICATION_REQUESTED`, `REPORT_EXPORTED`) et cibles
  (`USER`, `PAYMENT`, `ADMIN_SESSION`, `REPORT`) ;
- déclencheur refusant `UPDATE`, `DELETE` et `TRUNCATE` sur `admin_audit_log` ;
- index de liste.

---

## 13. Risques de sécurité

### Confirmés

| # | Criticité | Risque | Traitement prévu |
|---|---|---|---|
| R-01 | **Critique** | Pas de CORS ; l'ouvrir exposerait des jetons Bearer à JavaScript | Passerelle Next.js ; jetons jamais envoyés au navigateur ; aucun CORS ajouté |
| R-02 | **Critique** | `games.state` contient les mains cachées | DTO construit champ par champ ; aucune main tant que la partie n'est pas `finished` ; test automatisé dédié |
| R-03 | Élevée | Journal d'audit modifiable ; échec de connexion sur compte inconnu impossible à tracer | Migration `0023` (déclencheur, acteur nullable encadré). **Limite** : un propriétaire de la table peut désactiver un déclencheur ; protection forte = rôle SQL applicatif sans droit DDL ni `UPDATE`/`DELETE` sur la table (infrastructure, documenté) |
| R-04 | Élevée | Aucune session admin 8 h / 30 min | `admin_sessions` contrôlée à chaque requête admin ; à l'expiration : refresh token révoqué, audit `ADMIN_SESSION_EXPIRED`, `401` |
| R-05 | Élevée | Limitation en mémoire par instance ; `trust proxy` absent ; infra inconnue | Limiteur du login admin sur Redis (`INCR` + `PEXPIRE`) si `REDIS_URL`, repli mémoire journalisé en cas de panne ; `TRUST_PROXY` variable, **désactivée par défaut** ; la passerelle n'envoie aucun `X-Forwarded-For` de confiance |
| R-06 | Moyenne | R-32 : une connexion admin révoque la session mobile du même compte | Compte dédié (validé), documenté |
| R-07 | Moyenne | Écrans admin du mobile incompatibles avec la session admin | Documenté ; lot séparé |
| R-08 | Moyenne | Agrégats financiers trompeurs (achats présentés comme revenus) | Vue finances séparant achats joueurs (encaissés pour le compte des joueurs), passif = somme des soldes joueurs, et revenu = `platform_ledger` |
| R-09 | Moyenne | Deux migrations `0017`, pas de `0018` | Ne rien renommer ; `0023` ensuite |
| R-10 | Moyenne | 199 changements non commités d'autres lots | Aucun commit global ; mes fichiers listés à part |
| R-11 | Moyenne | 20 tests instables sous charge | Référence documentée (§14) |
| R-12 | Faible | `/api/health` public expose l'état PostgreSQL/Redis | Inchangé |
| R-13 | Faible | Le diagramme d'administration prévoit blocage et suppression (comptes, parties, tournois) | Non implémenté ; contraire aux décisions validées |

### Recommandations

- 💡 Rôle SQL en lecture seule pour les agrégats et rapports (infrastructure).
- 💡 HTTPS de bout en bout en production (prérequis des cookies `Secure`).
- 💡 Exports CSV bornés (période obligatoire, plafond de lignes, colonnes en liste blanche,
  audités `REPORT_EXPORTED`).

### Décisions métier nouvelles

Aucune n'est bloquante pour la V1. Points ouverts consignés : commission sur les parties
ordinaires, sorties du compte plateforme, règles de suspension.

---

## 14. Tests de référence

### Backend — exécutés dans cette session, avant toute modification

| Commande | Résultat |
|---|---|
| `npm run typecheck` | OK (code 0) |
| `npm run lint` | OK (code 0) |
| `npm test` (workers parallèles, 374 s) | Suites : 64 OK, **2 en échec**, 8 ignorées (74). Tests : 1 099 OK, **20 en échec**, 50 ignorés (1 169) |
| `npm test -- tests/integration/auth/register-login.test.ts tests/integration/timers/deadline-recovery.test.ts --runInBand` | **2 suites OK, 25/25** |

Les 20 échecs sont tous `Exceeded timeout of 30000 ms for a hook` dans ces deux suites, qui
passent seules : instabilité de charge (PGlite dans des workers parallèles), pas une
régression. Les 8 suites ignorées sont les tests d'infrastructure réelle (exécutés seulement
si `TEST_DATABASE_URL` est défini).

### Mobile — exécutés dans cette session, avant toute modification

Dans `frontend/` :

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` | OK (code 0) |
| `npx expo lint` | OK (code 0, aucun avertissement affiché) |
| `npm test -- --ci` | **23 suites OK, 240/240 tests OK** (29 s) |

---

## 15. Architecture cible

```
Navigateur ──HTTPS──▶ Next.js 16 (administration/)
                        ├─ pages App Router (Server + Client Components)
                        ├─ passerelle app/api/** (Route Handlers)
                        │    cookie de session httpOnly · Secure · SameSite=Strict
                        │    contrôle Origin + jeton CSRF (double soumission) sur mutation
                        │    jetons backend jamais transmis au navigateur
                        └─ proxy Next (redirection si non connecté : confort, pas sécurité)
                                    │ serveur à serveur, Authorization: Bearer
                                    ▼
                      backend /api/admin/**
                        requireAuth → requireRole('admin') → requireAdminSession (8 h / 30 min)
                        AdminQueryService (lecture, DTO) · PaymentService (revérification)
                        TournamentService / DetectionAdminService / DetectionSettingsService
                                    ▼
                      PostgreSQL (source de vérité) · Redis (limitation du login admin)
```

- **Aucune** modification du moteur, de `GameService`, `SessionService`, des règles, du flux
  CinetPay joueur ni des routes du mobile.
- Nouveaux fichiers backend préfixés `admin-*` ; lectures via un port `AdminQueryRepository`
  (SQL paramétré) ; DTO en liste blanche.
- Administration : `app/(auth)/login`, `app/(dashboard)/{dashboard, joueurs, parties,
  tournois, anti-collusion, finances, paiements, rapprochement, compte-plateforme, rapports,
  audit, parametres, profil}`, `app/api/**` ; `components/{ui, layout, tables, charts,
  feedback}` ; `features/*` ; `lib/{api, auth, validation, utils}` ; `hooks/`, `types/`,
  `tests/`. Types redéclarés (pas de `shared/`, AGENTS.md).
- Identité visuelle : fond gris bleuté, cartes blanches, bleu ardoise principal, turquoise
  discret, vert / ambre / rouge sobres, police Inter, rayons et ombres légers.
- Fuseau : affichage `Africa/Douala` (valeur par défaut des tournois) ; l'API reçoit et
  renvoie des instants ISO 8601 UTC ; une période est `[from, to)`.
- **Joueur actif** : compté une fois s'il figure dans `game_players` d'au moins une partie
  créée dans `[from, to)` et **démarrée** (`in_progress` ou `finished`, `ADMIN_STOP` et
  parties de tournoi compris). Les parties `waiting` jamais démarrées sont exclues : le
  joueur n'y a pas joué. Il n'existe ni partie annulée ni partie de test dans le modèle.
- **Finances** : trois agrégats jamais additionnés entre eux : achats confirmés (CinetPay),
  soldes des joueurs (passif), revenu de la plateforme (`platform_ledger`). Devise unique
  XAF.
- **Notifications de la barre supérieure** : compteurs calculés à partir de données réelles
  (alertes `NEW`, propositions de tournoi en attente, paiements en attente anciens,
  anomalies de rapprochement). Pas de système de notification admin inventé.

---

## 16. Plan détaillé de réalisation

| Phase | Contenu | Fichiers | Vérification |
|---|---|---|---|
| A — Katika | Reformuler 3 commentaires backend ; docs actives (§11.2) ; D-059 et D-060 dans `docs/decisions.md` + `docs/admin/DECISIONS.md` ; R-09 tranché ; point ouvert « commission parties ordinaires » | `user.ts`, `set-user-role.ts`, `stake.ts` (commentaires seulement), 6 docs | recherche globale, typecheck, lint |
| B — Initialisation | Next.js 16, TS strict, Tailwind 4, shadcn/ui, ESLint, Prettier, Vitest, `.env.example`, README | `administration/**` | `dev`, `build`, `lint`, `typecheck` |
| C — Design system | tokens, composants (bouton, carte KPI, badge de statut, tableau paginé, filtres, formulaire, dialogue de confirmation, toasts, squelettes, états vide / erreur / indisponible), sidebar, barre supérieure, responsive | `administration/**` | tests de composants |
| D — Authentification | migration `0023` ; `/api/admin/auth/*` ; `requireAdminSession` appliqué à **toutes** les routes `/api/admin/*` ; limiteur Redis / mémoire ; `TRUST_PROXY` ; passerelle, cookies, CSRF, page de connexion, déconnexion, profil | `backend/migrations/0023_admin_platform.sql`, `backend/src/**/admin-*.ts`, `routes/index.ts`, `app.ts`, `server.ts`, `config/env.ts`, `.env.example`, `middleware/api-errors.ts`, tests ; `administration/**` | 401, 403, expiration absolue et d'inactivité, rafale, CSRF, migrateur, tests existants des 19 routes adaptés à la session admin |
| E — Consultation | tableau de bord, joueurs (lecture, détail audité, suspension affichée « désactivée »), parties (DTO sans mains + test), tournois (12 routes), anti-collusion (5 routes + interrupteur) | idem | KPI comparés à des données de test connues, non-régression tournois |
| F — Finances | vue générale, transactions, paiements (détail audité, revérification), rapprochement (§8.5, §9), compte financier de la plateforme, opérations indisponibles | `PaymentService` (une méthode ajoutée), fichiers `admin-*` | `FakeCinetPay`, double appel, panne fournisseur, calculs de commission |
| G — Rapports, audit, paramètres | rapports et exports bornés, journal (filtres, détail), paramètres existants, état des services, profil | idem | lecture seule du journal, audit des exports |
| H — Validation | backend : typecheck, lint, `format:check`, tests (comparés à §14), build, migrateur sur PGlite ; administration : lint, Prettier, tsc, tests, build ; mobile : lint, tsc, tests ; recherche Katika finale ; `docs/admin/{ARCHITECTURE, IMPLEMENTATION, API, SECURITY, DECISIONS}.md` | — | rapport final |

**Fichiers existants modifiés (liste fermée)** : `backend/src/domain/users/user.ts`,
`backend/src/cli/set-user-role.ts`, `backend/src/domain/rules/stake.ts` (commentaires) ;
`backend/src/routes/index.ts`, `backend/src/routes/{detection-admin,admin-settings,tournament}.routes.ts`
(ajout de `requireAdminSession`), `backend/src/app.ts`, `backend/src/server.ts`,
`backend/src/config/env.ts`, `backend/.env.example`,
`backend/src/services/payments/payment.service.ts` (une méthode ajoutée),
`backend/src/middleware/api-errors.ts` (nouveaux codes), tests existants des routes admin
(connexion par la session admin) ; docs listées en §11.2. Plusieurs portent déjà des
modifications non commitées : mes changements s'y ajoutent sans rien retirer.

**Jamais exécuté sans autorisation** : migration sur une base partagée ou de production,
commit, push, changement de branche, déploiement, appel CinetPay réel, `git reset`,
`git clean`, restauration de fichiers.
