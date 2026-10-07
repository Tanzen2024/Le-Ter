# Journal des décisions — Le Ter

Format : chaque décision indique son contexte, la décision et ses conséquences.
Une décision n'est remplacée que par une nouvelle entrée qui la cite.

---

## D-001 — `docs/` est la source de vérité

- **Date** : 2026-10-07 · **Statut** : validée
- **Contexte** : les spécifications fonctionnelles et techniques ainsi que les diagrammes UML
  décrivent le produit. Le code doit s'y conformer.
- **Décision** : `docs/` est la référence. Aucun document n'est supprimé ni déplacé.
  `docs/` est suivi par Git.
- **Conséquences** : toute règle métier ambiguë est consignée dans [TODO.md](TODO.md) comme
  « À CLARIFIER » et n'est pas résolue par une hypothèse dans le code.
- **Note** : `docs/` n'était pas suivi auparavant. Aucune règle `.gitignore` ne l'excluait :
  le dossier avait été ajouté après le commit initial (généré par le template Expo) et n'avait
  jamais été ajouté avec `git add`.

## D-002 — Frontend séparé du backend

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : deux applications indépendantes, `frontend/` et `backend/`, dans le même dépôt.
- **Conséquences** : chaque application a ses dépendances, ses scripts et ses tests. Le
  projet Expo initialement à la racine a été déplacé dans `frontend/` (`git mv`, historique conservé).

## D-003 — Frontend en Expo / React Native

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : Expo SDK 57, React Native 0.86.3, React 19.2.3, TypeScript.
  Bibliothèques retenues : Expo Router 57, Zustand 5, TanStack Query 5, Reanimated 4.7.1.
- **Conséquences** : les dépendances s'ajoutent avec `npx expo install`. Les dossiers natifs
  `ios/` et `android/` sont générés (CNG) et ne sont pas versionnés.

## D-004 — Expo Router dans `frontend/app/`

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : les routes sont dans `frontend/app/`. Le code non-route est dans `frontend/src/`.
  `frontend/src/app/` ne doit pas exister.
- **Conséquences** : `AGENTS.md` a été mis à jour (il indiquait `src/app/`). Point d'entrée :
  `"main": "expo-router/entry"` ; `app.json` déclare `scheme: "leter"` et le plugin `expo-router`.
  L'ancien template (`App.tsx`, `index.ts`) a été supprimé.

## D-005 — Séparation `features` / `domain` / `services` côté frontend

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : `app/` ne contient que des écrans fins ; `src/features/` regroupe la logique par
  fonctionnalité ; `src/domain/` les types et la logique d'affichage ; `src/services/` les accès
  réseau ; `src/stores/` l'état client.
- **Conséquences** : les écrans restent simples et les fonctionnalités testables isolément.

## D-006 — Backend en Node.js / Express / TypeScript

- **Date** : 2026-10-07 · **Statut** : validée
- **Contexte** : la spécification technique impose Node.js + Express. Un premier backend en
  JavaScript avait été créé.
- **Décision** : backend en **TypeScript strict** (TypeScript 6.0, comme le frontend), Express 5,
  `tsx` pour le développement, Jest + ts-jest + Supertest, ESLint + typescript-eslint, Prettier.
  Le backend JavaScript a été converti ; `GET /api/health` et son test ont été conservés.
- **Conséquences** :
  - TypeScript est fixé à `~6.0.3` : TypeScript 7 existe, mais `typescript-eslint` exige
    `< 6.1` et `ts-jest` exige `< 7`.
  - Configuration lue depuis les variables d'environnement via le chargeur natif de Node
    (`process.loadEnvFile`), sans dépendance `dotenv`.
  - Les fichiers de configuration d'outils (`eslint.config.mjs`) restent en JavaScript module :
    un fichier `.ts` demanderait la dépendance supplémentaire `jiti`.

## D-007 — Pas de workspace npm à ce stade

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : pas de `package.json` racine, pas de workspace. Chaque application a son
  `package.json`, son `package-lock.json` et son `node_modules`.
- **Raison** : éviter les conflits React / React Native / Metro (hoisting, doublons de `react`)
  et garder deux applications indépendantes. La racine est un conteneur de projet et de documentation.

## D-008 — Backend server-authoritative

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : le backend est l'autorité sur toutes les règles critiques (distribution, coups
  valides, gains, mises, soldes, tournois). Le client envoie des intentions, le serveur valide.
- **Conséquences** : le domaine métier officiel vit dans `backend/src/domain/` (logique pure,
  sans Express ni MongoDB). Chaque joueur ne reçoit que sa propre main.

## D-009 — Pas de dossier `shared/` pour l'instant

- **Date** : 2026-10-07 · **Statut** : validée (provisoire)
- **Décision** : pas de `shared/` et pas de duplication des règles. Le frontend possède les types
  nécessaires à l'UI ; le backend possède le domaine officiel.
- **À revoir** : une fois le modèle de domaine stabilisé, décider de la stratégie de partage des types.

## D-010 — MongoDB : configuration seulement

- **Date** : 2026-10-07 · **Statut** : remplacée par D-022
- **Décision** : Mongoose est installé ; `backend/src/config/database.ts` gère connexion,
  déconnexion et état. L'URI vient de `MONGODB_URI` (`backend/.env`, modèle dans `.env.example`).
  Aucune collection métier n'est créée.
- **Conséquences** : si `MONGODB_URI` est vide, le serveur démarre sans base (phase de fondation)
  et `/api/health` renvoie `"database": "disconnected"`. Aucune URI réelle n'est versionnée.

## D-011 — Une partie est une unité d'isolation indépendante

- **Date** : 2026-10-07 · **Statut** : validée
- **Contexte** : plusieurs parties (des dizaines à des milliers) doivent se dérouler en même
  temps. Une action dans une partie ne doit jamais modifier une autre partie.
- **Décision** : la partie (`Game`) est l'unité d'isolation. Toute opération (commande,
  lecture, abonnement, événement, timer, log) porte un `gameId` explicite. Il n'y a aucun état
  global mutable de jeu, seulement des registres indexés par `gameId`. Le dépôt ne partage
  jamais de référence (copies profondes).
- **Conséquences** : `GameService` est le point d'entrée unique de toute modification. Tests
  d'isolation obligatoires (`tests/integration/game/multi-game-isolation.test.ts`).
  Détails : [multi-game-architecture.md](multi-game-architecture.md).

## D-012 — `gameId` = ObjectId MongoDB

- **Date** : 2026-10-07 · **Statut** : remplacée par D-023
- **Options étudiées** : ObjectId, UUID v4 dans un champ dédié, ObjectId + code public court.
- **Décision** : `gameId` est le `_id` du document `games`, en 24 caractères hexadécimaux.
  Il n'y a pas d'identifiant public séparé.
- **Raison** : natif, unique sans coordination, déjà indexé. Sa prévisibilité n'est pas un
  risque, car la sécurité repose sur le contrôle d'appartenance côté serveur et non sur le
  secret de l'identifiant (le lobby rend de toute façon les parties publiques).
- **Conséquences** : types marqués `GameId` et `PlayerId`. `parseGameId` valide toute entrée
  externe avant une requête MongoDB. Un code de partage court pourra être ajouté plus tard
  sans changer `gameId`.

## D-013 — Concurrence : file par partie + version optimiste + idempotence

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** :
  1. Les commandes d'une même partie sont sérialisées (`KeyedSerialQueue` par `gameId`),
     celles de parties différentes s'exécutent en parallèle.
  2. Chaque écriture est conditionnée à la version lue (`save(game, expectedVersion)`,
     `GameVersionConflictError` sinon).
  3. Chaque commande client porte un `commandId` : une double soumission est ignorée.
     `expectedVersion` est optionnel pour refuser une action basée sur un état périmé.
- **Écarté pour l'instant** : verrous distribués, event sourcing, file de messages externe.
- **Conséquences** : l'ordre officiel des événements d'une partie est celui de sa file.
  Le contrôle d'appartenance passe avant la détection de doublon.

## D-014 — Temps réel : une salle par partie, transport abstrait

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : salle `game:{gameId}` pour les événements publics, `game:{gameId}:chat` pour
  le chat, envoi ciblé au joueur dans le contexte de sa partie pour les événements privés.
  Chaque événement a une enveloppe avec `gameId` et `version` obligatoires. L'abonnement
  passe par `GameService.subscribe`, qui contrôle l'appartenance.
- **Conséquences** : le code dépend du port `GameEventPublisher` / `GameEventSubscriber`.
  Le choix du transport (Socket.IO, ws, Firebase) reste ouvert (TODO T-01).
  `InMemoryGameEventHub` est l'implémentation de référence testée.

## D-015 — Timers : un timer par partie, expiration via la file

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : `GameTimerRegistry` (`Map<GameId, Timeout>`), un timer au plus par partie,
  sans aucun timer global. L'échéance est persistée dans `turnDeadlineAt`. L'expiration
  soumet une commande dans la file de la partie et n'a d'effet que si la version n'a pas
  changé depuis l'armement. Terminer une partie annule son timer.
- **Non décidé** : durée, effet de l'expiration, pause pendant une déconnexion (R-06, R-24).

## D-016 — MongoDB : un document par partie dans `games`

- **Date** : 2026-10-07 · **Statut** : remplacée par D-025
- **Décision** : une collection `games`, un document par partie, état de jeu embarqué
  (joueurs, et plus tard paquet, mains et plis). Index prévus : `{ status, createdAt }` (lobby),
  `{ "players.playerId", status }` (reconnexion), `{ turnDeadlineAt }` partiel (timers).
  Pas de cache, MongoDB est la source de vérité et chaque commande relit le document.
- **Raison** : état petit, borné, toujours lu et écrit d'un bloc. Un seul document donne des
  écritures atomiques et une concurrence optimiste simple.
- **Conséquences** : le modèle Mongoose n'est pas encore créé. `GameRepository` fixe le
  contrat. `game_events` (audit) et `chat_messages` restent à évaluer.

## D-017 — Frontend : partie identifiée par la route, sans `currentGame`

- **Date** : 2026-10-07 · **Statut** : validée (à implémenter)
- **Décision** : route `frontend/app/game/[gameId].tsx`. L'état serveur est dans TanStack Query,
  avec des clés paramétrées par `gameId` (`['games', gameId]`). Les événements temps réel sont
  filtrés par `gameId` et `version`. L'état d'UI propre à une partie est dans un store Zustand
  indexé par `gameId`. Il n'y a pas de `currentGame` global.
- **Conséquences** : un seul socket pour l'application, abonnements par partie gérés par un
  hook lié au cycle de vie de l'écran.

## D-018 — Moteur du Ter : domaine pur, règles ambiguës injectées

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : le moteur (`backend/src/domain/cards`, `domain/game/ter-engine.ts`,
  `domain/rules`) est indépendant d'Express, de MongoDB, du temps réel et de React. Le hasard
  (`RandomSource`) et l'heure sont injectés. Les règles certaines sont codées en dur. Chaque
  règle ambiguë est une politique du `TerRuleSet`, **sans valeur par défaut**. Une situation non
  définie lève `UnresolvedRuleError`.
- **Conséquences** : il n'existe pas encore de jeu de règles de production. `GameService` refuse
  les commandes de jeu sans `rules`. Les interprétations candidates (`rule-candidates.ts`) ne
  sont utilisées que par les tests (`tests/fixtures/rules.ts`, « hypothèses de test »). Choisir
  une règle se fera par une nouvelle décision. Détails : [game-domain.md](game-domain.md).

## D-019 — Cartes identifiées par une chaîne `FAMILLE-VALEUR`

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : l'état stocke des `CardId` (par exemple `"PIQUE-7"`), pas des objets.
  `parseCardId` valide toute carte venant de l'extérieur.
- **Raison** : état sérialisable tel quel dans MongoDB, aucune référence d'objet partagée entre
  parties, comparaison et recherche triviales.

## D-020 — Hasard cryptographique en production

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : le mélange utilise `crypto.randomInt` (`utils/crypto-random-source.ts`),
  sans biais de modulo. `Math.random()` n'est jamais utilisé par le domaine.
- **Raison** : de l'argent réel dépend du mélange. Les tests injectent des sources
  déterministes, sans dépendance externe.

## D-021 — Terminologie : partie, tour, coup

- **Date** : 2026-10-07 · **Statut** : validée (terminologie technique)
- **Décision** : une partie (`Game`) contient une distribution et 5 tours (`trick`, le « tour »
  de la spec §2.4). Un tour est composé de coups (`TrickPlay`). Les documents ne définissent
  aucune « manche » : aucun modèle « Round » n'est créé.
- **À confirmer** : un tour = une carte par joueur en jeu (R-29), et le contrôleur ouvre chaque
  tour (R-27). Ces deux points sont déduits des documents, pas énoncés.

## D-022 — PostgreSQL est la base principale ; MongoDB est abandonné

- **Date** : 2026-10-07 · **Statut** : validée · **Remplace** : D-010
- **Contexte** : Le Ter gérera des utilisateurs, des parties, des mises, des portefeuilles,
  des transactions, des dépôts et retraits Mobile Money, la Kora, des tournois, des
  classements, des récompenses, l'administration et l'audit. La partie financière exige des
  transactions ACID multi-tables, des contraintes d'intégrité, des relations, des index et un
  historique fiable. Aucun `MongoGameRepository` ni modèle Mongoose n'avait été créé.
- **Décision** : PostgreSQL est la **source persistante de vérité**. MongoDB et Mongoose sont
  retirés du backend (dépendance, configuration, `MONGODB_URI`, dossier `src/models/`).
  Accès par le pilote `pg` (node-postgres), **sans ORM**, derrière un port `SqlClient`
  (`src/database/sql-client.ts`). Requêtes toujours paramétrées.
- **Raison du « sans ORM »** : la partie financière demandera un contrôle explicite des
  transactions, des verrous (`SELECT … FOR UPDATE`) et des niveaux d'isolation. Le SQL reste
  lisible et revu tel quel. Un constructeur de requêtes typé (ex. Kysely) pourra être ajouté
  plus tard par une nouvelle décision, sans toucher au domaine.
- **Conséquences** :
  - Le domaine et `GameService` ne dépendent toujours que de `GameRepository`
    (`Game Engine → GameRepository → PostgresGameRepository`).
  - `DATABASE_URL` (vide = démarrage sans base, phase de fondation). Une base configurée mais
    injoignable bloque le démarrage. `/api/health` renvoie `database` : `disconnected`,
    `connected` ou `unavailable`.
  - Tests : PGlite (PostgreSQL compilé en WASM, en mémoire) exécute le vrai SQL sans serveur
    ni Docker. Jest tourne avec `--experimental-vm-modules`, requis par PGlite.
  - `backend/docker-compose.yml` (développement uniquement) fournit PostgreSQL 18 et Redis 8.

## D-023 — `gameId` = UUID

- **Date** : 2026-10-07 · **Statut** : validée · **Remplace** : D-012
- **Décision** : `gameId` est un UUID v4 en minuscules (`crypto.randomUUID`), clé primaire
  `uuid` de `games`. `parseGameId` n'accepte que la forme canonique en minuscules.
- **Raison** : l'ObjectId n'a plus de raison d'être sans MongoDB. L'UUID est natif dans
  PostgreSQL (16 octets), généré sans coordination, et imprévisible. La sécurité continue de
  reposer sur le contrôle d'appartenance, pas sur le secret de l'identifiant.
- **Écarté** : identifiant `bigserial` (exige un aller-retour en base pour connaître l'id,
  énumérable) ; UUID v7 (meilleure localité d'index, mais pas de générateur natif dans
  Node 22, et le volume d'insertion des parties ne le justifie pas aujourd'hui).
- **Conséquences** : aucune donnée existante à migrer (aucune partie n'était persistée).

## D-024 — Redis : infrastructure temps réel, jamais source de vérité

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : Redis est introduit comme composant d'infrastructure **rapide et
  volatile**. Usage immédiat : la diffusion des événements de partie entre instances
  (Pub/Sub, canal `le-ter:game:{gameId}:events`). Usages futurs, chacun introduit seulement
  quand il est justifié : présence, cache court terme, timers distribués, verrous
  distribués, files de coordination.
- **Règles** :
  1. Aucune donnée métier n'existe **uniquement** dans Redis. Toute écriture métier va
     d'abord dans PostgreSQL ; Redis ne fait que diffuser ou accélérer.
  2. Une panne Redis ne corrompt jamais PostgreSQL : la commande est enregistrée, puis la
     diffusion échoue sans lever d'erreur. L'événement est remis aux abonnés de l'instance
     locale ; les clients des autres instances détectent le trou de version et relisent
     l'état (D-014).
  3. Pas de file hors ligne (`disableOfflineQueue`) : pendant une coupure, une publication
     échoue tout de suite au lieu d'être rejouée en retard.
  4. Aucune persistance Redis n'est requise (RDB/AOF désactivés en développement).
- **Conséquences** :
  - `PubSubGameEventBus` implémente les ports existants `GameEventPublisher` /
    `GameEventSubscriber`. Une instance ne s'abonne au canal d'une partie que si une de ses
    connexions la suit. Il dépend d'un port `PubSubTransport` (Redis en production, courtier
    en mémoire dans les tests).
  - Le choix du transport client (Socket.IO, ws : T-01) reste ouvert ; il se branchera sur ce bus.
  - `REDIS_URL` vide : `InMemoryGameEventHub`, une seule instance. `/api/health` renvoie
    `redis` : `disconnected`, `connected` ou `unavailable`.
  - Les événements privés (main d'un joueur) transitent par Redis : Redis doit rester sur un
    réseau privé, avec authentification et TLS (`rediss://`) en production.
- **Pas encore** : verrous et timers distribués. La file par partie reste locale à une
  instance ; entre instances, la version optimiste détecte tout conflit (D-013, T-08).

## D-025 — Schéma des parties : ligne `games` + `game_players` + état JSONB

- **Date** : 2026-10-07 · **Statut** : validée · **Remplace** : D-016
- **Décision** :
  - `games` : une ligne par partie. Colonnes pour tout ce qui est interrogé, indexé ou
    contraint (`status`, `version`, `creator_id`, `max_players`, `stake_amount`, dates,
    `turn_deadline_at`). L'état de jeu interne (`play` : paquet, mains, plis, contrôle ;
    `result` ; `recentCommandIds`) est une colonne `state jsonb`, lue et écrite d'un bloc.
  - `game_players` : un siège par ligne (`game_id`, `player_id`, `seat`, `joined_at`,
    `fled_at`), clé `(game_id, player_id)`, siège unique par partie.
  - `save` = `UPDATE games … WHERE id = $1 AND version = $2`, puis alignement de
    `game_players`, dans **une** transaction. 0 ligne modifiée = `GameVersionConflictError`.
  - Index : `(status, created_at DESC)` (lobby), `game_players(player_id)` (reconnexion),
    `turn_deadline_at` partiel sur `in_progress` (réarmement des timers).
- **Raison** : les joueurs d'une partie seront reliés aux comptes, aux mises et aux
  transactions : ils sont relationnels. L'état de jeu, lui, est petit, borné, propre à une
  partie et n'est jamais interrogé morceau par morceau : le normaliser n'apporterait que des
  jointures. Le contrôle de version porte sur la ligne `games`, ce qui conserve la concurrence
  optimiste de D-013, y compris entre instances.
- **Conséquences** : `player_id` est un `text` tant que la table `users` n'existe pas ; il
  deviendra une clé étrangère. Le contrat `GameRepository` est inchangé et vérifié par une
  suite de tests commune à l'implémentation mémoire et à PostgreSQL.

## D-026 — Migrations SQL versionnées

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : fichiers `backend/migrations/NNNN_description.sql`, appliqués dans l'ordre
  par `npm run db:migrate` (`db:migrate:prod` après build). Table `schema_migrations` avec
  empreinte SHA-256. Toutes les migrations en attente s'appliquent dans **une** transaction,
  sous verrou consultatif : deux instances ne migrent jamais en même temps.
- **Règles** : une migration appliquée n'est jamais modifiée (empreinte vérifiée) ; on en
  ajoute une nouvelle. Une base migrée par un code plus récent est refusée. Pas de
  `CREATE INDEX CONCURRENTLY` (interdit en transaction) : à traiter à part si nécessaire.
- **Conséquences** : le serveur n'applique pas les migrations au démarrage ; c'est une étape
  explicite du déploiement.
