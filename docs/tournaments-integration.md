# Module Tournois — rapport d'intégration (D-051, D-054, D-055, D-056)

> Statut au 2026-10-09 : rien n'est commité. Ce document prépare le commit et le déploiement
> du module sans écraser le travail des autres sessions présent dans le même répertoire.

## 1. Migrations : inventaire, ordre, dépendances

Le migrateur (`src/database/migrator.ts`) applique les fichiers `NNNN_nom.sql` dans l'ordre
**alphabétique**, en **une seule transaction** (tout ou rien), sous verrou consultatif. Il
refuse de démarrer si une migration enregistrée n'existe plus dans le code (nom inconnu) ou
si une migration déjà appliquée a été modifiée (empreinte SHA-256). Il n'impose pas la
continuité des numéros.

| Fichier | Suivi git | Domaine (session) | Dépend de |
|---|---|---|---|
| 0001 → 0007 | oui | parties, comptes, sessions | — |
| 0008_session_players_arrival | **non** | sessions (D-037) | 0005 |
| 0009_session_name_password | **non** | partie privée (D-039) | 0005 |
| 0010_wallets | **non** | compte de jeu (D-040) | 0002 |
| 0011_session_suspicion_detection | **non** | détection (D-043) | 0005 |
| 0012 → 0016 (detection_*) | **non** | détection (D-044 à D-048) | 0001, 0002 |
| 0017_admin_role_and_audit | **non** | administration détection (D-049) | 0002 |
| 0017_payments | **non** | CinetPay (D-050) | 0010 |
| 0019_tournaments | **non** | **Tournois** (D-051) | 0002, 0005 |
| 0020_detection_global_switch | **non** | détection (D-053) | 0017_admin_role_and_audit |
| 0021_tournament_finance | **non** | **Tournois** (D-054) | 0010, 0017_admin_role_and_audit, 0019, 0020 |
| 0022_tournament_table_closed_notification | **non** | **Tournois** (D-056) | 0021 |
| 0025_tournament_weighted_ranking | **non** | **Tournois** : classement pondéré (D-062) | 0021, 0024 |
| 0026_tournament_table_auto_start | **non** | **Tournois** : démarrage des tables à 20 s (D-065) ; ajout de 2 colonnes à `games`, aucune donnée modifiée | 0001 |
| 0043_tournament_closure_results | oui (cette session) | **Tournois** : rattachement explicite `games.tournament_id`, méthode de classement figée au démarrage, audit et immuabilité du classement, clôture sans annulation forcée (D-106) ; ajouts et triggers, parties existantes rattachées | 0021, 0025, 0026 |
| 0048_tournament_thank_you_notification | oui (cette session) | **Tournois** : remerciement de fin de tournoi (D-117) ; colonne `notifications.available_at` (NULL = visible dès la création) et type `TOURNAMENT_THANK_YOU` ; aucune donnée modifiée | 0021, 0047 |

Constats :

- Deux fichiers `0017_*` (deux sessions) : sans conflit (tables distinctes) ; ordre
  alphabétique `admin_role_and_audit` puis `payments`. Aucun `0018` : sans effet.
- Toutes les dépendances sont satisfaites par l'ordre alphabétique (vérifié : base PGlite
  vierge migrée de 0001 à 0022 dans chaque suite de tests).
- 0021 modifie des contraintes créées par d'autres sessions (`system_settings_key_check` de
  0020, `admin_audit_log_*_check` de 0017/0020, `wallet_transactions_kind_check` de 0010) :
  elle doit rester APRÈS elles, ce que l'ordre garantit.
- Le fichier 0019 s'est appelé `0017_tournaments.sql` pendant une dizaine de minutes le
  2026-10-08. Si une base l'avait appliqué sous ce nom, le migrateur s'arrêterait sans rien
  modifier (« Migrations appliquées absentes du code ») : il faudrait alors une décision
  manuelle (aucune n'a été prise, aucun cas constaté).
- **État de la base réelle : NON vérifié** (aucune connexion à la base de l'application).
  Vérification en lecture seule : `SELECT name, applied_at FROM schema_migrations ORDER BY name;`.

### Application (à faire par l'exploitation, jamais pendant l'audit)

1. Sauvegarde de la base.
2. `npm run db:migrate` (développement) ou `npm run db:migrate:prod` après `npm run build`.
3. Contrôle : `schema_migrations` contient 0001 → 0022 (y compris les deux 0017).
4. Démarrer le serveur ensuite : sans 0019, `GET /api/sessions/open` échoue (requête sur
   `tournament_sessions`) ; sans 0021/0022, les routes de tournoi et le planificateur échouent.

## 2. Fichiers propres au module (non suivis, créés par cette session)

Backend :

- `migrations/0019_tournaments.sql`, `0021_tournament_finance.sql`,
  `0022_tournament_table_closed_notification.sql`
- `src/domain/tournaments/tournament.ts`
- `src/repositories/tournament.repository.ts`, `postgres-tournament.repository.ts`,
  `wallet-reservations.ts`
- `src/services/tournaments/` (`tournament.service.ts`, `tournament-admission.ts`,
  `tournament-scheduler.ts`, `tournament-export.ts`), `src/services/notifications/`
- `src/controllers/tournament.controller.ts`, `tournament-admin.controller.ts`
- `src/routes/tournament.routes.ts`, `notification.routes.ts`
- `src/middleware/tournament-errors.ts`, `src/validators/tournament.validators.ts`
- `src/cli/tournament-create.ts`
- `tests/fixtures/tournaments.ts`, `tests/unit/tournaments/`, `tests/integration/tournaments/`,
  `tests/integration/wallet/wallet-reservations.test.ts`

Frontend :

- `app/tournament/index.tsx`, `app/tournament/propose.tsx`, `app/admin/tournaments/`
- `src/features/tournaments/`, `src/features/admin/tournaments/`
- `src/services/tournaments-api.ts`, `src/services/admin-tournaments-api.ts`,
  `src/types/tournament.ts`, `src/features/lobby/balance-label.test.tsx`

Documentation : `docs/tournaments-integration.md` (ce fichier).

## 3. Fichiers partagés modifiés par le module (intégration ciblée)

Ces fichiers contiennent AUSSI le travail d'autres sessions : relire le diff ligne à ligne
avant de les commiter (git ne distingue pas les auteurs dans un fichier non commité).

| Fichier | Modification du module |
|---|---|
| `backend/src/services/sessions/session.service.ts` | dépendances facultatives `admission` et `continuation` ; option `tournamentId` de `createSession` ; refus de la partie suivante par la politique |
| `backend/src/repositories/session.repository.ts`, `postgres-session.repository.ts` | `createWithFirstGame(…, tournament?)` : verrou du tournoi, contrôle, rattachement dans la même transaction ; tables de tournoi exclues de `findOpenTables` |
| `backend/src/services/game/create-game-service.ts` | assemblage tournois, planificateur, notifications, politiques |
| `backend/src/routes/index.ts`, `src/app.ts`, `src/server.ts` | montage `/tournaments`, `/admin/tournaments`, `/notifications` ; démarrage et arrêt du planificateur |
| `backend/src/middleware/api-errors.ts` | appel de `toTournamentApiError` |
| `backend/package.json` | scripts `tournament:create`, `tournament:create:prod` |
| `backend/src/domain/wallet/wallet.ts`, `repositories/wallet.repository.ts`, `postgres-wallet.repository.ts`, `services/wallet/wallet.service.ts` | types `tournament_entry` / `tournament_prize` ; retrait sur le DISPONIBLE ; `getBalances` ; vue `reserved` / `available` |
| `backend/tests/integration/database/migrator.test.ts`, `tests/integration/wallet/wallet-api.test.ts` | nouvelles tables, nouveaux champs |
| `frontend/app/_layout.tsx` | routes `tournament/propose`, `admin/tournaments/*` |
| `frontend/src/features/admin/AdminScreen.tsx` | bouton « Tournois » |
| `frontend/src/features/tournaments/TournamentScreen.tsx` | widget et lien « Proposer un tournoi » |
| `frontend/src/features/lobby/LobbyUi.tsx`, `src/lib/i18n/fr.ts`, `en.ts` | HUD : disponible + réservé (`balanceWithReserved`) |
| `frontend/src/types/wallet.ts` | champs facultatifs `reserved`, `available` |
| `docs/decisions.md`, `docs/TODO.md` | D-051, D-054, D-055, D-056 ; R-11, R-13 |

Tout autre fichier modifié ou non suivi du dépôt appartient aux autres sessions (paiements,
détection, chat, réglages, i18n, compte de jeu de base) et n'a pas été touché par le module.

## 4. Commit proposé (non effectué)

1. Commit des migrations et du compte de jeu de base (sessions D-040, D-050) AVANT le module,
   puisque 0021 en dépend.
2. Commit du module : fichiers de la section 2 + hunks du module dans les fichiers de la
   section 3 (`git add -p`).
3. Vérifier ensuite `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`
   (backend) et `npm test`, `npm run lint`, `npx tsc --noEmit` (frontend).

## 5. Tests PostgreSQL réel

`tests/integration/tournaments/postgres-tournament-concurrency.test.ts` (inscriptions
simultanées et capacité, double inscription, solde partagé entre deux tournois, attribution
des tables sur deux instances) s'exécute seulement si `TEST_DATABASE_URL` désigne une base de
TEST dédiée, distincte de `DATABASE_URL`. Il crée un schéma temporaire, y applique toutes les
migrations et le supprime à la fin. Exécuté le 2026-10-09 (session parallèle) sur la base de
test dédiée `le_ter_test`, jamais sur `le_ter` : il a d'abord révélé un conflit de version
entre deux instances lors de l'entrée dans la partie d'une table (corrigé, voir D-065), puis
3 suites, 29/29 réussis avec la correction ; schémas temporaires supprimés.

Pour l'exécuter : créer une base vide dédiée (ex. `le_ter_test`) sur un serveur PostgreSQL de
test, puis `TEST_DATABASE_URL=postgres://…/le_ter_test npm test -- tests/integration/tournaments/postgres-tournament-concurrency.test.ts`.

## 6. Clôture et résultats globaux (D-106, 2026-10-15)

- Migration **0043** à appliquer après 0042 (`npm run db:migrate`, après sauvegarde). Elle
  rattache les parties existantes des tables de tournoi (`games.tournament_id`), marque les
  tournois déjà démarrés `D062_SATURATING` et pose les triggers d'immuabilité. Aucune donnée
  n'est supprimée.
- Après 0043, le serveur doit être redémarré avec le nouveau code : l'ancien code démarrerait un
  tournoi sans méthode de classement, ce que la contrainte `tournaments_ranking_method_when_started`
  refuse (démarrage retenté, puis annulé `SYSTEM_ERROR` après 15 min, réservations libérées).
- Règles, API et écrans : voir D-106 dans `docs/decisions.md`.
