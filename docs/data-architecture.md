# Architecture des données — PostgreSQL + Redis

> Statut : architecture validée (octobre 2026, D-022 à D-026). PostgreSQL et Redis sont
> branchés dans le backend ; seule la persistance des **parties** existe à ce stade. Les
> domaines utilisateurs, finance et tournois sont décrits ici comme **cible** : leurs tables
> ne sont pas créées et leurs règles métier restent à clarifier ([TODO.md](TODO.md)).

## 1. Rôles

| Composant | Rôle | Ce qu'il n'est pas |
|---|---|---|
| **PostgreSQL** | Source persistante de vérité : parties, et demain comptes, portefeuilles, transactions, tournois, classements, audit | Un bus temps réel |
| **Redis** | Infrastructure rapide et volatile : diffusion inter-instances (Pub/Sub), puis présence, cache court terme, coordination si nécessaire | Une source de vérité. Aucune donnée métier n'existe seulement dans Redis |
| **Mémoire du processus** | Copie de travail d'**une** commande ; registres par `gameId` (file, timer, abonnés locaux) | Un cache d'état partagé |

MongoDB n'est plus utilisé (D-022).

## 2. Vue cible

```
                    MOBILE (Expo)
                       │  REST + temps réel
                       ▼
                Node.js / Express  (N instances)
                       │
             ┌─────────┴─────────┐
             │                   │
        Game Engine          Services métier
     (domain/, pur)      (comptes, finance, tournois…)
             │                   │
      GameRepository      autres dépôts (ports)
             │                   │
             └─────────┬─────────┘
                       ▼
                  PostgreSQL ── SOURCE OF TRUTH
                       │
          ┌────────────┼──────────────┐
          │            │              │
        Users        Games          Finance
          │       (games,            ├── Wallets
          │      game_players)       ├── Transactions
          │       Game A, B, C…      └── Payments (Mobile Money)
          │
     Tournaments ── Rankings ── Audit

                     Redis  (volatile)
                       │
           ┌───────────┼────────────┐
           │           │            │
        Pub/Sub      Cache     Coordination
           │        (si besoin)  (si besoin)
           ▼
   Instances WebSocket (abonnées aux seules parties suivies localement)
```

Le domaine ne dépend d'aucune infrastructure :

```
Game Engine (domain/) → GameService → GameRepository (port) → PostgresGameRepository → SqlClient → pg
                                    → GameEventPublisher (port) → PubSubGameEventBus → PubSubTransport → Redis
```

## 3. PostgreSQL

### 3.1 Accès

- Pilote `pg` (node-postgres), **sans ORM** (D-022). Les dépôts dépendent du port `SqlClient`
  (`backend/src/database/sql-client.ts`) : `query` paramétrée et `transaction`.
- Requêtes **toujours paramétrées** (`$1`, `$2`…). `parseGameId` valide en plus tout
  `gameId` externe avant la moindre requête.
- Les dates sont transmises en ISO 8601 UTC ; les colonnes sont en `timestamptz`.
- Configuration : `DATABASE_URL` (`backend/.env`). Pool ouvert au démarrage, vérifié par
  `SELECT 1`. `/api/health` → `database` : `disconnected` | `connected` | `unavailable`.

### 3.2 Schéma actuel (migrations `0001` à `0003`, D-025, D-029)

```
games                                      game_players
├── id               uuid PK               ├── game_id   uuid FK → games (CASCADE)
├── version          integer ≥ 1           ├── player_id uuid FK → users
│                                          ├── active    boolean (statut ≠ finished)
├── status           waiting|in_progress|  ├── seat      smallint 0..3, unique par partie
│                    finished              ├── joined_at timestamptz
├── creator_id       uuid FK → users       └── fled_at   timestamptz
├── max_players      smallint 2..4         PK (game_id, player_id)
├── stake_amount     bigint ≥ 0 (unité : R-13)
├── state            jsonb  { play?, result?, recentCommandIds }
├── created_at, updated_at, started_at, finished_at   timestamptz
└── turn_deadline_at timestamptz
```

Comptes et sessions (`0002`, D-029, détail dans [authentication.md](authentication.md)) :

```
users                                      refresh_tokens
├── id             uuid PK                 ├── id             uuid PK
├── first_name, last_name  text            ├── user_id        uuid FK → users (CASCADE)
├── email          text unique (minusc.)   ├── session_id     uuid  (= sid du JWT)
├── username       text unique (casse ign.)├── token_hash     text unique (SHA-256)
├── phone          text unique (E.164)     ├── created_at, expires_at
├── phone_verified boolean                 ├── revoked_at, revoked_reason
├── password_hash  text (bcrypt)           └── UNIQUE (user_id) WHERE revoked_at IS NULL
├── role 'user' · status active|disabled       → une seule session active (R-32)
└── created_at, updated_at
```

Sessions (`0005`, D-033) :

```
sessions                                   session_players
├── id          uuid PK                    ├── session_id uuid FK → sessions (CASCADE)
├── version     integer ≥ 1                ├── player_id  uuid FK → users
├── status      open | closed              ├── seat       integer (ordre ANTIHORAIRE), unique
├── creator_id  uuid FK → users            ├── active, joined_at, left_at
└── created_at, updated_at, closed_at      └── PK (session_id, player_id)

games      + session_id (NOT NULL, FK), first_player_id (NOT NULL, J1), winner_id
game_players + table_position (place de session copiée : ordre figé dans l'historique)
```

Capacité, sièges, décisions et timers (`0006`, D-034) :

```
sessions        + max_players smallint 2|3|4, NOT NULL, IMMUABLE (trigger)
session_players   seat = siège FIXE 0..max_players-1 ; unique parmi les PRÉSENTS seulement
                  (siège vacant réutilisable) ; trigger : seat < max_players

session_decision_rounds                    session_decisions
├── game_id     uuid PK FK → games         ├── game_id    uuid FK → rounds (CASCADE)
├── session_id  uuid FK → sessions         ├── player_id  uuid FK → users
├── opened_at   timestamptz (= fin partie) ├── choice     continue | leave | auto_leave
├── deadline_at timestamptz (+ 10 s)       ├── decided_at timestamptz
└── resolved_at timestamptz                └── PK (game_id, player_id)

games      + turn_started_at, active_player_id (FK users), turn_timed_out_at
             CHECK : échéance ⇒ début, échéance > début
```

Fin de partie et reprise (`0007`, D-035) :

```
games      + end_reason  INSTANT_WIN | CONTROL_AFTER_LAST_TRICK | INSTANT_WIN_TIE | ADMIN_STOP
                         présent ssi status = finished ; gagnant ssi victoire (CHECK)
           + replay_of_game_id uuid FK → games : partie annulée pour égalité qu'elle rejoue
```

| Index | Usage |
|---|---|
| `games (id)` (clé primaire) | Accès par `gameId` |
| `games (session_id) WHERE status <> 'finished'`, **unique** | Une seule partie active par session (D-033) |
| `games (session_id, finished_at DESC) WHERE status = 'finished'` | Dernière partie terminée (J1) |
| `games (status, created_at DESC)` | Lobby |
| `game_players (player_id)` | Parties actives d'un joueur (reconnexion) |
| `game_players (player_id) WHERE active`, **unique** | R-18 : une seule partie active par joueur, même en concurrence (0004) |
| `games (creator_id, creation_key)`, **unique** | Idempotence de la création (`Idempotency-Key`, 0004) |
| `games (turn_deadline_at)` partiel, `status = 'in_progress'` | Réarmement des timers de tour au redémarrage |
| `games (turn_timed_out_at)` partiel, `status = 'in_progress'` | Coups automatiques en attente (reprise) |
| `session_players (session_id, seat) WHERE active`, **unique** | Un joueur présent par siège ; sièges vacants réutilisables (0006) |
| `session_players (player_id) WHERE active`, **unique** | Une seule session active par joueur, même en concurrence (0006) |
| `session_decision_rounds (session_id) WHERE resolved_at IS NULL`, **unique** | Au plus une ronde de décision ouverte par session |
| `session_decision_rounds (deadline_at) WHERE resolved_at IS NULL` | Réarmement des timers de décision au redémarrage |
| `games (replay_of_game_id)` partiel, **unique** | Une partie annulée pour égalité n'est rejouée qu'une fois (0007) |

Pourquoi `state` en JSONB : l'état de jeu (paquet, mains, plis, contrôle) est petit, borné,
propre à une partie, et toujours lu et écrit d'un bloc. Les joueurs, eux, seront reliés aux
comptes, aux mises et aux transactions : ils sont dans une table.

### 3.3 Concurrence

```sql
BEGIN;
UPDATE games SET version = $3, … WHERE id = $1 AND version = $2;  -- 0 ligne → conflit
-- alignement de game_players (DELETE des absents, INSERT … ON CONFLICT DO UPDATE)
COMMIT;
```

Sous `READ COMMITTED`, deux écritures concurrentes de la même version se sérialisent sur le
verrou de la ligne : la seconde ne modifie aucune ligne et lève `GameVersionConflictError`.
Cela vaut **entre instances** : aucune écriture n'est perdue, même sans verrou distribué.

### 3.4 Migrations (D-026)

- `backend/migrations/NNNN_description.sql`, appliquées par `npm run db:migrate`
  (`npm run db:migrate:prod` après `npm run build`).
- Une seule transaction pour toutes les migrations en attente, sous verrou consultatif.
- `schema_migrations` garde le nom et l'empreinte SHA-256 : une migration appliquée ne se
  modifie jamais, on en ajoute une nouvelle.
- Le serveur ne migre pas au démarrage : c'est une étape explicite du déploiement.

### 3.5 Domaines à venir (cible, non créés)

| Domaine | Tables pressenties | Bloqué par |
|---|---|---|
| Comptes | ~~`users`, sessions~~ : faits (D-029). Appareils : à définir | — |
| Finance | portefeuilles, transactions, paiements Mobile Money | R-02, R-05, R-09, R-13, R-16 ; T-07 (conformité) |
| Tournois | tournois, inscriptions, jetons, classements, récompenses | R-11, R-13 |
| Audit | journal append-only des événements de partie et des opérations financières | — (à concevoir) |

Orientations techniques pour la finance, à confirmer par une décision au moment de la
conception : montants entiers (`bigint`, jamais de flottants), écritures financières
immuables, chaque mouvement d'argent et le résultat de partie qui le cause dans **la même
transaction** PostgreSQL, idempotence des callbacks de paiement par une clé unique.

## 4. Redis (D-024)

### 4.1 Usage actuel : diffusion inter-instances

```
Instance 1                            Redis                         Instance 2
GameService.mutate                                                  
  → save (PostgreSQL, versionné)                                    
  → PubSubGameEventBus.publish ──► le-ter:game:{gameId}:events ──► PubSubGameEventBus
                                         │                            → hub local (salles game:{gameId})
                                         └──► (instance 1 aussi) ──►    → connexions des joueurs
```

- Un canal par partie : `gameEventChannel(gameId)` (`websocket/game-rooms.ts`).
- Une instance ne s'abonne au canal d'une partie que tant qu'une de ses connexions la suit.
- L'instance qui publie reçoit aussi son message : un seul chemin de livraison.
- Un message dont le `gameId` diffère de celui du canal est ignoré.
- Événements privés : routés dans le canal de la partie, remis au seul destinataire par le
  hub local. Redis doit donc rester privé (réseau interne, ACL, `rediss://`).
- Connexions : une pour les commandes et `PUBLISH`, une dédiée aux abonnements.

### 4.2 Pannes

| Panne | Effet | Pourquoi aucune corruption |
|---|---|---|
| Redis injoignable au démarrage (configuré) | Le serveur refuse de démarrer | Configuration explicite non respectée |
| Redis coupé en cours de route | Commandes **acceptées et enregistrées** ; diffusion locale seulement ; reconnexion automatique | PostgreSQL est écrit avant toute publication ; publier ne lève jamais d'erreur |
| Message perdu (Pub/Sub sans persistance) | Un client voit un trou de version | Le client relit l'état (version) depuis l'API |
| PostgreSQL injoignable | Les commandes échouent | Rien n'est diffusé sans écriture réussie |

### 4.3 Usages futurs (à introduire seulement si justifiés)

| Usage | Déclencheur |
|---|---|
| Adaptateur du transport temps réel (ex. adaptateur Redis de Socket.IO) | Choix du transport (T-01) |
| Présence (joueur connecté, sur quelle instance) | Gestion des déconnexions (R-24) |
| Cache court terme (lobby, classements) | Charge mesurée |
| Timers distribués | Plusieurs instances sans affinité par `gameId` (T-08) |
| Verrous distribués | Seulement si la version optimiste ne suffit plus |

## 5. Développement local

```bash
cd backend
docker compose up -d     # PostgreSQL 18 + Redis 8 (identifiants factices, localhost)
# backend/.env :
#   DATABASE_URL=postgres://le_ter:le_ter@localhost:5432/le_ter
#   REDIS_URL=redis://localhost:6379
npm run db:migrate
npm run dev
```

Sans `DATABASE_URL` ni `REDIS_URL`, le serveur démarre quand même (phase de fondation).

## 6. Tests

| Fichier | Vérifie |
|---|---|
| `tests/fixtures/game-repository.contract.ts` | Contrat de `GameRepository`, exécuté sur la mémoire **et** sur PostgreSQL |
| `tests/integration/database/postgres-game.repository.test.ts` | Contrat + stockage (tables, JSONB), transaction annulée, contraintes |
| `tests/integration/database/migrator.test.ts` | Ordre, idempotence, annulation, empreinte, base plus récente refusée |
| `tests/unit/websocket/pubsub-game-event-bus.test.ts` | Diffusion entre instances, événements privés, isolation, canal ≠ gameId, panne Redis |
| `tests/integration/game/multi-instance.test.ts` | Deux `GameService` + PostgreSQL + Pub/Sub : diffusion, commandes concurrentes sans perte, panne Redis, isolation |

PostgreSQL est exécuté par **PGlite** (vrai moteur PostgreSQL en WASM, en mémoire) : aucun
serveur ni Docker n'est nécessaire pour `npm test`. Redis est simulé par un courtier en
mémoire (`tests/fixtures/in-memory-pubsub.ts`) qui respecte ses garanties (asynchrone,
ordonné, sans persistance). Un test d'intégration contre un vrai Redis reste à ajouter avec
la CI.
