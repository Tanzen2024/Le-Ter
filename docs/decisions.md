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

## D-027 — Audit de la fondation backend : corrections avant les fonctionnalités

- **Date** : 2026-10-07 · **Statut** : validée
- **Contexte** : audit complet du backend (moteur, `GameService`, PostgreSQL, Redis, temps
  réel, configuration, HTTP) avant les phases Authentification et API de partie. Les
  décisions D-011 à D-026 sont confirmées ; les points ci-dessous les complètent.
- **Décisions** :
  1. **Ordre des événements** : l'enveloppe `GameEvent` gagne un champ `sequence` (rang
     dans la commande). Les événements d'une commande partagent la `version` ; le client
     déduplique sur `(version, sequence)` et relit l'état si `version` saute (trou). La
     règle précédente « ignorer toute version déjà vue » perdait le 2e événement de chaque
     commande (multi-game-architecture.md §5.2).
  2. **Diffusion après enregistrement** : une erreur de diffusion (abonné défaillant,
     transport) est journalisée et n'est jamais propagée à l'appelant. Une commande
     enregistrée dans PostgreSQL est réussie (complète D-024, règle 2).
  3. **Réabonnement Pub/Sub** : un abonnement au canal d'une partie qui échoue pendant une
     coupure Redis est retenté (1 s, doublé, plafonné à 30 s) tant qu'un abonné local suit
     la partie. Le client Redis ne rejoue à la reconnexion que les abonnements confirmés.
  4. **Délais PostgreSQL** : pool borné (`max` 10, attente de connexion 5 s,
     `statement_timeout` et `idle_in_transaction_session_timeout` 10 s, `query_timeout`
     15 s). Une base muette ne bloque plus indéfiniment la file d'une partie. Les migrations
     lèvent les limites de durée des requêtes. Valeurs de départ, à ajuster en charge.
  5. **Production** : `DATABASE_URL` est obligatoire quand `NODE_ENV=production`. `REDIS_URL`
     reste facultatif (une seule instance sans lui).
  6. **HTTP** : `X-Request-Id` sur chaque requête ; les erreurs client d'Express/body-parser
     (JSON mal formé, corps > 32 ko) gardent leur statut 4xx au lieu de 500 ; une panne
     renvoie 500 avec le seul `requestId`, et elle est journalisée en JSON sans corps ni
     en-têtes de requête.
  7. **Journal des refus** : toute commande refusée produit une ligne `game command rejected`
     (`gameId`, `playerId`, `action`, `commandId`, `errorName`). Le message d'un refus
     attendu n'est pas journalisé (il peut nommer une carte).
  8. **Arrêt** : l'arrêt propre est forcé après 10 s.
- **Reporté volontairement** (docs/TODO.md §7) : en-têtes de sécurité, CORS et limitation
  de débit (avec les premières routes de partie) ; traduction des erreurs du domaine en
  statuts HTTP ; nouvel essai automatique d'une commande en conflit de version entre
  instances ; réarmement des timers au démarrage ; sonde de disponibilité distincte de
  `/api/health`.

## D-028 — Orientation paysage uniquement

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : Le Ter fonctionne exclusivement en mode paysage. L'orientation portrait
  n'est pas supportée.
- **Contexte** : une partie réunit 2 à 4 joueurs autour d'un tapis central, avec la main du
  joueur en bas. Cette disposition demande de la largeur. Un seul format évite de concevoir
  et de tester chaque écran deux fois.
- **Mise en œuvre** (configuration Expo globale, sans dépendance ni code d'exécution) :
  - `app.json` : `"orientation": "landscape"`. iOS : `UISupportedInterfaceOrientations` =
    `LandscapeLeft` + `LandscapeRight`.
  - `ios.requireFullScreen: true` : sinon Expo ajoute les quatre orientations, portrait
    compris, sous `UISupportedInterfaceOrientations~ipad` (exigence Apple pour le Split View
    et le Slide Over). L'application ne propose donc pas le multitâche iPad.
  - Android : le plugin local `frontend/plugins/withAndroidSensorLandscape.js` remplace
    `screenOrientation="landscape"` (un seul sens) par `sensorLandscape` (paysage gauche et
    droit, comme iOS). L'activité déclare déjà `orientation|screenSize` dans `configChanges` :
    la rotation ne recrée pas l'écran et ne perd ni l'état React, ni Zustand, ni le cache
    TanStack Query.
- **Conséquences** :
  - La règle s'applique à toute l'application, écrans futurs compris. Aucun écran n'est conçu
    pour le portrait. Aucun écran ne verrouille l'orientation lui-même, et il n'existe pas
    d'état `isPortrait`/`isLandscape`. `expo-screen-orientation` n'est pas installé.
  - Toutes les interfaces sont conçues pour le paysage : voir les règles de mise en page dans
    [architecture.md](architecture.md) §3.
  - Le verrouillage relève du binaire natif. Il ne vaut que dans un build de développement
    ou de production, pas dans Expo Go ni sur le web.

## D-029 — Authentification : comptes, JWT, refresh tokens, session unique

- **Date** : 2026-10-07 · **Statut** : validée
- **Règles métier tranchées** : **R-10** mode invité supprimé ; **R-15** inscription par
  Prénom, Nom, Email, Pseudo, Téléphone (obligatoire), Mot de passe, Confirmation, et
  connexion par email + mot de passe (le pseudo n'est qu'un nom visible) ; **R-32** une seule
  session d'authentification active par utilisateur (sans effet sur le nombre de parties).
- **Décisions techniques** (détail : [authentication.md](authentication.md)) :
  1. Tables `users` et `refresh_tokens` (migration 0002). Email en minuscules et unique,
     pseudo unique sans tenir compte de la casse, téléphone E.164 unique, `phone_verified`
     à `false` (aucun fournisseur SMS choisi), rôle `user` seulement (R-09 pour les autres),
     statut `active`/`disabled`.
  2. `PlayerId` = identifiant du compte (UUID). `games.creator_id` et `game_players.player_id`
     deviennent des `uuid` avec clé étrangère vers `users` (migration 0003, `ON DELETE
     RESTRICT`). `playerIdOf(userId)` est le seul passage ; l'identité vient toujours du JWT.
  3. Mots de passe : bcrypt via `bcryptjs` (même algorithme, sans compilation native), coût
     12, 72 octets maximum. Comparaison factice si l'email est inconnu.
  4. Access token : JWT HS256 de 15 min (`sub`, `role`, `sid`, `iss`, `aud`), `JWT_SECRET`
     d'au moins 32 caractères, obligatoire en production, sans valeur par défaut.
  5. Refresh token : 256 bits opaques, seule l'empreinte SHA-256 est stockée, 30 jours
     renouvelés à chaque rotation. Rotation atomique : une seule réussit par jeton.
  6. Concurrence : chaque opération de session verrouille la ligne `users` (`FOR UPDATE`) ;
     l'index unique partiel `refresh_tokens (user_id) WHERE revoked_at IS NULL` garantit R-32
     au niveau de la base.
  7. `requireAuth` vérifie aussi en base que la session (`sid`) est active : une nouvelle
     connexion ou un logout invalide immédiatement les access tokens de l'ancienne session.
     Coût : une requête indexée par requête authentifiée.
  8. Limitation de débit en mémoire sur `/register`, `/login` et `/refresh`.
  9. Frontend : refresh token dans `expo-secure-store` (mémoire seulement sur le web, jamais
     AsyncStorage), access token en mémoire (Zustand), utilisateur courant dans TanStack Query.
- **Écarté** : argon2id (dépendance native, alors que la spécification demande bcrypt) ;
  `jose` (ESM seulement, alors que le backend est en CommonJS) ; détection de réutilisation
  d'un refresh token avec révocation de la session entière (un double envoi réseau légitime
  déconnecterait l'utilisateur) ; table `sessions` séparée (`session_id` dans
  `refresh_tokens` suffit).
- **Ouvert** : R-33 (indicatif pays par défaut), R-34 (vérification du téléphone), R-35 (mot
  de passe oublié), R-09 (rôles Admin / Katika).

## D-030 — API HTTP des parties branchée sur GameService

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : les parties sont exposées par `/api/games` (multi-game-architecture.md §7),
  toutes les routes derrière `requireAuth`. La chaîne est imposée :
  `contrôleur → validation → requireAuth → GameService → GameRepository → PostgreSQL`, et
  `GameService → bus d'événements → Redis Pub/Sub`. Les contrôleurs n'accèdent jamais aux
  dépôts ni à la base (un test le vérifie) et ne renvoient jamais l'agrégat `Game`, seulement
  la vue du joueur.
- **Règles** :
  1. Le joueur qui agit est `playerIdOf(getAuth(res).userId)` ; aucun `playerId`, `userId`
     ou `creatorId` du corps n'est lu.
  2. `:gameId` est validé une seule fois (`router.param`), avant tout contrôleur.
  3. Actions : `commandId` UUID obligatoire (idempotence), `expectedVersion` facultative
     (concurrence optimiste : 409 avec `currentVersion`).
  4. Erreurs : codes stables et messages fixes (`middleware/api-errors.ts`). Une règle non
     tranchée répond **501 `RULE_NOT_DEFINED`** avec sa référence : le serveur refuse
     plutôt que de deviner.
  5. Aucun jeu de règles du Ter n'est configuré au démarrage (`TerRuleSet` absent) : les
     actions de jeu répondent 501 tant que les règles ne sont pas adoptées.
  6. *(Remplacé par D-031 : R-18 est tranchée.)* **R-18 n'est pas tranchée.** Ses deux interprétations sont codées (`unrestricted`,
     `single-active-game`) et le choix passe par `GAME_PARTICIPATION_POLICY`, **sans valeur
     par défaut** et obligatoire en production. Sans elle, `/api/games` répond 503.
  7. `requestId` propagé jusqu'aux logs des commandes de `GameService`.
  8. Limitation de débit des écritures par utilisateur ; `Cache-Control: no-store` et en-têtes
     de sécurité sur toute l'API, sans dépendance.
- **Non exposé** (règles ouvertes) : démarrage (R-23), quitter (R-19), lobby et parties
  privées (R-22), pseudos des adversaires (R-12).
- **Frontend** : accueil paysage (créer, rejoindre par identifiant, mes parties), écran
  `app/game/[gameId].tsx` provisoire (pas de table de jeu graphique), clés TanStack Query
  `['games', 'active']` et `['games', gameId]` (D-017), `commandId` créé une fois par
  intention (`expo-crypto`). L'état est relu toutes les 3 s en attendant le temps réel
  (phase D).

## D-031 — Cycle de vie des parties : R-18, R-23, idempotence, concurrence

- **Date** : 2026-10-07 · **Statut** : validée · **Remplace** : D-030 règle 6
- **Règles métier tranchées** :
  - **R-18** : un joueur peut avoir plusieurs parties historiques, mais **une seule partie
    active à la fois**. Une partie active est en statut `waiting` ou `in_progress`. Une partie
    `finished` ne bloque pas la participation à une nouvelle partie. La contrainte est
    garantie côté serveur et protégée contre les opérations concurrentes.
  - **R-23** : à la création, la capacité maximale est obligatoirement 2, 3 ou 4 joueurs. Le
    démarrage nécessite au minimum 2 joueurs ; la capacité maximale n'est pas une condition
    de démarrage, donc une partie à 3 ou 4 places peut démarrer à 2. Seul le créateur
    démarre. Une fois démarrée, la partie n'accepte plus de joueurs, et le cycle
    `waiting → in_progress → finished` ne revient jamais en arrière.
- **Décisions techniques** :
  1. **R-18 en base** : colonne `game_players.active` (statut ≠ `finished`), écrite par
     `PostgresGameRepository` dans la transaction de la partie, et index unique partiel
     `game_players_one_active_game_per_player (player_id) WHERE active` (migration 0004). Deux
     adhésions simultanées à deux parties différentes, même sur deux instances : la seconde
     attend la première puis échoue (409 `ALREADY_IN_ACTIVE_GAME`). Choisi plutôt qu'un
     `SELECT … FOR UPDATE` sur `users` : la garantie ne dépend pas du chemin de code, comme
     pour R-32 (D-029). `singleActiveGameParticipation` vérifie d'abord pour donner une
     réponse claire. `GAME_PARTICIPATION_POLICY` est supprimée.
  2. **Démarrage** : `POST /api/games/:gameId/start` → `GameService.startGame(gameId,
     actorId)`. L'acteur vient du JWT, doit être membre (403 `NOT_A_MEMBER`) et créateur (403
     `ONLY_CREATOR_CAN_START`). Moins de 2 joueurs → 422 `NOT_ENOUGH_PLAYERS`.
  3. **Atomicité** : la file par partie sérialise une instance ; entre instances, la version
     optimiste fait échouer la seconde écriture (409 `GAME_ALREADY_STARTED` ou
     `VERSION_CONFLICT`). `game:started` n'est publié qu'après l'enregistrement : une seule
     transition, un seul événement. Vérifié sur PostgreSQL réel (15 essais) et sur Redis réel.
  4. **Démarrage sans distribution** : distribuer exige l'ordre de distribution et l'ordre de
     jeu (R-17, R-28, non tranchées). Sans jeu de règles, `beginGame` fait passer la partie
     `in_progress` sans cartes (`game:started` avec `dealt: false`), et les actions restent en
     501. Avec un jeu de règles, la distribution a lieu dans la même transition.
  5. **Monotonie** : `isForwardTransition` ; `PostgresGameRepository.save` refuse en SQL un
     recul du statut (`InvalidStatusTransitionError`).
  6. **Idempotence de la création** : en-tête `Idempotency-Key` obligatoire, stocké dans
     `games.creation_key`, unique par créateur. La clé est relue avant le contrôle R-18 :
     rejouer une création réussie renvoie la même partie (`Idempotent-Replayed: true`) au
     lieu d'un 409. Deux requêtes simultanées avec la même clé donnent une seule partie (la
     seconde relit la première après la violation d'unicité). La même clé pour d'autres
     paramètres → 422 `IDEMPOTENCY_KEY_REUSED`.
  7. **Timers** : aucun timer n'est armé au démarrage (durée et effet non définis : R-06).
  8. **Administration** : `npm run game:finish -- <gameId>` termine une partie via
     `GameService.finishGame` (file, version, `game:finished`). C'est utile tant qu'une partie
     démarrée sans règles ne peut pas se terminer par le jeu ; ses joueurs sont libérés (R-18).
- **Frontend** : création limitée à 2/3/4 avec une `Idempotency-Key` par intention ; salle
  d'attente « x / max joueurs » ; bouton « Démarrer » pour le créateur dès 2 joueurs ; accueil
  « Ma partie active » ; création et adhésion désactivées si une partie est active (le
  serveur reste l'autorité, ses erreurs sont affichées).
- **Ouvert** : R-20 (un fuyard reste membre de sa partie jusqu'à sa fin) ; partie jamais
  démarrée (expiration, annulation) ; R-17 et R-28 pour la distribution.

## D-032 — Distribution des cartes, premier joueur et contrôle initial

- **Date** : 2026-10-07 · **Statut** : validée, **sens et choix de J1 remplacés par D-033** (le
  sens officiel est ANTIHORAIRE ; J1 n'est plus toujours le premier siège) · **Tranche** : R-17
  (distribution), R-26 (talon)
- **Règles du jeu (définitives)** :
  - Chaque joueur reçoit exactement **5 cartes** au démarrage. Ce sont ses seules cartes de
    la partie.
  - La distribution se fait en **deux passages**.
  - **Premier passage** : chaque joueur reçoit **3 cartes simultanément**, l'un après
    l'autre, dans l'ordre des joueurs et dans le **sens des aiguilles d'une montre**.
  - **Deuxième passage** : chaque joueur reçoit **2 cartes simultanément**, l'un après
    l'autre, dans le même ordre et le même sens.
  - L'ordre des joueurs reste identique entre les deux passages. Il n'y a jamais de
    distribution carte par carte à l'intérieur d'un lot.
  - Les joueurs **ne piochent jamais** pendant la partie. Lorsqu'un joueur joue une carte,
    aucune carte de remplacement ne lui est distribuée.
  - Les cartes non distribuées (21, 16 ou 11) **ne constituent pas une pioche** accessible.
  - Le démarrage reste possible dès 2 joueurs, quelle que soit la capacité (D-031).
- **Premier joueur et contrôle** : la spécification fonctionnelle §2.2 dit « le premier
  joueur à recevoir ses cartes commence la partie et a le contrôle ». En distribution par
  lots, c'est J1, le premier à recevoir son lot de 3. J1 joue en premier (`nextPlayerId`) et
  détient le contrôle initial (`control = { playerId: J1 }`, sans carte de référence avant
  son premier coup). C'est le modèle existant du moteur ; aucun second système de contrôle.
- **Interprétation à confirmer** : les documents ne disent pas qui occupe la place J1. L'ordre
  horaire est représenté par l'ordre des sièges (attribués à l'arrivée, affichés « Joueur 1…4 »),
  et J1 est le premier siège, celui du créateur (`tableOrder`). Changer ce point (tirage au
  sort, rotation) ne touche que `tableOrder`.
- **Mise en œuvre** :
  1. `DEAL_PASSES = [3, 2]` (règle certaine, `rule-set.ts`) ; `dealInPasses` remet chaque lot
     comme un bloc contigu du paquet mélangé (Fisher-Yates, hasard cryptographique). La
     politique candidate `dealOrder` est retirée de `TerRuleSet`.
  2. `startGame` fait **dans une seule transition** : mélange, distribution, premier joueur,
     contrôle, `in_progress`. Une seule écriture versionnée (UPDATE `games` + sièges dans la
     même transaction) : une panne ne laisse jamais `in_progress` avec des mains incomplètes
     (rollback vérifié sur PostgreSQL réel). Le démarrage sans distribution (`beginGame`,
     D-031 §4) est supprimé.
  3. *(Remplacé par D-033 : R-28 est tranchée, sens antihoraire.)* **R-28 reste ouverte** :
     l'ordre des joueurs suivants dans un tour n'est pas défini.
     Sans jeu de règles, `trickOrder` est vide et les actions de jeu répondent 501
     (`RULE_NOT_DEFINED`).
  4. Événements : `game:started` (public) porte `dealOrder`, `firstPlayerId`, `controllerId`,
     `nextPlayerId`, `trickNumber` et `dealSequence` (les lots, sans carte). Chaque joueur reçoit
     en privé `game:hand_dealt` avec `cards` et `batches` (lot de 3, lot de 2). La vue joueur
     expose `dealSequence` et sa seule main.
  5. Frontend : animation de la distribution (`DealAnimation`, API `Animated` de React Native,
     sans dépendance), rejouée une fois par partie. Chaque lot apparaît d'un bloc ; les cartes
     des adversaires restent face cachée. **Les durées (750 ms entre deux lots, 350 ms
     d'apparition) sont un choix d'interface, pas une règle du jeu.** Un bouton « Passer »
     permet de l'interrompre.

## D-033 — Session multi-parties, ordre antihoraire et détermination de J1

- **Date** : 2026-10-07 · **Statut** : validée · **Remplace** : D-032 (sens horaire, J1 = premier
  siège), D-031 §4 (démarrage sans distribution) · **Tranche** : R-28 (ordre de jeu), la suite
  de R-17 (choix du premier servi)
- **Règles métier** :
  1. Une **SESSION** est une table de jeu persistante, contexte de plusieurs parties (GAME)
     successives, sans limite de nombre. SESSION ≠ GAME : la session orchestre les joueurs
     présents, l'ordre de la table, les parties successives, J1, l'ouverture et la fermeture ;
     la partie gère distribution, cartes, tours, contrôle, actions, gagnant.
  2. Créer sa première partie crée automatiquement une session. Son créateur est son premier
     joueur.
  3. Une session est **OPEN** ou **CLOSED**. Fermée, elle ne reçoit plus de joueur ni de partie
     et garde son historique. La fin d'une partie ne ferme pas la session.
  4. `session_players` (joueurs présents) ≠ `game_players` (joueurs d'une partie). On peut être
     dans la session sans être dans la partie en cours ; un nouveau venu n'est jamais ajouté aux
     parties précédentes.
  5. Les joueurs entrent et sortent ; la session se **ferme automatiquement** quand le dernier
     joueur actif part (même transaction).
  6. **Sens officiel : ANTIHORAIRE.** J1 → J2 → J3 → J4 → J1, circulaire (J4 → J1).
  7. **J1 de la première partie** = créateur de la session.
  8. **J1 des parties suivantes** = gagnant de la dernière partie TERMINÉE de la session s'il
     est présent ; sinon, en partant du gagnant, le premier joueur ACTIF dans le sens
     antihoraire. Jamais de retour automatique au créateur ni de choix arbitraire. Aucun joueur
     actif : session fermée.
  9. J1 reçoit les cartes en premier (lots 3 puis 2, D-032, dans le sens antihoraire), joue
     en premier et a le contrôle initial.
  10. **R-28** : l'ordre d'un tour suit le sens antihoraire à partir du meneur (le contrôleur,
      déduction R-27 conservée).
  11. **Contrôle** : on le prend avec une carte de même couleur ET de valeur strictement
      supérieure à celle du contrôleur ; sinon il ne change pas. Aucune pioche, aucun
      remplacement.
- **Décisions techniques** :
  - Tables `sessions` et `session_players` (migration 0005). `games` reçoit `session_id`
    (NOT NULL, FK), `first_player_id` (NOT NULL), `winner_id` ; `game_players` reçoit
    `table_position` (copie de la place de session : l'ordre d'une partie reste figé dans
    l'historique). Les parties antérieures reçoivent chacune leur session (même identifiant).
  - Ordre de la table = places de session croissantes. **Implémentation unique** :
    `domain/sessions/table-order.ts` (`rotateFrom`, `getNextPlayer`, `determineFirstPlayer`),
    utilisée pour J1, la distribution et l'ordre des tours. `playOrder` sort du `TerRuleSet`.
  - **Concurrence** : chaque mutation de session verrouille sa ligne (`SELECT … FOR UPDATE`) ;
    une seule partie active par session (index unique `games_one_active_per_session`) ; un
    joueur n'entre dans une partie que s'il est membre actif de la session (vérifié dans la
    transaction de la partie, verrou partagé sur sa ligne de session ; le départ verrouille
    cette ligne en exclusif avant de regarder ses parties). Le calcul fait sous verrou est
    PUR (aucune lecture pendant le verrou : la partie est préparée avant).
  - Services : `SessionService` (créer une session + 1re partie, partie suivante, arriver,
    partir/fermer, J1) ; `GameService` reste l'unique point d'entrée des mutations d'une
    partie et fournit `prepareNewGame` / `announceCreated`. Les deux créations (session + 1re
    partie ; partie suivante) sont chacune UNE transaction.
  - Idempotence : `Idempotency-Key` sur `POST /api/sessions` et `POST /api/sessions/:id/games`
    (même mécanisme que D-031). Une requête jumelle refusée par R-18 ou par l'unicité de la clé
    relit la clé et renvoie la création existante.
  - API : `POST /api/sessions`, `GET /api/sessions/me/active`, `GET /api/sessions/:id`,
    `POST /api/sessions/:id/join`, `POST /api/sessions/:id/leave`, `GET /api/sessions/:id/games`,
    `POST /api/sessions/:id/games`. `POST /api/games` reste et ouvre une session.
  - Événements `session:created`, `session:player_joined`, `session:player_left`,
    `session:closed` (version et séquence de la session ; canal Redis
    `le-ter:session:{id}:events`). `game:created` porte `sessionId` et `firstPlayerId`.
  - Les fichiers des sessions d'authentification sont renommés `auth-session.*` pour éviter la
    confusion.
  - **Stabilité des tests** (instabilité signalée en C.2) : la cause réelle était la
    sur-souscription du CPU. Jest lançait 11 workers sur 12 cœurs (suites PGlite en WebAssembly,
    bcrypt), et le PostgreSQL de Docker Desktop partage ces cœurs : sous charge, les longues
    boucles de concurrence sur base réelle dépassaient leur délai, et les workers encore occupés
    étaient arrêtés de force (« failed to exit gracefully »). `--detectOpenHandles`, fichier par
    fichier : aucune ressource ouverte. Correctif : `maxWorkers: "50%"` (package.json). Mesuré :
    5 exécutions complètes sur 5 à 100 %, plus rapides (65 à 85 s au lieu de 118 à 197 s),
    sans augmenter aucun délai. Deux vrais défauts ont aussi été trouvés et corrigés pendant ce
    diagnostic : un interblocage (requête hors transaction pendant le verrou de session) et une
    course d'idempotence (requête jumelle refusée par R-18).
- **Interprétations et ambiguïtés signalées** (non inventées, à confirmer) :
  - Quitter la session est **refusé** pendant une partie active de cette session : quitter une
    partie (R-19) ou fuir (R-05) n'est pas défini. *(Remplacé par D-037 : départ accepté
    pendant une partie en attente, refusé pendant sa partie en cours.)*
  - Un joueur qui revient prend une **nouvelle place** en fin d'ordre. *(Remplacé par D-034 :
    premier siège vacant.)*
  - « Parties successives » : une seule partie active par session.
  - Rejoindre une partie exige d'être membre actif de la session.
  - J1 absent de la partie : **démarrage refusé** (409 `FIRST_PLAYER_NOT_IN_GAME`) ; aucune
    règle ne désigne un remplaçant.
  - Dernière partie terminée **sans gagnant** (arrêt administratif) : J1 indéterminable, création
    refusée (409 `FIRST_PLAYER_UNDETERMINED`).
  - Pas de limite de joueurs par session ni de règle sur la présence dans plusieurs sessions.
    *(Remplacé par D-034 : capacité 2/3/4 immuable, une seule session active par joueur.)*
  - **R-03 et R-08 restent À CLARIFIER** : sans eux, aucun coup n'est jouable en production
    (501), donc aucune partie n'y obtient de gagnant par le jeu. La chaîne J1 complète est
    vérifiée avec des règles de test injectées.

## D-034 — Capacité de session, sièges fixes, Poursuivre/Quitter, timers persistants

- **Date** : 2026-10-07 · **Statut** : validée · **Complète** : D-033 · **Remplace** : D-033
  « un joueur qui revient prend une nouvelle place en fin d'ordre » et « pas de limite de
  joueurs par session ni de règle sur plusieurs sessions » · **Tranche** : R-06 en partie
  (durée du tour, conséquence = coup automatique ; le CHOIX de la carte reste ouvert)
- **Règles métier** (spécification produit, octobre 2026) :
  1. **Session multi-parties** : une session contient plusieurs parties successives, une seule
     active à la fois, et leur historique. Elle reste OPEN tant qu'au moins un joueur y est.
  2. **Capacité** : `maxPlayers` ∈ {2, 3, 4}, choisi à la création de la session, obligatoire,
     persisté, **immuable** ; il s'applique à toutes ses parties. Une partie démarre dès 2
     joueurs, jamais au-delà de `maxPlayers`.
  3. **Une seule session active par joueur** (historique illimité de sessions fermées ou
     quittées).
  4. **Sièges FIXES** (0 … maxPlayers-1), propriété de la session. Un départ rend le siège
     **VACANT** ; un nouveau joueur, ou un ancien qui revient, prend le **premier siège
     vacant**. `seatPosition` ≠ `firstPlayerId` : quand J1 change, **aucun siège ne bouge**.
  5. **J1** : 1re partie = créateur de la session ; parties suivantes = gagnant de la partie
     précédente s'il est présent, sinon, à partir du **siège du gagnant**, le premier siège
     occupé dans le sens antihoraire (tour complet de la table ; le siège du gagnant, s'il a
     été repris, est examiné en dernier).
  6. **Joueur de session ≠ joueur de partie** : rejoindre une session pendant une partie en
     cours ne fait pas entrer dans cette partie (aucune carte) ; le joueur attend la suivante.
  7. **Poursuivre / Quitter** : à la fin d'une partie, chaque joueur présent (y compris ceux
     arrivés pendant la partie) a **10 secondes** pour choisir. Poursuivre = reste, éligible à
     la partie suivante. Quitter = quitte la session (siège vacant). **Sans réponse à
     l'échéance : départ AUTOMATIQUE** (AUTO_LEAVE), décidé par le serveur. Le dernier départ
     ferme la session ; une session fermée ne rouvre jamais.
  8. **Timer de tour** : **10 secondes** par tour pour le joueur attendu, décidées par le
     serveur. À l'échéance : **TURN_TIMEOUT**, puis le serveur joue **une carte
     automatiquement** à la place du joueur. Le timeout ne fait ni quitter, ni éliminer, ni
     fermer quoi que ce soit.
  9. **AutomaticCardSelectionStrategy sera spécifiée ultérieurement.** La façon de choisir la
     carte jouée automatiquement N'EST PAS DÉCIDÉE : ni première carte, ni plus petite, ni plus
     grande, ni aléatoire, ni « une carte valide quelconque ». *(Remplacé par D-036 : plus
     petite carte de la famille du contrôle, sinon plus petite carte de la main.)*
- **Décisions techniques** :
  - Migration **0006** : `sessions.max_players` (CHECK 2-4, trigger d'immuabilité) ; unicité
    des sièges limitée aux joueurs présents (`session_players_active_seat_unique`) et trigger
    `session_players_seat_in_table` (0 ≤ siège < max_players) : la base garantit la capacité
    même en concurrence ; index unique `session_players_one_active_session_per_player` (les
    doublons antérieurs ne gardent que la session la plus récente ; une session vidée est
    fermée) ; tables `session_decision_rounds` (une par partie terminée, au plus une ouverte
    par session, `deadline_at`) et `session_decisions` (`continue`, `leave`, `auto_leave`) ;
    `games.turn_started_at`, `active_player_id`, `turn_timed_out_at` (avec `turn_deadline_at`
    existant).
  - **Ronde de décision** : ouverte quand la partie se termine (écouteur `onGameFinished` de
    GameService → `SessionService.syncSession`). Échéance = **fin de partie + 10 s**,
    déterministe : elle est identique quel que soit le processus qui ouvre la ronde
    (écouteur, reprise, balayage, ou toute mutation de la session, qui commence toujours par
    mettre la ronde à jour sous verrou). Transitions pures dans `domain/sessions/session.ts`
    (`syncDecisionRound`, `decide`, `joinSession`, `leaveSession`).
  - **Timer de tour** : le moteur fixe `turnStartedAt` / `turnDeadlineAt` à chaque nouveau
    joueur attendu (démarrage, coup, fin de tour). `GameService.handleTurnTimeout` (commande
    système, file de la partie, version) ne fait effet que si l'échéance PERSISTÉE est atteinte
    et que le tour n'a pas déjà expiré ; une écriture concurrente d'une autre instance est
    relue (conflit de version → nouvel essai). Un coup manuel après l'échéance est refusé
    (409 `TURN_EXPIRED`).
  - **Coup automatique** : `AutomaticCardSelectionStrategy` (port,
    `domain/game/automatic-card-selection.ts`) reçoit seulement la main du joueur concerné et
    l'état public ; la carte choisie est jouée par **le même chemin qu'un coup manuel**
    (`engine.playCard` dans la file de la partie, version, enregistrement, puis événements),
    `commandId` déterministe par tour (idempotent). En production :
    `UndefinedAutomaticCardSelectionStrategy`, qui **refuse** (UnresolvedRuleError
    `AUTO_CARD_SELECTION`) : le tour reste expiré, rien n'est joué ni inventé. *(Remplacé
    par D-036 : `LowestCardAutomaticSelectionStrategy` par défaut.)*
  - **Timers persistants** : un seul système de timers (`KeyedTimerRegistry`, une instance
    par partie / par session), copie volatile des échéances PostgreSQL. `DeadlineSupervisor`
    les **reconstruit au démarrage** (échéance future → timer réarmé ; échéance passée →
    traitée immédiatement ; coup automatique en attente → repris) puis **balaie** toutes les
    5 s les échéances dépassées : une instance arrêtée ne laisse aucune échéance orpheline.
    Il ne touche jamais la base : il appelle les commandes métier, idempotentes.
  - API : `POST /api/sessions/:id/decision` `{ choice: 'continue' | 'leave' }` ;
    `POST /api/sessions/:id/games` n'exige plus `maxPlayers` (s'il est envoyé et différent :
    409 `SESSION_MAX_PLAYERS_IMMUTABLE`). La vue de session expose `maxPlayers`, `seats`
    (occupant ou `null`), `currentGame`, `decision` et `serverNow` ; la vue de partie expose
    `activePlayerId`, `turnStartedAt`, `turnDeadlineAt`, `turnTimedOutAt`, `serverNow`.
    Nouveaux codes : `SESSION_FULL`, `ALREADY_IN_SESSION`, `SESSION_DECISION_IN_PROGRESS`,
    `NO_DECISION_PENDING`, `SESSION_MAX_PLAYERS_IMMUTABLE`, `TURN_EXPIRED`.
  - Événements : `session:decision_started`, `session:decision`, `session:auto_leave`,
    `session:decision_closed` ; `session:player_left` porte `reason` (`leave`/`auto_leave`) ;
    `game:turn_timeout`, `game:auto_card_played`, `game:control_changed` ;
    `game:started`/`game:turn_changed` portent l'échéance du tour. Aucune carte privée.
  - Journaux : `TURN_TIMEOUT`, `AUTO_CARD_PLAY`, `SESSION_DECISION_STARTED`,
    `SESSION_DECISION_TIMEOUT`, `AUTO_LEAVE`, `SESSION_CLOSED`, avec sessionId, gameId,
    playerId, version, échéance ; jamais de carte privée.
  - Frontend : sièges (vacants compris), panneau Poursuivre/Quitter avec compte à rebours,
    compte à rebours du tour ; tous calculés depuis l'échéance du serveur et `serverNow`. À
    zéro, l'écran annonce le départ automatique et attend l'état du serveur.
- **Interprétations et ambiguïtés signalées** (non inventées, à confirmer) :
  - Arriver dans une session **pendant la ronde de décision** est refusé (409
    `SESSION_DECISION_IN_PROGRESS`, au plus 10 s) : le cas n'est pas défini, plutôt que
    d'attribuer un choix au nouveau venu.
  - La partie suivante est **créée par un joueur** (bouton), après la ronde, avec les règles
    D-033 ; elle n'est pas créée automatiquement, et ses joueurs la rejoignent (les joueurs
    qui ont choisi Poursuivre en sont les candidats).
  - La partie suivante peut être créée avec un seul joueur restant ; elle ne démarre qu'à 2.
  - Quitter la session reste refusé pendant **sa** partie active (R-19, R-05). *(Remplacé par
    D-037 : refusé seulement pendant sa partie EN COURS ; une partie en attente se quitte.)*
  - Après TURN_TIMEOUT sans stratégie définie, la partie reste **bloquée** sur le tour
    expiré : c'est la conséquence voulue de « ne pas inventer » ; une stratégie devra être
    décidée avant toute mise en production. *(Caduc depuis D-036.)*
  - Un coup manuel après l'échéance est refusé, conséquence directe de « 10 s maximum » et de
    l'autorité du serveur.
  - Une ronde ouverte « en retard » (session antérieure à 0006, ou processus arrêté) a son
    échéance déjà dépassée : les joueurs présents partent alors immédiatement
    (comportement déterministe de la règle 7).

## D-035 — Socle de vérité des règles du Ter (52 décisions validées)

- **Date** : 2026-10-07 · **Statut** : validée par le propriétaire du projet · **Priorité** :
  ce socle prime sur toute interprétation antérieure du code, des TODO et des décisions qui le
  contredisent. · **Tranche** : R-01, R-03, R-04 (écarté), R-05 (sauf finance), R-07, R-08,
  R-27, R-29, R-30 (fuite du contrôleur), R-31 · **Remplace** : les interprétations
  « candidates » (`rule-candidates.ts`, renommé `official-rules.ts`), la condition de somme
  injectable, `7 + 7 + 4 + 3`, le refus de la fuite du contrôleur, le 5e tour joué à la main,
  la ronde Poursuivre/Quitter après une égalité.
- **Les 52 décisions** (texte de référence : prompt C.5 du propriétaire, octobre 2026) :
  - **A. Session (1-17)** : contexte persistant de parties successives (10, 15, 20 ou plus) ;
    `maxPlayers` 2/3/4 fixé à la création, immuable ; une seule partie active par session ;
    une seule session active par joueur ; arrivée pendant une partie = joueur de session sans
    carte, qui attend la suivante ; sièges fixes, siège vacant au départ, repris par un
    nouveau venu ou un revenant ; siège ≠ statut de J1 ; fermeture quand tous sont partis ;
    après une partie GAGNÉE, 10 s pour Poursuivre/Quitter (sans réponse = Quitter), persisté,
    server-authoritative, restart-safe ; une égalité de priorité ne passe PAS par
    Poursuivre/Quitter et relance directement une nouvelle partie dans la session.
    *(Déjà implémenté par D-033 / D-034, sauf la décision 17.)*
  - **B. J1 (18-24)** : créateur pour la 1re partie ; gagnant précédent s'il est actif ; sinon
    premier joueur actif à partir de son siège, sens antihoraire, tour complet si nécessaire ;
    J1 ne modifie jamais les sièges ; reprise après égalité = même J1 ; ordre antihoraire
    J1 → J2 → J3 → J4 → J1.
  - **C. Distribution (25-34)** : 31 cartes (♥ 3-10, ♠ 3-9, ♣ 3-10, ⭐ 3-10) ; 5 cartes par
    joueur en deux passes (lots de 3 puis de 2, simultanés) ; ni pioche ni remplacement ;
    reste inaccessible ; 10 / 15 / 20 cartes distribuées ; animation visuelle sans autorité ;
    le serveur décide de tout. *(D-032, D-033.)*
  - **D. Tours (35-43)** : exactement 5 tours ; un tour = chaque joueur actif joue une carte ;
    fuyards ignorés ; le contrôleur de fin de tour ouvre le suivant ; ordre antihoraire
    (J3 au contrôle : J3 → J4 → J1 → J2) ; sans prise de contrôle, le contrôleur garde le
    contrôle ; le contrôleur ne rejoue pas dans le tour.
  - **E. Contrôle / famille (44-52)** : quatre familles ♥ ♠ ♣ ⭐ ; « même couleur » = même
    famille ; qui possède la famille de la carte de contrôle du début du tour DOIT la jouer,
    sinon n'importe quelle carte ; jeu par glisser-déposer validé par le serveur ; une carte
    inférieure de la famille est jouable ; seule une carte supérieure de la famille prend le
    contrôle ; en fin de tour, seule compte la famille de la carte de contrôle du début du
    tour, la plus haute valeur l'emporte (7♥ ; 9♥, 5♥, 8♥ → 9♥).
- **Précisions validées** :
  - **Fuir** : tour 1 seulement, avant la première carte du joueur (le bouton disparaît
    ensuite) ; un fuyard par partie ; permis au contrôleur ; le fuyard est inactif pour la
    partie, reste dans la session à son siège, joue la partie suivante ; ses cartes ne sont
    jamais jouées ; sa main gagnante ne compte plus ; une carte d'un fuyard candidate au
    contrôle est ignorée.
  - **Victoire instantanée** : uniquement sur les 5 cartes initiales ; analyse automatique
    par le serveur à la distribution. Une seule main gagnante : pas de victoire automatique,
    bouton « Gagner instantanément » tant que le joueur n'a pas joué sa première carte (droit
    perdu ensuite) ; il peut aussi jouer normalement ou fuir. Plusieurs mains : le meilleur
    rang (le plus PETIT) gagne automatiquement ; même meilleur rang : aucun gagnant, reprise
    immédiate (même session, mêmes joueurs, mêmes sièges, même J1, nouveau mélange,
    nouvelle analyse), répétée sans limite.
  - **Rangs** : 1 trois 7 ; 2 somme ≤ 21 ; 3 cinq de même famille ; 4 quatre de même
    valeur ; 5 trois + deux ; 6 trois 3. Une main qui en satisfait plusieurs retient le
    meilleur rang (7♥ 7♣ 7♠ 7⭐ 3♥ → rang 1).
  - **Fin normale** : après le 5e tour, le contrôleur gagne automatiquement.
  - **5e tour** : démarre seul à la fin du 4e ; chaque joueur actif n'a qu'une carte, le
    système la joue (ordre antihoraire, fuyards ignorés), sans glisser-déposer ni choix ni
    timer ; puis contrôle normal, le contrôleur final gagne.
  - **Gains** : une victoire instantanée est toujours SIMPLE (jamais Kora / Double Kora).
- **Décisions techniques** :
  - `OFFICIAL_TER_RULES` (`domain/rules/official-rules.ts`) : `sameSuit`,
    `mustFollowLeadColorWhenPossible`, `declareBeforeFirstCard`,
    `fleeBeforeFirstCardOfFirstTrick` ; règles par défaut de GameService (plus de 501
    `RULESET`). `win-conditions.ts` : `INSTANT_WIN_CONDITIONS` rangées, `bestInstantWin`,
    `resolveInstantWins`.
  - Moteur : contrôle courant pendant le tour (affichage) et **recalcul en fin de tour**
    (`trickController`, cartes des fuyards exclues) ; `playLastTrickAutomatically`
    (événement `game:last_trick_automatic`, cartes marquées `automatic`) ; analyse des mains
    dans `startGame` (`play.instantWins`, secret serveur) ; `game:instant_win_tie`.
  - **Carte de contrôle du début du tour = la carte posée par le meneur** (le contrôleur).
    C'est la lecture cohérente avec la spec §2.4 (« celle jouée par le joueur ayant le
    contrôle »), avec l'exemple de la décision 52 (7♥ figure parmi les cartes jouées du tour)
    et avec la déduction R-27. Le meneur joue donc librement.
  - **Reprise immédiate** : la partie à égalité se termine (`end_reason = INSTANT_WIN_TIE`,
    sans gagnant) ; `SessionService.ensureReplay`, sous verrou de la session, insère une
    nouvelle partie déjà distribuée (`GameService.buildReplayGame`, pure), puis
    `announceInserted` diffuse ses événements. Index unique `games_one_replay_per_game` :
    une partie annulée n'est rejouée qu'une fois, même par deux instances. Reprise après
    redémarrage : `DeadlineSupervisor` (sessions dont la dernière partie est une égalité non
    rejouée). Pas de ronde Poursuivre/Quitter pour une égalité.
  - Migration **0007** : `games.end_reason` (`INSTANT_WIN`, `CONTROL_AFTER_LAST_TRICK`,
    `INSTANT_WIN_TIE`, `ADMIN_STOP` ; présent ssi la partie est terminée ; gagnant ssi
    victoire) et `games.replay_of_game_id`.
  - Vue joueur : `myActions` (`canPlayCard`, `playableCardIds`, `canFlee`,
    `canDeclareInstantWin`) calculées par le serveur ; `myInstantWin` (sa main seulement) ;
    `play.trickOrder` ; `endReason`, `instantWinTie`, `replayOfGameId`. Le frontend n'affiche
    les boutons et ne laisse glisser que ce que le serveur autorise.
  - Frontend : glisser-déposer avec `PanResponder` / `Animated` de React Native (aucune
    nouvelle dépendance ; Reanimated n'est pas installé dans le projet).
- **Interprétations signalées** (déduites du socle, à confirmer) :
  - Fuite du contrôleur (seul cas : le meneur du tour 1 avant sa carte) : le joueur actif
    suivant, sens antihoraire, mène le tour et détient le contrôle (décisions 37-38).
  - « Rangs différents » avec 3 ou 4 mains : si le MEILLEUR rang est détenu par un seul
    joueur, il gagne (ex. rangs 2, 5, 5 → le rang 2) ; s'il est partagé, égalité.
  - Une carte d'un fuyard ne peut pas être candidate au contrôle (on ne fuit qu'avant sa
    première carte) ; la règle d'exclusion est néanmoins codée.
- **Toujours NON DÉFINI** (aucune règle inventée) :
  - fuite dans une partie à 2 (il resterait un seul joueur) : refusée, 501 `R-30` ;
  - reprise après égalité quand J1 a quitté la session, ou qu'il reste moins de 2 joueurs de
    la partie annulée : pas de reprise, journalisé ;
  - stratégie du coup automatique après TURN_TIMEOUT des tours 1 à 4 : hors de ce socle
    (voir D-036, décidée dans une autre session de travail) ;
  - Kora, Double Kora, finance, Katika, tournoi, coût de la fuite (R-02, R-05, R-09, R-11).
  - Ronde Poursuivre/Quitter après un ARRÊT ADMINISTRATIF (sans gagnant) : la décision 14
    ne vise que les parties gagnées ; le comportement de D-034 (ronde ouverte) est conservé
    en attendant une décision.

## D-036 — Timeout de tour : sélection automatique déterministe de la carte

- **Date** : 2026-10-07 · **Statut** : validée par le propriétaire du projet (socle de vérité
  fonctionnel) · **Tranche** : R-06 (la carte jouée après TURN_TIMEOUT) · **Remplace** :
  D-034 point 9 (« AutomaticCardSelectionStrategy sera spécifiée ultérieurement ») et le
  comportement « TURN_TIMEOUT sans stratégie → partie bloquée, rien n'est joué ».
- **Règle métier** :
  1. **Timeout = 10 secondes** par tour pour le joueur attendu (D-034, inchangé). À
     l'échéance sans coup valide, le serveur joue **une carte** à sa place.
  2. « Même couleur » = **même famille** (♥, ♠, ♣, ⭐), conformément à D-035. Le code parle de
     famille (`suit`), jamais de couleur.
  3. **CAS A** — le joueur possède au moins une carte de la famille de la **carte
     d'ouverture du tour** : il DOIT en jouer une ; le serveur joue **la plus petite valeur
     de cette famille** (ouverture 5♠, main 7♠ 9♠ 4♥ 6♣ → 7♠).
  4. **CAS B** — aucune carte de cette famille : le serveur joue **la plus petite valeur de
     toute la main** (contrôle 5♠, main 8♥ 3♣ 6⭐ 9♥ 7♣ → 3♣).
  5. **Aucun hasard**, aucune sélection arbitraire, indépendant de l'ordre de la main.
  6. La famille obligatoire est celle de la **carte d'ouverture du tour** (première carte
     posée, par le meneur, D-035), jamais recalculée d'après une prise de contrôle en cours
     de tour. Le joueur qui **ouvre** le tour n'a aucune famille imposée : plus petite carte
     de sa main (voir « Précision validée »).
  7. Joueur ayant **fui** : jamais attendu, aucune carte automatique. Partie **terminée**,
     tour **déjà joué** ou TURN_TIMEOUT **en double** : rien n'est joué.
  8. **5e tour** : pas de stratégie de choix. Chaque joueur actif n'a qu'une carte ; elle est
     jouée directement par le moteur (D-035, `game:last_trick_automatic`), sans timer.
  9. **Serveur autoritaire** : le client ne choisit ni n'envoie aucune carte à la place du
     joueur ; son compte à rebours n'est qu'un affichage.
- **Décisions techniques** :
  - `LowestCardAutomaticSelectionStrategy` (`domain/game/automatic-card-selection.ts`),
    implémentation du port `AutomaticCardSelectionStrategy`, est la stratégie **par défaut**
    de GameService (injectable pour les tests). La carte de contrôle lui est fournie par
    `leadCardId` (première carte du tour en cours).
  - Chemin inchangé (D-034) : timer → `handleTurnTimeout` (file de la partie, échéance
    persistée, version) → stratégie → `engine.playCard` (mêmes validations qu'un coup
    manuel) → enregistrement PostgreSQL → événements `game:turn_timeout`,
    `game:auto_card_played`, `game:card_played`… `commandId` déterministe
    `auto-play:{gameId}:{tour}:{rang}` : un même timeout reçu deux fois, ou par deux
    instances, ne joue qu'une carte. Le timer ne modifie jamais la partie ni la base.
  - `UndefinedAutomaticCardSelectionStrategy` est supprimée.
- **Précision validée** (correction D-036 du propriétaire, 2026-10-07) :
  - **Jeu manuel / jeu automatique strictement séparés** : en jeu normal, le joueur choisit
    TOUJOURS sa carte (glisser-déposer, validée par le serveur). Le système ne choisit une
    carte que dans deux cas : **timeout de 10 s** (tours 1 à 4) et **5e tour automatique**
    (carte unique, sans stratégie). Aucun autre mécanisme de sélection automatique.
  - Le joueur qui **ouvre le tour** = le PREMIER à jouer ce tour, pour CHAQUE tour 1 à 4 (pas
    seulement J1 au tour 1) : à son timeout, **plus petite carte de sa main** (TRANCHÉ ;
    n'est plus une interprétation).
  - Joueur suivant : la famille obligatoire est celle de la **carte d'ouverture** du tour,
    lue dans l'état serveur (`play.currentTrick[0]`), jamais côté client.
- **Point encore à confirmer** :
  - **Égalité de valeur** entre familles (ex. ouverture 5♥, main 3♣ 3⭐ 7♠ 8♣ : 3♣ et 3⭐) :
    AUCUNE règle validée ne la départage, et aucune n'a été inventée comme règle métier. Pour
    rester déterministe, le code applique un **départage technique provisoire**
    (`PROVISIONAL_TIE_BREAK_ORDER` = ordre de déclaration de `SUITS` : ♥, ♠, ♣, ⭐ → 3♣).
    Ce n'est PAS une hiérarchie des familles du Ter ; à remplacer dès que le métier tranche
    (TODO R-06). L'égalité ne peut survenir qu'entre familles différentes (une famille n'a
    qu'une carte par valeur), donc jamais quand le joueur suit la famille d'ouverture.

## D-037 — R-19 : quitter une session (partie en attente, J1, place libérée, session vide)

- **Date** : 2026-10-08 · **Statut** : validée par le propriétaire du projet · **Tranche** :
  R-19 (quitter avant le démarrage) · **Remplace** : D-033 « quitter la session est refusé
  pendant une partie active » et D-034 « quitter la session reste refusé pendant sa partie
  active », pour une partie EN ATTENTE seulement ; « le dernier départ ferme la session »
  (D-033, D-034) pour une session sans partie terminée.
- **Règle métier R-19 — Quitter une session** :
  1. **Partie EN ATTENTE (WAITING)** : un joueur peut quitter directement la session. Il en
     sort ET sort de la partie en attente ; le nombre de joueurs reflète les présents.
  2. **Partie EN COURS (IN_PROGRESS)** : un joueur de cette partie ne peut PAS quitter
     directement la session (409 `PLAYER_IN_ACTIVE_GAME`). Il termine la partie ; **fuir**
     (tour 1) ne concerne que la partie et ne fait pas quitter la session (D-035). Un présent
     qui n'est pas joueur de la partie peut partir (inchangé).
  3. **Partie TERMINÉE (FINISHED)** : la ronde **Poursuivre / Quitter** de 10 s s'applique
     (D-034, inchangée) ; pendant la ronde, « Quitter la session » vaut le choix « Quitter » ;
     sans réponse, départ automatique.
  4. **Q1 — Session sans joueur** : quand plus aucun joueur n'est présent, la session est
     **supprimée**, avec sa partie en attente. Pas de statut « annulée » pour une partie.
  5. **Q2 — Départ du créateur / J1** (partie en attente, d'autres joueurs restent) : le
     **joueur suivant dans l'ordre d'ARRIVÉE dans la session** devient le nouveau J1 (A, B, C,
     D : A part → B ; B part → C ; C part → D ; D part → Q1). Ni l'identifiant, ni le siège
     ne décident de cet ordre. `session.creatorId` reste le créateur historique et n'est
     jamais réécrit.
  6. **Q3 — Place libérée** : le siège du joueur qui part devient immédiatement libre, n'est
     pas réservé, et les autres joueurs gardent le leur (ni décalage, ni renumérotation). Un
     nouveau joueur prend une place libre selon la règle normale (premier siège vacant, D-034).
- **Interprétations d'implémentation** (à confirmer si besoin) :
  - **Ordre d'arrivée circulaire** : « le joueur suivant » est cherché après celui qui part
    dans l'ordre d'arrivée, puis depuis le premier arrivé (identique à l'exemple A → B → C → D).
    Un joueur qui revient dans la session est le **dernier arrivé**.
  - **Créateur ≠ J1** (à partir de la 2e partie, le créateur est celui qui a appuyé sur
    « Créer la partie » et J1 est calculé par D-033/D-034) : si J1 part, le nouveau J1 suit
    Q2. Si seul le créateur part, J1 ne change PAS (il a été fixé par les règles de J1) ; le
    droit de démarrer (D-031 : le créateur seul) passe à J1 s'il est dans la partie, sinon au
    joueur de la partie suivant dans l'ordre d'arrivée.
  - **Partie en attente sans plus aucun joueur, mais session non vide** (ex. un joueur de la
    session n'avait pas rejoint la partie) : la partie est supprimée, la session continue et
    une nouvelle partie se crée selon les règles existantes. J1 de cette « première » partie :
    le créateur de la session s'il est présent, sinon le présent suivant dans l'ordre
    d'arrivée (Q2).
  - **Q1 et historique** : une session qui a au moins une partie TERMINÉE n'est pas supprimée
    au dernier départ : elle est **fermée** (comportement D-034), car la supprimer effacerait
    l'historique des parties jouées (gagnants, et plus tard les mises). Sa partie en attente
    éventuelle est supprimée. Le dernier départ par la ronde Poursuivre / Quitter (choix ou
    départ automatique) ferme aussi la session, inchangé. **À confirmer** par le métier.
- **Décisions techniques** :
  - Migration **0008** : `session_players.arrival` (rang d'arrivée, ≥ 1, unique par
    session), rempli pour l'existant d'après `joined_at`. Un retour reçoit le rang suivant.
  - Le départ est **une transaction** (`SessionRepository.leave`) : verrou de la partie active
    PUIS de la session et de ses joueurs (même ordre que les écritures de partie, pas
    d'interblocage) ; transition pure `leaveSession` (domaine) ; partie en attente modifiée
    par `GameService.buildWaitingGameDeparture` (joueur retiré, J1 et créateur remplacés,
    version + 1, contrôle de version) ou supprimée ; session enregistrée ou supprimée
    (`DELETE` : joueurs, rondes et décisions en cascade ; une partie restante ferait échouer
    la suppression, rien n'est perdu en silence). Un démarrage concurrent voit soit la partie
    sans le joueur, soit le départ est refusé (`PLAYER_IN_ACTIVE_GAME`).
  - Rang d'un joueur DANS une partie (`game_players.seat`) : le plus petit libre, pour qu'un
    rang libéré par un départ soit réutilisable. La place de table (`table_position`), elle,
    est celle de la session et ne change jamais.
  - API : `POST /api/sessions/:id/leave` renvoie `{ session: null }` quand la session a été
    supprimée. Événements : `session:deleted` (remplace `session:closed` dans ce cas),
    `game:player_left` (`playerId`, `firstPlayerId`, `creatorId`) dans la salle de la partie.
  - Écran de session : « Quitter la session » proposé sauf pendant SA partie en cours (message
    explicite) et pendant la ronde Poursuivre / Quitter (panneau existant).
    *(Interface remplacée par D-038 : plus d'écran de session ; le départ se fait par
    « Quitter la partie » dans l'aire de jeu. Les règles de départ ci-dessus sont inchangées.)*

## D-038 — La session est un concept technique, invisible pour l'utilisateur

- **Date** : 2026-10-08 · **Statut** : validée par le propriétaire du projet · **Complète** :
  D-033, D-034, D-037 · **Remplace** : l'écran frontend `session/[sessionId]` (sièges,
  identifiant de session à partager, « Quitter la session », « Ouvrir la partie »,
  historique).
- **Principe** : « Session est un concept technique interne. L'utilisateur manipule uniquement
  les parties. » Le backend garde intégralement la session (domaine, `SessionService`,
  repository, `session_players`, sièges fixes, J1, R-19, ronde Poursuivre/Quitter) ; seul
  l'affichage disparaît.
- **Parcours** :
  - Accueil → Privé → Rejoindre → Partie privée → Créer → **aire de jeu** directement
    (`/game/:gameId`), « En attente de N-1 joueurs ».
  - Rejoindre : liste « Rechercher une partie » (tables ouvertes) → arrivée dans la session
    puis dans sa partie en attente → aire de jeu. « Ma partie » permet de reprendre la sienne.
  - Sortie : bouton rouge « Quitter la partie » (le retour Android l'ouvre aussi) →
    confirmation → départ selon R-19 / D-037 (refusé pendant sa partie en cours) → accueil.
  - Fin de partie : résultat et ronde Poursuivre/Quitter sur la table ; puis « Nouvelle
    partie » (D-034 : créée par un joueur) ou « Rejoindre la partie suivante », sans écran
    intermédiaire.
  - « Une seule partie à la fois » (R-18, une session par joueur) reste imposé par le
    serveur ; le formulaire ne l'annonce plus comme un blocage préalable : un refus est
    affiché comme erreur métier avec « Reprendre ma partie ».
- **Décisions techniques** :
  - `GET /api/sessions/open` (lecture seule, sans verrou) : tables à rejoindre — session
    ouverte, partie en attente, siège libre. Rejoindre reste validé sous verrou par les
    commandes existantes. *(Complété par D-039 : nom, mise, mot de passe, table du joueur
    marquée `mine`.)*
  - Le frontend reformule les messages d'erreur du serveur qui nomment la session (à partir
    du `code`, dans `lib/api-client.ts`) ; les messages et règles du serveur sont inchangés.

## D-039 — Partie privée : nom, mise et mot de passe enregistrés

- **Date** : 2026-10-08 · **Statut** : validée par le propriétaire du projet (parcours
  « Partie de Roly | 20 | 1/4 | 🔒 | → ») · **Complète** : D-038 · **Ne tranche pas** : R-12
  (noms de joueurs cryptés), R-13 (valeur et mouvements des jetons), R-22 (invitations).
- **Règles** :
  - Créer : nom, mise, nombre de joueurs, mot de passe facultatif → le serveur crée la partie
    et le créateur arrive directement dans l'aire de jeu ; la liste des autres joueurs affiche
    « nom | mise | n/max | 🔒 ou 🔓 | → ».
  - Le nom et le mot de passe appartiennent à la table (session, D-033) : fixés à la création,
    inchangés pour les parties suivantes. La mise appartient à la partie (`games.stake_amount`,
    existant) ; la partie suivante reprend la mise de la précédente (choix de l'interface).
  - 🔒 : tout joueur qui n'est pas déjà présent à la table doit fournir le mot de passe
    (vérifié par le serveur, 403 `TABLE_PASSWORD_INVALID`). Le créateur n'en a pas besoin.
  - La mise est **indicative** : aucun solde n'est débité ni crédité (R-13 reste ouvert).
- **Décisions techniques** :
  - Migration **0009** : `sessions.name` (1 à 40 caractères, NULL pour les tables antérieures,
    affichées « Partie de <créateur> ») et `sessions.password_hash` (bcrypt, comme les comptes ;
    jamais le mot de passe en clair, jamais exposé : seulement `hasPassword`).
  - Validation : nom 1 à 40 caractères visibles (espaces de bord retirés, caractères de
    contrôle refusés) ; mot de passe vide = aucun, sinon 4 caractères minimum et 72 octets au
    plus (limite bcrypt) ; mise entière ≥ 0 (règle existante).
  - Vérification du mot de passe avant le verrou de la session (le hash ne change jamais),
    puis arrivée normale sous verrou. Le mot de passe n'est jamais journalisé.
  - `GET /api/sessions/open` inclut la table du joueur, marquée `mine` (reprise depuis la
    liste) ; les tables des autres restent celles qu'il peut rejoindre.

## D-040 — Compte de jeu (jetons) : socle, achats et retraits Mobile Money

- **Date** : 2026-10-08 · **Statut** : validée par le propriétaire du projet (périmètre
  « interface + socle portefeuille ») · **Ne tranche pas** : R-13 (conversion jetons ↔ FCFA),
  R-16 (minimums), R-34 (téléphone vérifié avant retrait), T-07 (licence), choix du
  fournisseur Mobile Money.
- **Principes** :
  - Deux comptes distincts : le **compte de jeu** (jetons, stocké par Le Ter) et le **compte
    Mobile Money personnel** (numéro d'inscription `users.phone`, jamais recopié ni journalisé,
    affiché masqué).
  - Le serveur est la seule source de vérité : le solde ne change que par une transaction
    enregistrée ; il ne devient jamais négatif (verrou `FOR UPDATE` + `CHECK (balance >= 0)`).
  - Achat : transaction `pending` → demande de paiement au fournisseur → crédit **seulement**
    à la confirmation (`WalletService.settle`, idempotent).
  - Retrait : solde vérifié et **débité** sous verrou (`pending`) → demande de transfert →
    succès confirmé par le fournisseur, ou échec et **remboursement** dans la même transaction.
  - Idempotence : `Idempotency-Key` obligatoire, unique par joueur ; un renvoi rejoue l'issue
    enregistrée, une clé réutilisée pour une autre opération est refusée (409).
  - Aucun fournisseur n'est configuré : `UnconfiguredMobileMoneyGateway` refuse toute demande
    (503 `MOBILE_MONEY_UNAVAILABLE`), l'opération est enregistrée `failed` et un retrait est
    remboursé. **Jamais de fausse réussite.**
- **Décisions techniques** :
  - Migration **0010** : `wallets` (solde en jetons, `bigint`) et `wallet_transactions`
    (deposit/withdrawal, pending/succeeded/failed, `idempotency_key` unique par joueur).
  - API : `GET /api/wallet` (solde, numéro masqué, `phoneVerified`, `mobileMoneyAvailable`),
    `POST /api/wallet/deposits` et `POST /api/wallet/withdrawals` (`{ tokens }` entier > 0,
    Idempotency-Key ; 202 en attente du fournisseur ; 409 `INSUFFICIENT_BALANCE` « Solde
    insuffisant. »). Limite : 10 opérations par minute et par joueur.
  - Port `MobileMoneyGateway` (`requestCollection`, `requestDisbursement`) : l'implémentation
    réelle portera la conversion R-13 et la réception sécurisée des confirmations du
    fournisseur (rappel HTTP signé), qui appellera `WalletService.settle`.
    *(Fournisseur d'achat : CinetPay v1, voir D-050.)*
  - Frontend : HUD et aire de jeu affichent le solde réel ; « Ajouter des jetons » (jeton +)
    ouvre Boutique → Acheter / Retirer ; X et retour Android ramènent à la Boutique.

## D-041 — 5ᵉ tour automatique : présentation carte par carte, ronde décalée

- **Date** : 2026-10-08 · **Statut** : validée par le propriétaire du projet · **Complète** :
  D-035 (5ᵉ tour automatique), D-034 (ronde Poursuivre/Quitter de 10 s) · **Ne change pas** : la
  règle du 5ᵉ tour (une carte par joueur actif, jouée par le serveur dans l'ordre du tour,
  fuyards ignorés).
- **Présentation** : le serveur joue les dernières cartes en une commande ; les écrans les
  présentent UNE PAR UNE, dans l'ordre reçu : carte au centre (~2,5 s), rangée dans la zone
  publique de son joueur, puis 2 s de pause avant la carte suivante. Jamais deux cartes du 5ᵉ
  tour en mouvement ; aucune avant la fin des cartes du 4ᵉ tour. Une carte pas encore
  présentée reste de dos (ou dans la main de son propriétaire) ; le gagnant et la ronde
  n'apparaissent qu'après la dernière carte rangée. Aucun compte à rebours au 5ᵉ tour.
  Ordonnancement dans `frontend/src/features/games/table/presentation-plan.ts` (pur, dérivé
  de l'état du serveur : rien n'est rejoué après une reconnexion).
- **Ronde décalée** : échéance = fin de partie + `lastTrickPresentationMs(cartes du 5ᵉ tour)`
  + 10 s, avec `lastTrickPresentationMs(n) = 6,2 s + n × 3,2 s + (n − 1) × 2 s` (marge : dernière
  carte du 4ᵉ tour et relecture de l'état par le client). Chaque joueur garde ses 10 s pleines
  après la présentation. Les décisions envoyées plus tôt restent acceptées.
- **Technique** : `LastGameInfo.lastTrickCards` (lu dans `games.state`), paramètre
  `presentationMs` de `syncDecisionRound`, option `lastTrickPresentationMs` de
  `SessionService` (0 dans les fixtures de test qui ne portent pas sur ce délai).

## D-042 — « Poursuivre » enchaîne directement la partie suivante

- **Date** : 2026-10-08 · **Statut** : validée par le propriétaire du projet · **Remplace** :
  D-034 « la partie suivante est créée par un joueur (bouton), après la ronde » · **Ne
  change pas** : la ronde Poursuivre/Quitter (10 s, départ automatique sans réponse), les
  sièges fixes, la désignation de J1 (D-033), le démarrage dès 2 joueurs (R-23), la
  distribution 3 + 2 antihoraire (D-032), la reprise immédiate après égalité (D-035).
- **Règle** : dès que la ronde est close (tous ont répondu, ou échéance), le serveur crée la
  partie suivante de la MÊME session avec les joueurs restés (ceux qui ont choisi Poursuivre),
  à leurs sièges, J1 selon les règles existantes, créateur = J1, même mise, et la distribue
  aussitôt s'ils sont au moins 2 ; seul, le joueur attend les arrivées sur la table. Aucun
  écran, bouton ou action supplémentaire ; l'écran passe directement à la nouvelle partie,
  dont la distribution se joue sur la table.
- **Technique** : `SessionService.ensureContinuation` (déclenchée par
  `session:decision_closed` et par `syncSession` à la reprise), sous le verrou de la session,
  idempotente ; une seule partie active par session garantie en base ;
  `GameService.buildNextGame`. `POST /api/sessions/:id/games` reste disponible (plus utilisé
  par l'application). Option `autoNextGame` (vraie par défaut ; fausse dans les fixtures des
  tests historiques).
- **Correction liée** : à la fin du 5ᵉ tour, le moteur vidait `completedTricks` mais pas
  `currentTrick` ; la vue de fin de partie contenait donc chaque carte du 5ᵉ tour deux fois
  (clé React `COEUR-7` en double). Le tour en cours est désormais vidé ; le frontend ignore
  aussi les doublons des parties déjà terminées en base.

## D-043 — Réglage « détection anti-collusion » d'une partie privée

- **Date** : 2026-10-08 · **Statut** : validée par le propriétaire du projet (périmètre « champ
  + icône + case à la création ») · **Ne tranche pas** : R-36 (le mécanisme de détection
  lui-même : aucune détection n'existe).
- **Règle** : `suspicionDetectionEnabled` est choisi à la création d'une partie privée
  (désactivé par défaut), puis immuable (garanti en base par un trigger). Il appartient à la
  table (session), comme le nom et le mot de passe (D-039).
- **Affichage** : une icône 🛡️, jamais Oui/Non. Dans la liste « Rechercher une partie »,
  colonne à côté du cadenas : bouclier vif avec un point doré si activé, estompé sinon ; un
  appui affiche « Détection anti-collusion activée / désactivée ». Dans « Créer une partie »,
  la ligne « 🛡️ Détection anti-collusion » s'active d'un appui sur le bouclier. L'état affiché
  vient toujours du serveur (`GET /api/sessions/open`, vue de session).
- **Technique** : migration **0011** (`sessions.suspicion_detection_enabled`, trigger
  d'immuabilité), `POST /api/sessions` accepte `suspicionDetectionEnabled` (booléen, 400
  sinon), vues `suspicionDetectionEnabled`.
- **Avertissement** : le bouclier activé n'enclenche aucune détection tant que R-36 n'est pas
  défini et implémenté.

## D-044 — Détection de potentielle collusion : socle (R-36, étape 1)

- **Date** : 2026-10-08 · **Statut** : étape 1 (socle technique) demandée par le propriétaire
  du projet · **Ne tranche pas** : R-36 sur le fond (données analysées, critères, seuils
  définitifs, conséquences, transparence) ; aucune analyse réelle n'est branchée.
- **Principe** : un `DetectionService` indépendant de `GameService`. Il OBSERVE les fins de
  partie (`GameService.onGameFinished`) et n'agit jamais sur l'état du jeu ; le moteur ne
  dépend pas de lui. Ses traitements tournent en arrière-plan (`BackgroundTasks`), en file
  par partie (`KeyedSerialQueue`), jamais dans une commande critique ; une erreur d'analyse
  est seulement journalisée.
- **Activation** : `suspicionDetectionEnabled` de la table (D-043) est la seule source de
  vérité. Désactivée : aucune analyse lancée, aucun signal, aucun score, aucune ligne. La
  base le garantit aussi (trigger `detection_rows_guard`).
- **Isolation** : toute donnée est rattachée à un `gameId` ; aucun état global. Un signal ne
  peut citer que des joueurs de SA partie (service + trigger) ; les lignes disparaissent avec
  la partie.
- **Modèle** : 9 types de signaux (`PROXIMITY`, `REPEATED_PROXIMITY`, `IMPOSSIBLE_TRAVEL`,
  `INCOHERENT_LOCATION`, `FREQUENT_COPLAY`, `CARD_CHOICE_ANOMALY`, `CORRELATED_WINS`,
  `CONNECTION_PATTERN`, `SHARED_IP`) ; `SHARED_IP` est préparé mais DÉSACTIVÉ (aucune IP
  collectée). Score de RISQUE par sujet (joueur seul ou groupe, le plus souvent une paire),
  0 à 100, niveaux faible 0–24 / modéré 25–49 / élevé 50–74 / très élevé 75–100, avec version
  d'algorithme et horodatage. Jamais une preuve de triche ; aucune sanction automatique.
- **Configuration** : unique, `backend/src/domain/detection/detection-config.ts`. Les
  plafonds par type (`SIGNAL_RULES`) et les seuils de catégories (`DETECTION_THRESHOLDS`)
  sont des valeurs PROVISOIRES NON VALIDÉES, inutilisées à l'étape 1 ; elles devront être
  validées avant toute mise en service d'une analyse.
- **Technique** : migration **0012** (`detection_signals`, `detection_scores`, trigger de
  garde), `DetectionRepository` / `PostgresDetectionRepository`, aucune route HTTP, aucun
  changement frontend, aucun GPS, aucune IP.

## D-045 — Chat de partie et transport temps réel WebSocket (T-01 tranché)

- **Date** : 2026-10-08 · **Statut** : validée par le propriétaire du projet (WebSocket pour
  le temps réel, REST pour l'historique, PostgreSQL pour la persistance, Redis pour la seule
  diffusion entre instances ; pas de Firebase) · **Ne tranche pas** : R-14 (modération du
  chat), R-36 (aucune analyse du chat).
- **Transport (T-01)** : WebSocket natif (`ws` côté serveur, `WebSocket` standard de React
  Native côté client), sur le serveur HTTP de l'API, chemin `/ws`, UNE connexion par
  application. Pas de Socket.IO. Utilisé pour l'instant par le chat seulement ; les
  événements de partie (`GameEventPublisher`) pourront s'y brancher ensuite.
- **Authentification** : 1re trame `{ type: 'auth', token }` (jamais de jeton dans l'URL, ni
  dans les journaux), 10 s pour s'authentifier, fermeture 4401 à l'expiration du jeton ; la
  session est revérifiée avant chaque commande (R-32). L'identité est celle du jeton : aucun
  `senderId`/`userId` reçu n'est lu.
- **Chat** : `ChatService` indépendant de `GameService` (ni verrou, ni écriture sur une
  partie). Un message appartient à UNE partie ; seuls ses joueurs (`game_players`) lisent,
  écrivent et s'abonnent (403 `NOT_A_MEMBER` sinon), contrôle refait dans l'instruction
  d'insertion. Salle `game:{gameId}:chat`, canal Redis `le-ter:game:{gameId}:chat`, événement
  `chat:message` `{ gameId, message }` diffusé APRÈS l'écriture en base, identique à la réponse
  REST. Une panne de Redis ne fait jamais échouer un envoi (diffusion locale, rattrapage REST).
- **Message** : `id` UUID généré par le serveur, `gameId`, `senderId`, `senderDisplayName`
  (`users.username`), `content`, `createdAt`. Texte brut (jamais HTML ni Markdown), espaces de
  bord retirés, 1 à `MAX_CHAT_MESSAGE_LENGTH` = 500 caractères (constante unique du backend,
  renvoyée au client ; garantie aussi en base), caractères de contrôle refusés.
- **Double envoi** : une clé par intention (`Idempotency-Key` en REST, `clientMessageId` en
  WebSocket), unique par (partie, expéditeur) : un renvoi rend le même message, sans nouvelle
  diffusion. Anti-spam : 10 messages / 10 s par joueur (429 `RATE_LIMITED`).
- **Partie terminée** : aucune règle n'existait ; choix le plus restrictif, SANS modifier les
  règles du jeu : historique lisible par les joueurs, envoi refusé (409 `CHAT_CLOSED`).
- **API** : `GET /api/games/:gameId/chat/messages` (dernière page ; `?before=<id>` plus
  anciens ; `?after=<id>` rattrapage ; `?limit=1..50`, 30 par défaut ; renvoie `hasMore`,
  `canSend`, `maxMessageLength`) et `POST /api/games/:gameId/chat/messages` `{ content }`.
- **Reconnexion (client)** : délai croissant 1 s → 30 s, ping applicatif (connexion muette
  coupée), réveil au retour au premier plan ; après chaque reconnexion, réabonnement puis
  rattrapage `after` ; fusion par `id` (aucun doublon). Sans connexion, l'historique est relu
  toutes les 5 s.
- **Technique** : migration **0013** (`game_chat_messages`, index `(game_id, created_at, id)`,
  unicité de la clé d'envoi).

## D-046 — Détection de potentielle collusion : géolocalisation (R-36, étape 2)

- **Date** : 2026-10-08 · **Statut** : étape 2 demandée par le propriétaire du projet ·
  **Ne tranche pas** : score final, niveaux et alertes (étape 4), administration, analyse
  des cartes ; les seuils ci-dessous sont PROVISOIRES et NON VALIDÉS.
- **Activation** : uniquement pour une partie dont la table a `suspicionDetectionEnabled`
  (D-043). Sinon : aucune permission demandée, aucune position lue, envoyée ni enregistrée
  (refus 409 `DETECTION_DISABLED` + trigger en base), aucune distance, aucun signal.
- **Téléphone** (`expo-location`, premier plan seulement, jamais d'arrière-plan) : sur
  l'écran d'une partie surveillée, une explication neutre précède toute demande de
  permission native (raison, coordonnées jamais montrées aux joueurs, distances calculées
  par le serveur, conservation temporaire, refus possible). Le refus reste sur le téléphone
  (mémorisé par table pour la durée de l'application) : jamais transmis, jamais un signal ;
  le joueur joue normalement, ses distances affichent « — ». Collecte à la cadence du serveur
  (45 s, jamais moins de 30 s), arrêtée quand la partie se termine, quand l'écran n'est plus
  affiché ou actif, ou sur refus définitif du serveur.
- **API** : `GET /api/games/:gameId/geolocation` (activation, cadence, distances du joueur)
  et `POST /api/games/:gameId/position` `{ latitude, longitude, accuracy, capturedAt }` →
  `{ distances }`. Identité = JWT ; partie existante (404), joueur membre (403), détection
  activée (409), partie non terminée (409), coordonnées, précision (≤ 1 000 m) et date
  (≤ 2 min, ≤ 30 s d'avance) validées (400) ; 4 positions par minute au plus (429). Les
  réponses ne contiennent que des distances (arrondies à 10 m), jamais de coordonnées.
- **Stockage** (migration **0014**, `detection_positions`) : coordonnées arrondies à
  4 décimales (≈ 11 m, garanti par le type SQL), clé étrangère vers `game_players` (joueur
  de LA partie), trigger refusant toute partie non surveillée. Conservation : suppression au
  plus tard 24 h après la fin de la partie (ou 24 h après la capture si la partie n'est pas
  terminée), par un nettoyage automatique au démarrage puis toutes les heures.
- **Distances** : une seule formule, Haversine (`domain/detection/geo.ts`), calculée par le
  serveur sur les paires de joueurs de LA partie (2 → 1, 3 → 3, 4 → 6), avec la dernière
  position de chacun si elle a moins de 150 s. Temps réel : les distances reviennent dans la
  réponse de chaque position envoyée et dans `GET …/geolocation` ; aucune nouvelle
  connexion WebSocket (le transport `/ws` de D-045 pourra les diffuser plus tard).
- **Analyses** (`services/detection/geo-analyzers.ts`, branchées sur `DetectionAnalyzer`,
  en fin de partie, en arrière-plan) : `PROXIMITY` (< 50 m forte, < 200 m significative, au
  moins 2 mesures appariées à ≤ 60 s et 60 s de durée), `REPEATED_PROXIMITY` (même paire
  proche dans au moins 3 parties surveillées sur 30 jours), `IMPOSSIBLE_TRAVEL` (> 900 km/h
  après retrait des rayons d'incertitude, déplacement ≥ 1 km), `INCOHERENT_LOCATION` (saut
  ≥ 5 km suivi d'un retour à ≤ 200 m en ≤ 10 min). Positions de précision > 100 m ignorées.
  Le critère « position identique entre appareils » n'est pas implémenté : l'arrondi à
  ≈ 11 m ne permet pas de l'établir. Les éléments justificatifs ne contiennent jamais de
  coordonnées. Aucun score calculé (`SUSPICION_SCORING_ENABLED = false`), aucune alerte.
- **Configuration** : `GEOLOCATION_CONFIG` et `DETECTION_THRESHOLDS` dans
  `backend/src/domain/detection/detection-config.ts`, et nulle part ailleurs.

## D-047 — Détection de potentielle collusion : analyse comportementale (R-36, étape 3)

- **Date** : 2026-10-08 · **Statut** : étape 3 demandée par le propriétaire du projet ;
  seuils PROVISOIRES non validés · **Ne tranche pas** : score global, niveaux, alertes
  (étape 4), administration (étape 5). Détails : [detection.md](detection.md).
- **Signaux** : `FREQUENT_COPLAY_V1`, `CARD_CHOICE_ANOMALY_V1`, `CORRELATED_WINS_V1`,
  `CONNECTION_PATTERN_V1`, analyses longitudinales en fin de partie (arrière-plan, file par
  partie), rattachées à la partie OBSERVÉE et à ses seuls joueurs. Un signal est une
  observation statistique, jamais une accusation ; aucune conséquence automatique.
- **Historique** : parties SURVEILLÉES terminées uniquement (choix de confidentialité,
  PROVISOIRE), relues depuis les tables du jeu ; aucune copie, aucune nouvelle collecte.
- **Timeouts** : reconnus par le `commandId` déterministe `auto-play:{gameId}:{tour}:{position}`
  déjà persisté dans `recentCommandIds` (contrat testé), sans modifier le moteur ni GameService.
- **Données réseau** : aucune IP n'est conservée ; `SHARED_IP` reste désactivé ;
  CONNECTION_PATTERN utilise les arrivées aux tables et les débuts de session
  d'authentification.
- **Technique** : migration **0015** (unicité `(game_id, type, player_ids,
  algorithm_version)` des signaux : idempotence), version par type
  (`SIGNAL_ALGORITHM_VERSIONS`), `BehaviorHistoryRepository` (lecture seule),
  `services/detection/behavior-analyzers.ts`.

## D-048 — Détection de potentielle collusion : score et alertes internes (R-36, étape 4)

- **Date** : 2026-10-08 · **Statut** : étape 4 demandée par le propriétaire du projet ;
  formule, contributions, seuils de niveaux et d'alerte PROVISOIRES (non validés) ·
  **Ne tranche pas** : administration (étape 5), conséquences, transparence envers les
  joueurs. Détails : [detection.md](detection.md).
- **Nature** : le score est un INDICATEUR STATISTIQUE de 0 à 100, jamais une preuve de
  triche. Une alerte signifie seulement « plusieurs signaux justifient une analyse ». AUCUNE
  sanction, suspension, exclusion, modification de gains, de mise ou de classement, AUCUNE
  accusation ni notification automatique. Rien n'est exposé aux joueurs.
- **Formule `SUSPICION_SCORE_V2`** (remplace V1 de D-044, jamais activée en production) :
  par sujet (joueur seul ou paire ; groupe prévu mais aucun signal n'en produit), sur ses
  signaux des 30 derniers jours (parties surveillées uniquement) : par type, la plus forte
  contribution (plafonnée par `SIGNAL_RULES`), puis somme plafonnée à 100. Un même constat
  répété dans plusieurs parties ne compte qu'une fois.
- **Niveaux** : ceux de D-044 (0–24 faible, 25–49 modéré, 50–74 élevé, 75–100 très élevé).
- **Alertes internes** : HIGH → priorité NORMAL, VERY_HIGH → PRIORITY ; jamais pour LOW ou
  MODERATE ; jamais avec un seul type de signal. Statut interne NEW / REVIEWED / DISMISSED /
  RESOLVED (administration, étape 5). Déduplication par
  `SUSPICION_LEVEL|sujet|niveau|version|période de 30 jours` (clé unique en base) ; une
  alerte HIGH n'est pas recréée si une VERY_HIGH existe sur la période.
- **Historique** : un instantané par (partie analysée, sujet) avec score précédent, signaux
  retenus (type, contribution, signal, partie source), version et date ; jamais supprimé.
- **Technique** : migration **0016** (clé de sujet calculée sur les signaux, colonnes
  d'historique, `detection_alerts` avec les mêmes gardes que signaux et scores) ; calcul
  dans `DetectionService.recordSignals`, en file par partie, en arrière-plan ; GameService
  inchangé.

## D-049 — Détection de potentielle collusion : administration (R-36, étape 5)

- **Date** : 2026-10-08 · **Statut** : étape 5 demandée par le propriétaire du projet ;
  rôle `admin` et machine d'état des alertes PROVISOIRES · **Ne tranche pas** : R-09
  (Katika / Admin), conséquences d'une alerte, transparence envers les joueurs. Détails :
  [detection.md](detection.md).
- **Périmètre** : consultation des alertes (liste paginée, filtres, tri par liste blanche,
  détail, signaux examinés, historique du score) et changement de leur statut. AUCUNE
  sanction, aucun bannissement, aucune accusation, aucune modification du jeu, des comptes,
  des gains ou des scores. Aucune interface joueur ; API seulement.
- **Accès** : routes `/api/admin/detection/*` derrière `requireAuth` puis
  `requireRole('admin')`, rôle lu dans la session serveur (relu en base à chaque requête).
  Rôle `admin` ajouté au système EXISTANT `users.role` (pas de second système), attribuable
  uniquement par `npm run user:role` (aucune route). L'acteur est toujours l'appelant
  authentifié, jamais un identifiant reçu.
- **Statuts** : `NEW → REVIEWED → RESOLVED`, `NEW → DISMISSED` ; `DISMISSED` et `RESOLVED`
  finaux. Transaction avec verrou de ligne ; transition interdite → 409
  `ALERT_TRANSITION_NOT_ALLOWED` ; `expectedStatus` périmé → 409 `ALERT_STATUS_CONFLICT` ;
  statut déjà atteint → 200 `changed: false`, sans audit.
- **Audit** : `admin_audit_log` (acteur, action, cible, `{ from, to }`, date), écrit dans la
  même transaction que le changement ; jamais de jeton, mot de passe, IP, position ni donnée
  de jeu.
- **Confidentialité** : éléments justificatifs en représentation administrative minimisée
  (coordonnées, IP, cartes, mains, jetons retirés ou masqués) ; aucune donnée personnelle de
  compte ; aucune collecte réseau ajoutée.
- **Technique** : migration **0017** (`0017_admin_role_and_audit.sql` : rôle `admin`,
  `admin_audit_log`, index de liste) ; `DetectionAdminService` +
  `PostgresDetectionAdminRepository` sur les tables de l'étape 4 (aucune copie) ;
  `DetectionService`, `GameService`, formule `SUSPICION_SCORE_V2`, contributions et seuils
  inchangés.

## D-050 — Achat de jetons par CinetPay (API v1), fournisseur du compte de jeu

- **Date** : 2026-10-08 · **Statut** : validée par le propriétaire du projet · **Complète** :
  D-040 · **Tranche pour l'ACHAT seulement** : R-13 (1 FCFA = 1 jeton), R-16 (montants
  500 / 1 000 / 2 000 / 5 000 FCFA) · **Ne tranche pas** : R-13 hors achat (mise, retrait,
  tournois), R-16 pour le retrait, R-34 (téléphone vérifié, non exigé), T-07 (licence).
- **Principes** :
  - CinetPay est le fournisseur du port existant `MobileMoneyGateway` (`CinetPayGateway`) : ni
    second portefeuille, ni système de paiement parallèle. Le compte de jeu reste la source de
    vérité ; le crédit passe par le règlement idempotent du compte de jeu (`settle`).
  - **Nouvelle API v1** uniquement (`/v1/oauth/login`, `/v1/payment`, `/v1/payment/{id}`),
    contrats relevés dans le code des SDK officiels `cinetpay-js` / `cinetpay-go`.
  - Achat en **XAF**, devise fixée par le serveur. **Aucun `gameId`** : le compte appartient au
    joueur. Identité issue du JWT uniquement.
  - Une notification n'est **jamais** une preuve. Le serveur compare le `notify_token` à son
    empreinte SHA-256, en temps constant, vérifie la référence, **relit** le statut chez
    CinetPay (serveur à serveur), vérifie les références (et le montant et la devise s'ils
    sont renvoyés), puis règle.
  - Retour de l'application : page HTTPS du backend → `leter://payment/return` (CinetPay
    n'accepte que des URL http(s)). L'application relit le statut : elle ne conclut jamais.
  - Retrait **hors périmètre** : refusé proprement, rien n'est débité.
- **Décisions techniques** :
  - Migration **0017_payments** : table `payments` 1–1 avec `wallet_transactions`, statuts
    `PENDING` / `SUCCESS` / `FAILED` / `EXPIRED`, `UNIQUE (provider, provider_reference)` et
    `(provider, merchant_transaction_id)`, empreinte du `notify_token` seulement.
  - Paiement réglé dans **une** transaction SQL : verrou du paiement, puis le corps de
    `WalletRepository.settle` (`settleWalletTransaction`, même code), puis statut du paiement.
    Erreur → ROLLBACK complet. Le statut du paiement suit l'issue réelle du compte de jeu.
  - API : `POST /api/wallet/deposits` (inchangée, `{ tokens, currency? }`, renvoie `payment`),
    `GET /api/payments/:id` (propriétaire seulement, sinon 404 identique ; revérifie un
    paiement en attente), `POST /api/payments/cinetpay/notify` (public, limité par IP),
    `GET /api/payments/cinetpay/return/:paymentId` (redirection, sans effet).
    `GET /api/wallet` ajoute `withdrawalAvailable`.
  - Configuration : `CINETPAY_API_KEY`, `CINETPAY_API_PASSWORD`, `CINETPAY_NOTIFY_URL`,
    `CINETPAY_RETURN_URL` (+ facultatifs `CINETPAY_BASE_URL`, `CINETPAY_APP_RETURN_URL`,
    `CINETPAY_TIMEOUT_MS`). Sans clé : comportement D-040 (refus propre).
  - Frontend : Boutique → Acheter = 4 montants, `expo-web-browser`, route `payment/return`.
  - Détail : `docs/payments.md`.
- **Compléments (2026-10-08, stabilisation avant sandbox)** :
  - Prénom ou nom d'une lettre (accepté par le compte, refusé par CinetPay : 2 à 255
    caractères) : refus `422 PAYMENT_PROFILE_INCOMPLETE` AVANT toute écriture, via la méthode
    facultative `assertCollectionEligible` du port. Les règles du compte sont inchangées et
    rien n'est complété à la place du joueur.
  - La route `payment/return` est hors `Stack.Protected` : ouverte à froid pendant la
    restauration de la session, une garde fausse redirige vers l'accueil et perd le lien.
    L'écran gère lui-même la session ; le serveur reste seul juge.
  - Journalisation du webhook : `notification received` → `payment verified` →
    `payment settled` (identifiants et statuts seulement).

## D-051 — Tournois : première version (inscription gratuite, tables de 4, accès réservé) — remplacée en partie par D-054

- **Date** : 2026-10-08 · **Statut** : validée par le propriétaire du projet ·
  **Tranche partiellement** : R-11 (création, inscription, formation des tables) ·
  **Ne tranche pas** : R-09 (Admin / Katika), R-13 (jetons), barème, classement, primes,
  départage, limite « un tournoi par jour ».
- **Création** : uniquement par une opération d'exploitation, `npm run tournament:create`
  (même modèle que `game:finish`). AUCUN endpoint public de création, AUCUN nouveau rôle.
- **Période et statut** : un tournoi a un début et une fin (`timestamptz`, jamais de
  comparaison de chaînes). Le statut est CALCULÉ par le serveur à partir de son horloge :
  `SCHEDULED` avant le début, `IN_PROGRESS` entre début (inclus) et fin (exclue),
  `COMPLETED` ensuite ; `CANCELLED` est le seul statut enregistré (annulation). Aucun timer
  de bascule. Le client reçoit `serverNow` pour un compte à rebours ; il ne décide jamais
  qu'un tournoi a commencé ou fini.
- **Inscription** : GRATUITE dans cette version (aucun jeton, aucun paiement). Ouverte
  seulement tant que le tournoi est `SCHEDULED`. Une inscription par (tournoi, joueur),
  garantie en base (`UNIQUE (tournament_id, user_id)`) → `409 ALREADY_REGISTERED`.
  `maxPlayers` du tournoi (facultatif) limite le nombre d'inscrits, contrôlé sous verrou
  du tournoi → `409 TOURNAMENT_FULL`. La colonne `status` de l'inscription prépare des frais
  futurs (seule valeur aujourd'hui : `REGISTERED`).
- **Rejoindre** (`POST /api/tournaments/:id/join`), contrôles serveur dans l'ordre : tournoi
  existant, `IN_PROGRESS`, joueur authentifié (JWT) et inscrit, pas d'autre session active
  (`409 ALREADY_IN_SESSION`, R-18 inchangée). Puis : première table du tournoi (la plus
  ancienne) dont la partie est EN ATTENTE avec un siège libre ; sinon une nouvelle session
  est créée par `SessionService` (le joueur en est le créateur). Aucun tirage aléatoire,
  aucun matchmaking. Un joueur déjà assis à une table du tournoi y est renvoyé (idempotent).
  Réponse : `{ tournamentId, sessionId, gameId }` ; le client ouvre l'écran de jeu existant
  `/game/[gameId]`.
- **Tables** : capacité **4**, immuable (règle de session D-034). Démarrage : règles
  existantes inchangées (seul le créateur, à partir de 2 joueurs, R-23). La session est liée
  au tournoi par `tournament_sessions` ; les parties restent l'unité d'isolation (`gameId`).
- **Accès réservé** : une table de tournoi n'apparaît PAS dans `GET /api/sessions/open` et
  `POST /api/sessions/:id/join` la refuse (`403 TOURNAMENT_ACCESS_DENIED`) à un joueur non
  inscrit ou hors période. Mécanisme : dépendance FACULTATIVE `admission` de SessionService,
  sans effet par défaut (aucune règle de session existante modifiée).
- **Fin** : après la fin, plus aucun `join`. Les données (tournoi, inscriptions, tables) ne
  sont jamais supprimées. Le comportement des parties encore en cours à l'heure de fin
  (enchaînement D-042 à une table de tournoi) n'est PAS défini : rien n'est interrompu.
- **Temps réel** : aucune nouvelle infrastructure. Le client relit le tournoi (TanStack
  Query) au retour sur l'écran et à l'échéance suivante (début ou fin) calculée avec
  `serverNow`, sans polling agressif.
- **Concurrence** : la recherche-ou-création d'une table est sérialisée par tournoi dans
  une instance. Entre deux instances, deux joueurs simultanés peuvent ouvrir deux tables :
  chacune reste valide (aucune règle violée).

## D-052 — Module Réglages : son, langues, assistance et documents légaux

- **Date** : 2026-10-08 · **Statut** : demandé par le propriétaire du projet · **Ne tranche
  pas** : plateforme d'assistance, identité légale de l'éditeur, juridiction, âge minimum,
  sons définitifs (sons de partie, habillage sonore). Détails : [settings.md](settings.md).
- **Préférences** : `soundEnabled` (défaut `true`) et `language` (`fr` | `en`, défaut `fr`)
  dans `usePreferencesStore`, source de vérité unique, persistées sur l'appareil via
  `expo-secure-store` (déjà présent, aucune seconde architecture de persistance), relues et
  nettoyées au lancement. Préférences de l'appareil : aucun `gameId`, aucun envoi au serveur,
  aucun effet sur les parties.
- **Son** : `playSound` (`services/audio-service.ts`) est l'unique point d'entrée audio et
  respecte la préférence. Lecteur réel `expo-audio` ~57.0.5 (+ `expo-asset`), un lecteur par
  son créé à la demande, tous libérés au passage sur OFF ; plugin sans micro ni lecture en
  arrière-plan. Trois sons d'interface synthétisés localement (`assets/audio/`).
- **Langues** : i18n légère sans dépendance (`lib/i18n`, dictionnaires typés), changement
  immédiat. Traduits : Réglages, documents légaux, accueil, coquille des écrans connectés.
- **Assistance** : `SUPPORT_URL` = `EXPO_PUBLIC_SUPPORT_URL` ; vide → message « bientôt
  disponible », jamais d'adresse fictive.
- **Documents légaux** : route `/legal/[document]` (accessible sans connexion), contenu FR/EN
  dans `features/legal/content/`, repères entre crochets pour toute information inconnue
  (`LEGAL_INFO`). Projets à faire valider juridiquement avant publication.

## D-053 — Détection anti-collusion : interrupteur global (administration)

- **Date** : 2026-10-08 · **Statut** : demandé par le propriétaire du projet · Détails :
  [detection.md](detection.md) (« Interrupteur global »).
- **Règle** : la détection d'une partie exige l'interrupteur GLOBAL activé ET
  `suspicionDetectionEnabled` de sa table (D-043). **Défaut : désactivé.**
- **Source de vérité** : PostgreSQL, `system_settings` (migration 0020, clé
  `detection_enabled`, ligne absente = désactivé), relu à chaque consultation ; aucun cache,
  aucun Redis, aucun état frontend.
- **Point de contrôle unique** : `DetectionService.isEnabled` (avant toute lecture, analyse,
  écriture, score ou alerte) et l'accès de `GeolocationService` (positions refusées, aucune
  collecte demandée au téléphone). Analyseurs, formule `SUSPICION_SCORE_V2`, contributions,
  seuils et GameService inchangés.
- **Désactivation** : n'arrête aucune partie, ne modifie ni cartes, ni résultats, ni gains, ne
  supprime aucune donnée ; empêche seulement toute nouvelle activité de détection.
- **Administration** : `GET`/`PATCH /api/admin/settings/detection` (rôle `admin` relu en base,
  acteur = session) ; audit `DETECTION_ENABLED` / `DETECTION_DISABLED` dans `admin_audit_log`
  (D-049), même transaction, `{ key, from, to }`. Écran `/admin` dans l'application (Expo
  Router), sans lien depuis les écrans joueur.
- **Joueurs** : rien n'est exposé ; réponse de géolocalisation identique à celle d'une table
  non surveillée ; application joueur inchangée.

## D-054 — Tournois : réservation financière, cagnotte, jetons de tournoi, classement et gains

- **Date** : 2026-10-08 · **Statut** : validée par le propriétaire du projet, qui a délégué
  le choix des règles secondaires (choix les plus sûrs, documentés ici) · **Remplace** : D-051
  pour la création, l'inscription gratuite et le statut calculé ; D-051 reste valable pour
  l'attribution des tables (4 places, première table en attente, sinon nouvelle) et l'accès
  réservé aux tables · **Tranche** : R-11 ; R-13 pour les tournois (1 FCFA = 1 jeton du
  compte de jeu).
- **Règle officielle (réservation)** : *Une inscription à un tournoi entraîne une réservation
  financière du montant de participation. Le compte du joueur n'est pas débité définitivement
  au moment de l'inscription. Le montant réservé est bloqué afin de garantir la participation.
  Si le tournoi est annulé avant son démarrage, la réservation est automatiquement libérée.
  Si le tournoi atteint les conditions de démarrage, les réservations sont capturées et
  deviennent les paiements définitifs du tournoi.*
- **Compte de jeu (extension de D-040, pas de second portefeuille)** :
  - `wallets.reserved` = somme des réservations ACTIVE, maintenue dans la même transaction que
    chaque réservation ; **disponible = solde − réservé** ; garanti en base par
    `CHECK (0 <= reserved <= balance)`. Un retrait vérifie le DISPONIBLE.
  - `wallet_reservations` : `ACTIVE → CAPTURED | RELEASED` (`EXPIRED` prévu, non utilisé) ;
    une seule réservation non libérée par inscription (index unique partiel).
  - Capture = transaction `tournament_entry` (débit du solde ET du réservé), clé
    d'idempotence `tournament-entry:<réservation>`. Gain = transaction `tournament_prize`,
    clé `tournament-prize:<tournoi>:<rang>`. Libération : aucune transaction (rien n'avait
    été débité) ; `reserved` diminue et la réservation passe `RELEASED`.
  - Montants entiers en jetons du compte de jeu, devise affichée **XAF** (1 FCFA = 1 jeton).
    Prix d'entrée de 0 autorisé : réservation de 0, capture sans transaction.
- **Compte de la plateforme** : `platform_ledger` (pas un utilisateur) : une écriture
  `TOURNAMENT_PLATFORM_FEE` par tournoi (montant, taux) et, s'il y a lieu, une écriture
  `UNALLOCATED_PRIZE` ; unicité (tournoi, type) = idempotence. Le compte Katika (R-09)
  reste distinct et non défini.
- **Cagnotte** (figée au démarrage, jamais recalculée) : `gross_pool = prix × participants` ;
  `platform_fee = floor(gross × taux)` (arrondi en faveur des joueurs) ;
  `prize_pool = gross − fee`. Le taux (`platform_fee_bps`, points de base : 1000 = 10 %) est
  copié des paramètres à la PUBLICATION et n'est plus jamais relu.
- **Paramètres** (`system_settings`, rôle `admin`) : `tournament_platform_fee_percent` 10,
  `initial_tournament_tokens` 1000, `default_tournament_stake` 100,
  `maximum_pending_tournaments_per_player` 1, `tournament_transition_minutes` 0. Paramètre
  absent : valeur par défaut. Changement audité dans `admin_audit_log`.
- **Création** :
  - Admin (`requireRole('admin')`, aucun rôle Katika) : tournoi PUBLIÉ directement.
  - Joueur : `DRAFT` → (soumission) `PENDING_APPROVAL` → (admin) `SCHEDULED`, ou refus
    (`CANCELLED`, motif `APPROVAL_REJECTED`). Au plus
    `maximum_pending_tournaments_per_player` tournois DRAFT/PENDING par joueur.
  - Limites plateforme (constantes du domaine) : début au moins 1 h après la demande d'un
    joueur ; durée 15 min à 24 h ; prix 0 à 100 000 ; joueurs 2 à 1 000 (min ≤ max) ; mise 1
    à jetons initiaux (**D-063 : 1 à la moitié des jetons initiaux**) ; 1 à 10 rangs payés dont la somme vaut exactement 100 %.
  - Modification avant verrouillage : tout tant qu'aucune inscription n'est active ; ensuite
    nom et description seulement (les inscrits ont réservé à ces conditions).
- **Chevauchement** : interdit entre tournois publiés et non terminés (`SCHEDULED` à
  `CALCULATING_RESULTS`), garanti par PostgreSQL : contrainte d'exclusion GiST sur
  `[starts_at, blocked_until)` (`blocked_until = fin + tournament_transition_minutes`, figé à
  la publication) → `409 TOURNAMENT_OVERLAP`. Un tournoi non publié ne bloque rien ; le
  contrôle a lieu à l'approbation.
- **États** (transitions centralisées dans `TournamentService`, ligne verrouillée
  `FOR UPDATE`, toute autre transition refusée) :
  `DRAFT → PENDING_APPROVAL → SCHEDULED → REGISTRATION_OPEN → REGISTRATION_CLOSED → STARTING →
  IN_PROGRESS → CALCULATING_RESULTS → RESULTS_VALIDATED → DISTRIBUTING_PRIZES → COMPLETED` ;
  `CANCELLED` depuis tout état AVANT la capture, jamais après (`409 TOURNAMENT_STARTED`).
  Les échéances (`registration_opens_at` = publication par défaut, `registration_closes_at` =
  début par défaut, début, fin) sont en base ; `TournamentScheduler` (tick de 15 s) applique
  les transitions dues, et chaque commande fait d'abord avancer son tournoi : reprise
  automatique après redémarrage, une seule instance applique chaque transition.
- **Inscription** (UNE transaction : verrou du tournoi, statut et fenêtre, capacité, verrou du
  portefeuille, disponible ≥ prix, inscription + réservation ; tout ou rien) : un joueur par
  tournoi (`UNIQUE`) → `409 ALREADY_REGISTERED` ; `409 TOURNAMENT_FULL`,
  `409 INSUFFICIENT_BALANCE`, `409 REGISTRATION_CLOSED`. **Désinscription** avant la
  fermeture : inscription `CANCELLED` + réservation libérée ; une nouvelle inscription
  réactive la même ligne avec une nouvelle réservation. Après la fermeture :
  `409 REGISTRATION_CLOSED` ; après le démarrage : `409 TOURNAMENT_STARTED`.
- **Démarrage** (à `starts_at`) : `STARTING`, puis en UNE transaction : inscrits < minimum →
  `CANCELLED` (`INSUFFICIENT_PLAYERS`) et toutes les réservations libérées ; sinon capture
  de toutes les réservations, écriture de la commission, cagnotte figée, un compte de
  tournoi par inscrit (jetons initiaux), `IN_PROGRESS`.
- **Annulation** : motif obligatoire parmi `INSUFFICIENT_PLAYERS`, `ADMIN_CANCELLED`,
  `SYSTEM_ERROR`, `PAYMENT_ERROR`, `APPROVAL_REJECTED`, `CREATOR_CANCELLED` ; toujours avec
  libération de toutes les réservations actives, dans la même transaction.
- **Jetons de tournoi** : `tournament_player_accounts` (un par inscrit au démarrage),
  indépendants du compte de jeu, ni retirables ni transférables. Mise par partie
  `stake_per_game` (défaut 100). Règlement à la FIN de chaque partie d'une table du tournoi
  (`tournament_games`, une ligne par `gameId` = idempotence) : mise effective
  `e = min(mise, jetons du gagnant)` ; chaque autre joueur de la partie (fuyard compris) paie
  au gagnant `min(e, ses jetons)` : jamais de solde négatif, jamais de jetons créés (règle du
  « tapis » : on ne gagne pas plus que ce qu'on risque). Parties jouées +1 pour tous,
  gagnées +1 pour le gagnant. Partie sans gagnant (égalité rejouée, arrêt administratif) ou
  commencée après la fin : `VOID`, aucun mouvement. Un compte sous la mise passe
  `OUT_OF_TOKENS` (**seuil remplacé par D-063 : moins de 2 × la mise**) : il ne peut plus rejoindre une table du tournoi
  (`409 TOURNAMENT_OUT_OF_TOKENS`) et garde ses jetons et son classement. Les parties d'une
  table de tournoi n'ont aucune mise réelle : le compte de jeu n'est jamais touché pendant
  une partie.
  **Révisé par D-111** pour les tournois démarrés après la migration 0044 : règles de
  règlement des parties ordinaires (Kora 2M, fuyards à 3-4 non réglés) sur le compte fictif,
  sans commission ; comptes dissous à `COMPLETED`.
- **Fin** (à `ends_at`) : plus aucune table attribuée ; `CALCULATING_RESULTS` attend la fin
  des parties commencées avant `ends_at`, au plus 10 min (au-delà, elles sont `VOID`).
  **Remplacé par D-106** : la clôture attend TOUTES les parties commencées, sans jamais les
  annuler (alerte au-delà de 10 min).
- **Classement** (déterministe, sans ex æquo) : jetons restants DESC, parties jouées DESC,
  parties gagnées DESC, date d'inscription ASC.
  **Remplacé par D-062** (score pondéré) pour les tournois classés après la migration 0025.
- **Gains** : rang r payé `floor(prize_pool × part_r)` ; le reste d'arrondi va au 1er rang.
  Rangs sans joueur : leur part est écrite `UNALLOCATED_PRIZE` dans `platform_ledger`, non
  redistribuée. Résultats (`tournament_results`) écrits une fois, validés automatiquement
  (`RESULTS_VALIDATED`, aucune validation manuelle), puis immuables ; versement d'un gain par
  transaction (`DISTRIBUTING_PRIZES`), idempotent par sa clé ; `COMPLETED` quand tout est
  versé.
- **Notifications** : table `notifications` dans l'application (pas de FCM, T-02), écrite
  dans la transaction de l'événement, dédoublonnée par clé : `TOURNAMENT_APPROVED`,
  `TOURNAMENT_REGISTRATION_CONFIRMED`, `TOURNAMENT_CANCELLED`, `TOURNAMENT_STARTED`,
  `TOURNAMENT_RESULTS_AVAILABLE`, `TOURNAMENT_PRIZE_CREDITED`. API `GET /api/notifications`,
  `POST /api/notifications/:id/read`.
- **Résultats et export** : `GET /api/tournaments/:id/results` (rang, pseudo, jetons, parties
  jouées et gagnées, gain) et résumé partageable en texte (WhatsApp = canal complémentaire,
  jamais source de vérité) ; export CSV admin, formaté par un formateur isolé (XLSX
  ajoutable sans toucher au calcul).
- **Technique** : migration **0021** (0019 conservée : elle a pu être appliquée ; les
  tournois gratuits de la première version passent `CANCELLED` / `SYSTEM_ERROR`).
- **API** (toutes authentifiées ; identité issue du JWT) :
  - Joueur `/api/tournaments` : `GET /active`, `GET /mine`, `POST /` (proposition),
    `GET|PATCH /:id`, `POST /:id/submit`, `POST /:id/withdraw`, `POST /:id/register`,
    `POST /:id/unregister`, `POST /:id/join` → `{ tournamentId, sessionId, gameId }`,
    `GET /:id/standings`, `GET /:id/results`.
  - Admin `/api/admin/tournaments` (`requireRole('admin')`, audité) : `GET|PATCH /settings`,
    `GET /`, `POST /`, `GET|PATCH /:id`, `POST /:id/approve|reject|cancel`,
    `GET /:id/registrations`, `GET /:id/results`, `GET /:id/results.csv`.
  - `GET /api/notifications`, `POST /api/notifications/:id/read` ; `GET /api/wallet` expose
    aussi `reserved` et `available`.
  - Commande d'exploitation : `npm run tournament:create -- --admin <email> …` (même chemin
    que l'API admin).
- **Frontend** : `TournamentWidget` sur `/tournament` uniquement (HomeScreen inchangé) ; états
  NO_TOURNAMENT / UPCOMING / REGISTERED / WAITING / IN_PROGRESS / COMPLETED dérivés du statut
  du serveur ; rejoindre → `router.replace('/game/<gameId>')` (écran de jeu existant).

## D-055 — Tournois : interfaces joueur et administration, attribution des tables atomique

- **Date** : 2026-10-09 · **Statut** : demandé par le propriétaire du projet (choix
  techniques délégués) · **Complète** : D-054 (aucune règle de D-054 modifiée).
- **Atomicité table → tournoi** : une table de tournoi est créée par
  `SessionService.createSession({ …, tournamentId })` ; `createWithFirstGame` insère la
  session, sa première partie ET la ligne `tournament_sessions` dans UNE transaction. Aucune
  table de tournoi n'existe jamais sans son rattachement : elle n'apparaît jamais dans
  `GET /api/sessions/open`, même un instant, et un échec ou un arrêt ne laisse rien
  (ROLLBACK complet). L'ancien rattachement séparé (`linkSession`) est supprimé.
- **Concurrence (plusieurs instances)** : dans cette même transaction, la ligne du tournoi est
  verrouillée (`FOR NO KEY UPDATE`, compatible avec le contrôle de clé étrangère du
  rattachement), puis le serveur revérifie que le tournoi est en cours et qu'AUCUNE table du
  tournoi n'est joignable (partie en attente, siège libre). Sinon la création est refusée
  (`TournamentTableAvailableError`, interne) et TournamentService rejoint la table existante
  (au plus 3 tours ; au-delà `409 TOURNAMENT_BUSY`, « réessayez »). Deux joueurs arrivant en
  même temps sur deux instances partagent donc la même table ; une seconde table n'est ouverte
  que lorsque la première est pleine ou a démarré. Les arrivées dans une table existante
  restent sérialisées par le verrou de la session (D-034). Aucune nouvelle infrastructure
  (ni Redis, ni verrou consultatif).
- **Interface joueur** : `/tournament/propose` (lien « Proposer un tournoi » au bas du cercle
  de l'écran Tournois ; HomeScreen et widget inchangés) : formulaire (nom, description, date,
  heure, durée, participation, minimum, maximum, rangs et parts) et « Mes propositions »
  (Brouillon, En attente d'approbation, Approuvé, Refusé, Retiré, Annulé ; Soumettre /
  Retirer). L'écran ne vérifie que le FORMAT ; les limites de D-054 restent appliquées et
  expliquées par le serveur (erreurs par champ).
- **Interface d'administration** : `/admin/tournaments` (rôle `admin` existant, lien depuis
  `/admin`) : liste filtrée par statut (créateur, inscrits, min/max, commission, création),
  création publiée, détail (approuver, refuser, annuler avec confirmation quand l'état le
  permet, inscriptions et réservations, cagnotte, classement), export CSV produit par le
  serveur et transmis tel quel par la feuille de partage du téléphone (`Share`, aucune
  nouvelle dépendance), paramètres de D-054. `GET /api/admin/tournaments` renvoie en plus
  `registeredCount`, `creatorName` et `createdAt`.
- **Hors périmètre** : règlement de `platform_ledger` vers le compte Katika (R-09).

## D-056 — Tournois : corrections post-audit (démarrage bloqué, brouillons, fin des tables)

- **Date** : 2026-10-09 · **Statut** : demandé par le propriétaire du projet (choix
  techniques délégués) · **Complète** : D-054, D-055 (aucune règle financière modifiée).
- **Démarrage bloqué** : un échec du démarrage (transaction de capture) est journalisé
  (`TOURNAMENT_START_FAILED`, avec `alert: true` à partir du 3e échec consécutif) et retenté
  au tick suivant. Passé `starts_at` + **15 min** (`START_RECOVERY_MS`, réglable par la
  dépendance `startRecoveryMs`), le tournoi est annulé `SYSTEM_ERROR` et ses réservations
  ACTIVES sont libérées, sur la ligne verrouillée, seulement s'il est TOUJOURS `STARTING` et
  qu'AUCUNE réservation n'est `CAPTURED` (capture et `IN_PROGRESS` sont une seule
  transaction). Sinon : rien n'est libéré, alerte critique `TOURNAMENT_START_INCONSISTENT`.
  Le délai ne dépend que de `starts_at` (persisté) : un redémarrage reprend la récupération.
  L'« alerte » est une ligne de journal de niveau `error` (aucune nouvelle infrastructure).
- **Brouillons** : un tournoi jamais publié (`published_at` absent : brouillon, en attente,
  refusé, retiré) n'est lisible (`GET /api/tournaments/:id`, `…/standings`) que par son
  créateur et le rôle `admin` ; pour les autres : `404 TOURNAMENT_NOT_FOUND` (l'existence
  n'est pas révélée). **Modifié par D-108** : une proposition SOUMISE est visible de tous ;
  refusée ou retirée, elle reste aussi visible de ses anciens préinscrits.
- **Fin des tables** : `SessionService` accepte une politique FACULTATIVE de continuation
  (sans effet par défaut). Tables de tournoi : aucune nouvelle partie (suivante automatique
  D-042, reprise après égalité, partie demandée → `409 SESSION_CLOSED`) une fois le tournoi
  hors `IN_PROGRESS` ou `ends_at` atteint. Les parties commencées avant `ends_at` se
  terminent et sont réglées dans le délai de grâce de D-054. Les joueurs encore assis
  reçoivent une notification `TOURNAMENT_TABLE_CLOSED` (une par table). Migration **0022**
  (ajout de ce type de notification uniquement).
- **Délai d'une heure** : revérifié à la soumission ET à l'approbation d'une proposition de
  joueur (le début doit rester au moins 1 h plus tard) ; un tournoi de l'administration doit
  seulement commencer dans le futur. **Modifié par D-108** : plus à l'approbation (début
  seulement à venir).
- **Solde affiché** : le HUD (accueil et table de jeu) affiche le DISPONIBLE ; les fonds
  réservés sont indiqués à part (« 🔒 1000 ») et dans le libellé d'accessibilité.
- **PostgreSQL réel** : tests de concurrence à plusieurs connexions et deux instances
  (inscription avec réservation, attribution des tables) dans
  `tests/integration/tournaments/postgres-tournament-concurrency.test.ts`, exécutés seulement
  avec `TEST_DATABASE_URL` vers une base de TEST dédiée (schéma temporaire), jamais si l'URL
  est celle de l'application.

## D-057 — Tournois : durée 45 à 120 min, 20 à 1 000 participants, message « Tournoi complet »

- **Date** : 2026-10-09 · **Statut** : demandé par le propriétaire du projet ·
  **Remplace** : les limites de durée (15 min à 24 h) et de participants (2 à 1 000) de
  D-054 ; D-054, D-055 et D-056 sont inchangées pour le reste. (Demandée sous le numéro
  D-056, déjà attribué aux corrections post-audit : enregistrée sous le prochain numéro libre.)
- **Règles** (tournois de l'administration ET propositions de joueurs, bornes incluses) :
  durée **45 à 120 minutes** ; minimum de participants **20 à 1 000** ; maximum, s'il est
  fixé, **20 à 1 000** et au moins égal au minimum.
- **Contrôles serveur** (source de vérité, `validateTournamentInput`) : à la création, à la
  modification autorisée, et désormais aussi à la soumission et à l'approbation d'une
  proposition (un brouillon créé sous d'anciennes limites ne peut être ni soumis ni publié).
  Les tournois déjà publiés ne sont pas modifiés rétroactivement.
- **Conséquence** : avec 20 participants au moins et 10 rangs payés au plus, tous les rangs
  payés sont toujours occupés ; la part « non attribuée » de D-054 reste dans le code
  (calcul inchangé) mais ne peut plus se produire.
- **Capacité atteinte** : contrôle inchangé (verrou de la ligne du tournoi, compte des
  inscriptions actives dans la même transaction : jamais de dépassement, même en
  concurrence) ; code `409 TOURNAMENT_FULL`. Message de l'API adouci (« Tournoi complet 🎉 … »).
  Application : ce code, et lui seul, est affiché comme une INFORMATION (titre doré
  « Tournoi complet 🎉 », pas d'alerte rouge) :
  - inscription refusée : « Ce tournoi a atteint son nombre maximum de participants. Merci
    pour ton intérêt ! Découvre les autres tournois disponibles pour participer à la
    prochaine partie. » ;
  - tournoi déjà complet (consultation, ou tournoi en cours pour un non-inscrit) : « Toutes
    les places de ce tournoi sont prises. Merci pour ton intérêt, on te retrouve au prochain
    tournoi ! ».
  Les erreurs financières, de réservation et de connexion gardent leurs messages.
- **Valeur par défaut** : formulaires (joueur, admin) et `npm run tournament:create` : 20
  joueurs minimum.

## D-058 — Tournois : durée de 30 à 120 minutes, message de durée imposé

- **Date** : 2026-10-09 · **Statut** : demandé par le propriétaire du projet ·
  **Remplace** : la durée minimale de D-057 (45 min) ; le reste de D-057 (participants,
  « Tournoi complet ») et D-054, D-055, D-056 sont inchangés. (Demandée sous le numéro D-057,
  déjà attribué : enregistrée sous le prochain numéro libre.)
- **Règle** (tournois de l'administration ET propositions de joueurs, bornes incluses) :
  durée **30 à 120 minutes**. 29 min et 121 min refusées ; 30, 45 et 120 min acceptées.
- **Message** : une durée hors limites affiche EXACTEMENT
  `Durée entre 30 minutes et 120 minutes.` (point final compris, aucun texte ajouté). Ce
  texte remplace celui demandé initialement (« Durée entre 45 minutes et 120 minutes »), à la
  demande du propriétaire du projet.
- **Serveur** (source de vérité) : `TOURNAMENT_LIMITS.minDurationMs` / `maxDurationMs` et
  `TOURNAMENT_DURATION_ERROR` dans `domain/tournaments/tournament.ts`, appliqués par
  `validateTournamentInput` (création, modification, soumission, approbation, outil
  `tournament:create`) ; erreur `400` avec `fields.endsAt`. La durée est `endsAt − startsAt`
  (instants ISO 8601), comparée en millisecondes.
- **Application** : les deux formulaires (proposition, création admin) partagent
  `toTournamentPayload`, qui refuse une durée hors limites avant tout appel API, avec le même
  message (`TOURNAMENT_DURATION_MINUTES`, `TOURNAMENT_DURATION_ERROR` dans
  `features/tournaments/tournament-form.ts`, miroir du serveur : pas de code partagé entre
  `frontend/` et `backend/`). Saisie en minutes entières (`^\d+$`, espaces ignorés) ; `endsAt`
  = début + durée × 60 000 ms. Le message du serveur, identique, est placé sur le champ
  « Durée (minutes) ».
- **Valeur par défaut** : les formulaires (proposition, création admin) proposent **60 minutes**
  (`TOURNAMENT_DURATION_MINUTES.default`), modifiable dans les limites ci-dessus.
- **Données** : aucune migration (aucune contrainte de durée en base). Les tournois existants
  ne sont pas modifiés.

## D-059 — Tournois : 5 tournois en attente au plus, non-chevauchement, prochain tournoi à l'accueil

- **Date** : 2026-10-09 · **Statut** : demandé par le propriétaire du projet ·
  **Complète** : D-054 à D-058 (durée, joueurs, réservations, commissions et gains inchangés).
- **Limite de 5 tournois en attente de démarrage**, GLOBALE à la plateforme (la planification
  est globale : un seul tournoi à la fois, D-054). Sont comptés les tournois PUBLIÉS pas
  encore commencés : `SCHEDULED`, `REGISTRATION_OPEN`, `REGISTRATION_CLOSED`, `STARTING`
  (`WAITING_STATUSES`, `TOURNAMENT_LIMITS.maxWaitingTournaments`). Les brouillons et les
  propositions en attente d'approbation ne sont pas planifiés : non comptés (la limite d'UNE
  proposition en attente PAR JOUEUR, paramètre `maximumPendingTournamentsPerPlayer`, est
  conservée telle quelle). Une place se libère dès qu'un tournoi passe `IN_PROGRESS` ou
  `CANCELLED`.
  - **Garantie** (création admin, approbation d'une proposition — les deux seules façons
    d'entrer dans ces statuts) : verrou consultatif transactionnel PostgreSQL
    `pg_advisory_xact_lock(728302059)` pris EN PREMIER dans la transaction, puis comptage,
    puis insertion / publication ; les créations simultanées, sur toutes les instances, sont
    sérialisées et ne dépassent jamais 5. Ordre des verrous unique (planification, puis ligne
    du tournoi) : pas d'interblocage.
  - **Information au plus tôt** : la proposition d'un joueur (création du brouillon,
    soumission) est refusée avec le même message si la limite est déjà atteinte (sans
    verrou : la garantie reste l'approbation).
  - **Erreur** : `409 TOO_MANY_WAITING_TOURNAMENTS`, « Limite atteinte : 5 tournois sont déjà
    en attente de démarrage. Réessaie dès que l'un d'eux aura commencé. », affiché tel quel
    par les formulaires (joueur, admin).
- **Chevauchement** : règle INCHANGÉE, déjà garantie par PostgreSQL et désormais testée
  explicitement : contrainte d'exclusion GiST `tournaments_no_overlap` (migration 0021) sur
  `tstzrange(starts_at, blocked_until, '[)')`, avec `blocked_until` = fin + transition
  (0 min par défaut), pour les statuts publiés non terminés. Conflit si
  `début A < fin B ET début B < fin A` : 14:00–15:00 puis 15:00–16:00 accepté ;
  14:00–15:00 puis 14:30–15:30 refusé (`409 TOURNAMENT_OVERLAP`). Annulés, terminés,
  brouillons et propositions ne bloquent pas. Portée globale (aucun filtre par organisateur).
  Sûre en concurrence (contrainte vérifiée par PostgreSQL, quelle que soit l'instance).
- **Participation** : un joueur peut être inscrit à plusieurs tournois, même simultanés ;
  seule l'unicité (tournoi, joueur) des inscriptions s'applique (inchangée).
- **Accueil** : bouton « + Proposer un tournoi » sous le titre TOURNOIS (ouvre le parcours
  existant `/tournament/propose`) et, au-dessus de « Rejoindre », la date, l'heure de début
  et l'heure de fin du prochain tournoi auquel le joueur est inscrit (rien s'il n'y en a pas).
  Sélection par le serveur, sur son horloge : `GET /api/tournaments/next` → inscription
  `REGISTERED`, statut parmi `WAITING_STATUSES`, `starts_at > maintenant`, plus proche début ;
  réponse limitée à `tournamentId`, `name`, `startsAt`, `endsAt`, `timezone` (ou `null`).
  Relu au retour sur l'accueil, après inscription / désinscription, et à l'heure de début.
  Affichage dans le fuseau du téléphone, comme le reste du module (D-055).
- **Données** : aucune migration (la contrainte d'exclusion existe ; le verrou consultatif ne
  crée rien en base).

## D-060 — Suppression de l'appellation « Katika » : compte financier de la plateforme Le-Ter

- **Date** : 2026-10-09 · **Statut** : décidé par le propriétaire du projet · **Tranche** :
  R-09 (avec D-061) · **Remplace sur ce point** : toutes les mentions antérieures de
  « Katika » (D-0xx historiques, spécification fonctionnelle `.docx`, diagramme de classes).
- **Sens** : « Katika » désignait le compte financier central qui reçoit les commissions de la
  plateforme. Ce n'est **ni un rôle, ni l'administrateur, ni un compte utilisateur**.
- **Nouvelle appellation** : **compte financier de la plateforme Le-Ter**. Sa réalisation
  existante est `platform_ledger` (migration 0021) : un **journal d'écritures de recettes**,
  en entrée seulement, alimenté par `TournamentService` (types `TOURNAMENT_PLATFORM_FEE` :
  commission d'un tournoi, `floor(cagnotte brute × fee_bps / 10 000)` ; `UNALLOCATED_PRIZE` :
  part des gains des rangs non occupés), une écriture par tournoi et par type (idempotence).
  Aucun second compte n'est créé ; le journal n'est transformé ni en portefeuille ni en
  compte bancaire.
- **Solde** : solde comptable **calculé** = somme des écritures (aucune sortie n'est
  modélisée). La trésorerie réelle (CinetPay, banque) n'est pas intégrée et s'affiche comme
  telle. Achats des joueurs, soldes des joueurs et recettes de la plateforme ne sont jamais
  additionnés.
- **Parties ordinaires** : aucune commission n'existe (les mises ne sont pas réglées) ; la
  règle reste à définir (R-37). Aucun taux ni prélèvement n'est inventé.
- **Données** : aucune donnée, table, colonne ni valeur de rôle « Katika » n'a jamais existé :
  aucune migration. Les commentaires des migrations appliquées `0002` et `0017` restent
  intacts (empreinte vérifiée par le migrateur, D-026) ; les décisions antérieures et les
  documents sources (`SPECIFICATION FONCTIONNELLE DE LE TER.docx`,
  `Voici des critères…docx`, `Diagramme_de_classe_de_LE_TER.jpg`) ne sont pas modifiés et
  sont remplacés par la présente décision sur ce point.

## D-061 — Rôle d'administration : `admin` = `SUPER_ADMIN`

- **Date** : 2026-10-09 · **Statut** : décidé par le propriétaire du projet (demandé sous le
  numéro D-059, déjà attribué : enregistré sous le prochain numéro libre) · **Tranche** :
  R-09 (avec D-060) · **Complète** : D-049 (le rôle n'est plus « provisoire »).
- Le rôle existant `admin` (`users.role`, migration 0017) est le **seul** rôle
  d'administration ; l'interface d'administration le présente comme `SUPER_ADMIN`. Aucune
  nouvelle valeur de rôle en base.
- Attribution uniquement par l'outil d'exploitation `npm run user:role -- <email> admin` ;
  aucune route, aucune inscription publique d'administrateur. Compte dédié recommandé (une
  connexion révoque la session précédente du compte, R-32).
- Toutes les routes `/api/admin/*` exigent `requireAuth`, `requireRole('admin')` et une
  session d'administration dédiée (8 h absolues, 30 min d'inactivité, contrôlées côté
  serveur) : voir `docs/admin/SECURITY.md`.

## D-062 — Tournois : classement final par score pondéré (jetons restants et parties jouées)

- **Date** : 2026-10-09 · **Statut** : demandé par le propriétaire du projet ; la méthode de
  normalisation (références, durée de référence d'une partie) est un choix technique
  documenté ici, ajustable par une nouvelle décision · **Remplace** : la règle « Classement »
  de D-054 (ordre jetons → parties jouées → gagnées → inscription) pour tout tournoi publié
  après la migration 0025 ou pas encore classé à son application. Le reste de D-054
  (jetons, règlement des parties, gains par rang, versements) est inchangé.
- **Principe** : aucun des deux critères n'est prioritaire par principe ; le rang découle
  d'un score sur 100 points :
  `score = 100 × (poids_jetons × ratio_jetons + poids_parties × ratio_parties)`.
- **Poids** : `poids_jetons + poids_parties = 1`, chacun entre 0 et 1. Configuration
  initiale **50 % / 50 %**. Paramètres plateforme (`system_settings`, rôle `admin`) :
  `tournament_ranking_tokens_weight_percent` et `tournament_ranking_games_weight_percent`
  (entiers 0 à 100, somme exactement 100, validée par `TournamentService.updateSettings`,
  modification auditée). Les poids sont **copiés sur le tournoi à sa publication**
  (`tournaments.ranking_tokens_weight_bps` / `ranking_games_weight_bps`, points de base,
  somme 10 000 garantie par une contrainte CHECK), comme la commission, puis immuables : les
  joueurs s'inscrivent en connaissant la règle, et un changement ultérieur des paramètres
  ne touche ni un tournoi en cours ni un classement publié.
- **Remplacé par D-106** pour les tournois démarrés après la migration 0043 (jetons / capital,
  parties plafonnées à la référence) ; la méthode ci-dessous reste celle des tournois déjà
  démarrés.
- **Normalisation** (`domain/tournaments/tournament.ts`) : chaque critère est ramené dans
  [0, 1[ par `ratio = x / (x + référence)` : 0 sans rien, 0,5 à la référence, strictement
  croissant, jamais plafonné (deux joueurs différents restent départagés).
  - Référence des jetons : le **capital initial** du tournoi (identique pour tous).
  - Référence des parties : `floor(durée du tournoi / 170 s)`, où 170 s est la durée de
    référence d'une partie dérivée des règles existantes : 4 plis joués × 4 joueurs × 10 s
    (D-034, le 5e pli est automatique, D-035) + 10 s de manche Continuer/Quitter. Soit 10
    parties pour 30 min, 42 pour 120 min.
  - Les références ne dépendent que des paramètres figés du tournoi, jamais des autres
    participants : l'arrivée, l'absence ou l'élimination d'un joueur ne modifie le score de
    personne d'autre.
  - Cas limites : valeur négative ou invalide → 0 ; référence nulle (tournoi plus court
    qu'une partie de référence) → ratio 1 dès la première partie, 0 sinon ; jamais de 0/0.
- **Classement** (à `CALCULATING_RESULTS`, et classement en direct) : tous les comptes du
  tournoi, y compris ceux passés sous le seuil de jetons ; tri par score **exact** DESC
  (fractions entières comparées sans arrondi). Égalité exacte : parties gagnées DESC, puis
  date d'inscription ASC, puis identifiant — aucun des deux critères du score n'est utilisé
  pour départager.
- **Résultats** : `tournament_results.score` (`numeric(7, 4)`, arrondi au plus proche à
  4 décimales) est figé avec le rang ; les résultats antérieurs gardent `score` NULL et leur
  ordre historique. Tableau : rang, joueur, jetons restants, parties jouées, score (pas de
  colonne « Statut ») ; l'export CSV ajoute la colonne `Score`.
- **Technique** : migration **0025** (colonnes ajoutées, nouveaux paramètres autorisés ;
  tournois publiés non classés : 50 / 50 ; tournois déjà classés et brouillons : NULL).
  Tests : `tests/unit/tournaments/tournament-ranking.test.ts`,
  `tests/integration/database/tournament-weighted-ranking.test.ts`,
  `tests/integration/tournaments/tournament-service.test.ts` (« score pondéré figé »).

## D-063 — Tournois : seuil de participation à deux fois la mise

- **Date** : 2026-10-09 · **Statut** : décidé par le propriétaire du projet · **Remplace** :
  le seuil « sous la mise » de D-054 (`OUT_OF_TOKENS` dès `jetons < mise`).
- **Règle** : un participant peut créer ou rejoindre une partie d'un tournoi si et seulement
  si `jetons_restants >= 2 × mise_par_partie`. En dessous, son compte passe `OUT_OF_TOKENS` :
  plus aucune partie du tournoi ; il garde ses jetons et reste classé (D-062, aucune pénalité
  supplémentaire).
- **Source unique** : `canPlayTournamentGame(tokens, stake)` (`domain/tournaments/
  tournament.ts`, avec `TOURNAMENT_MIN_STAKES_TO_PLAY = 2`), utilisée par `accountStatusFor`,
  l'attribution d'une table (`TournamentService.join` : création ou table existante, y
  compris un joueur déjà assis qui rejoint la partie suivante), l'accès direct à une session
  (`tournamentSessionAdmission`, `isAdmitted`), la partie suivante après « Poursuivre »
  (`tournamentTableContinuation.playersBarredFromNextGame`) et l'indication `canJoin` de
  l'API. Aucun autre endroit ne compare jetons et mise.
- **Partie suivante** : quand la ronde Poursuivre/Quitter est close, un joueur sous le seuil
  quitte la table par le chemin normal (`SessionService.leaveSession`) AVANT la création de
  la partie suivante, qui ne retient que les joueurs restants. Même contrôle pour la partie
  suivante demandée explicitement (`createNextGame`). Un joueur déjà dans la partie en cours
  (reconnexion) n'est jamais refusé : ses jetons ne bougent qu'au règlement, en fin de partie.
- **Concurrence** : les jetons ne changent qu'au règlement d'une partie (verrou du tournoi,
  une fois par partie). Toute décision d'accès règle d'abord les parties terminées non encore
  réglées du tournoi (`settlePendingGames`, idempotent) puis lit le solde : un joueur qui
  quitte sa table juste après une défaite, avant le règlement en arrière-plan, est jugé sur
  son solde réglé. Les politiques de SessionService reçoivent ce règlement après coup
  (TournamentService est construit après SessionService).
- **Validation** : `mise ≤ jetons initiaux / 2` (sinon personne ne pourrait jouer au
  départ) ; message « Entre 1 et la moitié des jetons initiaux. ». Les tournois déjà créés ne
  sont pas modifiés ; les statuts déjà enregistrés sont recalculés au prochain règlement, et
  chaque accès applique le seuil sur le solde, pas sur le statut stocké.
- **Technique** : aucune migration. Tests :
  `tests/unit/tournaments/tournament-domain.test.ts` (200 = seuil, 199 en dessous…),
  `tests/integration/tournaments/tournament-participation-threshold.test.ts` (parties
  réellement jouées, seuil exact, juste en dessous, deux courses avant règlement).

## D-064 — Délais de 20 s (tour et Poursuivre/Quitter), pseudos réels à la table

- **Date** : 2026-10-09 · **Statut** : décidé par le propriétaire du projet · **Remplace** :
  les durées de 10 s de D-034 (timer de tour, ronde Poursuivre/Quitter), reprises par D-036,
  D-041 et R-06 ; le reste de ces décisions est inchangé · **Tranche en partie** : R-12.
- **Délais** : `TURN_DURATION_MS` (`domain/rules/rule-set.ts`) et
  `SESSION_DECISION_WINDOW_MS` (`domain/sessions/session.ts`) passent de 10 000 à
  **20 000 ms**. Ce sont les seules sources de ces durées : le serveur pose les échéances en
  PostgreSQL (`turn_deadline_at`, `deadline_at` de la ronde), `DeadlineSupervisor` les
  reconstruit, et les écrans n'affichent qu'un compte à rebours vers ces échéances
  (`turnDeadlineAt`, `decision.deadlineAt`) : le client ne décide jamais du délai. Côté
  client, `DEFAULT_TURN_MS` (20 000) ne sert qu'à l'échelle de l'anneau si le début du tour
  manque. La présentation du 5e tour (D-041) précède toujours la ronde, désormais de 20 s.
  Les échéances déjà posées avant le déploiement restent à 10 s (instants absolus en base).
- **Non concernés** (délais techniques distincts, inchangés) : authentification WebSocket
  10 s, fenêtre anti-spam du chat, arrêt du serveur, `statement_timeout`, relecture des
  paiements, délais réseau du client, durées et transitions des tournois.
- **Classement des tournois** : la durée de référence d'une partie de D-062
  (`RANKING_REFERENCE_GAME_MS`) était DÉRIVÉE des deux délais (170 s). Pour ne pas modifier
  le classement des tournois par effet de bord, elle est **figée à 170 s** ; seule une
  nouvelle décision peut l'ajuster (à 340 s, par exemple, si l'on veut qu'elle suive les
  nouveaux délais).
- **Pseudos** : la vue de partie porte le pseudo réel de chaque joueur
  (`PlayerInGame.username`), y compris le joueur connecté. `PostgresGameRepository` le lit
  dans `users` à chaque chargement (`LEFT JOIN users`) ; il n'est jamais copié dans
  `game_players` ni utilisé par les règles, et suit un renommage du compte. Toutes les vues
  (REST, reconnexion, relecture régulière) en bénéficient. Pseudo absent : « Vous » ou
  « Adversaire », jamais un identifiant technique ni un numéro de siège (`playerLabel`).
  **Reste À CLARIFIER (R-12)** : l'option « noms cryptés » à la création de la partie
  (masquer ou remplacer les noms) n'existe pas et n'est pas implémentée.
- **Technique** : aucune migration. Tests : `turn-timer.test.ts` (scénarios relatifs à
  `TURN_DURATION_MS`), `session-domain.test.ts`, `multi-game-isolation.test.ts`,
  `postgres-game.repository.test.ts` (pseudo relu dans `users`), `game-table.test.tsx`
  (pseudos, compteur « Tour n/5 », plaques). Les tests en temps réel (`turn-timeout-*`,
  `c6-functional-real-infra`) attendent 20 s par tour et ne s'exécutent qu'avec
  `TEST_DATABASE_URL` et `TEST_REDIS_URL`.

## D-065 — Tournois : liste des tournois, tables attribuées par le serveur, démarrage à 20 s

- **Date** : 2026-10-09 · **Statut** : demandé par le propriétaire du projet (choix
  techniques délégués) · **Complète** : D-051, D-054, D-055 (affectation), D-059 (accueil) ·
  **Ne modifie pas** : parties privées (seul le créateur démarre, sans échéance), D-062
  (classement), D-063 (seuil à deux mises), réservations et portefeuille (D-054).
- **Tables** : uniquement créées par le serveur (`POST /api/tournaments/:id/join`) ; aucune
  route ne permet à un joueur de créer une partie de tournoi. Capacité **4** (D-051) ; une
  partie démarre avec **2, 3 ou 4** joueurs (moteur inchangé : `MIN_PLAYERS_TO_START = 2`,
  distribution 3 + 2 dans l'ordre antihoraire, aucun joueur fictif). Une table démarrée
  n'accepte plus personne (partie `in_progress`) ; une table pleine refuse un 5e
  (`GameFullError`, places de session).
- **Affectation** : déjà assis → même table (idempotent : une nouvelle tentative réseau ne
  double jamais l'affectation) ; sinon une table en attente avec une place libre, **la plus
  remplie d'abord, puis la plus ancienne** (stratégie déterministe, choisie plutôt qu'un
  tirage : les parties démarrent au plus tôt) ; sinon une nouvelle table, ouverte sous
  verrou du tournoi (D-055). Inscription et seuil de jetons revérifiés à chaque entrée
  (D-063).
- **Responsable du démarrage** : le premier joueur affecté = créateur de la partie
  (`games.creator_id`, ordre d'affectation enregistré par le serveur). S'il quitte la table
  avant le démarrage, le droit passe au joueur suivant dans l'ordre d'arrivée (règle
  existante R-19 / D-037, `buildWaitingGameDeparture`) ; l'échéance n'est pas réinitialisée.
  Une simple déconnexion ne change rien : l'échéance court côté serveur.
- **Délai de 20 s** (`TOURNAMENT_TABLE_AUTO_START_MS`) : posé quand la partie en attente
  atteint **2 joueurs** (`games.start_deadline_at` = arrivée du 2e + 20 s), visible de tous
  (`startDeadlineAt` dans la vue de la partie) ; jamais repoussé par les 3e et 4e arrivées
  ni par une reconnexion ; retiré si la table redescend sous 2 joueurs (un joueur seul
  attend sans compte à rebours ; une nouvelle échéance partira à la prochaine 2e arrivée).
  Le créateur peut démarrer à tout moment pendant le délai (« Démarrer la partie ») ; les
  autres joueurs voient l'attente et le temps restant.
- **Démarrage automatique** : à l'échéance, le SERVEUR démarre la partie
  (`GameService.handleStartDeadline`, commande système passée par la file de la partie, qui
  relit l'état : toujours en attente, ≥ 2 joueurs, échéance persistée atteinte). Timer en
  mémoire = copie de l'échéance ; `DeadlineSupervisor` la reconstruit au démarrage du
  backend (future → timer réarmé, passée → démarrage immédiat) et la balaie toutes les 5 s :
  le démarrage a lieu même si le premier joueur est déconnecté ou si aucun client n'affiche
  le compte à rebours.
- **Unicité** : démarrage manuel, timer, balayage et plusieurs instances aboutissent à UNE
  seule transition `waiting → in_progress` : file par partie dans une instance, écriture
  conditionnée à la version entre instances (`UPDATE … WHERE version = $n`), les perdants
  deviennent sans effet (`GameAlreadyStartedError` pour un démarrage manuel tardif). Au
  démarrage, l'échéance est effacée (contrainte `games_start_deadline_when_waiting`) et le
  timer annulé.
- **Parties suivantes d'une table** : inchangées (D-042 : démarrées aussitôt dès 2 joueurs
  restés) ; le délai est recopié, il ne sert que si un joueur reste seul et attend une
  arrivée. Les tables ouvertes avant la migration 0026 n'ont pas de délai (comportement
  antérieur : démarrage par le créateur).
- **Fin du tournoi** : comportement existant inchangé (D-056) ; une partie démarrée après
  `ends_at` est réglée `VOID` (D-054).
- **Liste** : `GET /api/tournaments` → `{ tournaments, history, serverNow }` : tournois
  PUBLIÉS non terminés, début le plus proche d'abord (au plus 20), puis l'historique terminé
  ou annulé, le plus récent d'abord (au plus 10) ; chacun avec MON inscription, ma
  réservation, mon compte de tournoi, le nombre d'inscrits et `canRegister` / `canJoin`.
  Chaque tournoi non terminé est d'abord avancé (transitions dues) : jamais un tournoi
  commencé présenté « à venir ». Brouillons et propositions non publiées exclus (**modifié
  par D-108** : les propositions en attente d'approbation y figurent, ouvertes aux
  préinscriptions).
- **Interface** : Accueil → Tournois → Rejoindre = liste (carte : date, horaires, statut,
  participation, inscrits / min / max, rangs récompensés, jetons de départ (retirés de la
  carte par D-066), mon inscription, flèche à droite) → fiche `/tournament/[tournamentId]` (actions autorisées par le serveur ;
  « Rejoindre le Tournoi » affiche « Recherche d'une partie en cours… » pendant la requête,
  puis la table). Statuts affichés : À venir, Inscriptions ouvertes, Inscriptions clôturées,
  Démarrage, En cours, Résultats, Terminé, Annulé. Accueil : résumé compact du prochain
  tournoi pertinent en filigrane dans le panneau Tournois (en cours où je participe, sinon
  le plus proche à venir où je suis inscrit ou qui est ouvert), qui ouvre sa fiche ; le
  bloc « Prochain tournoi » de D-059 est remplacé par ce résumé (`GET /api/tournaments/next`
  reste disponible). Table en attente : « En attente d'un autre joueur… », puis « Partie
  prête à démarrer. », nombre de joueurs du serveur, « Démarrage automatique dans N s ».
- **Compléments (session parallèle, même jour, frontend seulement)** :
  - **Liste en 4 groupes** (`features/tournaments/tournament-groups.ts`), chaque tournoi
    dans un seul groupe, déduit du statut du SERVEUR et de sa capacité :
    1. inscriptions ouvertes avec une place libre ;
    2. pas encore démarré mais sans inscription possible (`SCHEDULED`, clôturé, complet ou
       `STARTING`) ;
    3. en cours (`IN_PROGRESS` jusqu'au versement des gains) ;
    4. historique (terminé ou annulé).

    Tri par début croissant, historique le plus récent d'abord.
  - **« Annuler la recherche »** : pendant la requête `join` (fiche) et sur la table
    d'attente. Elle réutilise le départ de session existant (R-19 / D-037) : la place est
    libérée, l'échéance de 20 s est retirée si la table redescend sous 2 joueurs, et le
    droit de démarrer passe au suivant. L'inscription au tournoi, la réservation et les
    jetons ne changent pas. Cas particuliers :
    - place attribuée après l'annulation : libérée aussitôt ;
    - partie déjà démarrée : le joueur est envoyé à sa table (une partie commencée n'est
      jamais quittée ainsi).

    Tests : `tournament-groups.test.ts`, `tournament-table-waiting.test.tsx`,
    `TournamentDetailPanel.test.tsx`,
    `backend/tests/integration/tournaments/tournament-search-cancel.test.ts`.
- **Technique** : migration **0026** (`games.auto_start_delay_ms`, `games.start_deadline_at`,
  contrainte et index partiel ; ajout seulement). Tests :
  `tests/integration/tournaments/tournament-table-auto-start.test.ts` (15 cas : seul, 2e
  arrivée, 3e/4e sans réinitialisation, 5e refusé, priorité à la table la plus remplie, table
  démarrée fermée, manuel, automatique à l'échéance exacte, manuel + automatique
  concurrents, premier joueur absent, redémarrage, départ du premier joueur, parties privées
  inchangées, liste) ; frontend : `TournamentScreen.test.tsx`, `TournamentDetailPanel.test.tsx`,
  `HomeScreen.test.tsx`, `tournament-state.test.ts`, `waiting-state.test.ts`. La concurrence
  entre deux processus sur un vrai PostgreSQL est couverte par
  `postgres-tournament-concurrency.test.ts` (attribution des tables), exécuté seulement avec
  `TEST_DATABASE_URL` : 29/29 le 2026-10-09 sur `le_ter_test`, après les corrections
  ci-dessous.
- **Corrections d'attribution (révélées par ce test, même jour)** :
  - Entrée dans la partie d'une table entre deux instances : `joinGame` n'est sérialisé que
    dans une instance. Le perdant du conflit de version (`GameVersionConflictError`) relit
    la table et réessaie (`seatAt`, 3 tentatives), puis reçoit `409 TOURNAMENT_BUSY`
    (« réessayez »).
  - `tryTable` libère la place de session après TOUT échec (jamais assis sans jouer). Une
    partie pleine, non joignable ou démarrée entre le choix de la table et l'entrée
    (`TournamentGameInProgressError`, plus fréquent avec le démarrage automatique) fait
    passer à la table suivante ou à une nouvelle table.
  - Tests sans PostgreSQL réel : `tests/integration/tournaments/tournament-two-instances.test.ts`
    (deux piles sur la même base PGlite).

## D-066 — Tournois : carte sans jetons de départ, sélecteurs de date et d'heure

- **Date** : 2026-10-09 · **Statut** : demandé par le propriétaire du projet (choix
  techniques délégués) · **Modifie** : l'interface de D-065 (contenu de la carte) ·
  **Ne modifie pas** : `initialTournamentTokens` (modèle, API, base, attribution réelle des
  jetons de tournoi), règles de création (D-054, D-058), API et backend.
- **Carte de la liste** : la ligne « 🪙 N jetons de départ » est retirée. Les jetons de
  départ restent visibles sur la fiche du tournoi (`TournamentDetailPanel`).
- **Application mobile** (proposition `ProposalForm`, création admin intégrée
  `AdminTournamentFormScreen`) : la date et l'heure de début ne se saisissent plus au
  clavier. `DatePickerField` (calendrier : jour, mois, année ; jours avant aujourd'hui non
  sélectionnables, le serveur reste juge du délai d'1 h) et `TimePickerField` (colonnes
  Heures, Minutes, AM/PM) sont des composants JS (`src/components/ui/`), sans dépendance
  native : le sélecteur natif Android suit la langue du système et non celle de l'app, et
  n'existe pas sur le web. Affichage selon la langue de l'app (`lib/date-time.ts`) :
  français `fr-FR`, 24 h ; anglais `en-GB` (variante configurée), date jour en premier,
  heure sur 12 h avec AM/PM. Valeur interne inchangée : `JJ/MM/AAAA` et `HH:MM` sur 24 h,
  lues en heure locale du téléphone par composantes numériques (aucune chaîne ISO lue par
  `Date`, donc aucun décalage d'un jour), puis envoyées en instants UTC comme avant.
- **Administration Next.js** : « Heure de début » utilise `TimePicker`
  (`components/ui/time-picker.tsx`, Popover Radix déjà installé) au lieu de
  `<input type="time">`, dont l'affichage suit la langue du NAVIGATEUR. Format selon la
  locale de l'administration (`fr-FR` : 24 h ; une locale anglaise en 12 h l'affiche en
  AM/PM) ; valeur toujours `HH:mm`, interprétée en Africa/Douala comme avant. Le champ Date
  reste `<input type="date">`.
- **Tests** : `src/lib/date-time.test.ts`, `src/components/ui/DateTimePickers.test.tsx`,
  `tournament-form.test.ts` (passages de jour, mois, année), `ProposeTournamentScreen.test.tsx`,
  `TournamentScreen.test.tsx` ; administration : `tests/time-picker.test.tsx`.

## D-067 — Finances (administration) : 12 cartes, achats sans paiement CinetPay séparés

- **Date** : 2026-10-10 · **Statut** : demandé par le propriétaire du projet (choix
  techniques délégués) · **Ne modifie pas** : règles de paiement CinetPay, comptabilisation
  des inscriptions (débit effectif) et des gains (crédit effectif), soldes, écritures
  comptables, données existantes, migrations.
- **Anomalie « 2 070 128 947 jetons d'achats échoués »** : le panneau « Mouvements des
  comptes de jeu » additionnait tous les `deposit` en échec. Sur la période, 9 étaient
  rattachés à un paiement CinetPay `FAILED` (7 500 jetons = 7 500 FCFA) et 4 n'avaient
  AUCUN paiement : tentatives refusées avant l'appel au fournisseur
  (`PROVIDER_UNAVAILABLE`, 2026-10-08), dont 3 × 690 040 149 jetons (un numéro de téléphone
  saisi comme montant, avant l'application du barème D-050). Ni jointure multiplicatrice,
  ni dépassement numérique : `sum(bigint)` est exact et reste sous 2^53. Ces lignes n'ont
  jamais rien crédité (un achat n'est crédité qu'à `succeeded`) ; elles sont conservées
  telles quelles (historique) et déjà signalées par le rapprochement
  (`DEPOSIT_WITHOUT_PAYMENT`). Aucune réparation de données n'est nécessaire.
- **Correction (backend, lecture seule)** : `finance/overview` renvoie
  `walletMovements[].withoutPayment` (jointure `LEFT JOIN payments` sur
  `wallet_transaction_id`, UNIQUE : aucune ligne multipliée) et `reservations` (réservations
  de tournoi de la période par statut, jamais des débits). Champs ajoutés : contrat
  rétrocompatible.
- **Écran Finances** : 12 cartes dans une liste (4 colonnes selon la largeur de la zone de
  contenu, 2 puis 1 sur tablette et mobile) : 8 indicateurs (achats confirmés, soldes des
  joueurs, recettes, solde comptable avec « Voir le compte », paiements en attente,
  échoués ou expirés, inscriptions débitées, gains versés), puis 4 cartes de détail qui
  remplacent les 3 panneaux : achats CinetPay par statut (4 statuts exclusifs), mouvements
  des comptes de jeu (crédits et débits effectifs, attente, échecs, achats refusés avant
  CinetPay, réservations), recettes par nature (`platform_ledger`), rapprochement (paiements
  ↔ achats rattachés par statut, achats sans paiement, cohérence des recettes, montants
  au-delà de 2^53, anomalies ouvertes de `reconciliation/anomalies`). Contrôle en lecture
  seule : aucune correction déclenchée.
- **Tests** : `backend/tests/integration/admin/admin-api.test.ts` (achats sans paiement,
  montants > 2^31) ; `administration/tests/finance.test.tsx`.

## D-069 — Tournois : jetons de départ et mise d'une proposition, modifiables avant approbation

> **Remplacée par D-071** pour le calcul des valeurs par défaut (10 × prix, moitié du prix),
> la personnalisation par l'administration et le tournoi gratuit. Conservée pour l'historique.

- **Date** : 2026-10-10 · **Statut** : demandé par le propriétaire du projet (choix
  techniques délégués) · **Complète** : D-054, D-063 · **Ne modifie pas** : classement,
  répartition des gains, commission, paiements, réservations, tournois créés par
  l'administration (valeurs des paramètres plateforme ou saisies, comme avant), tournois
  déjà approuvés ou démarrés. (D-068 est déjà cité par le code des délais de 15 s : cette
  décision prend le numéro suivant.)
- **Valeurs par défaut d'une proposition de joueur** (`defaultTournamentTokens`) : jetons de
  départ = 10 × prix d'entrée ; mise par partie = moitié du prix d'entrée, en entiers,
  arrondie à l'entier INFÉRIEUR (même sens que la commission, `computePool`), au moins 1.
  Prix 1 000 → 10 000 et 500 ; prix 1 001 → 10 010 et 500. Tournoi gratuit (prix 0) :
  paramètres plateforme, comme avant. Ces deux valeurs sont des jetons de tournoi : affichées
  sans devise.
- **Personnalisation** : `PATCH /api/admin/tournaments/:id` (route, audit et rôle `admin`
  existants) accepte `initialTournamentTokens` et `stakePerGame` tant que le tournoi est
  `DRAFT` ou `PENDING_APPROVAL` ; ensuite `409 TOURNAMENT_LOCKED`. Un joueur ne les fixe
  jamais (`400`, champ « Réservé à l'administration. »), ni à la création ni en modifiant
  sa proposition. Validation serveur inchangée : entiers, jetons de 1 à 1 000 000, mise de 1
  à la moitié des jetons (D-063, donc jamais au-delà des jetons de départ), revérifiée à
  l'approbation.
- **Recalcul** : drapeaux `initial_tokens_customized` et `stake_customized` (migration 0027).
  Un champ envoyé par l'administration devient personnalisé et n'est plus recalculé ; un
  changement du prix d'entrée avant l'approbation recalcule seulement les champs restés par
  défaut. Le prix d'entrée n'est jamais modifié par les jetons ou la mise. La migration
  aligne les propositions non approuvées existantes (prix ≥ 1) sur les valeurs par défaut ;
  aucun autre tournoi n'est touché.
- **Moteur** : inchangé. Les valeurs enregistrées sont celles copiées dans les comptes de
  tournoi au démarrage et utilisées au règlement de chaque partie.
- **Administration Next.js** : sur le détail d'un tournoi `DRAFT`/`PENDING_APPROVAL`, la carte
  « Calendrier et règles » remplace les deux lignes par deux champs (préremplis avec les
  valeurs enregistrées, aide « Par défaut : … » ou « Valeur personnalisée. ») et un bouton
  « Enregistrer » ; seuls les champs changés sont envoyés. Après l'approbation, affichage
  en lecture seule comme avant.
- **Tests** : `backend/tests/integration/tournaments/tournament-token-setup.test.ts` ;
  `administration/tests/token-setup.test.tsx`.

## D-070 — Inscription : champ Pays obligatoire avant le téléphone

- **Date** : 2026-10-10 · **Statut** : demandé par le propriétaire du projet · **Complète** :
  R-15, D-029 (l'inscription passe de 7 à 8 champs : le Pays s'ajoute) · **Ne modifie pas** :
  connexion, sessions, profil, portefeuilles, devise du compte (XAF, D-050), CinetPay,
  numéros déjà enregistrés, colonne `users.phone` (toujours E.164, unique).
- **Contrat** `POST /api/auth/register` : nouveau champ obligatoire `country` (ISO 3166-1
  alpha-2) ; `phone` est le numéro NATIONAL. Le serveur valide le pays (régions connues de
  libphonenumber), valide le numéro selon les règles de CE pays et **reconstruit** le numéro
  E.164, seul format stocké. Un indicatif fourni par le client n'est accepté que s'il est
  celui du pays choisi (`+33…` avec `CM` → refusé). Erreurs par champ : `country`
  (« Ce champ est obligatoire. », « Pays non pris en charge. »), `phone` (« Numéro invalide
  pour le pays sélectionné. »).
- **Bibliothèque** : `libphonenumber-js` (métadonnées `max`), dans le backend et le frontend
  (mêmes règles des deux côtés ; JavaScript pur, compatible Expo Go). Aucune autre
  dépendance.
- **Pays non stocké** : le numéro E.164 suffit à l'usage actuel ; aucune colonne ni
  migration. Limite connue : un indicatif partagé (`+1`, `+7`, `+44`…) ne désigne pas un
  pays unique ; une colonne sera nécessaire si le pays doit être relu sans ambiguïté.
- **Application** (étape 2 de l'inscription) : Email, puis Pays et Téléphone côte à côte.
  Liste des pays : noms français seuls (ni drapeau, ni indicatif, ni code, ni devise),
  recherche sans casse ni accents. Téléphone désactivé tant qu'aucun pays n'est choisi
  (« Sélectionnez d'abord votre pays ») ; ensuite l'indicatif s'affiche dans une zone
  distincte du champ, non modifiable, et seuls chiffres et séparateurs sont saisissables.
  Changer de pays efface le numéro saisi. Le pays et le numéro sont conservés entre les
  étapes.
- **Devise** : le pays ne change ni la devise du compte de jeu (XAF), ni les soldes, ni les
  paiements ; aucune conversion. Une devise locale n'est connue que pour les zones franc CFA
  (XAF, XOF : « FCFA ») et n'est pas affichée à l'inscription.
- **Tests** : `backend/tests/unit/auth/auth-validators.test.ts`,
  `backend/tests/integration/auth/register-login.test.ts` ; `frontend/src/lib/phone-countries.test.ts`,
  `frontend/src/features/auth/RegisterScreen.test.tsx`.

## D-071 — Tournois : jetons de départ et mise calculés par coefficients du prix d'entrée

- **Date** : 2026-10-10 · **Statut** : demandé par le propriétaire du projet (choix
  techniques délégués) · **Remplace** : D-069 (valeurs par défaut, personnalisation, prix 0)
  · **Complète** : D-054, D-062, D-063 · **Ne modifie pas** : règlement des parties, seuil de
  participation (2 × mise), calcul de la commission (`computePool`), classement pondéré,
  répartition des gains, réservations, paiements, tournois déjà publiés ou démarrés.
- **Formule unique, serveur seul** (`tournamentTokenSetup`) : jetons de départ = prix
  d'entrée × coefficient de jetons ; mise par partie = prix d'entrée × coefficient de mise.
  Coefficients multiplicateurs (pas des pourcentages), strictement positifs, 2 décimales au
  plus, bornes 0,01 à 2 000. Calcul exact en entiers (coefficient en centièmes), résultat
  arrondi à l'entier INFÉRIEUR (même sens que la commission). Prix 1 000 → 10 000 et 500 ;
  prix 2 000 → 20 000 et 1 000 ; prix 501 → 5 010 et 250.
- **Cohérence** : `PATCH /api/admin/tournaments/settings` refuse un coefficient de mise
  supérieur à la moitié du coefficient de jetons (D-063 : chacun peut jouer au départ quel
  que soit le prix ; l'arrondi inférieur conserve l'inégalité). Jetons calculés au-delà de
  1 000 000 : tournoi refusé (champ `entryFee`), revérifié à l'approbation.
- **Prix d'entrée** : entier de **500** à 100 000 FCFA (décision du propriétaire du projet) ;
  plus de tournoi gratuit, donc plus de valeurs fixes de repli.
- **Cycle de vie** : `DRAFT` / `PENDING_APPROVAL` : les valeurs SUIVENT les coefficients en
  vigueur (recalculées à la lecture, à la soumission et à l'approbation ; le détail admin
  renvoie `tokenCoefficients`). Elles sont **figées à la publication** (approbation, ou
  création par l'administration) comme la commission et les poids ; un changement ultérieur
  des coefficients ne les modifie jamais. Exception : un nouveau prix d'entrée sur un tournoi
  publié sans inscrit (seul cas où le prix change encore) recalcule les deux valeurs avec les
  coefficients en vigueur, pour que la formule reste vraie.
- **Aucune saisie** : `initialTournamentTokens` et `stakePerGame` envoyés à une route de
  création ou de modification (joueur ou administration) → `400` « Calculé par le serveur à
  partir du prix d'entrée. ». Options `--stake` / `--tokens` retirées de
  `npm run tournament:create`.
- **Paramètres** (`system_settings`, migration 0028) : nouvelles clés
  `tournament_initial_tokens_coefficient` et `tournament_stake_per_game_coefficient` (API :
  `initialTokensCoefficient`, `stakePerGameCoefficient`). Les anciennes clés
  `initial_tournament_tokens` / `default_tournament_stake` (nombres FIXES de jetons) ne sont
  pas converties : 1 000 jetons fixes ne signifient pas un coefficient 1 000. Elles restent en
  base, ne sont plus lues ni modifiables. Colonnes `initial_tokens_customized` /
  `stake_customized` (0027) conservées, plus utilisées.
- **Valeurs initiales** (clé jamais enregistrée seulement ; un réglage enregistré n'est jamais
  écrasé) : commission 15 %, coefficient de jetons 10, coefficient de mise 0,5, poids 60 % /
  40 % ; propositions en attente 1 et transition 0 inchangées. Les tournois sans poids copiés
  gardent le repli historique 50 % / 50 % (`DEFAULT_RANKING_WEIGHTS`).
- **Administration Next.js** : `/parametres` affiche « Coefficient de jetons de tournoi au
  départ » et « Coefficient de mise par partie de tournoi » (décimales à la virgule). Le
  détail d'un tournoi affiche jetons et mise en lecture seule avec leur origine (« Prix
  d'entrée × 10 (Paramètres) · figé à l'approbation. » ou « Figé à la publication. ») ; le
  formulaire et le bouton « Enregistrer » de D-069 sont supprimés. Application mobile
  (écran admin des paramètres) alignée sur les mêmes clés.
- **Tests** : `backend/tests/integration/tournaments/tournament-token-setup.test.ts`,
  `backend/tests/unit/tournaments/tournament-domain.test.ts` ;
  `administration/tests/token-setup.test.tsx` ;
  `frontend/src/features/admin/tournaments/AdminTournaments.test.tsx`.

## D-072 — Tournois : terminés et annulés visibles 7 jours ; limite de 5 sur les inscriptions

- **Date** : 2026-10-10 · **Statut** : demandé par le propriétaire du projet (option de
  comptage choisie par lui) · **Modifie** : D-059 (statuts comptés, message), D-065 (contenu
  de l'historique de la liste) · **Ne modifie pas** : statuts, transitions, horaires
  d'ouverture et de clôture, inscriptions, réservations, paiements, gains, mise en avant de
  l'accueil (24 h, `RECENT_TOURNAMENT_VISIBILITY_MS`), administration.
- **Liste des tournois (joueurs)** : un tournoi `COMPLETED` reste dans le groupe historique
  7 jours après sa fin PRÉVUE (`ends_at`) ; un tournoi `CANCELLED` 7 jours après son
  annulation RÉELLE (`cancelled_at`, toujours renseignée pour un tournoi annulé). Ensuite il
  n'est plus renvoyé par `GET /api/tournaments` (`LIST_HISTORY_VISIBILITY_MS`, filtre SQL sur
  l'horloge du serveur). Affichage seulement : aucune ligne supprimée ni modifiée. Les
  tournois dont les résultats ou les gains sont en traitement (`CALCULATING_RESULTS`,
  `RESULTS_VALIDATED`, `DISTRIBUTING_PRIZES`) ne sont pas `COMPLETED` : règle non appliquée.
  Aucun onglet ni page d'historique ajouté.
- **Limite de 5** (globale à la plateforme, inchangée) : sont comptés les tournois aux
  inscriptions OUVERTES ou À OUVRIR, `REGISTRATION_OPEN` et `SCHEDULED`
  (`REGISTRATION_LIMIT_STATUSES`). `SCHEDULED` reste compté car un tournoi publié s'ouvre
  automatiquement à son heure, sans nouveau contrôle : sans lui, plus de 5 tournois pourraient
  avoir leurs inscriptions ouvertes en même temps. `REGISTRATION_CLOSED` et `STARTING` ne
  comptent plus : une place se libère dès la clôture des inscriptions. Contrôle et
  concurrence inchangés (verrou de planification, puis comptage, à la publication).
  `WAITING_STATUSES` est conservé pour le prochain tournoi inscrit de l'accueil (D-059).
- **Erreur** : `409 TOO_MANY_WAITING_TOURNAMENTS` (code inchangé), « Limite atteinte : 5
  tournois ont déjà leurs inscriptions ouvertes ou sur le point d'ouvrir. Réessaie dès que
  les inscriptions de l'un d'eux seront closes. ».
- **Inscription** : inchangée et vérifiée par test : refusée si le tournoi est annulé ou si
  la fin prévue est atteinte (statut `REGISTRATION_OPEN` ET horloge avant la clôture, elle-même
  au plus tard au début).
- **Tests** : `backend/tests/integration/tournaments/tournament-service.test.ts`,
  `backend/tests/integration/tournaments/tournament-api.test.ts`.

## D-073 — Parties ordinaires : mise obligatoire couverte par 2 × la mise

- **Date** : 2026-10-10 · **Statut** : demandé par le propriétaire du projet.
- Une partie ordinaire n'est créée ou rejointe que si sa mise est un entier > 0 et si le solde
  DISPONIBLE du joueur (compte de jeu, solde − réservations) vaut au moins 2 × la mise
  (perte maximale : la Kora, D-074). Mise et solde sont relus côté serveur.
- Arrivée à une table (`POST /api/sessions/:id/join`) : vérifiée avant d'occuper un siège,
  avec la mise de la dernière partie de la table. « Poursuivre » : la partie suivante reprend
  la mise ; les joueurs qui ne la couvrent plus quittent la table par le chemin normal.
- Tables de tournoi exclues (jetons de tournoi, D-054, D-063).
- **Code** : `backend/src/services/game/stake-policies.ts`, `backend/src/domain/rules/stake.ts`.

## D-074 — Parties ordinaires : séquestre, règlement et commission par tranche de mise

- **Date** : 2026-10-10 · **Statut** : demandé par le propriétaire du projet (Kora à 2 × la
  mise, bornes du barème rendues contiguës et barème modifiable : choix confirmés par lui) ·
  **Tranche** : R-37 ; R-02 en partie · **Révisée par D-080** : plus de séquestre visible
  (engagement sans changement de solde) et taux NON doublé en Kora.
- **Séquestre** : au démarrage, 2 × M réservés sur le compte de jeu de chaque joueur
  (`wallet_reservations`) ; le taux de la tranche de M est figé dans
  `game_settlements.commission_bps`.
- **Règlement** (dans la transaction qui termine la partie, une seule fois) : la commission
  est prélevée sur les mises des PERDANTS ; le gagnant récupère sa mise.
  - Victoire simple : chaque perdant perd M ; brut = M × (N − 1) ; taux = C.
  - Victoire par Kora (le gagnant remporte le 5e tour avec un 3) : chaque perdant perd 2M ;
    brut = 2M × (N − 1) ; taux = 2C.
  - Commission = floor(brut × taux) ; le gagnant reçoit brut − commission (`game_winnings`) ;
    la commission va au compte de la plateforme (`platform_ledger`, `GAME_COMMISSION`, avec
    le taux appliqué dans `fee_bps`).
  - Sans gagnant : tout est libéré, aucune commission. Fuyards : ni débités ni comptés dans
    N (le coût de la fuite, R-05, reste ouvert).
  - Exemple : 3 joueurs, M = 50, C = 2 % → simple : commission 2, gagnant +98 ; Kora :
    commission 4 % × 200 = 8, gagnant +192.
- **Barème initial** (`DEFAULT_GAME_COMMISSION_SCHEDULE`) : 1-5 : 0 % · 6-100 : 1 % ·
  101-200 : 2 % · 201-300 : 3 % · 301-400 : 4 % · 401-500 : 6 % · 501-700 : 7 % ·
  701-999 : 8 % · 1 000 et plus : 10 %. Le tableau d'origine omettait 100 et chevauchait
  351-400 et 1 000 ; le propriétaire a validé ces bornes.
- **Administration** : `GET/PATCH /api/admin/settings/game-commission` (`{ tiers }`), audité
  (`GAME_COMMISSION_UPDATED`). Tranches contiguës depuis 1, la dernière sans plafond, taux de
  0 à 50 % (doublé par la Kora, jamais plus de 100 %). Un changement vaut pour les parties
  démarrées ensuite ; aucun recalcul rétroactif.
- **Migrations** : 0029 (séquestre, règlement), 0030 (barème, `applied_commission_bps`,
  brut sur les seuls perdants).
- **Tests** : `backend/tests/unit/rules/game-settlement.test.ts`,
  `backend/tests/integration/games/game-settlement.test.ts`.

## D-075 — Retraits Mobile Money par l'API de transfert CinetPay v1

- **Date** : 2026-10-10 · **Statut** : validée par le propriétaire du projet · **Complète** :
  D-040 (compte de jeu), D-050 (CinetPay) · **Tranche pour le RETRAIT** : R-13 (1 jeton =
  1 FCFA), R-16 (minimum 1 000 jetons) · **Ne tranche pas** : R-34 (téléphone vérifié, non
  exigé : aucune vérification SMS n'existe), T-07 (licence), frais de retrait Le Ter (aucun).
- **Règles** :
  - Montant : entier de jetons, **≥ 1 000**, ≤ 1 500 000 (plafond d'un transfert CinetPay
    d'après le SDK officiel). Toute autre valeur (0, négatif, décimal, chaîne, absente, non
    finie) est refusée, jamais convertie. Vérifié dans l'application ET par le serveur.
  - Destinataire : **numéro d'inscription** du joueur (D-040), jamais un numéro saisi. Le
    joueur choisit seulement l'opérateur : Orange Money (`OM_CM`) ou MTN Mobile Money
    (`MTN_CM`), seuls opérateurs CinetPay en XAF. Numéro hors +237 : retrait refusé.
  - Quota configurable (`withdrawal_limit_count`, `withdrawal_limit_period` en minutes,
    `system_settings`) : `null` = ∞ (valeur par défaut des deux). n fini et t fini : au plus
    n retraits dans toute fenêtre glissante de t ; n fini et t = ∞ : au plus n au total ;
    n = ∞ : aucune limite. **Comptent** les retraits enregistrés non échoués (CREATED,
    PROCESSING, SUCCEEDED) ; **ne comptent pas** les demandes refusées avant création ni les
    retraits FAILED (jetons remboursés). Aucune annulation n'existe (un transfert envoyé ne
    se rappelle pas).
- **Décisions techniques** :
  - API de **transfert** CinetPay v1, distincte de la collecte : `POST /v1/transfer`,
    `GET /v1/transfer/{merchant_transaction_id}`, notification sur une URL dédiée
    (`POST /api/withdrawals/cinetpay/notify`). Désactivée par défaut
    (`CINETPAY_TRANSFERS_ENABLED=false`) : sans activation, refus 503 avant toute écriture.
  - Création atomique (une transaction SQL) : verrou du portefeuille → quota compté sous ce
    verrou → solde DISPONIBLE → transaction `withdrawal` `pending` + débit → ligne
    `withdrawals` (CREATED). Deux demandes simultanées ne dépassent jamais le quota ni le solde.
  - Cycle : CREATED → PROCESSING (accepté, référence CinetPay) → SUCCEEDED | FAILED, uniquement
    sur un statut FINAL relu chez CinetPay (SUCCESS ; FAILED / INSUFFICIENT_BALANCE). Un refus
    explicite à l'envoi (code API connu, rien créé) → FAILED. Un échec est remboursé une seule
    fois par le règlement idempotent du compte de jeu (`settleWalletTransaction`).
  - Issue incertaine (délai, réseau, réponse illisible) : le retrait reste ouvert, jamais
    tranché ni renvoyé à l'aveugle. Relecture par la référence marchande. **Aucun renvoi
    automatique par défaut** (`CINETPAY_TRANSFER_MAX_SUBMISSIONS=1`, audit du 2026-10-10) : la
    fiabilité de `NOT_FOUND` et le refus d'une référence réutilisée (`TRANSACTION_EXIST`) ne
    sont pas encore confirmés chez CinetPay. Une fois confirmés, jusqu'à 3 envois : seulement
    si CinetPay répond « introuvable », après 10 min, toujours avec la MÊME référence marchande.
  - Un envoi différé (reprise après arrêt, renvoi) relit le numéro d'inscription ; s'il ne
    correspond plus au numéro masqué enregistré à la création, rien n'est envoyé
    (`RECIPIENT_CHANGED`, rapprochement administratif).
  - Réconciliation (`WithdrawalReconciler`) : retraits ouverts relus dans PostgreSQL au
    démarrage puis périodiquement ; un retrait créé mais jamais envoyé (arrêt) est envoyé.
  - Administration : `GET /api/admin/withdrawals` (filtres statut, période, référence),
    détail audité, revérification auditée et idempotente ; `GET|PATCH
    /api/admin/settings/withdrawal-limit` (audité). **Aucune** action ne déclare un retrait
    réussi ou échoué.
  - Migration **0031_withdrawals** (table `withdrawals`, clés de quota, actions d'audit).
  - Détail : `docs/withdrawals.md`.

## D-076 — Retraits : récupération sûre et rapprochement à double validation

- **Date** : 2026-10-10 · **Statut** : proposée par l'audit des retraits, à valider par le
  propriétaire du projet · **Complète** : D-075 · **Ne change pas** : montant minimum,
  conversion, quota, destinataire.
- **Règles de sécurité** :
  - Aucun remboursement automatique d'un retrait dont l'issue est inconnue. Seul un statut
    FINAL relu chez CinetPay (`FAILED`, `INSUFFICIENT_BALANCE`) rembourse automatiquement.
  - Un refus annoncé à la création (`INVALID_PARAMS`, `INSUFFICIENT_BALANCE`…) n'est plus une
    preuve : le retrait reste ouvert (`PROVIDER_REJECTED`), le transfert est relu.
  - Seul fait local certain : un échec AVANT l'émission de `POST /v1/transfer`
    (authentification refusée ou injoignable) → `not_sent` : l'envoi n'est pas compté et sera
    retenté avec la même référence.
  - Aucun renvoi automatique par défaut (`CINETPAY_TRANSFER_MAX_SUBMISSIONS=1`, D-075).
  - Aucune voie ne déclare un retrait réussi sans statut `SUCCESS` relu chez CinetPay.
- **Séparation** : `CINETPAY_TRANSFERS_ENABLED=false` interdit toute NOUVELLE demande et tout
  envoi (même d'un retrait déjà créé), mais la relecture continue dès que les identifiants
  CinetPay sont configurés : réconciliation, notifications, revérifications.
- **Rapprochement administratif** (migration **0032**, `withdrawal_refund_requests`) :
  1. Revérification (existante) et **escalade** vers CinetPay (ticket, note), auditées.
  2. **Proposition** de remboursement : retrait ouvert depuis ≥ 24 h (création ou dernier envoi),
     référence de la **confirmation écrite** de CinetPay, justification, relecture fraîche
     « introuvable ». Un succès relu est appliqué (refus) ; un échec final relu est réglé
     normalement (aucune demande).
  3. **Approbation par un AUTRE administrateur** (contrainte SQL `decided_by <> proposed_by`),
     nouvelle relecture « introuvable », puis remboursement unique dans la même transaction
     que la décision et son audit (`failure_code = MANUAL_REFUND_CONFIRMED`). Rejet motivé.
  - Rôles : seul le rôle `admin` existe (session d'administration bornée) ; la double
    validation en tient lieu. Un rôle financier dédié serait une décision distincte.
  - Textes libres (justification, notes) : refus de toute suite de chiffres ressemblant à un
    numéro de téléphone.
- **Détection** : un retrait remboursé que CinetPay annonce ensuite réussi (notification,
  revérification) est marqué `PAID_AFTER_REFUND` et journalisé ; rien n'est débité
  rétroactivement (rapprochement manuel).
- **Tests sur PostgreSQL réel** : `backend/tests/integration/withdrawals/postgres-withdrawal-concurrency.test.ts`
  (`TEST_DATABASE_URL` vers une base de test DÉDIÉE ; refus si hôte, port et nom sont ceux de
  `DATABASE_URL`).

## D-077 — Retraits : trois états (indisponible, sandbox, production)

- **Date** : 2026-10-11 · **Statut** : proposée par l'audit de disponibilité des retraits, à
  valider par le propriétaire du projet · **Complète** : D-075, D-076 · **Ne change pas** :
  montant minimum, quota, destinataire, protections financières (réservation, idempotence,
  aucun remboursement sur réponse ambiguë, double validation, `PAID_AFTER_REFUND`).
- **Constat** : l'application affichait en permanence « Les retraits Mobile Money seront
  bientôt disponibles » parce que `GET /api/wallet` renvoyait `withdrawalAvailable: false`,
  c'est-à-dire `CinetPayTransferGateway.canSubmit = false` faute de
  `CINETPAY_TRANSFERS_ENABLED=true`. Le message ne distinguait ni le motif ni un mode test.
  `CinetPayGateway.disbursementAvailable` (collecte) n'intervient pas dans les retraits.
- **Décision** : l'état des NOUVEAUX retraits est décidé au démarrage par
  `resolveWithdrawalAvailability` (fonction pure, `services/withdrawals/withdrawal-availability.ts`) :
  - `unavailable` + motif stable : `PROVIDER_NOT_CONFIGURED`, `TRANSFERS_DISABLED`,
    `LIVE_NOT_CONFIRMED`, `LIVE_OUTSIDE_PRODUCTION`, `SANDBOX_IN_PRODUCTION`,
    `ENVIRONMENT_MISMATCH`, `NOTIFY_URL_NOT_PUBLIC`, `SCHEMA_OUTDATED` ;
  - `sandbox` : clé `sk_test_` + `CINETPAY_TRANSFERS_ENABLED=true`, serveur hors production ;
  - `live` : clé `sk_live_` + `CINETPAY_TRANSFERS_ENABLED=true` +
    **`CINETPAY_TRANSFERS_LIVE_CONFIRMED=true`** (attestation de l'exploitant : transfert activé
    et approvisionné chez CinetPay, notification testée, parcours validé en sandbox) +
    `NODE_ENV=production` + URL de notification HTTPS publique.
  - Les identifiants CinetPay seuls n'autorisent JAMAIS un transfert. Une clé sandbox sur un
    serveur de production est refusée : des jetons réels partiraient vers un transfert simulé.
  - Migrations des retraits (0031, 0032) non appliquées : indisponible (`SCHEMA_OUTDATED`) ;
    toute migration en attente est journalisée au démarrage (lecture seule, rien n'est appliqué).
- **Contrat** : `GET /api/wallet` ajoute `withdrawalMode` et `withdrawalUnavailableReason`
  (`withdrawalAvailable` conservé) ; `GET /api/wallet/withdrawals` ajoute `policy.mode` et
  `policy.unavailableReason` ; `GET /api/admin/system` ajoute `services.withdrawals`
  (mode, motif, avertissements). Le joueur ne voit jamais les avertissements d'exploitation.
- **Interface** : message permanent supprimé ; motif compréhensible quand indisponible ;
  bandeau « Environnement de test » et « Retrait effectué (test) » en sandbox ; « Retrait
  effectué » uniquement sur `SUCCEEDED` (statut final relu chez CinetPay et réglé).
- **Limite** : un retrait ne mémorise pas l'environnement dans lequel il a été créé ; la
  mention « test » de l'historique suit l'état actuel du serveur.

## D-078 — Retraits des revenus de la plateforme vers MTN Mobile Money (CinetPay)

- **Date** : 2026-10-11 · **Statut** : implémentée, **exécution désactivée** ; à valider par le
  propriétaire du projet · **Complète** : D-060, D-074, D-075, D-077 · **Ne change pas** :
  commissions, mises, gains, règlement des parties, retraits des joueurs.
- **Décision** : flux distinct (`PlatformPayoutService`) : demande → approbation par un AUTRE
  administrateur avec réservation sous verrou → mise en exécution → un seul envoi → statut
  final relu chez CinetPay. Détails : [platform-payouts.md](platform-payouts.md).
- **Comptabilité** : `platform_ledger` inchangé (recettes seulement) ; retraits tracés dans
  `platform_payouts` et déduits au calcul, pour ne fausser aucune somme existante.
- **Trésorerie** : seule une relecture `GET /v1/balances` (SDK officiel) VALIDE de moins de
  15 minutes confirme un solde ; aucune saisie manuelle ; inconnu ≠ 0.
- **Retirable** : min(revenu distribuable, trésorerie libre après obligations envers les
  joueurs et retraits engagés), frais estimés compris ; barème des frais = configuration
  contractuelle, absent = blocage.
- **Sécurité** : trois verrous cumulés pour l'exécution (`PLATFORM_PAYOUTS_ENABLED`, D-077,
  URL dédiée) ; `submission_attempts ≤ 1` en base ; données figées par déclencheur.
- **Ouverts** : R-38 à R-41 (`docs/TODO.md`).

## D-079 — Gestion des joueurs dans l'administration : compte, suspension, sessions, modération

- **Contexte** : demande produit (octobre 2026). La section Administration → Joueurs devient un
  module de gestion des comptes et de modération. Remplace la décision « Suspension des joueurs
  désactivée en V1 » (`docs/admin/DECISIONS.md`). **Tranche R-14** (la modération du chat est
  faite par l'administration ; une modération par les joueurs est hors périmètre) et **R-25
  pour un joueur** (pas pour une partie ou une session bloquée par un admin, qui reste ouvert).
- **Désactivation / activation** : mécanisme existant `users.status` (D-029). Désactiver
  révoque les sessions dans la même transaction ; la connexion, le renouvellement et chaque
  requête sont refusés. Réactiver ne restaure aucune session (nouvelle connexion normale).
  Idempotent (`changed: false`, aucun audit). Aucune donnée n'est supprimée.
- **Protections** : un administrateur ne peut ni se désactiver, ni se suspendre, ni révoquer
  ses propres sessions (`403 SELF_ACTION_FORBIDDEN`) ; le dernier super administrateur
  accessible (actif et non suspendu) ne peut pas perdre l'accès (`409 LAST_ADMIN`). Les comptes
  admin puis le compte ciblé sont verrouillés (`FOR UPDATE`, ordre fixe) : deux
  administrateurs qui se désactivent mutuellement ne laissent jamais la plateforme sans admin.
- **Suspension** (décision du porteur : elle bloque TOUT l'accès) : temporaire (5 min à 365 j)
  ou indéterminée, toujours levable, motif obligatoire, commentaire interne facultatif.
  Sessions révoquées ; `AuthService` refuse la connexion (`403 ACCOUNT_SUSPENDED`, avec
  `suspendedUntil`), le renouvellement et chaque requête HTTP ou WebSocket. Échéance évaluée à
  l'heure du serveur à chaque contrôle : aucun minuteur, aucune écriture ; l'expiration ne
  modifie jamais `users.status` (un compte désactivé le reste). Une seule suspension en cours.
- **Partie en cours d'un joueur suspendu, désactivé ou déconnecté par un admin** (décision du
  porteur) : traitée comme une déconnexion. Aucune règle nouvelle : le minuteur de 20 s joue
  ses cartes (D-036), la partie se termine et se règle normalement, puis la manche
  Poursuivre/Quitter le retire (départ automatique). Ni fuite, ni défaite, ni mouvement
  financier ajouté. Inscriptions aux tournois, achats et retraits déjà lancés : inchangés.
- **Révocation des sessions** : jetons de renouvellement révoqués (`revoked_reason =
  'admin_revoked' | 'account_disabled' | 'account_suspended'`) ; les access tokens (JWT) sont
  refusés dès la requête suivante car `requireAuth` et la passerelle WebSocket relisent la
  session en base à chaque requête ou commande. Les jetons ne sont jamais journalisés.
- **Restriction du chat** : par joueur, toutes ses parties, motif, durée déterminée ou
  indéterminée, levable. Vérifiée dans `ChatService.sendMessage` (chemin unique HTTP et
  WebSocket) puis dans l'insertion SQL ; `403 CHAT_RESTRICTED`. Le compte reste actif.
- **Avertissement** (décision du porteur : transmis) : motif interne obligatoire ; message
  visible facultatif écrit dans `notifications` (type `MODERATION_WARNING`, D-054) dans la même
  transaction et affiché à l'accueil de l'application mobile. `delivered = true` signifie
  « notification enregistrée », jamais « lue ». Sans message visible : enregistrement seul,
  affiché « non transmis ». `Idempotency-Key` obligatoire.
- **Notes internes** : jamais exposées au joueur ; auteur = administrateur authentifié ; pas de
  modification, suppression LOGIQUE avec motif (triggers en base) ; `Idempotency-Key`.
- **Journal de modération** : `admin_audit_log` (cible USER) reste la source unique ; 10
  nouvelles actions. Le texte des notes n'est pas copié dans le journal.
- **Données** : migration 0034 — `user_sanctions` (SUSPENSION, CHAT_RESTRICTION, WARNING dans
  une table ; seule la levée est modifiable, aucune suppression) et `user_admin_notes`.
- **Hors périmètre** : aucun crédit, débit, modification de solde, de transaction, de partie ni
  de `platform_ledger`. Les connexions WebSocket déjà ouvertes d'un joueur révoqué restent
  abonnées au chat de leurs parties jusqu'à l'expiration de l'access token (15 min) ; toute
  commande est refusée.
- **Code** : `backend/src/services/admin/player-moderation.service.ts`,
  `backend/src/repositories/postgres-moderation.repository.ts`,
  `backend/src/controllers/player-moderation.controller.ts`,
  `administration/features/players/`, `frontend/src/features/lobby/ModerationNotice.tsx`.
- **Tests** : `backend/tests/integration/admin/player-moderation.test.ts`,
  `backend/tests/integration/chat/chat-api.test.ts`, `administration/tests/player-moderation.test.tsx`,
  `frontend/src/features/lobby/HomeScreen.test.tsx`. Détails : `docs/admin/MODERATION.md`.

## D-080 — Parties ordinaires : aucun mouvement pendant le jeu ; Kora sans doublement du taux

- **Date** : 2026-10-11 · **Statut** : validée par le propriétaire du projet (choix confirmés
  explicitement : « taux inchangé en Kora », « engagement invisible ») · **Révise** : D-074
  (séquestre visible et taux doublé en Kora) · **Ne change pas** : barème par tranche, taux
  figé au démarrage, commission sur les seules pertes, arrondi à l'entier inférieur, parties
  sans gagnant, fuyards (R-05 ouvert), Double Kora (R-02 ouvert).
- **Anomalies corrigées** :
  1. *Solde « débité » au démarrage* : le séquestre de D-074 ajoutait 2 × M à
     `wallets.reserved` ; le disponible affiché (`solde − réservé`) baissait de 2 × M dès le
     démarrage (ex. 3 682 → 2 682 pour M = 500).
  2. *Commission Kora* : D-074 doublait le TAUX (`KORA_COMMISSION_MULTIPLIER`) en plus de la
     perte : 12 % × 1 000 = 120 au lieu de 6 % × 1 000 = 60.
- **Engagement (remplace le séquestre)** : au démarrage, une ligne `wallet_reservations`
  ACTIVE avec `game_id` (2 × M, perte maximale) est écrite, mais ni `wallets.balance` ni
  `wallets.reserved` ne changent : solde et disponible affichés restent identiques pendant
  toute la partie. Les engagements actifs sont déduits des seuls contrôles de DÉPENSE faits
  sous le verrou du portefeuille (`lockWalletBalances` : retrait, inscription à un tournoi,
  démarrage d'une autre partie) : le perdant peut toujours payer au règlement. Un retrait qui
  entamerait l'engagement est refusé (`InsufficientBalanceError`).
- **Règlement** (inchangé hors Kora, dans la transaction qui termine la partie, une seule fois) :
  - Simple : chaque perdant perd M ; commission = floor(M × (N − 1) × C).
  - Kora : chaque perdant perd 2M (`KORA_LOSS_MULTIPLIER`) ; commission =
    floor(2M × (N − 1) × C). Le taux reste C : `applied_commission_bps = commission_bps`.
  - Gagnant : + (brut − commission) ; plateforme (`platform_ledger`, `GAME_COMMISSION`) :
    + commission. Seul le perdant est débité, et seulement au règlement.
  - Exemple de référence (M = 500, C = 6 %, Roly 3 682, Lamat 7 710, Lamat gagne) : simple →
    Roly 3 182, Lamat 8 180, plateforme +30 ; Kora → Roly 2 682, Lamat 8 650, plateforme +60.
- **Bornes du taux** : 0 % à 100 % par tranche (le plafond de 50 % n'existait que pour que le
  taux doublé reste ≤ 100 %). À 100 %, le gain net vaut 0, jamais négatif.
- **API** : `GET /api/admin/settings/game-commission` expose `koraLossMultiplier` (perte) au
  lieu de `koraMultiplier` (taux) ; la simulation de l'administration suit la même formule.
- **Migration** : 0035 (`0035_game_stake_commitments.sql`) retire de `wallets.reserved` les
  engagements des parties EN COURS au moment du déploiement (aucun solde, aucune écriture,
  aucune partie réglée n'est modifiée) et indexe les engagements actifs par portefeuille.
- **Historique** : les parties Kora réglées sous D-074 (`outcome = 'KORA'` et
  `applied_commission_bps = 2 × commission_bps`) ont prélevé une commission double. Elles ne
  sont PAS recalculées ; toute régularisation exige une décision et une procédure comptable
  explicites. Diagnostic :
  `SELECT game_id, winner_id, gross_amount, commission_amount,
     commission_amount - (gross_amount * commission_bps / 10000) AS excess
   FROM game_settlements WHERE status = 'SETTLED' AND outcome = 'KORA'
     AND applied_commission_bps = 2 * commission_bps AND commission_bps > 0;`
- **Code** : `backend/src/domain/rules/game-settlement.ts`,
  `backend/src/repositories/game-stake-ledger.ts`,
  `backend/src/repositories/wallet-reservations.ts`,
  `administration/features/settings/game-commission.ts`.
- **Tests** : `backend/tests/unit/rules/game-settlement.test.ts`,
  `backend/tests/integration/games/game-settlement.test.ts`,
  `administration/tests/game-commission.test.tsx`.

## D-081 — Détection anti-collusion coupée : option masquée aux joueurs

- **Date** : 2026-10-11 · **Statut** : demandé par le propriétaire du projet (« si au niveau
  de l'administration la détection est désactivée, le bouton "Détection anti-collusion" ne
  doit pas être visible ») · **Révise** : D-053, point « Joueurs : rien n'est exposé ».
- **Règle** : quand l'interrupteur global (D-053) est désactivé, l'option « Détection
  anti-collusion » n'est plus proposée à la création d'une partie privée et la colonne
  bouclier 🛡️ de la liste des tables disparaît. Activée : comportement inchangé (option
  désactivée par défaut, choisie par le créateur, immuable, D-043).
- **Exposition** : `GET /api/sessions/open` renvoie `detectionAvailable` (booléen, relu dans
  PostgreSQL à chaque appel, aucun cache). C'est la seule information donnée aux joueurs :
  ni date, ni acteur, ni historique du réglage. La réponse de géolocalisation d'une partie
  reste celle d'une table non surveillée (D-053).
- **Serveur** : interrupteur coupé, une demande `suspicionDetectionEnabled: true` (ancien
  client) crée une table NON surveillée ; réactiver plus tard l'interrupteur ne la rend pas
  surveillée (option immuable, D-043). Les tables créées détection active et coupée ensuite
  gardent leur réglage, sans aucune détection tant que l'interrupteur reste coupé (D-053).
- **Client** : champ absent (ancien serveur) ou réponse pas encore reçue : option non
  proposée, jamais affichée par défaut.
- **Code** : `backend/src/services/sessions/session.service.ts` (`isDetectionAvailable`,
  création), `backend/src/controllers/session.controller.ts`,
  `backend/src/services/game/create-game-service.ts`,
  `frontend/src/features/sessions/hooks.ts` (`useDetectionAvailable`),
  `frontend/src/features/lobby/PrivateGamePanel.tsx`.
- **Tests** : `backend/tests/integration/detection/detection-global-switch.test.ts`,
  `frontend/src/features/lobby/PrivateGamePanel.test.tsx`.

## D-082 — Joueur absent : la partie continue sans lui ; reprise automatique au retour

- **Contexte** : demande produit (octobre 2026). **Tranche R-24** : le minuteur de tour n'est
  JAMAIS mis en pause pour un joueur absent (application en arrière-plan ou fermée, réseau
  coupé, écran quitté) et la partie ne l'attend pas davantage.
- **Règle** : la partie continue jusqu'à sa fin normale, que le joueur revienne ou non. À
  chaque échéance (20 s, D-064), le serveur joue sa carte par l'algorithme existant (D-036) ;
  le 5e tour est automatique (D-035) ; après la fin, la ronde Poursuivre/Quitter s'applique
  (départ automatique à l'échéance, D-034). Aucun « état d'absence » n'est stocké : un joueur
  absent est un joueur qui ne joue pas avant l'échéance ; il reste membre de sa partie.
- **Serveur (inchangé, vérifié)** : échéances dans PostgreSQL (`games.turn_deadline_at`),
  minuteurs reconstruits au démarrage et balayage toutes les 5 s (`DeadlineSupervisor`),
  commandes idempotentes (un `commandId` par tour, version sous verrou) : ni double carte, ni
  dépendance au téléphone, reprise après redémarrage.
- **Mobile** :
  - premier plan = « focus » de TanStack Query (`installAppFocusManager`) : relecture
    immédiate au retour, aucune relecture en arrière-plan ;
  - reprise au lancement et au retour au premier plan, sur tout écran sauf celui d'une partie
    (`ActiveGameRestorer`, `restoreActiveGame`) : `GET /api/games/me/active` (partie en cours,
    sinon en attente), sinon `GET /api/sessions/me/active` (partie terminée pendant l'absence
    dont la ronde est encore ouverte AVANT son échéance → écran de fin) ; une seule
    vérification et une seule navigation à la fois ; vers `/game/:id?reprise=1` ;
  - écran d'une partie (`useGameReconnection`) : une relecture en échec ne remplace plus la
    table (données avant erreur) ; panneau « Reconnexion » pendant la restauration réelle,
    « Réessayer » après 3 échecs consécutifs ; un refus (403/404) affiche son message ;
  - panneau `ReconnectionPanel` : « Reconnexion » / « Veuillez patienter pendant la
    reconnexion. », voile qui bloque les appuis, marges de sécurité.
- **Limites** : aucune détection native du réseau (pas de NetInfo, module natif non installé) :
  la perte de réseau est constatée par l'échec des relectures et du WebSocket du chat ; l'état
  de la partie est relu toutes les 3 s (pas d'événements de partie sur le WebSocket, T-01).
- **Tests** : `backend/tests/integration/games/game-resume.test.ts`,
  `frontend/src/features/games/use-return-to-active-game.test.tsx`,
  `frontend/src/features/games/use-game-reconnection.test.tsx`.

## D-083 — Achat de jetons : paiement CinetPay DIRECT (sans redirection), MTN Mobile Money

- **Date** : 2026-10-12 · **Statut** : demandé par le propriétaire du projet ; **activation
  soumise à confirmation de CinetPay** (mode direct ouvert sur le compte marchand) ·
  **Complète** : D-050 · **Ne change pas** : montants, conversion 1 FCFA = 1 jeton, règlement
  idempotent du compte de jeu, notifications, réconciliation, règles de jeu.
- **Mécanisme compatible** (vérifié dans le code source du SDK officiel `cinetpay/cinetpay-js` :
  `src/types/payment.ts`, `src/validation.ts`, `examples/direct-pay`) : le MÊME
  `POST /v1/payment` de l'API v1, même OAuth, même `GET /v1/payment/{id}`, même notification,
  avec `direct_pay: true`, `payment_method` (`MTN_CM`) et `client_phone_number` (+237…).
  Réponse : `details { code, status, message, must_be_redirected }`. Aucune autre API, aucun
  SDK client (`cinetpay-seamless` est une fenêtre de paiement hébergée : hors périmètre).
- **Opérateurs** : `CINETPAY_DIRECT_PAY_METHODS`, vide par défaut (désactivé). Seul **MTN_CM** :
  Orange Money exige en direct un `otp_code` saisi par le payeur ; sa collecte n'est pas
  autorisée, `OM_CM` est refusé au démarrage et reste payable par la page CinetPay. Aucun OTP
  n'est jamais demandé, transmis ni journalisé.
- **Numéro** : celui de l'inscription (D-040), jamais saisi ni envoyé par l'application ;
  +237 exigé (sinon `PHONE_UNSUPPORTED`). Jamais journalisé.
- **Sécurité** : le statut annoncé à la création (même `SUCCESS`) est noté, jamais une preuve ;
  seul le statut RELU serveur à serveur règle le paiement (D-050 inchangé). `must_be_redirected`
  → la page est proposée comme une page (mode `REDIRECT`), jamais présentée comme directe.
- **Erreurs** : refus explicite de CinetPay (code API, ex. `422 NOT_ALLOWED`) → achat clos sans
  crédit (`DIRECT_PAYMENT_REFUSED`), `409 DIRECT_PAYMENT_UNAVAILABLE`, repli page CinetPay
  (nouvelle demande). Demande jamais partie (authentification refusée) → `503` comme avant.
  **Issue inconnue** (délai, réseau, 5xx après l'envoi : la demande a pu atteindre le
  téléphone) → paiement **laissé en attente** (`metadata.initialization = UNCERTAIN`), ni
  crédit ni échec ; la réconciliation le recherche par `merchant_transaction_id` : trouvé → sa
  référence est posée puis contrôle normal ; introuvable 30 min après → clos sans crédit.
- **API** : `POST /api/wallet/deposits { tokens, method?: "MTN_CM" }` ; vue de paiement
  `mode: DIRECT | REDIRECT`, `operator` ; `GET /api/wallet` ajoute `directPayOperators`.
- **Migration** : 0036 (une référence peut exister sans empreinte de `notify_token` : paiement
  retrouvé par la réconciliation, réglé par relecture du statut seulement).
- **Détail** : `docs/payments.md` §Paiement direct.

## D-084 — Visibilité des boutons « Main spéciale » et « Se coucher »

- **Date** : 2026-10-12 · **Statut** : demandé par le propriétaire du projet · **Révise** :
  D-035, seulement la visibilité des boutons (« le bouton disparaît ensuite »).
- **« Main spéciale »** : visible tant que le joueur n'a joué AUCUNE carte de la partie, puis
  masqué. Un appui envoie la déclaration (DECLARE_WIN) seulement si le serveur a reconnu une
  main gagnante (`myActions.canDeclareInstantWin`) ; sinon un court message explique que ses
  5 cartes ne forment aucune combinaison gagnante, sans rien envoyer au serveur.
- **« Se coucher »** : visible tant que le joueur n'a pas joué sa DEUXIÈME carte, puis masqué.
  Actif seulement si le serveur autorise la fuite (`myActions.canFlee`) ; sinon affiché
  inactif, en teintes ternes opaques (jamais d'opacité ni de filtre).
- **Fuyard** : aucun des deux boutons. **Cartes jouées** : celles du joueur dans les tours
  terminés et le tour en cours (`cardsPlayedBy`).
- **Inchangé (D-035)** : quand une action est permise (fuite avant sa deuxième carte, D-089,
  un fuyard par partie ; à 2 joueurs l’adversaire gagne, D-086 ; victoire instantanée pour le seul
  détenteur d'une main gagnante avant sa première carte), validation par le serveur à chaque
  commande, conséquences de la fuite et règlement unique de la victoire instantanée.
- **Code** : `frontend/src/features/games/table/TurnHud.tsx` (`TurnActions`, `cardsPlayedBy`).
- **Tests** : `frontend/src/features/games/table/game-table.test.tsx`,
  `frontend/src/features/games/table/card-legibility.test.tsx`.

## D-085 — Achat de jetons : montant saisi par le joueur (fin des montants fixes)

- **Date** : 2026-10-12 · **Statut** : demandé par le propriétaire du projet · **Révise** : D-050
  (montants fixes 500 / 1 000 / 2 000 / 5 000 FCFA, R-16 pour l'achat) · **Ne change pas** :
  devise XAF, 1 FCFA = 1 jeton, crédit uniquement après `SUCCESS` relu par le serveur,
  idempotence, réconciliation, paiement direct MTN (D-083), Orange Money par la page CinetPay,
  retraits, règles de jeu et commissions.
- **Règle** : le joueur saisit le montant de la recharge, **entier en FCFA, de 100 à
  2 500 000**. Ces bornes sont celles du contrat de l'API CinetPay v1 pour un paiement (validation
  des SDK officiels `cinetpay-js` — `assertAmount('amount', …, 100, 2_500_000)` et tableau du
  README — et `cinetpay-go`), déjà relevées dans `docs/payments.md`. Aucune autre limite n'est
  inventée.
- **Serveur seul juge** : `POST /api/wallet/deposits { tokens }` (inchangé) revalide le montant
  avant toute écriture et tout appel CinetPay ; hors limites, décimal, nul, négatif, texte, absent →
  `400 VALIDATION_ERROR` avec un message explicite (`fields.tokens`). `GET /api/wallet` annonce
  `depositLimits { min, max, currency }` ; l'application s'y règle (pré-validation d'affichage).
- **Application** : champ « Montant de la recharge (FCFA) », clavier numérique, montant et jetons
  affichés, bouton « Recharger » indisponible tant que le montant est vide ou invalide, message du
  serveur affiché, saisie bloquée pendant la création. Plus aucun montant prédéfini.
- **Administration** : l'anomalie de rapprochement `PAYMENT_AMOUNT_OUT_OF_RANGE` compare aux
  limites (« Montant hors limites »). Aucune configuration de montants n'est ajoutée.
- **À confirmer par CinetPay** : un plafond ou plancher plus strict propre au compte marchand ou
  à l'opérateur (MTN, Orange Money). Le cas échéant, CinetPay refuse la création : rien n'est
  crédité, le joueur voit un refus.
- **Migration** : aucune (les montants existants restent dans les limites).

## D-086 — Se coucher dans une partie à 2 : défaite du fuyard (R-30, R-05 partiel)

- **Date** : 2026-10-12 · **Statut** : tranché par le propriétaire du projet (« L'autre
  gagne », « Sa mise normale ») · **Tranche** : R-30 · **Tranche en partie** : R-05 (partie à
  2 seulement) · **Ne change pas** : D-035 hors partie à 2 (fuite avant sa deuxième carte,
  D-089 ; un fuyard par partie, contrôleur autorisé ; à 3 ou 4 joueurs la partie continue sans
  le fuyard, qui n'est ni débité ni compté — R-05 reste ouvert pour ce cas).
- **Règle** : dans une partie à 2, le joueur qui se couche (avant sa deuxième carte, D-089)
  perd immédiatement ; l'autre joueur gagne. Victoire SIMPLE (jamais Kora), raison de
  fin `OPPONENT_FLED` (avec gagnant), événements `game:player_fled` puis `game:finished`.
- **Règlement** (transaction qui termine la partie, une seule fois, D-080) : le fuyard paie sa
  mise M comme un perdant ; commission de la tranche figée au démarrage ; le gagnant reçoit
  M − commission. Ex. M = 100, tranche 1 % : fuyard −100, gagnant +99, plateforme +1.
- **Interface** : « Se coucher » est actif dans une partie à 2 dans la même fenêtre qu'à 3 ou
  4 joueurs (`myActions.canFlee`).
- **Schéma** : migration `0037_game_opponent_fled.sql` (contraintes `games_end_reason_check`
  et `games_winner_iff_victory` élargies ; aucune donnée modifiée).
- **Code** : `backend/src/domain/game/ter-engine.ts` (`flee`, `canFlee`),
  `backend/src/domain/game/game.ts`, `backend/src/domain/rules/game-settlement.ts`
  (`settledParticipants`), `administration/features/games/game-outcome.ts`,
  `administration/lib/labels.ts`, `frontend/src/types/game.ts`, `frontend/src/types/session.ts`.
- **Tests** : `backend/tests/unit/game/ter-engine.test.ts`,
  `backend/tests/integration/games/game-api.test.ts`,
  `backend/tests/integration/games/game-settlement.test.ts`,
  `administration/tests/game-outcome.test.tsx`.

## D-087 — Recharge : fenêtre « Recharger mon portefeuille », MTN / Orange Money hybride

- **Date** : 2026-10-12 · **Statut** : demandé par le propriétaire du projet · **Complète** :
  D-050, D-083, D-085 · **Ne change pas** : `POST /api/wallet/deposits`, XAF, 1 FCFA = 1 jeton,
  montant saisi (100 à 2 500 000), crédit seulement après `SUCCESS` relu, idempotence,
  réconciliation, retraits, règles financières du jeu.
- **Interface** : fenêtre centrée « Recharger mon portefeuille » (icône, fermeture discrète),
  montant saisi, deux boutons d'importance égale **MTN Mobile Money** et **Orange Money**
  (« Paiement mobile sécurisé »), mention de sécurité, zone d'état. Supprimés : « Autre moyen
  (page CinetPay) », le nombre de jetons promis, toute trace de montants fixes. Le projet ne
  contient aucun logo officiel MTN / Orange : pastilles textuelles aux couleurs des opérateurs,
  à remplacer par des ressources officielles autorisées.
- **MTN** : paiement DIRECT s'il est proposé (`CINETPAY_DIRECT_PAY_METHODS`) ; repli automatique
  vers la page CinetPay, même montant, SEULEMENT sur un refus certain du serveur
  (`409 DIRECT_PAYMENT_UNAVAILABLE` : rien créé, ou paiement clos sans crédit). Issue incertaine
  (`202` en attente) : le même paiement est suivi, aucun second paiement. Indisponibilité du
  service (`503`) : message, aucun repli.
- **Orange Money** : page CinetPay hébergée, jamais de paiement direct ni d'OTP (D-083, D-086 :
  `OM_CM` reste refusé dans `CINETPAY_DIRECT_PAY_METHODS`).
- **Opérateur sur la page** : nouveau champ `operator` (exclusif de `method`) du même
  `POST /api/wallet/deposits`. L'opérateur est PRÉSÉLECTIONNÉ (`payment_method` sans
  `direct_pay`, contrat des SDK officiels) seulement s'il figure dans
  `CINETPAY_PAGE_PRESELECT_METHODS` (vide par défaut, à renseigner après confirmation par
  CinetPay) ; sinon page générique, et l'application l'annonce (« Sur la page CinetPay,
  choisissez Orange Money. »), sans garantir l'opérateur. `GET /api/wallet` ajoute
  `pageOperators`. Extensible : un paiement direct Orange Money ne pourra être ajouté qu'après
  confirmation officielle de CinetPay et décision sur la collecte de l'OTP.
- **Migration** : aucune.

## D-088 — Recharge : numéro du payeur = numéro d'inscription, avec indicatif, non modifiable

- **Date** : 2026-10-12 · **Statut** : demandé par le propriétaire du projet · **Complète** :
  D-050, D-083, D-087 · **Ne change pas** : montant, opérateurs, crédit après `SUCCESS` relu.
- Pour TOUTE recharge (page CinetPay hébergée, paiement direct MTN, Orange Money), le serveur
  transmet à CinetPay `client_phone_number` = le numéro d'INSCRIPTION du compte, au format
  international avec l'indicatif du pays (ex. `+237692130271`). Avant D-088, la page hébergée ne
  recevait aucun numéro.
- Le numéro vient TOUJOURS du compte (`users.phone`, format garanti par la base depuis 0002 :
  `^\+[1-9][0-9]{7,14}$`) ; l'application n'en envoie aucun, et tout numéro présent dans la
  requête est ignoré. Défense supplémentaire : un numéro non transmissible est refusé avant
  toute écriture (`422 PAYMENT_PROFILE_INCOMPLETE`, champ `phone`).
- L'application affiche ce numéro dans la fenêtre de recharge, « Numéro de paiement »,
  `+237 692130271`, en lecture seule. Il n'est jamais journalisé.

## D-089 — Se coucher jusqu'à la deuxième carte ; bouton masqué pour tous après une fuite

- **Date** : 2026-10-12 · **Statut** : demandé par le propriétaire du projet (« au deuxième
  tour, le joueur peut encore fuir » ; « un seul joueur peut fuir : dès qu'il le fait, le bouton
  ne doit plus être visible chez les autres ») · **Révise** : D-035 (« tour 1 seulement, avant
  la première carte »).
- **Règle** : un joueur peut se coucher tant qu'il n'a pas joué sa DEUXIÈME carte, donc aux
  tours 1 et 2 (`fleeBeforeSecondCard`), qu'il ait la main ou non. Toujours un seul fuyard par
  partie (le premier) ; le joueur qui a le contrôle peut se coucher.
- **Effets** (inchangés) : à 3 ou 4 joueurs, la partie continue sans lui (sa carte du tour 1
  reste jouée ; s'il menait le tour, le suivant antihoraire mène ; s'il était le dernier
  attendu, le tour se termine) ; à 2 joueurs, l'adversaire gagne et le fuyard paie sa mise
  (D-086).
- **Interface** : « Se coucher » visible tant que le joueur n'a pas joué sa deuxième carte ET
  que personne n'a fui ; dès la première fuite, il disparaît chez tous les joueurs.
- **Code** : `backend/src/domain/rules/official-rules.ts`, `backend/src/domain/game/ter-engine.ts`
  (refus, numéro de tour de `game:control_changed`), `frontend/src/features/games/table/TurnHud.tsx`.
- **Tests** : `backend/tests/unit/rules/rules-and-stake.test.ts`,
  `backend/tests/unit/game/ter-engine.test.ts`,
  `frontend/src/features/games/table/game-table.test.tsx`.

## D-090 — Recharge automatique : moyen de paiement déduit du numéro du compte

- **Date** : 2026-10-12 · **Statut** : demandé par le propriétaire du projet ; choix confirmés
  par lui (opérateur par préfixe camerounais ; numéro vérifié NON exigé tant que la vérification
  SMS n'existe pas, R-34) · **Révise** : D-087 (choix MTN / Orange par le joueur) · **Ne change
  pas** : montant saisi (D-085), numéro transmis (D-088), crédit seulement après `SUCCESS` relu,
  idempotence, réconciliation, retraits.
- **Interface** : un champ « Montant de la recharge (FCFA) », le montant à payer, un SEUL bouton
  « Payer avec MTN Mobile Money » (jaune) ou « Payer avec Orange Money » (orange) selon le compte.
  Plus de numéro affiché ni de choix d'opérateur. Numéro non pris en charge : aucun bouton, message
  renvoyant vers l'assistance (le numéro n'est pas modifiable dans le profil).
- **Opérateur** : déduit par le SERVEUR du numéro d'inscription (`operatorOfPhone`) : MTN = 650-654,
  67x, 680-684 ; Orange = 655-659, 69x, 685-689 ; sinon aucun (`409 PAYMENT_OPERATOR_UNSUPPORTED`).
  `GET /api/wallet` ajoute `paymentOperator`. CinetPay n'offre aucune recherche d'opérateur ;
  limite : un numéro porté serait mal identifié (CinetPay refuserait, rien crédité). Bornes
  684/685 et plan à confirmer auprès de l'ARCEP / des opérateurs.
- **Paiement** : l'application n'envoie QUE le montant. Le serveur tente le paiement direct si
  l'opérateur y est ouvert, puis, sur un refus CERTAIN seulement, la page CinetPay du même
  opérateur, sous une clé d'idempotence dérivée (`:page-fallback`) : un rejeu retrouve la même
  page. Issue incertaine : paiement en attente, aucun repli. Indisponibilité : erreur, aucun repli.
  Un `method` / `operator` envoyé par l'application et différent du compte : `400`.
- **Numéro sur la page CinetPay** : transmis (`client_phone_number`, D-088), donc prérempli si la
  page l'utilise. L'API v1 (SDK officiels) n'offre AUCUN paramètre de verrouillage : le champ
  n'est pas garanti non modifiable sur la page CinetPay ; aucun paramètre n'est inventé.
- **Crédit de 1 000 jetons** : aucun crédit fictif ou automatique n'existe (vérifié dans le code et
  en base : les transactions de 1 000 jetons sont des achats payés ou des mises).

## D-091 — Recharge : erreur interne ≠ fournisseur indisponible ; issue inconnue annoncée comme telle

- **Date** : 2026-10-12 · **Statut** : correction d'un défaut constaté · **Complète** : D-050,
  D-083, D-090 · **Ne change pas** : règles financières, crédit seulement après `SUCCESS` relu,
  idempotence, réconciliation.
- **Constat** : « Service de paiement momentanément indisponible. Aucun montant n'a été débité »
  (`503 MOBILE_MONEY_UNAVAILABLE`) venait le 2026-10-12 d'un refus d'AUTHENTIFICATION CinetPay
  (`2011 NOT_ALLOWED`, IP publique du poste non autorisée après un changement de réseau) : demande
  jamais envoyée, aucun paiement créé, message exact. Les erreurs PostgreSQL (« Connection
  terminated… ») venaient de la mise en veille du poste (03:45 → 08:18 UTC) puis du redémarrage
  des conteneurs (08:28 UTC) ; aucune recharge n'a eu lieu pendant cette fenêtre.
- **Défaut corrigé** : `WalletService` transformait TOUTE erreur de création (base de données
  comprise, y compris APRÈS l'appel à CinetPay) en « fournisseur indisponible, rien débité » et
  déclarait l'achat échoué. Désormais :
  - seules les erreurs du fournisseur (`MobileMoneyProviderError` : `CinetPayError`,
    `CinetPayPaymentNotSentError`, fournisseur non configuré) → `503 MOBILE_MONEY_UNAVAILABLE`,
    achat clos sans crédit ;
  - toute autre erreur → `503 PAYMENT_VERIFICATION_PENDING` (« vérification en cours, ne relancez
    pas »), rien déclaré échoué ni crédité ;
  - un paiement DIRECT est marqué « initialisation incertaine » dès sa création (avant l'appel) ;
    la marque disparaît avec la référence CinetPay. Une panne entre l'appel et l'enregistrement
    laisse un paiement que la réconciliation recherche par `merchant_transaction_id` (D-083).
  - connexion PostgreSQL perdue sur n'importe quelle route → `503 SERVICE_TEMPORARILY_UNAVAILABLE`
    (plutôt qu'un 500) ; pool `pg` avec keep-alive TCP (connexions mortes détectées après une
    veille).
- **Application** : messages distincts (indisponibilité du fournisseur, vérification en cours,
  service momentanément indisponible, refus, numéro non pris en charge) ; « aucun montant débité »
  seulement pour un refus certain ; après « vérification en cours », pas de relance immédiate du
  même montant. Fenêtre « Recharger mon portefeuille » redessinée (plus douce).

## D-092 — Délais de jeu ramenés à 10 s

- **Date** : 2026-10-12 · **Statut** : demandé par le propriétaire du projet (« ramener le
  timing de toute l'application à 10 secondes ») · **Révise** : D-064, D-065 et D-068 (délais
  passés de 10 s à 20 s, puis à 15 s).
- **Règle** : les trois délais de jeu visibles des joueurs valent 10 s, fixés par le serveur
  (échéances en PostgreSQL, D-034) :
  - tour de jeu (`TURN_DURATION_MS`) : ensuite TURN_TIMEOUT et carte automatique (D-036) ;
  - ronde Poursuivre/Quitter après une partie (`SESSION_DECISION_WINDOW_MS`) : sans réponse,
    départ automatique ;
  - démarrage d'une table de tournoi par son premier joueur (`TOURNAMENT_TABLE_AUTO_START_MS`) :
    ensuite le serveur démarre.
  Le téléphone n'affiche que le temps restant (`DEFAULT_TURN_MS` ne sert qu'à l'échelle de
  l'anneau du chrono).
- **Inchangé** : délais techniques (requêtes réseau, rapprochements de paiements, balayage des
  échéances, planificateur de tournois), présentation des cartes (2 s), signaux visuels.
  `RANKING_REFERENCE_GAME_MS` (170 s, D-062) reste figé ; il avait été calculé avec ces mêmes
  délais de 10 s.
- **Parties en cours** : une échéance déjà fixée garde sa valeur ; les suivantes durent 10 s.
- **Code** : `backend/src/domain/rules/rule-set.ts`, `backend/src/domain/sessions/session.ts`,
  `backend/src/domain/tournaments/tournament.ts`, `frontend/src/features/games/table/turn-signal.ts`.
- **Tests** : `backend/tests/integration/game/turn-timer.test.ts`,
  `backend/tests/integration/games/turn-timeout-http.test.ts`,
  `backend/tests/integration/timers/deadline-recovery.test.ts`,
  `backend/tests/integration/tournaments/tournament-table-auto-start.test.ts`,
  `backend/tests/unit/sessions/session-domain.test.ts`,
  `frontend/src/features/games/table/table-timings.test.ts`,
  `frontend/src/hooks/use-server-countdown.test.ts`.

## D-093 — APK Android de test par EAS Build (profil `preview`)

- **Date** : 2026-10-12 · **Statut** : demandé par le propriétaire du projet (APK de test
  installable, utilisable depuis tous les réseaux Internet).
- **Règle** : l'APK de test est produite par EAS Build, profil `preview` de `frontend/eas.json`
  (distribution interne, `buildType: apk`, environnement EAS `preview`, `versionCode` géré par
  EAS). Le bundle JavaScript est embarqué (ni `expo-dev-client` ni `expo-updates`) : ni Metro,
  ni Expo Go, ni tunnel Expo.
- **URL du backend** : uniquement `EXPO_PUBLIC_API_URL` (HTTP et WebSocket `/ws` dérivé),
  définie dans les variables EAS de l'environnement `preview`, jamais dans le code source ni
  `eas.json` (une URL de Quick Tunnel est temporaire). `frontend/app.config.js` fait échouer un
  build EAS dont l'URL est absente, non HTTPS ou `localhost`. Toute nouvelle URL impose une
  nouvelle APK (valeur inlinée au build).
- **Inchangé** : `app.json`, protocole temps réel (D-045), authentification, règles métier.
  `android.package` reste `com.anonymous.leter` (à décider avant diffusion large).
- **Doc** : `docs/android-apk-test.md`.

## D-094 — Recharge : panne CinetPay identifiée comme telle ; diagnostic du fournisseur

- **Date** : 2026-10-13 · **Statut** : correction de diagnostic après un incident · **Complète** :
  D-050, D-083, D-090, D-091 · **Ne change pas** : règles financières, sélection du moyen de
  paiement (D-090), repli direct → page seulement sur refus certain, crédit seulement après
  `SUCCESS` relu, idempotence, réconciliation, codes d'erreur de l'API.
- **Constat** : `503 MOBILE_MONEY_UNAVAILABLE` sur six recharges (motif
  `CinetPayPaymentNotSentError:timeout`). Cause : l'authentification CinetPay
  (`POST /v1/oauth/login`) n'aboutissait pas ; `api.cinetpay.net` et `api.cinetpay.co`
  répondaient `522` (Cloudflare, origine injoignable) après ≈ 20 s, au-delà du délai client de
  15 s. Demande de paiement jamais envoyée, rien crédité ni débité : le 503 était exact.
- **Pas de nouveau fournisseur ni de nouveau repli** : il n'existe aucune intégration MTN MoMo ou
  Orange Money hors de CinetPay ; le « paiement direct MTN » est l'option `direct_pay` de la même
  API. Une panne de cette API rend tous les parcours indisponibles ; un repli vers la page ne
  ferait qu'allonger l'attente. Orange Money reste sur la page CinetPay (OTP, D-087).
- **Défaut corrigé** : un 5xx (dont les 52x de Cloudflare) reçu à l'authentification était
  classé « authentification refusée » (motif `…:authentication:522`), orientant vers une fausse
  cause (clé, IP). Il reste une erreur `http` du fournisseur ; la demande reste « jamais
  envoyée » (503, aucun crédit). Les refus 4xx et les codes API restent des refus.
- **Ajouts** : `npm run payments:diagnose` (configuré / joignable / authentification acceptée,
  panne d'origine reconnue, aucun paiement créé ni secret affiché) ; journal
  `cinetpay payment initialization failed` complété par `durationMs` et `pageFallback`.
- **Code** : `backend/src/services/payments/cinetpay/cinetpay-diagnostics.ts`,
  `backend/src/cli/payments-diagnose.ts`, `cinetpay-client.ts` (`login`), `cinetpay.gateway.ts`.
- **Tests** : `backend/tests/unit/payments/cinetpay-diagnostics.test.ts`,
  `backend/tests/unit/payments/cinetpay-client.test.ts` (login 401, 403, 422, 500, 503, 522,
  délai, réseau : toujours « non envoyée »), `backend/tests/unit/payments/cinetpay-gateway.test.ts`
  (journal : motif, durée, repli).
- **Doc** : `docs/payments.md` (dépannage, diagnostic).

## D-096 — Temps réel : 4401 réservé aux refus d'authentification ; incident du 2026-10-13

- **Date** : 2026-10-13 · **Statut** : correction d'un défaut constaté pendant un audit ·
  **Complète** : D-045 (temps réel), D-091, D-094 · **Ne change pas** : authentification par
  la 1re trame, expiration (4401 à l'`exp` du jeton), R-32, règles métier et financières.
- **Constat (2026-10-13, 06:20 → 07:01 UTC)** : `503 SERVICE_TEMPORARILY_UNAVAILABLE` sur
  `GET /api/tournaments`, `500` puis délai dépassé (30 s) sur `POST /api/sessions/:id/leave`,
  fermetures WebSocket `4401`. Cause commune : poste hôte à court de mémoire (7,7 Go de RAM,
  0,3 Go libres, 25,6 Go engagés) qui fige la VM WSL2 de Docker. Preuves PostgreSQL : requêtes
  triviales (`system_settings` par clé) annulées par `statement_timeout`, `canceling
  authentication due to timeout` (60 s), `connection to client lost`, décalage d'horodatage
  de 13 s entre PostgreSQL et Docker. Aucune requête SQL ni verrou applicatif en cause ; les
  deux sessions citées ont ensuite été supprimées normalement (dernier départ, sans historique).
- **Défaut corrigé** : la passerelle fermait en `4401` (« jeton expiré ») TOUTE erreur de
  vérification, y compris une base indisponible : le client renouvelait inutilement son jeton
  pendant la panne. Désormais : `AuthenticationRequiredError` → `4401` (inchangé) ; toute
  autre erreur → trame `SERVICE_TEMPORARILY_UNAVAILABLE` puis fermeture `1013` (Try Again
  Later) ; le client se reconnecte avec délai croissant SANS renouveler le jeton.
- **Inchangé, volontairement** : `57014` (statement timeout) reste une erreur `500` (D-091 :
  ne pas masquer une requête réellement lente) ; à revoir seulement sur décision.
- **Recharges (même jour)** : `503 MOBILE_MONEY_UNAVAILABLE` exact. CinetPay répond à
  l'authentification `422 {code: 2011, status: NOT_ALLOWED, description: "This Ip is not
  withlisted"}` : l'IP publique sortante du poste (et non l'adresse Tailscale) n'est pas sur la
  liste blanche du compte. Demande jamais envoyée, rien débité ni crédité. Action : déclarer
  l'IP publique ACTUELLE chez CinetPay (`npm run payments:diagnose` pour vérifier).
- **Code** : `backend/src/websocket/realtime-gateway.ts`, `frontend/src/lib/realtime-client.ts`
  (commentaire).
- **Tests** : `backend/tests/integration/chat/chat-realtime.test.ts` (session révoquée → 4401
  puis reconnexion avec le jeton renouvelé ; base indisponible → 1013 puis même jeton accepté),
  `backend/tests/integration/sessions/session-api.test.ts` (départ répété, deux départs
  simultanés du même joueur, session supprimée → 404, non-membre → 403, erreur SQL → 500 et
  rollback, départ répété pendant la ronde sans mouvement financier),
  `frontend/src/lib/realtime-client.test.ts` (1013 : pas de renouvellement du jeton).

## D-097 — Table : barres de progression, anneau central, temps réel et GPS fiabilisés

- **Date** : 2026-10-13 · **Statut** : demandé par le propriétaire du projet (capture du
  2026-10-13 : `TEMPS_RÉEL_FERMÉ … code 1006`, « GPS indisponible ») · **Complète** : D-034,
  D-041, D-045, D-046, D-092, D-096 · **Ne change pas** : règles de jeu, durée du tour (10 s,
  `TURN_DURATION_MS`), 5e tour automatique, mises, gains, authentification, consentement.
- **État de tour unique** (`frontend/src/features/games/table/turn-phase.ts`) : joueur attendu,
  échéance et durée lus dans l'état du serveur (`activePlayerId`, `turnStartedAt`,
  `turnDeadlineAt`, `turnTimedOutAt`), échéance ramenée à l'horloge du téléphone par
  `serverNow` (écart recalé seulement au-delà de 250 ms). Aucun tour (`null`) : attente,
  distribution, partie terminée — dont le 5e tour automatique (D-041 : aucun compte à rebours).
  Barres, chrono et anneau lisent ce même état.
- **Barres des joueurs** : la plaque du pseudo devient une barre ; pendant le tour de son
  joueur, un remplissage or (bordeaux sous 30 %) se vide de `restant / durée` (borné à [0, 1])
  jusqu'à 0 à l'échéance, en une seule animation native par tour. Un état reçu en retard ou
  après reconnexion reprend au bon niveau, jamais à 10 s. Échéance dépassée : barre vide, le
  serveur joue la carte (D-036).
- **Chrono en bas à gauche (« roulette »)** : affiché seulement pendant un tour où un joueur
  doit jouer une carte (état de tour non nul et non expiré), masqué en fondu sinon
  (distribution, entre deux parties, fin, 5e tour automatique) ; le compteur « Tour n/5 » et
  le bandeau restent affichés. L'anneau gravé « L » au centre de la table reste toujours
  visible (précision du propriétaire du projet, 2026-10-14).
- **Relecture** : une réponse de relecture plus ancienne que l'état affiché (version
  inférieure) ne le remplace plus (`newestGame`).
- **Temps réel** : arrêt du serveur = fermeture annoncée `1001` (plus une coupure `1006`) ;
  une ligne de journal par fermeture (`realtime connection closed` : code, famille
  `normal` / `server_shutdown` / `auth_rejected` / `dependency_unavailable` / `protocol_error` /
  `heartbeat_timeout` / `transport_lost`, durée ; jamais de jeton) ; port déjà occupé : arrêt
  immédiat de la 2e instance (`EADDRINUSE`). Client : ouverture sans `ready` en 15 s abandonnée
  (`4408`), une seule tentative à la fois, connexion vérifiée par un ping au retour au premier
  plan, un seul avertissement par panne puis « TEMPS_RÉEL_RÉTABLI ».
- **Constat 1006 (non tranché)** : au moment de l'audit, DEUX `npm run dev` (deux `tsx watch`)
  tournaient ; la seconde instance, sans port, gardait ses connexions PostgreSQL/Redis et ses
  minuteurs ; chaque modification redémarrait les deux, coupant les WebSocket. Mémoire libre du
  poste : 0,3 Go sur 7,7 Go (23,5 Go engagés), comme D-096. Cause exacte des 1006 à confirmer
  avec les nouveaux journaux.
- **GPS** : localisation désactivée détectée (`hasServicesEnabledAsync` : « Localisation
  désactivée ») ; dernière position du système de moins de 60 s utilisée d'abord, sinon mesure
  en précision `Balanced` (la précision `High` n'aboutissait souvent pas en intérieur en 20 s,
  d'où « GPS indisponible » permanent) ; première mesure : « Recherche GPS… » ; échec : nouvel
  essai après 15 s ; permission accordée plus tard dans les réglages relue au retour (jamais
  redemandée). Serveur : `missingPosition` (`VIEWER` / `OTHER` / `BOTH`) sur une distance
  inconnue → « Position de <pseudo> non reçue » ; jamais de coordonnée ni d'accusation.
- **Tests** : `turn-phase.test.tsx`, `realtime-client.test.ts`, `GameGeolocation.test.tsx`,
  `chat-realtime.test.ts` (1001, familles, aucun jeton journalisé), `geolocation.test.ts`,
  `geo.test.ts`.

## D-098 — Délais de jeu à 13 s côté serveur, 10 s affichées

- **Date** : 2026-10-14 · **Statut** : demandé par le propriétaire du projet (« remettre les
  timings à 13 secondes mais afficher 10 secondes, dans la barre de progression ou partout
  ailleurs ») · **Révise** : D-092 (10 s) · **Ne change pas** : règles du tour, coup
  automatique (D-036), 5e tour automatique (D-041, sans compte à rebours), présentation des
  cartes, `RANKING_REFERENCE_GAME_MS` (170 s, D-062, figé).
- **Serveur** : `TURN_DURATION_MS`, `SESSION_DECISION_WINDOW_MS` et
  `TOURNAMENT_TABLE_AUTO_START_MS` valent **13 000 ms** ; échéances en PostgreSQL inchangées
  dans leur principe (le serveur reste seul juge).
- **Écrans** : chaque compte à rebours montre **10 s**. Les 3 dernières secondes du serveur sont
  une marge invisible (latence du réseau mobile) : l'échéance affichée vaut l'échéance du
  serveur moins 3 s (`HIDDEN_MARGIN_MS`, `displayedDeadline`,
  `frontend/src/hooks/use-server-countdown.ts`). Concerné : barres de progression des joueurs
  et chrono (`turn-phase.ts`), panneau de fin de partie (10 s, plafonné par l'échéance
  affichée de la ronde), démarrage d'une table de tournoi. À 0 affiché, une carte posée dans
  la marge reste acceptée par le serveur.
- **Parties en cours** : une échéance déjà posée à 10 s s'affiche sur 7 s.
- **Tests** : `turn-phase.test.tsx`, `use-server-countdown.test.ts`, `game-table.test.tsx`,
  `game-over-panel.test.tsx`, `turn-timer.test.ts`, `turn-timeout-http.test.ts`,
  `deadline-recovery.test.ts`, `session-domain.test.ts`, `tournament-table-auto-start.test.ts`.

## D-099 — Qui voit le chrono et les barres ; plus de pastille « J1 »

- **Date** : 2026-10-14 · **Statut** : demandé par le propriétaire du projet · **Révise** :
  D-097 (visibilité du chrono et des barres), D-064 (pastille J1) · **Ne change pas** : D-098
  (13 s serveur, 10 s affichées), règles du tour, 5e tour automatique, J1 dans les règles.
- **Chrono et roulette** (bas gauche) : visibles UNIQUEMENT sur le téléphone du joueur attendu,
  pendant un tour où il doit jouer une carte (état du serveur, échéance non dépassée selon lui),
  de 10 à 0. Masqués chez les autres joueurs, pendant la distribution, entre deux tours, en fin
  de partie et pendant le 5e tour automatique (aucune carte à choisir). « Tour n/5 » et le
  bandeau (« C'est ton tour ! » / « Tour de <pseudo> ») restent affichés pour tous.
- **Barres** : barre d'une plaque affichée si `joueur de la plaque ≠ joueur connecté ET joueur
  de la plaque = joueur attendu` (identifiants réels, jamais les sièges). Pleine au début du
  tour, elle se vide de la fin vers le début en 10 s, calculée sur `turnStartedAt` /
  `turnDeadlineAt` du serveur (`seatTurnFor`, `dialVisibleFor`, `turn-phase.ts`). Nouveau
  joueur attendu : l'ancienne barre disparaît, la nouvelle part de son niveau réel.
- **Pastille « J1 »** supprimée de la plaque : seule reste le pseudo réel. Aucun numéro de siège
  n'est affiché comme pseudo (`playerLabel` : pseudo, sinon « Vous » / « Adversaire »). Le
  premier joueur reste annoncé aux lecteurs d'écran.
- **Tests** : `turn-phase.test.tsx` (table de 4 téléphones : barres, chrono, même tour partout,
  changement de joueur, distribution et fin), `game-table.test.tsx`.

## D-100 — Paiements : causes classées, santé du fournisseur, URL publiques vérifiées

- **Date** : 2026-10-14 · **Statut** : demandé par le propriétaire du projet (« Service de
  paiement momentanément indisponible ») · **Complète** : D-050, D-083, D-090, D-091, D-094,
  D-096 · **Ne change pas** : règles financières, crédit seulement après `SUCCESS` relu chez
  CinetPay et vérifié (références, montant, devise), règlement atomique et idempotent, repli
  direct → page seulement sur refus certain, Orange Money par la page (OTP non collecté),
  idempotence, réconciliation par `merchant_transaction_id`.
- **Causes confirmées (2026-10-14)** : (1) `POST /v1/oauth/login` → `422 {code: 2011, status:
  NOT_ALLOWED}` : l'IP publique ACTUELLE du poste (129.0.76.35) n'est pas sur la liste blanche du
  compte (déjà vu le 2026-10-12 avec une autre IP) ; aucune demande de paiement envoyée, rien
  débité ni crédité ; le domaine répond (< 1 s). (2) `CINETPAY_NOTIFY_URL` et
  `CINETPAY_RETURN_URL` en `http` sur une adresse de réseau privé (10.x) : CinetPay ne peut pas
  livrer ses notifications, seule la réconciliation règle les paiements ; le navigateur du
  payeur ne joint pas la page de retour.
- **Défaut corrigé** : toutes les pannes donnaient le même message. Désormais une
  classification unique (`payment-failure.ts`) : IP refusée, identifiants refusés, réseau/DNS,
  délai avant / après l'envoi, 5xx, réponse illisible, refus métier, moyen indisponible, issue
  inconnue. `503 MOBILE_MONEY_UNAVAILABLE` porte `details { cause, retryable, charged: false }`
  et un message propre à la cause, sans détail interne ; l'application l'affiche.
- **Surveillance** (`payment-health.ts`, en mémoire de l'instance) : état du fournisseur déduit
  des appels réels, revérifié toutes les 5 min (authentification seule) ; alertes journalisées
  à chaque changement d'état (`PAYMENT_PROVIDER_ALERT`, `PAYMENT_PROVIDER_RECOVERED`), seuil de
  5 pannes en 15 min ; réconciliateur (dernier passage réussi, arrêt détecté) ; paiements
  bloqués (> 60 min, `PAYMENTS_STUCK`, jamais clos pour leur âge). Exposé à l'administration :
  `GET /api/admin/system` → `services.payments` (aucun secret, aucune URL).
- **URL publiques** (`config/public-url.ts`) : adresse locale, privée, Tailscale ou Quick
  Tunnel signalée au démarrage ; en production, refus de démarrer.
- **Hors code (action restante)** : ajouter l'IP publique actuelle à la liste blanche CinetPay,
  ou exécuter le backend sur une machine à IP publique FIXE ; exposer le backend par une URL
  HTTPS publique stable pour `CINETPAY_NOTIFY_URL` / `CINETPAY_RETURN_URL`.
- **Tests** : `tests/unit/payments/payment-health.test.ts` (classification, moniteur, rapport,
  URL, réconciliateur, DNS), `cinetpay-payments.test.ts` (cause 2011, délai, 5xx),
  `admin-api.test.ts`, `ShopFlow.test.tsx`.

## D-101 — Carte acceptée : fin du tour signalée en temps réel à tous les joueurs

- **Date** : 2026-10-14 · **Statut** : demandé par le propriétaire du projet (« la roulette et
  la barre continuent après une carte jouée ») · **Complète** : D-045, D-097, D-099 · **Ne
  change pas** : règles du tour, ordre de jeu, D-098 (13 s serveur, 10 s affichées), coup
  automatique (D-036), 5e tour automatique (D-041), autorité du serveur, mises, tournois.
- **Constat** : le serveur clôt déjà le tour à l'acceptation d'une carte (le moteur fixe la
  nouvelle échéance ou l'efface ; `syncTurnTimer` réarme ou annule le timer de LA partie ;
  `handleTurnTimeout` ignore une échéance périmée). Mais les AUTRES téléphones ne
  l'apprenaient qu'à la relecture suivante (toutes les 3 s) : la barre du joueur qui avait joué
  continuait de baisser, et le joueur suivant voyait sa roulette jusqu'à 3 s après le début réel
  de son tour.
- **Décision** : la passerelle WebSocket accepte `game:subscribe` / `game:unsubscribe` ;
  l'abonnement passe par `GameService.subscribe` (appartenance vérifiée). À chaque commande
  acceptée, `game:changed { gameId, version }`, une trame par version, sans aucun contenu
  d'événement. Le téléphone relit alors sa vue joueur par `GET /api/games/:id` (seule source de
  l'état), ignore une version déjà affichée et relit après chaque (ré)abonnement. La relecture
  toutes les 3 s reste le filet de sécurité (temps réel coupé). Le client ne décide jamais seul
  de la fin d'un tour : carte refusée ou requête en échec, la roulette continue.
- **Tests** : `chat-realtime.test.ts` (signal aussitôt chez l'adversaire, carte refusée sans
  signal, une trame par version, non-membre refusé, isolation de deux parties),
  `realtime-client.test.ts`, `game-updates.test.tsx`, `turn-phase.test.tsx` (carte acceptée à
  3 s sur 10).

## D-102 — Timers de décision seulement après la distribution confirmée par le serveur

- **Date** : 2026-10-14 · **Statut** : demandé par le propriétaire du projet (« les chronomètres
  ne démarrent qu'une fois la distribution complète terminée et confirmée par le serveur »)
  · **Complète** : D-032, D-034, D-036, D-097, D-098, D-099, D-101 · **Ne change pas** : règles
  et nombre de cartes de la distribution (3 + 2, antihoraire), ordre de jeu, durée du tour
  (13 s serveur, 10 s affichées), coup automatique (D-036), 5e tour automatique (D-041, sans
  compte à rebours), fin de partie, tournois, mises, paiements.
- **Constat** : `startGame` distribuait ET ouvrait le premier tour dans la même transition
  (`beginTurn(now)`) : l'échéance de J1 et son timer serveur partaient au début de la
  distribution, pendant que les téléphones animaient encore les lots (≈ 2 s à 2 joueurs,
  ≈ 3,7 s à 4). J1 perdait ce temps sur ses 10 s affichées ; à la reconnexion, l'animation
  était même rejouée alors que le tour courait déjà.
- **Décision** : phase de distribution explicite et persistée.
  - Démarrage (manuel, automatique de tournoi, partie suivante, reprise après égalité) :
    distribution complète dans la transition, puis `games.deal_ends_at` (migration 0039) ;
    AUCUNE échéance de tour (`turn_deadline_at` NULL, contrainte en base), aucun timer de
    décision, aucune action de joueur (carte, fuite, déclaration → `409 DEAL_IN_PROGRESS`).
    Victoire automatique et égalité à la donne : inchangées (pas de phase).
  - Durée de la phase (`dealPhaseDurationMs`, `rule-set.ts`) calculée sur le nombre de lots,
    calquée sur le calendrier des téléphones (250 ms, 420 ms par lot, 510 ms de vol et pose)
    + 500 ms de marge de réception : 2,52 s à 2 joueurs, 4,2 s à 4.
  - Fin de phase : commande système COMPLETE_DEAL (`GameService.handleDealDeadline`, file par
    `gameId`, version optimiste). Elle vérifie que chaque joueur servi a ses 5 cartes et
    qu'aucune carte n'est posée, efface `deal_ends_at` et ouvre le premier tour : c'est le
    SEUL point où naît le premier timer de décision ; J1 dispose de toute la durée.
    Événement `game:deal_completed`. Doublons (timer, balayage, deux instances) : un seul
    effet ; déclenchement anticipé : sans effet, timer réarmé.
  - Un seul timer par partie (`GameTimerRegistry`) : il vise la fin de distribution, puis
    l'échéance du tour. `DeadlineSupervisor` reconstruit les fins de distribution au
    démarrage (`findDealDeadlines`) ; une distribution échue pendant un arrêt est confirmée
    au redémarrage, le tour de J1 partant de cet instant.
  - Téléphone : `dealEndsAt` dans la vue ; l'animation ne démarre que si le serveur est
    encore en phase de distribution (une reconnexion après la confirmation affiche le temps
    restant réel, sans rejouer la distribution) ; roulette, barres et halo de tour restent
    inactifs tant que `dealEndsAt` est présent (`turnPhaseOf`, `turnKeyOf`,
    `useTableDealing`).
- **Limite connue** : la fin de phase est une échéance serveur, pas un accusé de réception
  des téléphones. Un téléphone qui reçoit l'état du démarrage avec plus de 500 ms de retard
  finit son animation après le début du tour ; il affiche alors le temps restant réel.
- **Tests** : `tests/integration/game/deal-phase.test.ts` (backend),
  `frontend/src/features/games/table/deal-phase.test.tsx`.

## D-103 — Tournois : bornes de joueurs réglables dans les paramètres (minimum 20, maximum ∞)

- **Date** : 2026-10-14 · **Statut** : demandé par le propriétaire du projet ·
  **Remplace** : les bornes fixes de participants de D-057 (20 à 1 000) ; le reste de D-057
  (« Tournoi complet », contrôles à la soumission, à l'approbation et à la modification) et
  D-058 sont inchangés.
- **Règle** (tournois de l'administration ET propositions de joueurs, bornes incluses) : le
  minimum de participants d'un tournoi et son maximum, s'il est fixé, sont compris entre deux
  paramètres plateforme réglés par l'administration (page Paramètres, « Paramètres des
  tournois ») ; le maximum reste au moins égal au minimum.
  - `tournamentMinimumPlayers` (clé `tournament_minimum_players`) : entier ≥ 2 ; valeur
    initiale **20**.
  - `tournamentMaximumPlayers` (clé `tournament_maximum_players`) : entier ≥ 2, ou `null` =
    aucun plafond ; valeur initiale **∞** (`null`). Au moins égal au minimum réglé.
- **Stockage** : `system_settings` (migration 0040). Aucune ligne insérée : tant qu'une clé
  n'a jamais été enregistrée, le serveur applique la valeur initiale du code. Plafond
  technique : 2 147 483 647 (colonne `integer`).
- **Contrôles serveur** : `validateTournamentInput` lit les deux paramètres ; la modification
  des paramètres est validée (`updateSettings`) et inscrite au journal d'audit
  (`TOURNAMENT_SETTINGS_UPDATED`). Les tournois déjà publiés ne sont pas modifiés.
- **Conséquence** : avec un minimum réglé sous 10, la part « non attribuée » de D-054 peut de
  nouveau se produire (calcul inchangé).
- **Tests** : `tests/unit/tournaments/tournament-domain.test.ts`,
  `tests/integration/tournaments/tournament-api.test.ts`.

## D-104 — Tournois : durée minimale et maximale réglables (45 et 120 min par défaut), appliquées partout

- **Date** : 2026-10-14 · **Statut** : demandé par le propriétaire du projet ·
  **Remplace** : les bornes fixes de durée de D-058 (30 à 120 minutes). La FORME du message
  imposée par D-058 est conservée, avec les bornes réglées : « Durée entre X minutes et Y
  minutes. » (point final compris).
- **Règle** (tournois de l'administration ET propositions de joueurs, bornes incluses) : la
  durée d'un tournoi est comprise entre deux paramètres plateforme réglés UNIQUEMENT dans
  l'administration (page Paramètres, « Paramètres des tournois ») :
  - `tournamentMinimumDurationMinutes` (clé `tournament_minimum_duration_minutes`) : valeur
    initiale **45** ;
  - `tournamentMaximumDurationMinutes` (clé `tournament_maximum_duration_minutes`) : valeur
    initiale **120**.
  Entiers de 1 à 1 440 (24 h, borne haute historique de D-054) ; le maximum est au moins égal
  au minimum.
- **Stockage** : `system_settings` (migration 0041). Aucune ligne insérée : tant qu'une clé
  n'a jamais été enregistrée, le serveur applique la valeur initiale du code.
- **Pris en compte partout** (le serveur reste seul juge, `validateTournamentInput`) :
  - lecture par tout joueur connecté : `GET /api/tournaments/rules` (bornes de durée et de
    joueurs de D-103) ;
  - application mobile (proposition d'un joueur, création par l'administrateur) : contrôle
    immédiat avec les bornes réglées et les mêmes messages que le serveur ; valeurs par défaut
    ajustées (minimum de joueurs, durée ramenée dans les bornes), sans toucher une saisie ;
  - administration : formulaire de création (valeurs par défaut, règles affichées) et liste
    des tournois affichent les bornes réglées.
- **Tournois existants** : non modifiés. Une modification, une soumission ou une approbation
  est revérifiée avec les bornes en vigueur (comme D-057).
- **Tests** : backend `tournament-domain.test.ts`, `tournament-api.test.ts` ; mobile
  `tournament-form.test.ts`, `ProposeTournamentScreen.test.tsx`, `AdminTournaments.test.tsx`.

## D-105 — Tournois : prix d'entrée minimal réglable (500 FCFA par défaut)

- **Date** : 2026-10-14 · **Statut** : demandé par le propriétaire du projet ·
  **Remplace** : le minimum fixe de 500 FCFA (`TOURNAMENT_LIMITS.minEntryFee`, D-054, D-071).
  Le maximum reste fixe (100 000 FCFA) et un tournoi n'est jamais gratuit (D-071).
- **Règle** (tournois de l'administration ET propositions de joueurs) : le prix d'entrée est
  au moins égal au paramètre plateforme `tournamentMinimumEntryFee` (clé
  `tournament_minimum_entry_fee`), réglé UNIQUEMENT dans l'administration (« Paramètres des
  tournois », champ « Prix d'entrée minimal (FCFA) ») : valeur initiale **500** ; entier de 1 à
  100 000. Message du serveur : « Montant entier entre X et 100000. ».
- **Stockage** : `system_settings` (migration 0042). Aucune ligne insérée : tant que la clé
  n'a jamais été enregistrée, le serveur applique 500.
- **Pris en compte partout** (le serveur reste seul juge, `validateTournamentInput`) :
  - `GET /api/tournaments/rules` expose `minimumEntryFee` et `maximumEntryFee` ;
  - application mobile : contrôle immédiat du prix avec le même message que le serveur ; le
    prix proposé par défaut (1 000 FCFA) est relevé au minimum s'il est plus élevé, sans
    toucher une saisie ; champ aussi dans l'écran Paramètres des tournois de l'administration
    mobile ;
  - administration web : champ dans « Paramètres des tournois » ; règles affichées dans le
    formulaire de création et la liste des tournois.
- **Tournois existants** : non modifiés. Une modification est revérifiée avec le minimum en
  vigueur (comme D-057).
- **Tests** : backend `tournament-domain.test.ts`, `tournament-api.test.ts`,
  `tournament-token-setup.test.ts` ; mobile `tournament-form.test.ts`,
  `AdminTournaments.test.tsx` ; administration `token-setup.test.tsx`.

## D-106 — Tournois : clôture sans annulation forcée, classement D-106 figé au démarrage, résultats globaux consultables

- **Date** : 2026-10-15 · **Statut** : demandé par le propriétaire du projet (exécution
  autonome, choix techniques délégués) · **Remplace** : la règle « Fin » de D-054 (annulation
  `VOID` des parties encore en cours 10 min après la fin) ; la normalisation de D-062 pour les
  tournois qui DÉMARRENT après la migration 0043 · **Complète** : D-054, D-056, D-062, D-063,
  D-065, D-072 · **Ne modifie pas** : inscriptions, réservations, capture, commission,
  cagnotte, répartition et versement des gains, règlement d'une partie (mise effective, tapis,
  seuil 2 × mise), parties ordinaires (D-073, D-074).
- **Capital de tournoi** (inchangé, vérifié) : `tournament_player_accounts` = capital alloué au
  démarrage (`initial_tokens`, désormais IMMUABLE en base), jetons restants, parties jouées et
  gagnées, statut, `created_at` (début de participation) et `finished_at` (nouveau : classement
  officiel calculé, compte figé ensuite par un trigger). L'allocation est dans la transaction du
  démarrage (capture, commission, cagnotte, comptes, `IN_PROGRESS`), idempotente (contrainte
  d'unicité, statut verrouillé) ; le compte de jeu n'est jamais crédité de jetons de tournoi.
- **Rattachement explicite des parties** : `games.tournament_id` (migration 0043) est écrit À LA
  CRÉATION de chaque partie d'une table de tournoi (première partie : `SessionService` →
  `prepareNewGame({ tournamentId })` ; parties suivantes et rejouées : copiées de la
  précédente), puis immuable. Le lien de la table (`tournament_sessions`) est inséré AVANT la
  première partie, dans la même transaction. Garde-fous PostgreSQL (`games_tournament_guard`) :
  le tournoi d'une partie est celui de sa table (jamais une partie ordinaire rattachée, jamais
  l'inverse), immuable ; `tournament_games_link_guard` : un règlement ne vise qu'une partie de
  SON tournoi. Les parties existantes sont rattachées par la migration. Le règlement lit
  `game.tournamentId` (repli sur la table pour une partie lue sans la colonne).
- **Fin du tournoi = fin des DÉMARRAGES** (pas des parties) :
  - `GameStartWindow` (nouvelle dépendance de `GameService`, `tournamentGameStartWindow`) :
    une partie de tournoi ne démarre, manuellement (`409 TOURNAMENT_COMPLETED`) ou à son
    échéance automatique (échéance retirée, aucun démarrage), que si le tournoi est
    `IN_PROGRESS` et `ends_at` non atteint ;
  - garde-fou en base : une partie de tournoi ne passe `in_progress` que si son tournoi est
    `IN_PROGRESS`, lu `FOR SHARE` (la transition de clôture, `FOR UPDATE`, et un démarrage ne
    peuvent pas se croiser) ;
  - attribution de table et accès direct : inchangés (déjà refusés après `ends_at`).
  Une partie commencée avant la fin se termine normalement, même longtemps après.
- **Clôture** (`CALCULATING_RESULTS`, à chaque tick et chaque commande, idempotente) :
  1. règlement des parties terminées non réglées ;
  2. tables du tournoi SANS partie en cours (partie en attente, ou partie finie en ronde
     Poursuivre/Quitter) : leurs joueurs les quittent par le départ de session existant
     (R-19, D-037) et sont notifiés (`TOURNAMENT_TABLE_CLOSED`, une fois par table) : ils
     retrouvent aussitôt les parties ordinaires et le tournoi suivant ;
  3. le classement attend qu'il ne reste AUCUNE partie `in_progress` rattachée au tournoi ET
     aucune partie terminée non réglée. Jamais de résultat forcé ni d'annulation. Au-delà de
     10 min après la fin, alerte `TOURNAMENT_CLOSING_DELAYED` (`alert: true`, au plus toutes
     les 5 min) ; une partie bloquée se résout par les mécanismes existants (timers
     reconstruits par `DeadlineSupervisor`, `npm run game:finish` : partie alors `VOID` sans
     gagnant, traçable).
  Tout est relu dans PostgreSQL : un redémarrage reprend la clôture où elle en était.
- **Classement D-106** (méthode `D106_CAPITAL_RATIO`, figée au DÉMARRAGE avec
  `tournaments.ranking_method` et `ranking_games_reference` ; les poids restent copiés à la
  publication, D-062, donc eux aussi figés avant le démarrage) :
  - `ratio_jetons = jetons restants / capital initial` (1 = capital conservé ; peut dépasser 1
    puisque les jetons gagnés viennent des adversaires) ;
  - `ratio_parties = min(parties jouées, R) / R`, `R = max(1, floor(durée / 170 s))` (même
    durée de référence d'une partie que D-062 : 10 parties pour 30 min, 42 pour 2 h). Le
    plafond à 1 évite de favoriser ceux qui ont eu accès à davantage de parties : au-delà de la
    référence, jouer plus ne rapporte plus rien ; `R` ne dépend que des paramètres figés du
    tournoi, jamais des autres participants ;
  - `score = 100 × (poids_jetons × ratio_jetons + poids_parties × ratio_parties)`, poids en
    fractions (paramètres `rankingTokensWeightPercent` / `rankingGamesWeightPercent`, 0 à 100,
    somme exactement 100, validés par le serveur et l'administration) ;
  - seules comptent les parties RÉGLÉES du tournoi (une partie `VOID` n'incrémente rien) ;
    aucune donnée d'une partie ordinaire ou d'un autre tournoi ;
  - comparaison en fractions EXACTES ; départage inchangé (D-062) : parties gagnées DESC,
    date d'inscription ASC, identifiant ; le critère appliqué est ENREGISTRÉ (`tie_break` :
    `GAMES_WON`, `REGISTRATION_ORDER`, `PLAYER_ID`). Éliminés, soldes nuls et joueurs sans
    partie sont classés ;
  - les tournois démarrés avant 0043 gardent D-062 (`D062_SATURATING`) ; le score n'est plus
    borné à 100 (colonne élargie à `numeric(12, 4)`).
- **Audit et immuabilité** : chaque ligne de `tournament_results` fige rang, score, capital,
  jetons restants, parties, ratios, poids, référence, méthode, départage et date
  d'inscription. Trigger `tournament_results_guard` : aucune suppression, aucune modification
  sauf l'inscription UNIQUE du versement d'un gain. `tournaments_frozen_rules_guard` : après le
  démarrage, ni méthode, ni référence, ni poids, ni capital, ni mise ne changent. Aucune
  procédure de correction administrative n'existe : aucune n'est inventée.
- **Publication** : classement, comptes clos, `RESULTS_VALIDATED` et une notification
  `TOURNAMENT_RESULTS_AVAILABLE` par participant (clé `results:<tournoi>`) sont écrits dans UNE
  transaction (boîte d'envoi durable : jamais de classement sans annonce, ni l'inverse ; la même
  clé à `COMPLETED` est dédoublonnée). Après le COMMIT, signal temps réel `notification`
  (WebSocket, salle `user:{userId}`, Redis Pub/Sub `le-ter:user:{userId}:events`), sans
  contenu et sans garantie : un échec n'a aucun effet sur le classement. Message traduit
  (FR/EN) : « Le tournoi est terminé ! Le classement officiel est disponible. Consultez vos
  résultats et votre position finale. ».
- **API** (authentifiées, identité du JWT) :
  - `GET /api/tournaments/:id/results` : classement général OFFICIEL (rang, pseudo, score,
    jetons restants, parties, gain, départage, `isViewer`), règles figées, et `me` = détail de
    MON score (ratios, points par critère, capital) — jamais celui d'un autre. Aucun
    identifiant interne, téléphone, e-mail ni solde. Lisible par tout joueur connecté pour un
    tournoi publié (règle D-054 inchangée) ; `me` vaut `null` pour un non-participant ; tournoi
    non publié : 404 (D-056) ; clôture en cours : `409 TOURNAMENT_RESULTS_UNAVAILABLE`.
  - `GET /api/tournaments/results?before=<ISO>` : mes tournois aux résultats publiés, sans
    limite de date (la liste principale garde 7 jours, D-072), 20 par page.
  - `GET /api/tournaments/:id/me` : MON contexte (jetons de CE tournoi, parties, rang
    provisoire, échéance, statut de participation), réservé aux participants.
  - CSV admin : colonnes d'audit ajoutées EN FIN (`Ranking Method`, `Tokens Ratio`,
    `Games Ratio`, `Tokens Weight %`, `Games Weight %`, `Games Reference`, `Tie Break`).
- **Application mobile** : Tournois → « 🏆 Résultats des tournois » (`/tournament/results`) :
  mes tournois terminés (date, statut, participants, publication, ma position) →
  `/tournament/results/[tournamentId]` : classement général complet (podium distingué, ma
  ligne surlignée, départage signalé), carte « Votre résultat » (rang, score, capital, jetons,
  parties, pondérations, détail par critère), états chargement / publication en cours (relu
  toutes les 15 s) / erreur. Fiche d'un tournoi terminé : « Voir le classement complet » ; la
  notification de fin y mène. Table de tournoi : le HUD affiche les jetons de CE tournoi,
  les parties jouées, le rang provisoire et le temps restant (`game.tournamentId`, décidé par
  le serveur) au lieu du compte de jeu. Le signal temps réel n'ouvre aucune connexion : il est
  reçu pendant une partie ; sinon les relectures habituelles suffisent.
- **Administration Next.js** : contrôle immédiat « somme des poids = 100 % » dans les
  paramètres ; colonne « Départage » dans les résultats d'un tournoi.
- **Technique** : migration **0043** (`0043_tournament_closure_results.sql`, ajouts et
  triggers ; données existantes rattachées, tournois démarrés marqués D-062). Tests : backend
  `tests/integration/tournaments/tournament-closure-results.test.ts`,
  `tests/unit/tournaments/tournament-ranking-d106.test.ts`,
  `tests/unit/websocket/user-event-bus.test.ts`,
  `tests/integration/database/tournament-closure-migration.test.ts`, signal WebSocket dans
  `tests/integration/chat/chat-realtime.test.ts` ; mobile
  `src/features/tournaments/TournamentResults.test.tsx`, `src/lib/realtime-client.test.ts`.

## D-107 — Tournois : parties comptées à l'échelle du tournoi, registre des règlements source officielle

- **Règle** : la colonne « Parties » du classement et le critère « Parties jouées » de la
  formule (D-062 / D-106) sont le total des parties ADMISSIBLES jouées par le joueur dans
  TOUT le tournoi, toutes tables (sessions) confondues. Le tournoi est l'unité de référence,
  jamais la session : quitter une table, en rejoindre une autre, se déconnecter ou un
  redémarrage du backend ne réinitialise rien.
- **Partie admissible** : partie TERMINÉE, rattachée au tournoi (`games.tournament_id`,
  D-106) et réglée `SETTLED` dans `tournament_games`. Exclues : parties ordinaires, parties
  d'un autre tournoi, parties annulées ou réglées `VOID` (sans vainqueur, démarrées après la
  fin, tournoi non en cours). Une partie compte une fois par joueur (`tournament_games.game_id`
  unique ; participants = clés de `transfers`, écrites une seule fois au règlement).
- **Source officielle** : le registre `tournament_games`. Les compteurs de
  `tournament_player_accounts` (`games_played`, `games_won`, `current_tokens`) restent
  incrémentés à chaque règlement mais ne sont qu'un cache : le classement provisoire
  (`standings`, contexte/HUD) et la clôture recalculent les comptes depuis le registre
  (`TournamentRepository.tallySettledGames`, `reconcileAccountsWithLedger`). En cas d'écart, le
  registre fait foi, l'écart est journalisé (`TOURNAMENT_ACCOUNTS_RECONCILED`) et la clôture
  écrit les valeurs du registre dans les comptes clos et dans `tournament_results`.
- **Clôture** : inchangée sur l'ordre (D-106) : aucune partie en cours, toutes les parties
  terminées réglées, PUIS recalcul global, classement, figement et publication.
- **Affichage** : administration Next.js, colonne « Parties » = `parties jouées / parties de
  référence figées` (`rules.gamesReference`, désormais aussi renvoyé par
  `GET /api/admin/tournaments/:id/results`), victoires dans une colonne « Gagnées » distincte
  (l'ancienne cellule `gagnées / jouées` se lisait comme « jouées / référence »). Application
  mobile, administration et export CSV lisent les mêmes lignes figées de `tournament_results`.
- **Tests** : backend `tests/integration/tournaments/tournament-games-across-tables.test.ts`,
  `tests/unit/tournaments/tournament-ledger-reconciliation.test.ts` ; administration
  `tests/tournament-results-columns.test.tsx`.

## D-108 — Tournois proposés par les joueurs : préinscriptions dès la soumission, approbation sans délai d'1 h

- **Date** : 2026-10-15 · **Statut** : demandé par le propriétaire du projet (choix
  techniques délégués) · **Modifie** : D-054 (cycle d'une proposition), D-056 (« Délai d'une
  heure » à l'approbation, confidentialité des propositions soumises), D-065 (liste) ·
  **Ne modifie pas** : statuts et transitions, modèle financier (réservation, capture au
  démarrage, libération), commission et poids copiés à la publication, D-106 (méthode figée
  au démarrage), durée, prix d'entrée, bornes de joueurs, chevauchement, limite de tournois en
  attente, limite de propositions par joueur, délai d'1 h à la création et à la soumission.
- **Préinscriptions** : une proposition SOUMISE (`PENDING_APPROVAL`) est visible de tous les
  joueurs (liste `GET /api/tournaments` et fiche) et ouverte aux inscriptions avant
  l'approbation. Aucun nouveau statut : la fenêtre d'inscription (`registrationWindowOpen`,
  domaine, seule règle partagée par le service et la vue joueur) accepte `REGISTRATION_OPEN`
  (D-054, inchangé) et `PENDING_APPROVAL` (`PRE_REGISTRATION_STATUSES`), de l'ouverture
  choisie (sinon dès la soumission) jusqu'à la clôture, au plus tard au début. Le brouillon
  (`DRAFT`) reste privé et fermé. Une préinscription est une inscription ordinaire : même
  transaction (verrou du tournoi, capacité, unicité (tournoi, joueur), disponible ≥ prix),
  même RÉSERVATION du prix d'entrée (aucun débit, aucun jeton de tournoi, aucun compte de
  tournoi), même notification `TOURNAMENT_REGISTRATION_CONFIRMED`, désinscription possible.
  La proposition n'est pas publiée pour autant : pas de créneau réservé, pas de commission ni
  de poids figés, jamais de démarrage.
- **Approbation** : le délai d'1 h entre l'approbation et le début est SUPPRIMÉ ; le début
  doit seulement être encore à venir (`validateTournamentInput`, option `approval`). Toutes
  les autres règles sont revérifiées comme avant (durée, prix, joueurs, répartition,
  chevauchement, limite de tournois en attente). Les préinscriptions sont conservées telles
  quelles (mêmes lignes, mêmes réservations : rien n'est dupliqué, personne ne se réinscrit) ;
  le tournoi suit ensuite le cycle normal (`SCHEDULED` → `REGISTRATION_OPEN` → … → démarrage
  à `starts_at` avec capture, ou annulation `INSUFFICIENT_PLAYERS`). Le créateur ET les
  préinscrits reçoivent `TOURNAMENT_APPROVED`. Une approbation refusée (chevauchement,
  limite…) laisse la proposition en attente et ses préinscriptions intactes.
- **Refus** (`POST /api/admin/tournaments/:id/reject`) : `CANCELLED` / `APPROVAL_REJECTED` ;
  dans la même transaction, toutes les réservations actives sont libérées et le créateur et
  les préinscrits reçoivent `TOURNAMENT_CANCELLED`. Plus aucune inscription n'est acceptée.
  **Idempotent** : un refus répété d'une proposition déjà refusée renvoie le tournoi sans
  rien libérer, notifier ni auditer de nouveau. La fiche reste consultable par le créateur,
  l'administration et les anciens préinscrits ; pour les autres : `404` (D-056).
- **Retrait, annulation, expiration** : inchangés et appliqués aux préinscriptions (libération
  de toutes les réservations, notification des inscrits). Une proposition jamais approuvée
  avant son début est annulée par le planificateur (`APPROVAL_REJECTED`, comportement
  existant) : rien n'est capturé, aucune table n'est ouverte.
- **Modification de date** : inchangée (D-054) : dès la première préinscription, ni le
  créateur ni l'administration ne peuvent plus modifier la proposition (`409
  TOURNAMENT_LOCKED`) ; les préinscrits ne gardent jamais des informations périmées.
- **Temps réel** : approbation, refus, retrait et annulation envoient un signal personnel
  (D-106) à chaque destinataire APRÈS le COMMIT ; le mobile relit alors la liste et la fiche
  par l'API. Le signal n'est jamais la source : au retour dans l'application, tout est relu.
- **Affichage** : mobile, statut « Préinscriptions ouvertes » / « Pre-registration open »
  (groupe « Inscriptions ouvertes » de la liste s'il reste une place ; jamais « Démarrage »)
  et explication « Proposition en attente d'approbation… » sur la fiche ; « Mes
  propositions » indique que les préinscriptions sont ouvertes. Administration : badge
  « Préinscriptions ouvertes » à côté de « À approuver », carte « Préinscriptions et
  réservations », conséquences rappelées dans les confirmations Approuver et Refuser.
- **Points laissés à décider par le propriétaire** (non tranchés ici) :
  - les préinscriptions d'une proposition ne sont pas comptées dans la limite de 5 tournois
    aux inscriptions ouvertes (D-072, comptée sur les tournois publiés et garantie à
    l'approbation) : plusieurs propositions peuvent donc être ouvertes aux préinscriptions en
    même temps que 5 tournois publiés ;
  - le chevauchement n'est contrôlé qu'à l'approbation (D-059) : une proposition qui en
    chevauche une publiée peut recevoir des préinscriptions puis ne pas pouvoir être
    approuvée (elle est alors refusée et les réservations libérées) ;
  - les jetons de départ et la mise d'une proposition suivent les coefficients en vigueur
    jusqu'à l'approbation (D-071) : un changement de coefficients entre une préinscription et
    l'approbation change ces valeurs (le prix d'entrée réservé, lui, est figé) ;
  - aucune notification n'est envoyée aux autres joueurs à la soumission (la proposition
    apparaît dans leur liste à la prochaine lecture).
- **Compléments (audit, même jour)** :
  - la notification `TOURNAMENT_APPROVED` d'un préinscrit porte `preRegistered: true` (absent
    pour le créateur). Le mobile masquait toute notification d'approbation (réservée au
    créateur, qui voit « ✓ Proposition approuvée » sur sa carte) : un préinscrit n'était donc
    jamais informé visiblement, et le texte « votre proposition est approuvée » ne le
    concernait pas. Il voit désormais « tournoi approuvé, votre préinscription est
    conservée » ; le créateur, inchangé ;
  - le libellé mobile du départage `PLAYER_ID` suit D-109 (« départagé à l'identifiant du
    joueur », au lieu de « critère technique déterministe ») ; D-109 n'est pas modifiée ;
  - concurrence vérifiée sur PostgreSQL RÉEL (base de test dédiée `le_ter_test`, schéma
    temporaire supprimé, deux instances) : `tests/integration/tournaments/
    postgres-tournament-pre-registration.test.ts` (8 cas : préinscriptions simultanées et
    capacité, double préinscription, double approbation, refus répétés simultanés,
    approbation contre refus, préinscriptions pendant un refus, retrait et annulation
    simultanés, expiration avancée par deux instances) : une seule réservation, une seule
    libération, une notification et un audit par événement ;
  - **approbation après la clôture choisie des inscriptions** : une proposition dont
    `registrationClosesAt` (fixée par le joueur) est passée pendant les préinscriptions, mais
    dont le début est encore à venir, était refusée à l'approbation (`registrationClosesAt`
    comparée à l'heure courante, vestige du délai d'1 h). À l'approbation, seul l'ordre des
    dates choisies est revérifié (clôture après l'ouverture choisie, au plus au début ; la
    clôture a déjà été vérifiée contre l'horloge à la soumission). Le tournoi est publié
    puis passe aussitôt en `REGISTRATION_CLOSED` : préinscrits conservés, plus aucune
    inscription, démarrage normal à `starts_at`. Test : « approuvée après la clôture choisie
    des inscriptions » (`tournament-pre-registration.test.ts`).
- **Données** : aucune migration (aucune contrainte n'interdisait une inscription sur une
  proposition ; les types de notification utilisés existent déjà).
- **Tests** : backend `tests/integration/tournaments/tournament-pre-registration.test.ts`
  (21 cas), `tests/unit/tournaments/tournament-domain.test.ts` (fenêtre, approbation),
  `tournament-service.test.ts` et `tournament-api.test.ts` adaptés ; administration
  `tests/tournament-pre-registration.test.tsx` ; mobile `tournament-state.test.ts`,
  `tournament-groups.test.ts`, `TournamentDetailPanel.test.tsx`.

## D-109 — Tournois : colonne « Parties » sans dénominateur, départage audité et libellé « Identifiant »

- **Date** : 2026-10-15 · **Statut** : demandé par le propriétaire du projet · **Complète** :
  D-062, D-106, D-107 · **Ne modifie pas** : formule du score, pondérations, ordre du
  départage, règlement des parties, résultats déjà publiés.
- **« Parties »** (administration, classement mobile, export CSV) : un NOMBRE seul, le total des
  parties admissibles jouées dans tout le tournoi, toutes tables confondues, calculé par le
  serveur depuis le registre des parties réglées (D-107 : `tournament_games` `SETTLED`, une
  ligne par partie, parties ordinaires, autres tournois et parties `VOID` exclus). L'affichage
  « jouées / référence » de l'administration (« 5 / 1 » : la référence `R` de D-106 vaut 1
  pour un tournoi court) est supprimé. La référence `R` reste une donnée interne de
  normalisation du score (colonne d'audit `Games Reference` du CSV, règles du classement).
- **Départage réellement appliqué** (vérifié dans `rankTournamentAccounts` et `rankAccounts`,
  `domain/tournaments/tournament.ts`, inchangé) : 1) score EXACT (fractions entières, jamais
  le score arrondi) décroissant ; à égalité exacte 2) parties gagnées décroissant ;
  3) date d'inscription croissante ; 4) identifiant du joueur croissant (`localeCompare`,
  ordre total). Les jetons restants ne départagent jamais : ils sont dans le score.
- **Critère affiché** : celui enregistré avec le résultat officiel (`tournament_results.tie_break`,
  `tieBreakBetween`) : pour une ligne à score égal à celle du dessus, le premier critère qui
  les sépare ; pour la première ligne d'un groupe à égalité, le critère qui la sépare de la
  suivante ; « — » sans égalité. Libellés : `GAMES_WON` « Parties gagnées »,
  `REGISTRATION_ORDER` « Ordre d'inscription », `PLAYER_ID` « Identifiant » (auparavant
  « Critère technique » dans l'administration).
- **Tests** : administration `tests/tournament-results-columns.test.tsx` (total seul, libellés,
  « — ») ; backend `tests/unit/tournaments/tournament-ranking-d106.test.ts` (ordre et critère
  enregistré), `tests/integration/tournaments/tournament-games-across-tables.test.ts`
  (cumul toutes tables, exclusions, cohérence application / administration / CSV, redémarrage).

## D-110 — Mobile : retour au premier plan sans rechargement, cycle de vie centralisé

- **Date** : 2026-10-15 · **Statut** : demandé par le propriétaire du projet.
- **Constat (audit)** : aucun rechargement du bundle (`reloadAsync` absent), aucune
  réinitialisation de store ni redirection au simple retour. Les causes du « redémarrage »
  perçu étaient :
  1. la racine React REMONTÉE quand Android recrée l'activité (le moteur JavaScript survit) :
     le cache TanStack Query vivait dans un `useState` de `app/_layout.tsx` (perdu), la pile de
     navigation repartait de l'accueil, et la réouverture du dernier écran n'était décidée
     qu'une fois par PROCESSUS (donc jamais après un remontage) ;
  2. l'activité recréée sur des changements de configuration non déclarés (taille du texte,
     taille d'affichage, langue modifiées dans Réglages pendant l'absence) ;
  3. le processus détruit par Android : seuls tournois, administration et documents légaux
     étaient rouverts ; le panneau ouvert (portefeuille, profil…) et le classement d'un tournoi
     étaient perdus ;
  4. cinq écouteurs `AppState` indépendants aux règles différentes ; certains relisaient sur
     `inactive → active` (centre de notifications, dialogue système), et la fraîcheur nulle par
     défaut relisait TOUTES les requêtes de tous les écrans montés à chaque retour ; l'écran de
     partie envoyait deux requêtes par retour (la relecture explicite annulait celle du focus).
- **Décision** :
  - `src/lib/app-lifecycle.ts` : UNE souscription native partagée ; « retour au premier plan »
    = `background` puis `active` (jamais `inactive` seul), un événement par retour, avec la
    durée d'absence ; abonnements nettoyés, aucune navigation ni remontage. Abonnés : focus
    TanStack Query (`app-focus`), reprise de session (`session.ts`), reprise de la partie
    active (`useActiveGameRestorer`), écran de partie (`useGameReconnection`), WebSocket
    (`useRealtimeWake`), géolocalisation (`useScreenActive`).
  - `src/lib/query-client.ts` : cache unique au niveau du module (survit à un remontage),
    fraîcheur par défaut 30 s ; données vivantes à fraîcheur nulle (partie, parties actives,
    solde, sessions/tables, contexte de tournoi) relues à chaque retour ; une requête par
    donnée et par retour (dédoublonnage TanStack, `cancelRefetch: false` sur l'écran de
    partie).
  - `last-route.ts` : décision de réouverture reprise à chaque nouvelle racine
    (`beginNavigationRoot`) ; rouvrables en plus : `/tournament/results/:id` et le NOM du
    panneau ouvert de la coquille (`profile`, `settings`, `private`, `shop`) sur `/` et
    `/tournament`, jamais une saisie ni une donnée de jeu (30 min max, inchangé).
  - Android : `plugins/withAndroidSensorLandscape.js` ajoute
    `density|fontScale|locale|layoutDirection` à `android:configChanges` (nouveau build natif
    requis, CNG ; aucune modification manuelle de `android/`). Complément du 2026-10-16
    (interruption par un appel téléphonique) : `mcc|mnc` (SIM, réseau mobile, double SIM) et
    `navigation|touchscreen` (matériel de saisie) ; test `src/test/android-config-changes.test.ts`.
  - Relancement après destruction du processus : rideau `LaunchCurtain` jusqu'à la réouverture
    du dernier écran (8 s au plus) ; l'ancienneté de 30 min se compte depuis le passage en
    arrière-plan (écran réenregistré à ce moment).
- **Validation sur téléphone** : uniquement avec un APK (profil EAS `preview`, D-093). Expo Go
  connecté à Metro ne la permet pas : le manifeste d'Expo Go ignore ce plugin, Expo Go recharge
  le bundle depuis Metro quand Android détruit son processus, et une modification de fichier
  pendant l'absence (Fast Refresh) peut provoquer un rechargement complet au retour.
- **Inchangé** : règles du jeu, minuteurs de tour (20 s) et échéances de tournoi ; le serveur
  reste l'autorité (états relus, jamais reconstruits) ; commandes idempotentes (pas de double
  carte ni de double règlement) ; une session expirée suit le parcours normal (refus définitif
  → déconnexion, connexion, puis reprise) ; aucune vérification de sécurité désactivée.
- **Limite** : un processus détruit ne peut pas être « conservé » : la session (jeton dans le
  stockage sécurisé), la partie active (serveur), le dernier écran et son panneau sont
  restaurés ; les saisies non envoyées et la position de défilement ne le sont pas.
- **Tests** : `src/lib/app-lifecycle.test.ts`, `src/lib/app-focus.test.tsx`,
  `src/features/lobby/LobbyShell.test.tsx`, `src/features/navigation/last-route.test.ts`,
  `src/features/auth/session.test.ts`.

## D-111 — Tournois : parties réglées comme les parties ordinaires, sur un compte fictif ; dissolution des comptes

- **Date** : 2026-10-15 · **Statut** : demandé par le propriétaire du projet · **Révise** : la
  formule de règlement des jetons de D-054 (« tapis ») pour les tournois démarrés après la
  migration 0044 · **Ne modifie pas** : moteur de jeu, résultats, messages, minuteurs, seuil de
  participation (D-063), classement (D-106, D-107), cagnotte et gains (D-054, D-112).
- **Audit (avant)** : même moteur, même fin de partie et mêmes événements pour les deux modes ;
  différences : (1) règlement de tournoi propre (`settleGameTokens` : mise plafonnée aux jetons
  du gagnant, fuyard compris, pas de Kora) ; (2) écran de fin sans montant pour une partie de
  tournoi (`mySettlement` lu seulement dans le compte de jeu réel).
- **Deux comptes, jamais mélangés** :
  - partie ORDINAIRE : compte de jeu réel (`wallets`), engagement 2M au démarrage, règlement
    D-074/D-080/D-086 avec commission (`game_settlements`, `wallet_transactions`,
    `platform_ledger`) ; ne lit ni n'écrit jamais `tournament_player_accounts` ;
  - partie de TOURNOI : compte FICTIF `tournament_player_accounts` (clé tournoi + joueur, créé
    au démarrage du tournoi avec les jetons initiaux, D-054), indépendant du portefeuille et des
    autres tournois ; aucun engagement, aucune transaction, aucune commission sur le compte
    réel (`game-stake-ledger` ignore toute partie qui porte un `tournamentId` et toute table de
    `tournament_sessions`).
  - Le contexte est décidé par le SERVEUR : `games.tournament_id` écrit à la création et
    immuable (D-106, garde-fous en base), jamais par le client.
- **Règle `D111_ORDINARY_RULES`** (`planTournamentGame`, réutilise `victoryTypeOf`,
  `settledParticipants`, `planGameSettlement`) : mêmes participants réglés qu'une partie
  ordinaire (fuyards exclus, sauf adversaire couché à 2 qui paie, D-086 ; le coût de la fuite à 3
  ou 4 reste À CLARIFIER, R-05 : rien n'est inventé, comme pour les parties ordinaires) ; perte
  de chaque perdant M, ou 2M en Kora (D-080) ; commission 0 (la plateforme est rémunérée sur le
  prix d'entrée, D-054) ; le gagnant reçoit le total. Garde-fou : un perdant ne paie jamais plus
  que ses jetons (le seuil de 2 × la mise, D-063, couvre déjà la Kora). Parties jouées +1 et
  gagnées +1 pour les seuls comptes réglés (donc le total global de D-107 suit la même règle).
- **Règle figée au démarrage** : `tournaments.settlement_rule` écrit à `IN_PROGRESS`, immuable
  (trigger `tournaments_frozen_rules_guard`) ; les tournois déjà démarrés gardent `D054_TAPIS`
  (`settleGameTokens` inchangé) : aucune règle ne change en cours de tournoi.
- **Vérifications et anomalies** : sous verrou du tournoi et des comptes : tournoi réglable
  (`IN_PROGRESS` ou `CALCULATING_RESULTS`), partie démarrée avant la fin, gagnant parmi les
  participants réglés, un compte de CE tournoi pour chaque participant réglé. Sinon :
  règlement `VOID` (motif `WINNER_NOT_PARTICIPANT`, `PARTICIPANT_WITHOUT_ACCOUNT`,
  `INVALID_SETTLEMENT`, journalisé `TOURNAMENT_GAME_SETTLEMENT_REFUSED`), aucun mouvement.
  Partie rattachée à un tournoi introuvable : aucun règlement (ni fictif, ni réel : le compte
  réel ignore toute partie de tournoi), anomalie journalisée
  `TOURNAMENT_GAME_SETTLEMENT_REFUSED` motif `TOURNAMENT_NOT_FOUND` (complément du 2026-10-15).
- **Idempotence** : une ligne `tournament_games` par partie (clé `game_id`), insérée dans la
  même transaction que les comptes (tout ou rien) ; deuxième règlement (reprise, concurrence)
  = aucun mouvement. Le règlement est IMMUABLE (trigger `tournament_games_immutable_guard` :
  ni modification ni suppression) et porte `settlement_rule` et `victory_type`.
- **Expérience de fin de partie** : mêmes titre, message, pile de jetons et montant signé ;
  `mySettlement = { delta, account }` (`WALLET` ou `TOURNAMENT`, lu côté serveur) ; pour un
  tournoi, la mention « Jetons du tournoi — solde fictif, votre solde réel est inchangé » est
  ajoutée sous le montant, et le contexte du tournoi (jetons, rang) est relu.
- **Bilan affiché au même moment** (complément du 2026-10-15) : le règlement ordinaire est
  écrit avec la fin de partie, celui d'un tournoi juste après (écouteur de fin de partie). Après
  son COMMIT, le serveur envoie aux seuls joueurs réglés le signal personnel
  `TOURNAMENT_GAME_SETTLED` (salle `user:{id}`, aucune notification enregistrée, une seule fois :
  un règlement rejoué n'écrit rien et ne signale rien) ; la table relit aussitôt la partie
  (`useTournamentSettlementUpdates`) et le contexte du tournoi (`useTournamentSignals`). Signal
  sans garantie : la relecture périodique de la partie (3 s) reste le filet de sécurité.
- **Solde de tournoi identifié** : sur la table d'un tournoi, la pastille du solde porte
  l'étiquette visible « Tournoi » et l'accessibilité annonce « jetons de tournoi restants
  (solde fictif) » : jamais confondue avec le compte de jeu réel.
- **Dissolution** : dans la transaction qui passe le tournoi à `COMPLETED` (classement publié,
  gains versés), `dissolveAccounts` : comptes clos (`finished_at`) → `DISSOLVED` +
  `dissolved_at`, idempotent, définitif (trigger), aucune suppression (soldes finaux, parties,
  rang, gain et règlements conservés pour l'audit et les contestations), aucun crédit, débit ou
  remboursement du compte réel. Plus aucune partie ne démarre dans un tournoi terminé (D-106).
- **Migration** : `0044_tournament_ordinary_settlement.sql` (ajouts seulement).
- **Tests** : backend `tests/unit/tournaments/tournament-game-plan.test.ts`,
  `tests/integration/tournaments/tournament-ordinary-settlement.test.ts` (référence ordinaire :
  `tests/integration/games/game-settlement.test.ts`, assertions `account: 'WALLET'` ajoutées),
  `tests/integration/tournaments/tournament-closure-results.test.ts` (décompte des signaux) ;
  mobile `src/features/games/table/game-over-panel.test.tsx`,
  `src/features/games/game-updates.test.tsx`, `src/features/tournaments/TournamentResults.test.tsx`.

## D-112 — Tournois : récompenses réelles, plan de versement validé, crédit unique et reprise

- **Date** : 2026-10-15 · **Statut** : demandé par le propriétaire du projet (exécution
  autonome, choix techniques délégués) · **Complète** : D-054 (cagnotte, gains), D-062 / D-106
  (classement), D-107 (registre), D-111 (règlement fictif, dissolution) · **Ne modifie pas** :
  inscription, réservation, capture, taux de commission (figé à la publication), formule de
  classement, départage, répartition des gains (`computePrizes` : parts à l'entier inférieur,
  reste au 1er rang), règlement des parties.
- **Deux soldes indépendants** (rappel vérifié dans le code) : le compte de jeu RÉEL
  (`wallets`, `wallet_transactions`) ne bouge qu'à la capture du prix d'entrée
  (`tournament_entry`) et au versement d'une récompense (`tournament_prize`) ; les jetons du
  tournoi (`tournament_player_accounts`, un compte par joueur et par tournoi) ne servent qu'au
  classement, ne sont jamais convertis, et sont dissous après la finalisation (D-111) sans
  aucun mouvement réel.
- **Cagnotte** : brute = fonds réellement capturés (prix × participants), commission =
  `floor(brute × taux figé)`, distribuable = brute − commission (D-054, inchangé).
- **Plan de versement** (`tournament_payouts`, migration 0045) : écrit dans la transaction du
  classement officiel, une ligne par rang récompensé : bénéficiaire, montant entier (FCFA),
  référence UNIQUE `tournament-prize:<tournoi>:<rang>` (celle de D-054 : un gain versé avant
  D-112 n'est jamais reversé), statut `PENDING` → `CREDITED` (définitif) ou `FAILED` (motif,
  tentatives, date). Bénéficiaire, montant et référence sont immuables ; aucune suppression
  (trigger). Un bénéficiaire par tournoi (UNIQUE). Ex æquo : le classement est un ordre total
  (départage jusqu'à l'identifiant), un rang n'a donc jamais deux bénéficiaires ni de partage.
- **Validation avant tout crédit** (`RESULTS_VALIDATED` → `DISTRIBUTING_PRIZES`) : (1) les
  contrôles du compte financier de la plateforme, ceux de la réconciliation de l'administration
  (`tournamentAnomalies`, faits lus par `queryTournamentLedgerFacts` pour CE tournoi) :
  commission écrite et conforme, cagnotte brute = entrées réellement capturées, brute =
  commission + distribuable, gains + non attribué = distribuable ; (2) le plan
  (`payoutPlanAnomalies`) : classement contigu, gains = répartition officielle recalculée, plan
  = gains du classement (montant, bénéficiaire, aucune ligne en trop ou manquante, aucun
  doublon), total ≤ distribuable et total + non attribué = distribuable. Une anomalie BLOQUE
  tout versement : motifs enregistrés (`tournaments.payout_blocked_at`,
  `payout_block_reasons`), alerte `TOURNAMENT_PAYOUTS_BLOCKED`, affichage dans
  l'administration. Les contrôles sont rejoués à chaque tick ; le blocage se lève seul quand
  les données sont cohérentes (`payout_plan_validated_at`). Aucune procédure de correction
  manuelle n'est créée.
- **Crédit** (une récompense par transaction) : `creditTournamentPrize` (compte verrouillé,
  écriture interne `tournament_prize`, jamais CinetPay), versement `CREDITED` avec la
  référence de la transaction, résultat marqué versé et notification
  `TOURNAMENT_PRIZE_CREDITED` — dans la même transaction : la notification n'existe que si le
  crédit est validé ; le signal temps réel suit le COMMIT, sans garantie. Garanties en base :
  `UNIQUE (user_id, idempotency_key)` sur `wallet_transactions`, référence UNIQUE du plan,
  `wallet_transaction_id` UNIQUE, trigger `tournament_payouts_credit_guard` (la transaction
  référencée est bien un `tournament_prize` réussi du même joueur, du même montant, de la même
  référence), statut `CREDITED` définitif. Deux instances, deux ticks ou une reprise après
  panne ne créditent jamais deux fois : verrou de la ligne du tournoi, puis de la ligne du plan,
  et la clé déjà utilisée renvoie la transaction existante.
- **Échec et reprise** : une erreur annule la transaction du crédit (rien n'est écrit), puis
  le versement passe `FAILED` (motif, tentatives) dans une transaction séparée, alerte
  `TOURNAMENT_PRIZE_PAYOUT_FAILED` ; les autres bénéficiaires sont payés ; le versement en échec
  est retenté automatiquement après 60 s (`PAYOUT_RETRY_DELAY_MS`), indéfiniment, sans action
  manuelle. Tout est relu dans PostgreSQL : un redémarrage reprend exactement là.
- **Finalisation financière** : `COMPLETED` seulement quand TOUT le plan est `CREDITED`,
  garanti par le service et par le trigger `tournaments_completion_guard` ; dans la même
  transaction, comptes fictifs dissous (D-111) et résultats annoncés. État dérivé
  (`tournamentFinancialState`) : `PLAN_PENDING_VALIDATION`, `BLOCKED`, `PAYING`,
  `PAYMENT_FAILED`, `FINALIZED`…
- **API** : `GET /api/admin/tournaments/:id/payouts` (rôle admin, lecture seule) : fonds
  capturés, commission, distribuable, répartition, plan (bénéficiaire, montant, statut,
  référence, transaction, tentatives, dernier échec), blocage, crédité / dû, état. Joueur :
  `GET /api/tournaments/:id/results` → `me.payout` (`amount`, `CREDITED` ou `PENDING` — un
  échec en cours de reprise est présenté « en cours », jamais « crédité »).
- **Interfaces** : administration web, carte « Récompenses réelles » du détail d'un tournoi ;
  application mobile, « Votre résultat » distingue la récompense réelle (« créditée sur votre
  compte de jeu » ou « versement en cours ») des jetons de tournoi (« sans valeur monétaire »).
- **Validation finale (2026-10-16)** — compléments :
  - **Jetons → FCFA impossible en base** (migration 0045) : une partie de tournoi (rattachée,
    ou à une table de tournoi, `is_tournament_game`) ne peut recevoir ni séquestre
    (`game_settlements`), ni réservation, ni mise ou gain (`wallet_transactions.game_id`) :
    trigger `tournament_game_real_money_guard`. Un `tournament_prize` n'existe que s'il est la
    preuve de crédit d'une ligne CREDITED du plan (même joueur, montant, référence), vérifié en
    fin de transaction (trigger de contrainte différé `wallet_transactions_tournament_prize_guard`).
    Seule conversion possible : classement officiel → plan validé → crédit d'une ligne du plan.
    La dissolution des comptes fictifs (D-111) n'écrit rien dans le compte de jeu.
  - **Contrôles rejoués avant CHAQUE crédit et avant la clôture**, pas seulement à la
    validation : une incohérence apparue pendant la distribution bloque les versements
    restants et la finalisation (état `BLOCKED`), puis se lève d'elle-même.
  - **Atomicité vérifiée** : une panne entre le crédit du compte de jeu et le passage CREDITED
    annule les deux (même transaction) ; « compte crédité + versement non crédité » et
    « versement crédité + compte non crédité » sont impossibles (le second est aussi refusé par
    `tournament_payouts_credit_guard`).
  - **Audit des échecs** : tentatives et dernier motif d'échec conservés après un crédit réussi.
  - **Reprise** : une tentative par versement en échec toutes les 60 s au plus, une seule à la
    fois (verrous de la ligne du tournoi et du plan) ; une erreur permanente laisse l'état
    « Versement en échec » persistant, visible, journalisé, sans clôture possible. Aucune
    correction administrative (montant, bénéficiaire, abandon) n'existe ni n'est créée.
  - **Limite connue** : un tournoi DÉJÀ en `DISTRIBUTING_PRIZES` au moment de la migration reçoit
    un plan « validé » sans rejouer la validation initiale ; les contrôles s'appliquent quand
    même avant chacun de ses crédits restants et avant sa clôture.
- **Migration 0045** (`0045_tournament_payouts.sql`) : table, triggers, colonnes de validation ;
  plans créés pour les classements déjà publiés avec l'état RÉEL de chaque gain (versé →
  `CREDITED` avec sa transaction ; sinon `PENDING`), aucune écriture du compte de jeu.
- **Tests** : backend `tests/unit/tournaments/tournament-payouts.test.ts`,
  `tests/integration/tournaments/tournament-payouts.test.ts`,
  `tests/integration/database/tournament-payouts-migration.test.ts` ; administration
  `tests/tournament-payouts.test.tsx` ; mobile `TournamentResults.test.tsx`.

## D-113 — Préinscriptions : limite des 5 tournois, chevauchement à la soumission, jetons figés

- **Date** : 2026-10-15 · **Statut** : décidé par le propriétaire du projet (choix techniques
  délégués) · **Complète** : D-108 (tranche trois de ses « points laissés à décider ») ·
  **Modifie** : D-072 (comptage de la limite), D-071 (jetons de départ et mise d'une
  proposition préinscrite) · **Ne modifie pas** : D-108 (préinscriptions, approbation sans
  délai d'1 h, refus, retrait, expiration), D-109, statuts et transitions, modèle financier
  (réservation, capture au démarrage, libération), commission et poids figés à la
  publication, prix d'entrée réservé, `TOURNAMENT_LOCKED` dès la première préinscription.
- **Limite des 5 tournois** (`TOURNAMENT_LIMITS.maxWaitingTournaments`) : compte désormais,
  en plus des tournois publiés aux inscriptions ouvertes ou à ouvrir (`SCHEDULED`,
  `REGISTRATION_OPEN`, D-072 inchangé), les propositions `PENDING_APPROVAL` dont la fenêtre
  de préinscription n'est pas close (`registration_closes_at`, sinon début, encore à venir).
  Comme un tournoi `SCHEDULED`, une proposition dont l'ouverture choisie est à venir compte
  déjà (elle s'ouvrira sans nouveau contrôle). Jamais comptés : brouillons, annulés (refus,
  retrait, annulation, expiration), inscriptions closes. Règle unique du domaine
  `countsTowardRegistrationLimit`, reproduite en SQL par `countWaitingTournaments`.
  Contrôlée sous le verrou de planification (`pg_advisory_xact_lock`) à la création admin, à
  la SOUMISSION (qui prend désormais ce verrou, avant la ligne du tournoi, même ordre que
  l'approbation : pas d'interblocage) et à l'approbation, où la proposition déjà comptée
  est exclue (`excludeId`) ; à la modification d'une proposition si elle rouvre une fenêtre
  close. Soumissions simultanées : sérialisées, une seule passe pour la dernière place. La
  création d'un brouillon garde un contrôle d'information non bloquant. Propositions déjà
  en attente au déploiement : rien n'est annulé ; si elles dépassent la limite, elles
  bloquent seulement les nouvelles ouvertures, et l'approbation de chacune reste soumise à
  la limite.
- **Chevauchement** : contrôlé dès la SOUMISSION (et à la modification des dates d'une
  proposition en attente) contre les tournois PUBLIÉS non terminés (`BLOCKING_STATUSES`),
  avec la définition de la contrainte `tournaments_no_overlap` : créneaux [début,
  `blocked_until`[ persistés des tournois publiés ; pour la proposition, le créneau que la
  publication lui fixera (fin + période de transition en vigueur). Deux créneaux qui se
  suivent ne se chevauchent pas. Refus : `409 TOURNAMENT_OVERLAP` (« Un autre tournoi est
  déjà programmé sur ce créneau. »), la proposition reste un brouillon privé, rien n'est
  inscrit ni réservé. Contrôle préalable seulement : l'approbation garde la contrainte
  PostgreSQL (un tournoi publié APRÈS la soumission fait toujours échouer l'approbation,
  préinscriptions intactes, D-108). Deux PROPOSITIONS sur un même créneau restent
  possibles (aucune n'occupe de créneau avant la publication) : l'approbation tranche.
- **Jetons de départ et mise figés à la première préinscription** : jusqu'ici ils suivaient
  les coefficients jusqu'à l'approbation (D-071). Désormais, dans la transaction de la
  PREMIÈRE préinscription (verrou de la ligne du tournoi), les valeurs affichées à cet
  instant (prix d'entrée × coefficients en vigueur) sont écrites avec la marque
  `token_setup_frozen_at` ; lecture (joueurs, administration) et approbation les reprennent
  telles quelles (`frozenTokens`, bornes toujours vérifiées). Les préinscriptions suivantes
  et les désinscriptions ne refigent rien. Seule exception : un nouveau prix d'entrée, permis
  uniquement sans aucun inscrit actif, retire la marque (nouvelle offre, valeurs de nouveau
  calculées). Avant toute préinscription : D-071 inchangé. Commission et poids : toujours
  figés à la publication. Administration : « Figé à la première préinscription. » (sans
  coefficient) au lieu de « Figé à la publication. ».
- **Notifications** : aucune notification générale à la soumission (bruit) ; la proposition
  apparaît dans la liste à la prochaine lecture de l'API (D-108 inchangé). **GET /next** :
  inchangé, prochain tournoi OFFICIEL (publié, `WAITING_STATUSES`) auquel le joueur est
  inscrit ; une proposition préinscrite n'y figure qu'après son approbation.
- **Données** : migration `0046_tournament_token_setup_freeze.sql` (colonne nullable
  `tournaments.token_setup_frozen_at`, ajout seul, aucune ligne réécrite). Pas de
  rattrapage : D-108 n'a jamais été déployée, aucune préinscription n'existe en production.
  Non appliquée à la base réelle.
- **Tests** : backend `tests/integration/tournaments/tournament-pre-registration-rules.test.ts`
  (24 cas : limite, chevauchement, figement, `/next`, notifications, concurrence sur PGlite),
  `tests/integration/database/tournament-token-freeze-migration.test.ts`,
  `postgres-tournament-pre-registration.test.ts` (+2 cas de concurrence, PostgreSQL réel,
  exécutés seulement avec `TEST_DATABASE_URL`) ; `tournament-pre-registration.test.ts` : le
  cas « chevauchement refusé à l'approbation » publie désormais le tournoi concurrent APRÈS
  la soumission ; administration `tests/token-setup.test.tsx`.

## D-114 — Réclamations des joueurs et assistant automatisé local (Ollama), sans pouvoir sur l'argent

- **Date** : 2026-10-16 · **Statut** : demandé par le propriétaire du projet (exécution
  autonome, choix techniques délégués) · **Détails** : [complaints.md](complaints.md) ·
  **S'appuie sur** : D-029 (identité du JWT), D-054 (notifications), D-061 (session et audit
  d'administration), D-079 (modèle d'actions administratives auditées).
- **Réclamations** (migration 0047, ajouts seuls) : dossier persistant à référence lisible
  `RCL-AAAAMMJJ-XXXXXX`, dix catégories (partie/résultat, solde, recharge, retrait, tournoi,
  récompense de tournoi, technique, fraude, compte/sécurité, autre), priorité calculée par le
  serveur, liens vers partie, tournoi, transaction, paiement, retrait par clé étrangère
  (vérifiés comme appartenant au joueur ; aucun montant recopié), échanges, notes internes,
  pièces justificatives (stockées dans PostgreSQL, type vérifié sur la signature, 3 Mo, 5 par
  dossier), vérifications tracées, historique en ajout seul. Isolation : un dossier d'un autre
  joueur répond 404.
- **Workflow** : `OPEN → AI_ANALYSIS → IN_REVIEW ⇄ WAITING_FOR_PLAYER → RESOLVED | REJECTED →
  CLOSED`, transitions autorisées PAR ACTEUR (table `COMPLAINT_TRANSITIONS`). Une décision
  (`RESOLVED`/`REJECTED`) est toujours humaine et motivée ; le système ne résout, ne rejette ni
  ne clôture jamais, même un dossier non financier. Le joueur répond, retire son dossier, accepte
  ou conteste une décision (≤ 2 fois, ≤ 30 jours). `expectedStatus` contre les traitements
  concurrents. Chaque action administrative est auditée dans la transaction du changement.
- **Assistant** : modèle open-weight exécuté par **Ollama sur nos machines** (aucune API externe,
  aucune clé), joint uniquement par le backend (`OLLAMA_BASE_URL` interne, jamais renvoyée ni
  journalisée). Le modèle classe, extrait et rédige ; ses sorties sont des données non fiables :
  schéma JSON imposé puis validation stricte, identifiants inventés refusés, outils en liste
  blanche et en LECTURE SEULE exécutés avec l'identité du jeton, réponse refusée si elle cite un
  montant/identifiant absent des faits, prétend avoir agi, promet un délai ou se dit humaine.
  Les faits vérifiés sont affichés séparément du texte généré. La création d'une réclamation
  depuis la conversation est confirmée par le joueur (catégorie modifiable).
- **Limites financières** : aucun chemin ne permet à l'IA (ni au traitement d'une réclamation)
  de créditer, débiter, créer ou supprimer une transaction, modifier un résultat, un classement
  ou une récompense, suspendre un compte ou rembourser. Une correction passe par le service
  métier existant (paiements, retraits, tournois), avec ses propres garanties ; la décision du
  dossier la consigne.
- **Coûts et disponibilité** : concurrence 1 et file bornée (au-delà : « occupé »), disjoncteur
  (3 échecs → 60 s sans appel), délai maximal, contexte et réponses bornés, ≤ 8 messages
  transmis, quotas par joueur, conversation bornée. **Mode dégradé** sans fournisseur ou en
  panne : classement par mots-clés, mêmes outils, réponses fixes FR/EN ; dépôt et suivi
  inchangés. Modèle par défaut `qwen2.5:1.5b` choisi pour la machine auditée (7,7 Go de RAM,
  CPU seul) ; `qwen2.5:3b` recommandé sur un serveur ≥ 16 Go.
- **Notifications** : `COMPLAINT_UPDATE` (référence et nature de l'événement, jamais de
  montant), dédupliquée par événement ; bandeau d'accueil mobile.
- **Non tranché ici** : durées légales de conservation des dossiers et conversations (T-09) —
  rien n'est supprimé automatiquement en attendant.
- **Tests** : backend `tests/unit/complaints/*` (domaine, garde, fournisseur simulé,
  configuration), `tests/integration/complaints/*` (PGlite : dépôt sans IA, isolation, workflow
  audité, notifications idempotentes, pièces, reprise après redémarrage, faux modèle : données
  inventées refusées, injection, panne, rejeu) ; mobile `src/features/complaints/complaints.test.tsx` ;
  administration `tests/complaints.test.tsx`.

## D-115 — Réclamations : finalisation (bail d'analyse, garde renforcée, raccourcis, rétention T-09 en attente)

- **Date** : 2026-10-16 · **Statut** : demandé par le propriétaire du projet · **Complète** :
  D-114 · **Détails** : [complaints.md](complaints.md).
- **Séparation des rôles** : `modèle → proposition` (classement, extraction, texte) ;
  `serveur → validation` (schéma, identifiants cités par le joueur seulement, outils en lecture
  seule exécutés avec l'identité du jeton, garde de la réponse) ; `humain → décision` (statut
  `RESOLVED`/`REJECTED`, motivée, auditée). Jamais `modèle → décision`.
- **Garde renforcée** (`guardReply`) : en plus de D-114, refus d'une réponse qui prétend
  connaître une décision humaine, affirme un remboursement ou une correction, affirme un crédit
  sans constat de crédit réel (`PAYMENT_CREDITED`, `GAME_WON_CREDITED`, `TOURNAMENT_PRIZE_PAID`,
  `WITHDRAWAL_SUCCEEDED`), contredit un constat du serveur (paiement en attente dit
  « confirmé », partie perdue dite « gagnée »…) ou annonce une date. Refusée : réponse
  déterministe fondée sur les constats. Le résumé destiné au support peut rapporter les
  DÉCLARATIONS du joueur (mode `declarations`), jamais une action, un délai ni une identité.
- **Minimisation** : un outil demandé par le modèle n'est exécuté que s'il sert la catégorie
  (`RELEVANT_TOOLS` : ex. jamais le solde pour une question de recharge ou de tournoi).
- **Analyse sûre en multi-instance** : bail `complaints.analysis_claimed_at` (UPDATE
  conditionnel atomique, 5 min, supérieur au délai maximal d'un appel) ; le balayage (démarrage
  et chaque minute, sur toutes les instances) ne reprend qu'un bail libre ou expiré. Vérifié sur
  PostgreSQL réel : trois instances concurrentes → un seul appel au modèle.
- **Mode dégradé** : sans fournisseur, fournisseur arrêté, délai dépassé, sortie mal formée ou
  invalide : réponse fixe indiquant que l'assistance automatique n'est pas disponible (sans
  détail technique), analyse `UNAVAILABLE`, dossier en examen humain ; jamais d'`AI_ANALYSIS`
  bloqué (bail expiré → reprise).
- **Fournisseur interchangeable** : seul `services/ai/create-language-model.ts` connaît Ollama ;
  le domaine et les services des réclamations ne reçoivent qu'un `LanguageModel`.
- **Corrections financières** : aucune voie propre aux réclamations ni à l'IA. L'administration
  corrige dans le module existant (paiements, retraits, tournois, joueur), liens fournis depuis le
  dossier, puis référence la correction dans la décision motivée.
- **Raccourcis** « Signaler un problème » : fin de partie (`gameId`), fiche et classement officiel
  d'un tournoi (`tournamentId`). Le mobile ne transmet que le contexte affiché ; le serveur
  vérifie l'accès (422 sinon) et le joueur peut retirer l'élément lié.
- **Rétention (T-09, NON TRANCHÉE)** : aucune suppression automatique n'est activée. Données
  concernées, conservées en attendant la règle : réclamations, messages (y compris notes
  internes), pièces justificatives, vérifications (faits constatés), historique
  (`complaint_events`, ajout seul), journal d'audit (`admin_audit_log`, ajout seul),
  notifications `COMPLAINT_UPDATE`, conversations et messages de l'assistant (dont l'analyse
  automatisée et ses métadonnées), résumé automatisé du dossier. Une future politique devra
  distinguer données personnelles et traces d'audit, et passer par une migration et un service
  dédiés (jamais par une purge ad hoc).
- **Pièces dans PostgreSQL** (choix maintenu) : ≤ 3 Mo × 5 par dossier, `bytea` stocké hors ligne
  par PostgreSQL (TOAST), lu seulement à la demande (jamais dans les listes), transactions et
  sauvegardes communes avec le dossier, accès contrôlé par le serveur. Évolution possible, non
  réalisée : stockage objet privé (URL signées courtes) si le volume le justifie.

## D-116 — Administration : mise à jour automatique des points d'attention (SSE + lecture passive)

- **Date** : 2026-10-16 · **Statut** : demandé par le propriétaire du projet · **Complète** :
  D-061 (session d'administration), D-106 (signaux temps réel sans contenu).
- **Constat** : la cloche de l'administration n'est pas alimentée par une table de
  notifications (la table `notifications` ne vise que les joueurs) ; elle affiche les **points
  d'attention** calculés par le serveur (alertes anti-collusion `NEW`, propositions de tournoi
  `PENDING_APPROVAL`, paiements en attente anciens, anomalies de rapprochement, échéances de
  tour dépassées). Aucun état lu/non lu n'existe : le compteur est le nombre d'éléments encore à
  traiter. Aucune table de notifications d'administration n'est créée (hors périmètre).
- **Lecture passive** : un `GET` portant `X-Admin-Passive: 1` est contrôlé par
  `requireAdminSession` (8 h, 30 min) **sans enregistrer d'activité**. L'en-tête ne peut que
  raccourcir la session de celui qui l'envoie. Toute modification reste une activité. La règle
  « aucune requête de fond ne maintient la session » est conservée.
- **Compteurs seuls** : `GET /api/admin/attention` → `{ generatedAt, alerts,
  reconciliationAnomalies }`, mêmes calculs que le tableau de bord, sans le reste.
- **Temps réel** : `GET /api/admin/events`, flux **Server-Sent Events** derrière la garde
  commune (le navigateur n'a pas de JWT : la passerelle WebSocket `/ws` n'est pas joignable par
  la console, dont les jetons restent en cookies httpOnly côté Next.js). Événements `ready`,
  `attention { source }`, `end { code }` ; aucune donnée métier, le client relit
  `/attention`. Bus `AdminEventBus` sur le transport Redis Pub/Sub existant (canal
  `le-ter:admin:events`, repli local, D-024) ; publié APRÈS commit, sans jamais faire échouer
  l'opération : nouvelle alerte de détection (`DETECTION_ALERT`), soumission / approbation /
  refus / annulation d'une proposition (`TOURNAMENT_APPROVAL`). Jeton et session revérifiés
  chaque minute en lecture passive ; échec → `end` et fermeture ; flux fermés à l'arrêt.
- **Relais Next.js** : route dédiée `app/api/admin/events` (flux non mis en mémoire). Elle ne
  renouvelle **jamais** l'access token (un refresh token ne sert qu'une fois : deux
  renouvellements simultanés fermeraient la session) ; le client relit d'abord ses compteurs par
  le relais ordinaire (qui renouvelle ou renvoie à la connexion), puis rouvre le flux.
- **Compteurs liés au temps** (paiement « ancien » après 30 min, échéance dépassée,
  rapprochement) : aucun événement ne les signale ; relecture passive chaque minute (onglet
  visible) et au retour sur l'onglet. Délai : immédiat pour les sources signalées, ≤ 1 min pour
  les autres.
- **Garanties** : les compteurs viennent toujours de PostgreSQL (jamais du signal) ; un signal
  perdu est rattrapé à la reconnexion (`ready`) et par la relecture périodique ; rien ne peut
  être compté deux fois ni disparaître hors traitement réel.

## D-117 — Tournois : colonne « Gain » du classement et remerciement 10 s après la fin

**Contexte.** Le classement officiel n'affichait pas le gain de chaque participant ; aucun
message ne remerciait les joueurs à la fin d'un tournoi.

**Décision.**

- **Colonne « Gain »** : dernière colonne du classement officiel (`TournamentResultsScreens`),
  après les colonnes existantes, inchangées. Source : `prizeAmount` de chaque ligne de
  `GET /api/tournaments/:id/results`, c'est-à-dire le montant RÉEL figé dans
  `tournament_results` avec le classement (D-106, D-112), jamais recalculé par le mobile. Sans
  gain : `0 FCFA` (`formatFcfa`). Gain attribué mais pas encore crédité (`paid = false`) :
  suffixe ⏳ et « versement en cours » pour les lecteurs d'écran ; jamais présenté comme versé.
  Largeur fixe et `adjustsFontSizeToFit`, comme les autres colonnes numériques. Aucun calcul de
  classement, de commission ni de versement n'est modifié.
- **Instant de référence** : la fin EFFECTIVE du tournoi est la publication du classement
  officiel (`resultsAt`, horloge du serveur) : toutes les parties commencées sont terminées et
  réglées, et les résultats sont consultables. `endsAt` (fin prévue) ne convient pas : à cet
  instant les résultats peuvent ne pas exister (clôture qui attend les parties, D-106).
- **Remerciement** : nouvelle notification `TOURNAMENT_THANK_YOU` (migration 0048), écrite dans
  la MÊME transaction que le classement (une par participant classé, clé `thanks:<tournamentId>`,
  unicité `(user_id, dedupe_key)`), avec `notifications.available_at = resultsAt + 10 s`
  (`TOURNAMENT_THANKS_DELAY_MS`). L'API ne renvoie une notification qu'à partir de son
  `available_at` (horloge du serveur), datée de cet instant, et refuse de la marquer lue avant.
  Les autres notifications (`available_at` NULL) sont inchangées.
- **Livraison** : signal temps réel `TOURNAMENT_THANK_YOU` émis 10 s après le COMMIT (minuteur
  sans garantie, annulé à l'arrêt) ; la source reste PostgreSQL : le message apparaît aussi au
  retour sur l'écran, au retour au premier plan, après un redémarrage ou une reconnexion.
  Mobile : `TournamentThanksNotice` (accueil, liste et fiche des tournois), « Voir les résultats
  du tournoi » → route existante `/tournament/results/<tournamentId>` ; « Voir » et « Fermer »
  la marquent lue (statut lu/non lu existant) : elle ne revient plus. Le message n'est pas
  monté sur les écrans de résultats (le joueur y est déjà).
- **Tournois déjà publiés avant la migration** : aucun remerciement rétroactif.

**Limite connue.** Sans connexion temps réel (le mobile n'en ouvre une que pendant une partie
ou un chat), un joueur resté immobile sur l'accueil voit le message à la prochaine relecture
(retour sur l'écran ou au premier plan), pas exactement à 10 s.

## D-118 — Victoire instantanée : réintroduction de « Composition de 7 » (7 + 7 + 4 + 3)

- **Date** : 2026-10-18 · **Statut** : validée par le propriétaire du projet · **Modifie** :
  D-035 sur ce seul point (R-04, jusqu'ici ÉCARTÉ) ; les autres décisions de D-035 restent
  inchangées.
- **Règle** : « Composition de 7 » (`COMPOSITION_OF_SEVEN`) est une main spéciale gagnante :
  parmi les 5 cartes initialement distribuées, au moins deux cartes de valeur 7, une de
  valeur 4 et une de valeur 3. Les familles sont indifférentes ; la 5ᵉ carte est libre
  (ex. 3♠ 4♥ 8♥ 7♣ 7★). Ce n'est pas un Full : le Full du Ter reste « Trois + deux »
  (rang 5, inchangé).
- **Rang** : 6, juste avant « Trois 3 », qui passe au rang 7. Les rangs 1 à 5 ne changent
  pas. Une main qui satisfait plusieurs combinaisons garde la meilleure (ex. trois 7 + 4 + 3
  → « Trois 7 », rang 1). Mêmes mécanismes que les autres mains (D-035) : détection par le
  serveur, déclaration facultative si une seule main gagnante, victoire automatique au
  meilleur rang unique, égalité de rang → reprise immédiate ; toujours une victoire SIMPLE,
  règlement inchangé.
- **Affichage** : panneau de fin existant (`GameOverPanel`) : « Main spéciale », « Vous avez
  gagné ! », « Main spéciale : », « Composition de 7 » pour le gagnant ; la ligne habituelle
  « Victoire par main spéciale : Composition de 7 » pour les autres joueurs. Le mobile
  n'évalue jamais les cartes : il affiche la combinaison retenue par le serveur.
- **Parties déjà terminées** : leur résultat garde sa combinaison enregistrée ; seul le
  numéro de rang de « Trois 3 » diffère (6 avant, 7 après).


## D-119 — GARAM TIA, deuxième jeu de la plateforme

- **Date** : 2026-10-20 · **Statut** : validée par le propriétaire du projet · **Source des
  règles** : `docs/garam/` (cahier des charges maître consolidé, mises à jour du 09/09/2026).
  Seules les règles de jeu y sont reprises ; Godot, Katika, profils et finances hors partie
  ne sont pas concernés.
- **Identification** : un seul mécanisme, `game_type` (`'TER'` | `'GARAM'`) sur `sessions` et
  `games` (migration 0049), immuable, recopié de la session sur chaque partie (garde-fou en
  base). Tout ce qui existait est `'TER'` (valeur par défaut) et se comporte exactement comme
  avant. API : `gameType` facultatif à la création (`POST /api/sessions`), `?gameType=` sur
  `GET /api/sessions/open` (absent : Le Ter ; un ancien client ne voit jamais de table GARAM),
  `gameType` dans les vues de partie et de session quand il vaut `'GARAM'`.
- **Correspondance** : une PARTIE GARAM = une session (table, sièges fixes, sens
  trigonométrique = antihoraire, Continuer/Sortir) ; une MANCHE = une `Game`. Moteur pur
  `domain/garam/garam-engine.ts`, état `games.state.garam`, mutations par `GameService` seul
  (D-011). Actions : `PLAY_CARD` (premier tour), `DRAW_CARD`, `STAKE_VOTE` sur
  `POST /api/games/:id/actions`.
- **Règles implémentées** : 35 cartes (pique sans As, As = 11) ; 3 cartes par joueur, terre
  de 3/4/5 cartes ; conditions spéciales dans l'ordre (trois identiques, somme ≤ 10, terre
  de même signe ; pluralité → manche nulle ; « terre ≤ 21 » supprimée) ; dégagement par le
  créateur, même signe obligatoire ; contrôle = plus grande carte du signe dégagé ; deux As
  après le premier tour → victoire ; tirage à la tête, obligatoire tant que 21 n'est pas
  dépassé, « Impossible » sinon (carte laissée au terre, le suivant reprend) ; terre vide :
  rien ; gagnant = plus grand total ≤ 21, première carte exclue ; 10 s par tour (D-098 :
  13 s serveur dont 10 affichées) puis action automatique (carte légale au hasard, ou tirage
  automatique).
- **Tranché par le propriétaire (documents muets)** :
  1. le TIRAGE commence par le contrôleur, puis sens antihoraire, un passage par joueur ;
  2. « moins de 15 » ne s'applique qu'à la fin normale (pas aux victoires automatiques) ;
  3. manche nulle (pluralité ou égalité de total) : même dégageur, rejouée aussitôt sans
     Continuer/Sortir (même mécanisme que l'égalité de priorité du Ter) ;
  4. doubler la mise : vote sur la manche qui rejoue une égalité de TOTAL ; doublée si tous
     disent oui ; un joueur dont le solde ne couvre plus 2 × la mise retenue est retiré de la
     table (§3.16) ;
  5. commission : le barème des paramètres de l'administration, comme Le Ter (et non 10 %
     fixe) ; les sommes « moins de 15 » sont versées au gagnant sans commission
     (`game_settlements.penalty_amount`).
- **Choix techniques (sans règle nouvelle)** : démarrage de la première manche par le
  créateur dès 2 joueurs (mécanisme existant) ; un tour de tirage sans carte prenable se clôt
  aussitôt (le joueur n'a aucun choix) ; vote : 13 s (10 affichées), une absence de réponse
  n'est pas un oui, la première réponse est définitive ; dégageur retiré faute de solde →
  le joueur restant suivant ; pas de détection anti-collusion ni de tournoi pour GARAM
  (détection anti-collusion : remplacé par D-125).
- **Non implémenté (reste à faire)** : spectateur d'une manche en cours (§8.3 : le joueur
  arrivé attend la manche suivante, comme au Ter, sans voir la manche en cours) ; unicité du
  nom de partie parmi les parties actives (§6.9), absente aussi au Ter.

## D-120 — Caisse unique : source des recettes (Fap-Fap, Tournois, GARAM TIA)

- **Date** : 2026-10-20 · **Statut** : validée par le propriétaire du projet · **Complète** :
  D-060 (compte financier de la plateforme), D-074 (commissions des parties), D-119.
- **Caisse** : `platform_ledger` reste LA SEULE caisse de la plateforme. Aucune caisse,
  aucun portefeuille ni aucun solde par jeu : la source trace seulement l'origine d'une
  recette ; le solde reste la somme de toutes les écritures.
- **Source** (`platform_ledger.source`, migration 0050, obligatoire) : `FAP_FAP` (commission
  d'une partie de Le Ter), `GARAM_TIA` (commission d'une manche de GARAM TIA), `TOURNAMENT`
  (commission d'un tournoi et part des rangs payés non occupés). Garde-fous en base : une
  écriture de tournoi est `TOURNAMENT` et réciproquement ; une commission de partie porte la
  source du jeu de sa partie (trigger `platform_ledger_source_guard`).
- **Historique** : source déduite par jointure, sans supposition (chaque écriture porte son
  tournoi ou sa partie ; les parties antérieures à GARAM sont du Ter). Aucune ligne `UNKNOWN`.
- **Commissions GARAM TIA** : déjà prélevées par le mécanisme central (règlement dans la
  transaction de fin, barème de l'administration figé au démarrage, D-119). Une commission
  nulle n'est pas un oubli : `floor(mise × taux)` < 1 (ex. 96 FCFA à 1 %), comme pour
  Fap-Fap. Aucun taux ni barème modifié.
- **Idempotence** (inchangée, commune aux trois sources) : `UNIQUE (game_id, kind)`,
  `UNIQUE (tournament_id, kind)`, règlement seulement depuis `RESERVED` (ligne verrouillée),
  clés d'idempotence des transactions des joueurs ; débit, gain, commission et règlement dans
  la transaction qui termine la partie.
- **Administration** : liste des écritures avec la source et des filtres combinables (source,
  type, période : aujourd'hui / 7 / 30 / 90 jours / 12 mois / personnalisée, recherche par
  référence d'écriture, de partie, de session ou de tournoi) ; tableau de bord : « Caisse
  plateforme » (solde global, tout l'historique) distincte des « Commissions sur la période »
  et de leur répartition par source (barre empilée + tableau, parts arrondies au plus fort
  reste : 100,0 % exactement), filtrable par période et par source. Agrégats calculés en SQL
  (`GROUP BY source`), une requête par vue.

## D-121 — GARAM TIA : mise en conformité aux règles officielles

- **Date** : 2026-10-20 · **Statut** : validée · **Chrono et pose du terre remplacés par
  D-122** (choix du propriétaire du projet).
- **Vérifié conforme** (moteur, serveur, tests HTTP `garam-rules-http.test.ts`) : paquet de
  35 cartes (pas d'As de pique, pas de 2 ni de figures, As = 11), 2 à 4 joueurs, mise entière
  > 0 et solde ≥ 2 × mise sans débit à l'entrée, 3 cartes par joueur sans doublon, mains
  adverses jamais transmises, terre 3/4/5 en rang (tête = `terre[0]`), créateur premier, sens
  antihoraire, signe obligatoire contrôlé par le serveur, contrôle par la plus forte carte du
  signe dégagé, tirage à la tête une carte à la fois jusqu'à 21, carte refusée laissée au
  terre et reprise par le suivant, terre épuisé sans boucle, action automatique légale par
  les mêmes fonctions du moteur que les joueurs.
- **Affichage** : repères « Tête » / « Queue » sous le terre ; compte à rebours du joueur
  attendu visible par tous, devant sa plaque.

## D-122 — GARAM TIA : temps de tour du Ter et distribution carte par carte

- **Date** : 2026-10-20 · **Statut** : retenue par le propriétaire du projet · **Remplace** :
  le chrono de 5 s et la pose du terre à 1 s de D-121.
- **Temps de tour** : celui du Ter (`TURN_DURATION_MS`, 13 s côté serveur dont 10 affichées,
  D-098), même échéance persistée, même action automatique à l'échéance.
- **Distribution** (remplacée par D-123) (`garam-deal.ts` frontend, `garamDealPhaseMs` backend, même calendrier) :
  une carte à la fois en 3 passages (1re carte de chaque joueur, puis 2e, puis 3e), une
  carte toutes les 550 ms, 700 ms avant le 3e passage ; puis le terre, 850 ms après la
  dernière carte des mains, une carte toutes les 750 ms. Phase persistée (`dealEndsAt`) :
  aucune action ni temps de décision avant sa confirmation (COMPLETE_DEAL).

## D-123 — GARAM TIA : distribution par paquets de 2 cartes, puis la 3e, puis le terre

- **Date** : 2026-10-20 · **Statut** : validée par le propriétaire du projet · **Remplace** :
  le calendrier de distribution de D-122 (le temps de tour du Ter reste celui de D-122).
- **Séquence** (`garamDealSequence`, ordre de la table depuis le dégageur, `tableOrder`, sens
  antihoraire) : passage 1, un lot de 2 cartes par joueur ; passage 2, la 3e carte de chacun ;
  puis le terre (3/4/5 cartes) une par une. Un lot = un seul vol (`DealFlight`) : les 2
  cartes partent et arrivent ensemble.
- **Tempo** (d'un départ au suivant) : 600 ms entre deux joueurs, 600 ms avant le passage 2,
  700 ms avant la 1re carte du terre, puis 700 ms entre deux cartes. Mêmes valeurs côté
  téléphone (`garam-deal.ts`) et serveur (`garamDealPhaseMs`, `garam-rules.ts`).
- **Serveur** : aucun délai bloquant ; l'état officiel (mains, terre) est fixé au démarrage.
  La phase de distribution persistée (`dealEndsAt`) = fin de l'animation + pose (510 ms) +
  marge de réception (500 ms) : 5 160 / 7 060 / 8 960 ms pour 2 / 3 / 4 joueurs. Le tour du
  dégageur, avec le timer, la durée, la marge et l'action automatique existants du Ter,
  ne commence qu'à sa confirmation (COMPLETE_DEAL).

## D-124 — Jeu d'un tournoi : choix explicite obligatoire

- **Date** : 2026-10-20 · **Statut** : validée par le propriétaire du projet · **Complète** :
  D-054 (tournois), D-119 (GARAM TIA).
- **Règle** : tout nouveau tournoi porte un jeu, choisi EXPLICITEMENT à la création (mobile,
  administration, outil `tournament:create --game`) : FAP-FAP ou GARAM TIA. Aucune valeur
  n'est présélectionnée ni déduite ; sans choix, la création est refusée (« Veuillez
  sélectionner le jeu du tournoi. »).
- **Valeur** : le `game_type` existant des sessions et des parties, `TER` (Fap-Fap) ou `GARAM`
  (GARAM TIA), sans second système de noms. L'API refuse un jeu absent, `null`, vide ou
  inconnu (400, champ `gameType`), jamais remplacé par `TER`.
- **Base** : `tournaments.game_type` (migration 0051), `NOT NULL`, contrôlé, SANS valeur par
  défaut ; les tournois antérieurs, tous du Ter, sont renseignés `TER` par la migration sans
  réécriture de ligne. Immuable après la création (déclencheur) ; une modification qui renvoie
  le même jeu est acceptée.
- **GARAM TIA** : D-119 exclut les tournois GARAM (tables, classement et règlement non
  définis). Un tournoi GARAM est donc refusé à la création par `501 RULE_NOT_DEFINED`
  (`ruleRef` D-119) tant que ces règles ne sont pas définies ; le choix reste proposé et le
  refus est affiché sur le champ.
- **Modification** : il n'existe pas d'écran de modification de tournoi ; le détail d'un
  tournoi (administration) affiche son jeu enregistré.

## D-125 — GARAM TIA : détection anti-collusion commune avec Fap-Fap

- **Date** : 2026-10-20 · **Statut** : demandée par le propriétaire du projet · **Remplace** :
  l'exclusion de la détection anti-collusion pour GARAM de D-119 (le reste de D-119, dont
  l'absence de tournoi GARAM, est inchangé) · **Complète** : D-043 à D-053, D-081, D-095.
- **Un seul système** : les manches GARAM sont analysées par le `DetectionService` existant
  (mêmes analyseurs, signaux, versions d'algorithme, score `SUSPICION_SCORE_V2`, niveaux,
  alertes, administration, audit). Aucun moteur, table, réglage ni écran propre à GARAM.
- **Configuration** : la configuration est GLOBALE, donc commune aux deux jeux : interrupteur
  `system_settings.detection_enabled` (administration, Paramètres → Détection anti-collusion),
  seuils de `detection-config.ts`, option de table 🛡️ `suspicionDetectionEnabled` choisie à la
  création (désormais proposée aussi pour une table GARAM). Aucune configuration par jeu.
- **Branchement** : création d'une table GARAM (`SessionService.createSession`) avec la même
  règle que Fap-Fap (option demandée ET interrupteur global ON) ; consentement à la
  géolocalisation avant le démarrage (D-095, même écran `GameTableScreen`) ; analyse de fin
  de manche par `GameService.onGameFinished` → `DetectionService.observeFinishedGame`, en
  arrière-plan. Une MANCHE GARAM (= une `Game`) est l'unité analysée, comme une partie du Ter.
- **Historique par jeu** : les analyses longitudinales (FREQUENT_COPLAY, CARD_CHOICE_ANOMALY,
  CORRELATED_WINS, CONNECTION_PATTERN, REPEATED_PROXIMITY) ne lisent que des parties du MÊME
  `game_type` que la partie observée. Les manches GARAM n'alimentent donc jamais l'analyse
  d'une partie de Fap-Fap (comportement de Fap-Fap inchangé), et réciproquement.
- **Score et alertes par jeu** : même formule `SUSPICION_SCORE_V2`, mêmes contributions,
  plafonds, niveaux et règles d'alerte, mais calculés sur les seuls signaux du jeu de la
  partie analysée (`listSubjectSignals` filtré par `games.game_type`). Le score précédent
  (`previous_score`) est le dernier score du sujet dans le MÊME jeu. Clé de déduplication
  d'une alerte : inchangée pour Fap-Fap (`SUSPICION_LEVEL|sujet|niveau|v2|période`),
  suffixée `|GARAM` pour GARAM ; une alerte très élevée ne masque une alerte élevée que dans
  le même jeu. Une activité GARAM ne modifie donc jamais un score ni une alerte de Fap-Fap,
  et inversement. Le sujet reste identifié par les mêmes `playerId` (= `userId`) dans les
  deux jeux ; aucune migration, les clés existantes restent valides.
- **Spécificité GARAM** : CARD_CHOICE_ANOMALY repose sur les décisions de prise de contrôle
  des 5 tours du Ter ; aucune décision équivalente n'est définie pour GARAM, qui n'en produit
  donc aucune (aucune règle inventée). Les autres analyses s'appliquent telles quelles.
- **Tournois** : non concerné. Il n'existe pas de tournoi GARAM (D-119, D-124 : 501
  `RULE_NOT_DEFINED`) et les tables de tournoi ne sont pas surveillées (Fap-Fap compris) ;
  rien n'est modifié dans le système de tournoi.


## D-126 — Application mobile : composant secondaire exclusif

- **Date** : 2026-10-20 · **Statut** : demandée par le propriétaire du projet.
- **Règle** : un composant secondaire ouvert (panneau Profil, Réglages, Boutique, Partie
  privée, GARAM, dépôt, sélecteur de date/heure, confirmation d'inscription à un tournoi,
  consentement à la géolocalisation, reconnexion, avertissement de modération, remerciement
  de fin de tournoi…) est SEUL visible et SEUL interactif jusqu'à sa fermeture. Aucun élément
  de l'écran précédent (FAP-FAP, GARAM TIA, cartes décoratives, HUD, table de jeu…) ne reste
  visible derrière lui ni touchable.
- **Mise en œuvre** : un seul composant, `frontend/src/components/ui/ExclusiveOverlay.tsx` :
  fond plein écran OPAQUE (le fond de table, sans aucun élément d'interface), qui capte tous
  les appuis et masque l'écran du dessous aux lecteurs d'écran (`accessibilityViewIsModal`).
  Tout nouveau composant secondaire passe par lui ; plus aucun voile semi-transparent.
  `LobbyShell` rend en plus sa couche écran inerte (`pointerEvents: none`, masquée à
  l'accessibilité) tant qu'un panneau est ouvert. L'écran du dessous reste monté (aucun
  rechargement, état conservé) et réapparaît à la fermeture.
- **Hors champ** : les éléments qui font partie de la table de jeu elle-même (bilan de fin de
  partie au centre, vote de mise GARAM, chat latéral de la partie) ne sont pas des composants
  secondaires exclusifs : les masquer cacherait la table pendant le tour (minuteur de 20 s,
  D-064).

## D-126 — Fap-Fap et GARAM TIA : jeux indépendants, configurations de plateforme communes

- **Date** : 2026-10-20 · **Statut** : demandée par le propriétaire du projet · **Complète** :
  D-119, D-120, D-125.
- **Principe** : deux jeux totalement indépendants (règles, moteurs, validations, calculs,
  historiques, statistiques, données de jeu) qui utilisent les MÊMES configurations globales
  de la plateforme. Aucun paramètre ni système dupliqué pour GARAM.
- **Configurations globales (`system_settings`, toutes communes)** : `detection_enabled`
  (détection anti-collusion, D-053, D-125), `game_commission_schedule` (barème de commission
  des parties, figé au démarrage, D-074, D-119), `withdrawal_limit_count` /
  `withdrawal_limit_period` (retraits), paramètres des tournois (`tournament_*`,
  `initial_tournament_tokens`, `default_tournament_stake`,
  `maximum_pending_tournaments_per_player`). Aucun paramètre d'administration n'est propre à
  un jeu ; les règles de chaque jeu sont des constantes de son moteur (`official-rules.ts`,
  `ter-engine.ts` ; `garam-rules.ts`, `garam-engine.ts`). Le temps de tour et les délais de la
  distribution restent partagés par décision (D-122, D-123).
- **Finances** : une seule caisse (`platform_ledger`), source de chaque recette (`FAP_FAP`,
  `GARAM_TIA`, `TOURNAMENT`, D-120).
- **Statistiques** : les victoires d'un joueur (administration, fiche joueur) sont comptées
  par jeu (`games.game_type`), jamais additionnées : `gamesWon: { fapFap, garamTia }`.
- **Historique** : chaque partie expose son jeu (`gameType`) dans la liste et le détail de
  l'administration, avec un filtre `?gameType=TER|GARAM` (400 sinon).
- **Moteurs** : le cycle de vie commun (conditions de démarrage R-23, ordre de la table,
  phase de distribution, échéance du tour) vit dans `domain/game/game-lifecycle.ts`, utilisé
  par les deux moteurs ; le moteur GARAM n'importe plus rien du moteur ni des règles du Ter.
  Comportement inchangé (déplacement de code).
- **Actions** : une action propre à un jeu est refusée explicitement dans l'autre, avant tout
  moteur : `DECLARE_WIN` et `FLEE` (Fap-Fap) dans une manche GARAM, `DRAW_CARD` et
  `STAKE_VOTE` (GARAM) dans une partie de Fap-Fap → 422 `ACTION_NOT_AVAILABLE_FOR_GAME`
  (auparavant refusées par 422 `GAME_NOT_IN_PROGRESS`, « La partie n'a pas encore commencé. », message trompeur). Aucune règle modifiée.
- **Non modifié** : compteurs d'activité du tableau de bord (toutes parties confondues :
  mesure de la plateforme, pas une statistique de jeu).

## D-127 — GARAM TIA : variantes 15/16/17/18, 15 s par décision, Katika déterministe, tournois GARAM

- **Date** : 2026-10-21 · **Statut** : demandée par le propriétaire du projet (prompt maître
  GARAM TIA) · **Remplace** : pour GARAM seulement, le temps de tour du Ter (D-122) ; la carte
  automatique « au hasard » et le tirage automatique en une fois (D-119) ; le compte à rebours
  visible par tous devant la plaque (D-121) ; le refus des tournois GARAM (D-119, D-124 :
  501 `RULE_NOT_DEFINED`) · **Ne change pas** : Fap-Fap (règles, moteur, 13 s / 10 s affichées),
  règles GARAM de D-119 et D-121, distribution D-123, détection D-125, caisse D-120.
- **Variante** (`GaramVariant` = 15 | 16 | 17 | 18, `domain/garam/garam-rules.ts`) : choisie
  EXPLICITEMENT à la création d'une table GARAM (`POST /api/sessions`, champ `garamVariant`) et
  d'un tournoi GARAM (API, administration web et mobile, `tournament:create --game GARAM
  --variant N`). Aucune valeur par défaut nulle part : absente, `null`, chaîne, décimale ou hors
  liste → 400 `VALIDATION_ERROR` (champ `garamVariant`) ; fournie pour Fap-Fap → 400. Persistée
  (migration 0052) sur `sessions`, `games` (recopiée de la session, garde-fou) et `tournaments`,
  immuable, contrainte `(game_type = 'GARAM') = (garam_variant IS NOT NULL)`. Exposée dans les
  vues de session, de partie, des tables ouvertes, des tournois et de l'administration ;
  affichée sur la table (« GARAM 17 ») pendant toute la partie et dans la liste des tables.
  *Amendement du 2026-10-21 (propriétaire du projet)* : les formulaires présélectionnent
  **15** (modifiable) : « Créer une partie » GARAM (mobile) et création / proposition d'un
  tournoi GARAM (mobile, administration web). Le serveur et `tournament:create --variant`
  restent sans valeur par défaut : les formulaires envoient toujours `garamVariant`
  explicitement.
- **Sens** : seuil de la pénalité financière « moins de X », total STRICTEMENT inférieur à X
  (`isBelowGaramThreshold`). Elle ne désigne jamais le gagnant (plus grand total ≤ 21 et
  conditions spéciales, inchangés) et ne remplace pas la limite de tirage de 21, commune aux
  quatre variantes. Résultat : `belowThresholdIds` + `penaltyThreshold` (remplacent
  `belowFifteenIds`).
- **Données existantes** : avant D-127, la seule règle appliquée était « moins de 15 » : les
  sessions et manches GARAM existantes sont renseignées 15 par la migration (valeur constatée,
  aucune ligne supprimée) ; les résultats enregistrés avec `belowFifteenIds` sont relus comme
  `belowThresholdIds` + `penaltyThreshold: 15`, sans réécriture. Aucun tournoi GARAM n'existait.
- **Pénalité** : chaque perdant sous le seuil paie une mise de plus (la mise de la manche,
  `game_settlements.stake`), versée au gagnant SANS commission (`penalty_amount`) ; la
  commission normale reste celle du barème global (D-074, D-120). En tournoi : même calcul en
  jetons du tournoi, commission 0, perte bornée aux jetons du joueur. *Remplacé par D-130* :
  la commission du barème porte aussi sur la pénalité (Koraté).
- **Temps de décision** : `GARAM_TURN_DURATION_MS` = 15 s affichées + 3 s de marge réseau
  invisible commune (D-098) = 18 s côté serveur, pour chaque décision (premier tour et chaque
  tirage). Échéance persistée, `TURN_TIMEOUT` et reprise inchangés. Écrans : chiffres 15 → 0 et
  roulette SEULEMENT sur le téléphone du joueur attendu ; les adversaires voient seulement la
  barre de progression dans la plaque du joueur attendu, jamais les secondes (règle D-099,
  désormais appliquée aussi à GARAM : le badge de secondes visible par tous est retiré).
- **Katika (action automatique)** : par les mêmes fonctions du moteur que l'action d'un joueur
  (tour, phase, carte, signe, limite de 21 revérifiés). Premier tour : la carte LÉGALE de plus
  petite valeur (`garamAutomaticCard`), égalité départagée par l'ordre technique des familles
  `GARAM_SUITS` (sans valeur de règle) : déterministe, jamais de hasard. Tirage : UNE carte par
  échéance (jamais plusieurs en une opération), seulement si elle ne fait pas dépasser 21 ; le
  joueur retrouve un tour complet, et une nouvelle échéance tire la suivante. `commandId`
  déterministe par tour : aucune double exécution.
- **Tournois GARAM** : autorisés. La table du tournoi (`openTable`) est une session GARAM avec la
  variante du tournoi ; ses manches suivent le moteur GARAM ; règlement en jetons par
  `TournamentService.settleGame` (D-106, D-111), manche nulle = aucun mouvement (`GARAM_TIE`,
  rejouée). Pas de proposition de doubler la mise en tournoi (la mise par partie du tournoi est
  fixée par ses règles). Tables de tournoi non surveillées par la détection, comme Fap-Fap.
- **Erreur cross-game** : inchangée (D-126) : 422 `ACTION_NOT_AVAILABLE_FOR_GAME`, levée avant
  tout moteur, y compris sur une manche pas encore démarrée (jamais `GAME_NOT_IN_PROGRESS`). Le
  statut reste 422 : c'est le protocole existant des refus de règles de jeu (`RULE_VIOLATIONS`),
  le 409 étant réservé aux conflits d'état (version, partie démarrée, distribution…).
- **Moteur** : les délais de présentation de la distribution communs aux deux jeux vivent dans
  `domain/game/deal-timing.ts` (réexportés par `rules/rule-set.ts`, aucun changement de valeur) ;
  le moteur GARAM n'importe plus rien de `rules/` (règles de Fap-Fap).
- **Audit anti-collusion (score de suspicion)** : inchangé et conforme à D-125 : un seul
  `DetectionService` ; signaux et score `SUSPICION_SCORE_V2` calculés par sujet ET par jeu
  (`games.game_type`), historiques longitudinaux filtrés par jeu, clé d'alerte suffixée
  `|GARAM` ; interrupteur global `detection_enabled` commun. Rien n'a été modifié.
- **Tests** : `tests/unit/garam/garam-engine.test.ts` (variantes, seuil strict, Katika,
  15 s), `tests/integration/games/garam-game.test.ts` (création 15/16/17/18, refus, base,
  pénalité GARAM 18, cross-game), `tests/integration/tournaments/tournament-garam.test.ts`,
  `tournament-api.test.ts`, `garam-rules-http.test.ts`, `garam-deal-phase.test.ts` ; mobile :
  `PrivateGamePanel.test.tsx`, `garam-table.test.tsx`, `tournament-form.test.ts`,
  `AdminTournaments.test.tsx`, `LobbyShell.test.tsx` (Boutique exclusive) ; administration :
  `validation.test.ts`.

## D-128 — GARAM TIA : table organisée par état des cartes et déroulement visuel d'une manche

- **Date** : 2026-10-21 · **Statut** : demandée par le propriétaire du projet · **Complète** :
  D-119, D-123 (distribution, inchangée), D-127 · **Ne change pas** : aucune règle de jeu,
  aucune action, aucune donnée envoyée aux joueurs (les mains adverses ne quittent toujours le
  serveur qu'au résultat).
- **Une zone par état de carte** (`frontend/src/features/games/garam/garam-presentation.ts`,
  `GaramPlayArea.tsx`) : distribution (vols existants, D-123) ; main cachée (dos chez
  l'adversaire, ma main en bas) ; cartes du tour (zone pointillée « Cartes du tour » au centre,
  chaque carte devant son joueur) ; carte classée du 1er tour (cadre neutre « 1er tour » du
  siège, seul cadre du siège) ; terre (rang en haut de la table, cadre « Terre · tête →
  queue », places fixes pour la manche, de gauche à droite, la tête (1re carte posée)
  au-dessus de la suivante, qui n'en cache que 6 % : la valeur de chaque carte, dans son coin,
  reste lisible ; aucune rotation, chaque joueur voit le terre droit, face à lui). Révisé par le propriétaire du projet : il n'y a PAS de cadre
  « Terre » par siège ; une carte tirée rejoint la ZONE DE DÉPART de son joueur (là où ses lots
  sont arrivés à la distribution : dos chez l'adversaire, ma main en bas), après ses cartes
  cachées, face visible pour tous (fin liseré doré). Zone de départ pleine (2 cachées + 4
  tirées) : l'éventail se resserre jusqu'au pas des éventails adverses (`FAN_STEP`), coins
  lisibles ; jusqu'à 5 cartes, ma main garde exactement le pas du Ter. Aucune zone ne recouvre
  une autre ni ne sort de la table ou de l'écran, vérifié pour 2, 3 et 4 joueurs sur 7 tailles
  d'écran (`garam-presentation.test.ts`).
- **Déroulement** : cartes du tour visibles jusqu'à la dernière (2 s, rangement 450 ms, comme le
  Ter) ; contrôle annoncé SEULEMENT après le rangement (« X prend le contrôle », halo de la
  plaque, mention « Contrôle ») ; chaque joueur garde alors 2 cartes cachées ; tirage : chaque
  carte tirée (joueur ou Katika) quitte la tête du terre et vole, face visible, jusqu'à la zone
  de départ de son joueur, une à la fois, dans l'ordre réel du tirage (520 ms de vol, 380 ms de
  respiration) ; fin : rien n'est dévoilé avant que la dernière carte tirée soit posée, puis la
  zone de départ de chaque joueur est dévoilée l'un après l'autre (900 ms) : ses cartes cachées
  se retournent sur place et le total DU SERVEUR de toutes ses cartes s'affiche (« Total 20 ») ;
  après une pause (900 ms), le gagnant (2 s) ; ensuite seulement le panneau de fin (Continuer /
  Sortir). Manche nulle : mains et totaux ensemble, « Égalité · Nouvelle manche » 2,5 s, puis
  la nouvelle manche. Reconnexion : état final d'emblée, rien n'est rejoué.
- **Tirage par glisser-déposer** : seul le joueur que le serveur autorise (`canDraw`) peut
  saisir la tête du terre, une fois le tour rangé et les vols précédents terminés ; cible : sa
  zone de départ (la main du bas), élargie pour un doigt ;
  même composant de glisser-déposer que les cartes de la main (fiable au toucher). Lâchée, la
  carte va à sa place et le serveur valide (tour, tête, limite de 21) ; refusée, elle revient
  au terre. Le bouton « Tirer » reste l'équivalent sans geste.
- **Serveur** : la ronde Continuer/Sortir d'une manche GARAM gagnée commence après cette
  présentation, comme après le 5e tour du Ter (D-041) : `garamRevealPresentationMs(n)` =
  2 600 ms (dernier tour rangé ou dernière carte posée) + n × 900 + 900 + 2 000 ms (7 300 /
  8 200 / 9 100 ms pour 2 / 3 / 4 joueurs), mêmes valeurs côté téléphone. Le résultat et le
  règlement ne sont pas retardés.
- **Limite connue** : la manche nulle est rejouée aussitôt par le serveur (D-119) ; ses 2,5 s
  de présentation sont prises sur la distribution de la nouvelle manche (≥ 5,16 s) ou sur le
  vote de doublement (13 s).
- **Tests** : `garam-presentation.test.ts` (zones, ordre des tirages, calendrier identique au
  serveur), `garam-round-flow.test.tsx` (manche complète étape par étape, reconnexion,
  visibilité, droits de tirage, tirage d'un autre joueur, égalité, manche suivante),
  `garam-table.test.tsx` ; serveur : `garam-engine.test.ts` (visibilité au tirage et à la
  fin), `garam-game.test.ts` (ronde après la présentation).

## D-129 — GARAM TIA : « Main spéciale » à déclarer, comme au Fap-Fap

- **Date** : 2026-10-21 · **Statut** : demandée par le propriétaire du projet · **Remplace** :
  les victoires AUTOMATIQUES des conditions spéciales de GARAM (D-119 : trois identiques,
  somme ≤ 10, terre de même signe, deux As) · **Ne change pas** : les conditions elles-mêmes,
  leur priorité (trois identiques, puis somme ≤ 10, puis terre de même signe ; deux As après le
  premier tour), la manche nulle quand PLUSIEURS joueurs remplissent la même condition
  (automatique, comme la pluralité au Fap-Fap), le résultat (`GARAM_AUTOMATIC_WIN`, règlement
  sans pénalité « moins de X »), la suite de la partie (Continuer / Sortir, D-034).
- **Règle (modèle Fap-Fap, D-035)** : un SEUL détenteur ne gagne pas automatiquement ; il doit
  appuyer sur « Main spéciale » (`DECLARE_WIN`, même bouton que Fap-Fap). Le serveur reconnaît
  la main (analyse à la distribution ou à la fin du premier tour) ; elle reste SECRÈTE, connue
  de son seul détenteur (`myActions.canDeclareInstantWin`, `garam.mySpecial`).
  - Trois identiques, somme ≤ 10, terre de même signe (le dégageur) : déclarable dès la fin de
    la distribution et jusqu'à ce que le détenteur joue sa première carte (même hors de son
    tour). Carte jouée sans déclarer (par lui ou par le Katika à l'échéance) : droit perdu,
    la manche se joue normalement ; aucune condition de rang inférieur n'est reprise.
  - Deux As : à la fin du premier tour, tour de déclaration du détenteur (temps de tour
    habituel, 15 s affichées). Ses deux As font 22 : il ne peut rien tirer et la déclaration
    est sa seule action légale ; à l'échéance, le Katika la joue pour lui (`automatic: true`).
- **Écran** : bouton rond « Main spéciale » en bas à droite (même badge que Fap-Fap), visible
  pendant mon premier tour tant que je n'ai pas joué (que j'aie ou non une main spéciale, il ne
  trahit rien) et chaque fois que le serveur me permet de déclarer ; sans main spéciale, un
  appui affiche seulement un message. Après la déclaration : présentation de fin (D-128),
  bannière « Main spéciale : … » puis le panneau de fin. Les cadres des cartes jouées ne
  portent plus le texte « 1er tour ».
- **API** : `DECLARE_WIN` existe désormais dans les deux jeux (n'est plus refusé par
  `ACTION_NOT_AVAILABLE_FOR_GAME` en GARAM) ; sans main spéciale : 422 `NOT_A_WINNING_HAND` ;
  hors fenêtre : 422 `WIN_DECLARATION_NOT_ALLOWED`. `FLEE` reste propre à Fap-Fap.
- **Tests** : `garam-engine.test.ts` (déclaration, secret, droit perdu, Katika, deux As),
  `garam-game.test.ts` (HTTP), `garam-special-hand.test.tsx` (bouton).

## D-130 — GARAM TIA : les 5 mains spéciales, arbitrage par priorité, deux As, Koraté

- **Date** : 2026-10-21 · **Statut** : spécification du propriétaire du projet, précisée par
  lui le même jour (deux As hors mains spéciales, terre supprimée, commission sur la pénalité)
  · **Remplace** : les conditions spéciales de D-119/D-129 (trois identiques, somme ≤ 10, terre
  de même signe, deux As déclarés), le refus de la proposition de doubler la mise pour une
  égalité de mains spéciales (D-119), la pénalité « moins de X » hors commission (D-119,
  D-127, dossier §1.5 et §6.5), l'absence de variante présélectionnée dans les formulaires
  (D-127, voir son amendement : partie et tournoi présélectionnent 15) · **Ne change pas** :
  Fap-Fap, distribution, sens antihoraire, tirage, limite de 21, Katika, timers, sessions,
  détection, barème global de commission, caisse unique, source `GARAM_TIA`.
- **Valeurs des cartes** (inchangées, `garam-cards.ts`) : 3 à 10 = valeur faciale, As = 11 ;
  pas de 2 ni de figure dans le paquet de 35. Les exemples « 2-2-2 » ou « 2-3-5 » de la
  spécification sont donc impossibles ; « somme = 10 » n'existe que sous la forme 3 + 3 + 4.
- **Les 5 mains** (`dealtSpecialOf`, `GARAM_SPECIAL_PRIORITY`), toutes sur les 3 cartes
  reçues, priorité absolue décroissante : 1 trois 7 ; 2 trois cartes de même valeur ≠ 7
  (familles indifférentes ; trois As compris) ; 3 somme = 10 ; 4 trois cartes de même
  famille ; 5 somme = 21. Une main qui en remplit plusieurs vaut la meilleure. La « terre de
  même signe » est supprimée (propriétaire).
- **Deux As : PAS une main spéciale** (propriétaire, remplace la « priorité 6 » de la
  spécification) : ni déclaration, ni arbitrage, ni tour réservé. Le joueur qui garde deux As
  après le premier tour (22) ne peut rien tirer : son tirage est clos aussitôt (« Impossible »),
  comme tout joueur sans carte prenable. À la fin normale (révélation), il bat tout autre
  total, 21 compris (`finishRound`, `method: 'GARAM_BEST_SCORE'`, score 22) ; les autres
  perdants restent soumis au Koraté. Un seul joueur au plus (3 As dans le paquet). Trois As
  reçus = main n° 2 ; non déclarés, deux As gardés gagnent quand même à la révélation.
- **Une seule main spéciale** (**remplacé par D-137** : déclarée automatiquement par le serveur) : jamais de victoire automatique. Déclarable par « Main
  spéciale » de la fin de la distribution jusqu'à la première carte jouée du détenteur (même
  hors de son tour) ; carte jouée (par lui ou par le Katika à l'échéance) : droit
  définitivement perdu, la manche continue. Le Katika ne déclare JAMAIS.
- **Plusieurs mains spéciales** : arbitrage AUTOMATIQUE dès la distribution, sans attendre les
  tours : la meilleure priorité gagne (`automatic: true`). Meilleure priorité détenue par
  plusieurs joueurs : manche nulle (`GARAM_TIE`, `kind: 'SPECIAL'`, mains reçues révélées),
  aucun départage ; la manche rejouée porte la proposition de doubler la mise (même mécanisme
  que l'égalité de total). Deux joueurs aux trois 7 sont impossibles (4 sept dans le paquet).
- **Contrôle serveur de la déclaration** : identité (JWT), partie en cours, distribution
  confirmée, main réellement reçue (`initialHands`), première carte déjà jouée ou non, phase ;
  sinon 422 `NOT_A_WINNING_HAND` / `WIN_DECLARATION_NOT_ALLOWED`. Bouton affiché seulement
  quand le serveur le permet (`canDeclareInstantWin`).
- **Koraté** (= la pénalité « moins de X » de D-127, renommée à l'écran) : en fin normale de
  manche, un perdant dont la somme des cartes présentées (cartes gardées : main sans la carte
  du 1er tour + cartes tirées, la somme affichée « Total ») est STRICTEMENT inférieure à X
  (variante 15/16/17/18 de la partie) paie une mise de plus (250 → 500 au total), pour le
  gagnant. Pas de Koraté après une victoire par main spéciale (règle de D-119 inchangée).
- **Commission** (propriétaire) : UNE commission du barème global (`game_commission_schedule`,
  taux figé au démarrage), sur toutes les pertes, pénalités Koraté comprises
  (`planGaramSettlement`). Exemple : mise 250, 2 joueurs, 10 %, b Koraté → b perd 500,
  commission 50 (une écriture `GAME_COMMISSION` source `GARAM_TIA`, caisse unique), a reçoit
  450 (`game_winnings`). `game_settlements` : `gross_amount` = mises seules, `penalty_amount`
  = pénalités, `gross_amount + penalty_amount = commission_amount + net_gain` (contrainte de la
  migration 0049, inchangée : aucune migration). Tournois : commission 0, inchangés.
- **Écran** : GARAM 15 présélectionnée à la création d'une partie (le serveur exige toujours la
  variante envoyée) ; libellés « Trois 7 », « Somme des trois cartes = 10 »… ; « Koraté (moins
  de X) » dans le bilan. Les manches déjà jouées gardent leurs anciennes conditions.
- **Tests** : `garam-engine.test.ts` (5 mains, priorités, arbitrage, égalités à 2 et 3
  joueurs, déclaration, droit perdu, Katika, deux As à la révélation, Koraté, commission sur
  la pénalité), `garam-game.test.ts` (égalité → vote de doublement, Koraté 250 avec commission
  et caisse), `garam-special-hand.test.tsx`.

## D-131 — Application mobile : une fenêtre ne se ferme jamais par un appui hors d'elle

- **Date** : 2026-10-21 · **Statut** : demandée par le propriétaire du projet · **Complète** :
  D-126 (composant secondaire exclusif).
- **Règle** : un appui hors d'une fenêtre ouverte (panneaux Profil, Réglages, Boutique,
  Fap-Fap / GARAM TIA, sélecteurs de date et d'heure, et tout composant secondaire) n'a aucun
  effet. Elle se ferme seulement par son propre bouton (X, Annuler, Valider…) ou par le bouton
  retour d'Android (inchangé).
- **Mise en œuvre** : `ExclusiveOverlay` n'offre plus de fermeture au fond (option
  `onBackdropPress` supprimée) ; le fond capte toujours tous les appuis (rien de l'écran du
  dessous n'est touchable). Test : `ExclusiveOverlay.test.tsx`.

## D-132 — Application mobile : panneaux et clavier (formulaire « Proposer un tournoi »)

- **Date** : 2026-10-21 · **Statut** : demandée par le propriétaire du projet (« le scroll ne
  fonctionne pas bien sur la fenêtre Proposer un tournoi »).
- **Cause** : le panneau gardait toute la hauteur de l'écran quand le clavier s'ouvrait ; sur
  Android (affichage bord à bord), le clavier recouvrait le bas du panneau : les derniers champs
  et les boutons « Enregistrer le brouillon » / « Proposer » passaient dessous, hors de portée
  du défilement.
- **Correction** (`LobbyPanel`, tous les panneaux) : `KeyboardAvoidingView` (React Native,
  recommandé par le guide « Keyboard handling » d'Expo : `padding` sur iOS, `height` sur
  Android, comme `DepositSheet`) ; le panneau se réduit au-dessus du clavier (`flexShrink`)
  et son contenu défile jusqu'au dernier champ. Aucune dépendance native ajoutée
  (`react-native-keyboard-controller` écarté : il exigerait un nouveau build de développement).
- **Défilement selon l'endroit du geste** (signalé ensuite : « le scroll ne prend pas sur toutes
  les parties de la fenêtre ») : le fond `ExclusiveOverlay`, PARENT du contenu, réclamait tous
  les appuis (`onStartShouldSetResponder`) ; un geste commencé sur une partie non cliquable de
  la fenêtre (libellé, cadre, texte) lui remontait et ne faisait pas défiler, contrairement à
  un geste commencé sur un bouton ou un champ. Correction : la capture des appuis est une
  couche SŒUR, derrière le contenu ; elle bloque toujours l'écran du dessous, sans jamais
  prendre un geste commencé dans la fenêtre (vaut pour toutes les fenêtres). Test :
  `ExclusiveOverlay.test.tsx`.

## D-134 — Recharge MTN : paiement direct par défaut, repli automatique vers la page CinetPay

- **Date** : 2026-10-21 · **Statut** : demandée par le propriétaire du projet (« les deux
  méthodes pour MTN, par défaut la méthode directe ; si elle n'est pas disponible, le paiement
  se fait automatiquement par la méthode via CinetPay »).
- **Défaut** : un compte MTN (`MTN_CM`) paie d'abord en paiement DIRECT (demande de
  confirmation envoyée au téléphone), comme avant. Un refus immédiat du direct déclenchait déjà
  la page CinetPay (clé `…PAGE_FALLBACK_SUFFIX`).
- **Nouveau** : un direct ACCEPTÉ puis clos par CinetPay SANS débit (`FAILED` ou `EXPIRED`,
  transaction `failed`) bascule automatiquement le MÊME achat vers la page CinetPay
  (opérateur MTN présélectionné) : l'application relance la demande avec la même clé
  d'idempotence ; le serveur (`WalletService.requestDeposit`) revérifie que le direct est clos
  sans débit et crée (ou rejoue) une seule page pour cet achat. Un nouveau rejeu renvoie la
  même page ; aucun crédit avant la notification CinetPay vérifiée.
- **Jamais de double débit** : un direct encore en attente (`PENDING`, issue inconnue) n'est
  jamais doublé par une page ; il reste affiché « En attente de confirmation ».
- **Tests** : `backend/tests/integration/payments/cinetpay-payments.test.ts` (FAILED/EXPIRED →
  page, rejeu, crédit unique) ; `frontend/src/features/wallet/ShopFlow.test.tsx` (repli
  automatique, même clé, aucun repli tant que le direct est en attente).

## D-133 — Application mobile : HUD toujours visible et numéro d'ordre du joueur

- **Date** : 2026-10-21 · **Statut** : demandée par le propriétaire du projet · **Modifie** :
  D-126 (composant secondaire exclusif).
- **HUD toujours visible** : dans les écrans connectés (`LobbyShell` : accueil, tournois), le
  pseudo du joueur, son numéro d'ordre (ligne 🧑 sous le pseudo) et le solde restent affichés
  au premier plan, même quand un panneau, la Boutique ou un avertissement est ouvert. Tout le
  reste de l'écran précédent reste masqué (D-126). Panneau ouvert, le HUD est affiché mais NON
  interactif (le « + » de la Boutique est sans effet) : seule la fenêtre ouverte est
  interactive. Les panneaux sont centrés ENTRE les deux blocs du HUD (emprise mesurée), jamais
  dessous. Hors de la coquille (table de jeu), rien ne change.
- **Numéro d'ordre** : rang d'inscription du compte sur la plateforme (n° 1 = premier compte
  créé). Colonne `users.player_number` (migration 0053) : attribuée par une séquence
  PostgreSQL à la création du compte, jamais par l'application ni par le client ; unique,
  positive, immuable (déclencheur) et jamais réutilisée. Une inscription annulée après le
  tirage laisse un numéro inutilisé : les numéros sont croissants, sans garantie d'absence de
  trou. Comptes existants : numérotés par `created_at`, puis `id`.
- **API** : `playerNumber` dans le compte public (`/api/auth/me`, inscription, connexion).
  Affiché « N° 42 » dans le HUD ; « — » tant qu'il est absent (serveur plus ancien), jamais
  un numéro inventé.

## D-135 — Authentification : email facultatif des joueurs, connexion par téléphone, code de récupération

- **Date** : 2026-10-21 · **Statut** : demandée par le propriétaire du projet · **Tranche** :
  R-35 (mot de passe oublié) · **Modifie** : R-15 (email facultatif pour un joueur ; connexion
  par téléphone ou email), D-029 · **Ne change pas** : R-10, R-32, la connexion et la
  récupération de l'administration (email obligatoire), le changement de mot de passe connecté
  (`POST /api/auth/password`, mot de passe actuel exigé, aucun code).
- **Comptes** : joueur = téléphone obligatoire (unique, E.164 reconstruit par le serveur),
  email facultatif (`NULL`, jamais une adresse inventée) ; administrateur = email obligatoire,
  garanti en base (`users_admin_email_required`, migration 0054). Comptes existants inchangés.
- **Connexion** : `POST /api/auth/login` accepte `{ email, password }` OU `{ country, phone,
  password }`. Mobile : téléphone par défaut, lien « Se connecter avec l'email ». Message
  d'échec identique que le compte existe ou non.
- **Code de récupération** : `LT-XXXX-XXXX-XXXX`, 12 caractères aléatoires (alphabet de
  Crockford, 60 bits), créé à l'inscription et renvoyé UNE fois (`201 { user, recoveryCode }`).
  Seule son empreinte bcrypt est stockée (`users.recovery_code_hash`) ; jamais journalisé,
  jamais renvoyé par une autre route (`hasRecoveryCode` seulement). Un seul code actif par
  compte : utilisé ou remplacé, l'ancien ne vaut plus rien.
- **Mot de passe oublié** (sans SMS ni coût) : téléphone → code (`POST
  /api/auth/recovery/verify`) → autorisation temporaire (10 min, usage unique, empreinte
  SHA-256 en base, `password_reset_grants`) → nouveau mot de passe (`POST
  /api/auth/recovery/reset`) : mot de passe remplacé, ancien code invalidé, toutes les
  sessions fermées (`password_reset`), NOUVEAU code renvoyé une fois. Le numéro seul ne prouve
  jamais rien. Numéro inconnu, compte sans code, code faux, compte bloqué : même réponse
  `400 RECOVERY_FAILED` et même durée (comparaison factice).
- **Anti-force brute** : 5 codes faux → compte bloqué 15 min (en base, tous serveurs
  confondus) ; limites par IP (30 / 15 min) et par numéro (10 / 15 min) ; réinitialisations
  et nouveaux codes : 10 / 15 min.
- **Nouveau code depuis le Profil** : `POST /api/auth/recovery-code { currentPassword }` ;
  sert aussi aux comptes créés avant les codes.
- **Code perdu** : l'assistance (`admin`) fait « Réinitialiser l'accès » sur la fiche du joueur
  (`POST /api/admin/users/:id/recovery { reason }`) : motif obligatoire, ancien code invalidé,
  nouveau code affiché une fois à l'administrateur, qui le transmet ; le joueur choisit ensuite
  son mot de passe. Aucun mot de passe vu ni fixé. Audit `PLAYER_ACCOUNT_RECOVERY` (motif, sans
  le code), dans la même transaction. Interdit sur soi-même, sur un administrateur, sur un
  compte inactif.
- **Paiements** : un joueur sans email paie sans `client_email` envoyé à CinetPay (choix du
  propriétaire ; à confirmer en sandbox avant la production).
- **Tests** : `password-recovery.test.ts`, `register-login.test.ts`,
  `player-moderation.test.ts` (backend) ; `recovery-code.test.ts` ; `LoginScreen.test.tsx`,
  `ForgotPasswordScreen.test.tsx`, `RegisterScreen.test.tsx`, `ProfilePanel.test.tsx`
  (mobile) ; `player-moderation.test.tsx` (administration).

## D-136 — GARAM TIA : tirage automatique du terre, plus de bouton « Tirer »

- **Date** : 2026-10-21 · **Statut** : demandée par le propriétaire du projet · **Complète** :
  D-119, D-121, D-127 (temps de tour inchangé au premier tour). **Aucune règle modifiée** : le
  tirage reste obligatoire tant que la tête du terre ne fait pas dépasser 21 (§3.8), « Impossible »
  sinon (carte laissée au terre), terre vide : rien. Le joueur n'ayant aucun choix, le serveur
  tire pour lui.
- **Serveur autoritaire, un seul tirage** : pendant la phase de tirage, l'échéance du tour
  persistée devient un court délai (`GARAM_AUTO_DRAW_FIRST_MS` avant la 1re carte d'un joueur,
  `GARAM_AUTO_DRAW_STEP_MS` entre deux cartes, `garam-rules.ts`). À l'échéance, le chemin
  existant (`TURN_TIMEOUT` → `AUTO_GARAM_ACTION` → `drawGaramCard`) tire UNE carte ; puis le
  moteur décide seul de la suite (nouvelle échéance, « Impossible », joueur suivant, fin de
  manche). Aucun second mécanisme, aucune migration.
- **Doubles tirages impossibles** : file par partie, version optimiste, `turnTimedOutAt` constaté
  une seule fois, `commandId` déterministe par carte (`auto-garam:…:terre.length:joueur`) ;
  échéances persistées, timers reconstruits au redémarrage (`DeadlineSupervisor`). Lire la
  partie (reconnexion) ne déclenche rien.
- **`DRAW_CARD`** : conservé dans l'API (anciennes versions de l'application, tests) ; mêmes
  validations (tour, phase, limite de 21). L'application ne l'envoie plus.
- **Application** : bouton « Tirer » et glisser-déposer du terre supprimés ; chaque carte tirée
  vole de la tête du terre vers son joueur (animation existante, une à la fois, seulement une
  fois le premier tour rangé ; transition courte avec « réduire les animations ») ; respiration
  + vol = 800 ms, le cycle du serveur ; ni chrono ni barre de tour pendant le tirage ; consigne
  « Tirage automatique… ». Reconnexion : cartes déjà tirées posées d'emblée, aucun vol rejoué.
- **Tests** : `garam-engine.test.ts` (bloc « tirage automatique (D-136) »),
  `garam-auto-draw.test.ts` (HTTP, timers réels, concurrence) ; `garam-round-flow.test.tsx`,
  `garam-table.test.tsx` (mobile).

## D-136 — GARAM TIA : tirage automatique par le serveur, tempo du tirage

- **Date** : 2026-10-21 · **Statut** : demandée par le propriétaire du projet · **Modifie** :
  la phase de tirage de D-119 (tirage par le joueur) · **Ne change pas** : la règle du tirage
  (§3.8), l'ordre (le contrôleur, puis sens antihoraire), le premier tour et son temps de
  décision (D-127), la présentation de fin de manche (D-128).
- **Principe** : le tirage est obligatoire tant que la tête du terre ne fait pas dépasser 21
  (§3.8) ; le joueur n'a donc aucun choix et c'est le SERVEUR qui tire pour lui. Si la tête
  ferait dépasser 21 (ou si le terre est vide), « Impossible » : la carte reste au terre, les
  cartes déjà prises sont gardées, et le tour passe aussitôt au joueur suivant, sans délai
  (cas du joueur aux deux As, 22, D-130). Le dernier tirage clos termine la manche.
- **Une carte par échéance** : chaque tour de tirage a une échéance courte, persistée en base
  comme celle d'un tour normal (reprise par `DeadlineSupervisor` au redémarrage). À
  l'échéance, `playGaramAutomatically` tire UNE carte par la même opération que le tirage
  (`drawGaramCard`, mêmes vérifications : phase, tour, limite de 21), jamais plusieurs. Une
  échéance traitée deux fois (deux timers, deux instances) ne tire qu'une carte. Consulter la
  partie ne tire rien. Journal : `AUTO_DRAW_DUE` (info), pas `TURN_TIMEOUT` : ce n'est pas une
  absence du joueur.
- **Tempo** (`backend/src/domain/garam/garam-rules.ts`) :
  - avant la toute première carte de la manche, à la fin du premier tour :
    `GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS` = 3,5 s. Les écrans montrent d'abord le tour complet
    (2 s, `TRICK_CLEAR_DELAY_MS`), le rangent chez chaque joueur (450 ms), puis marquent une
    pause lisible (`GARAM_DRAW_START_PAUSE_MS` = 1 s) ; aucune carte du terre ne part tant
    que les cartes du premier tour ne sont pas rangées ;
  - avant la première carte d'un joueur suivant : `GARAM_AUTO_DRAW_FIRST_MS` = 800 ms ;
  - entre deux cartes d'un même joueur : `GARAM_AUTO_DRAW_STEP_MS` = 800 ms.
  Les tests peuvent injecter ces délais (`garamAutoDrawMs`).
- **Application mobile** (`garam-presentation.ts`) : aucun bouton « Tirer », aucune tête du
  terre à saisir, aucun chrono pendant le tirage. Chaque carte tirée vole de la tête du terre
  à la zone de départ de son joueur, UNE à la fois : respiration `GARAM_DRAW_BREATH_MS`
  (280 ms) puis vol `GARAM_DRAW_FLIGHT_MS` (520 ms), soit le même cycle de 800 ms que le
  serveur. Une carte tirée par un adversaire (ou par le Katika) est présentée de la même
  façon. En reconnexion, les cartes déjà tirées sont posées d'emblée, sans vol ni pause.
- **API** : l'action `DRAW_CARD` reste acceptée, avec les mêmes vérifications (refus
  `NOT_YOUR_TURN` hors de son tour) ; l'application ne l'envoie plus.
- **Tests** : `garam-engine.test.ts`, `garam-auto-draw.test.ts` (backend, tempo de
  production) ; `garam-round-flow.test.tsx` (mobile).

## D-137 — GARAM TIA : main spéciale déclarée automatiquement par le serveur, plus de bouton « Main spéciale »

- **Date** : 2026-10-21 · **Statut** : décision du propriétaire du projet (question posée : la
  déclaration d'une main spéciale unique était un CHOIX du joueur selon D-130 ; réponse :
  « Nouvelle règle : automatique »). · **Remplace** : pour une main spéciale UNIQUE, la
  déclaration par le bouton « Main spéciale », le droit perdu à la première carte et « le
  Katika ne déclare jamais » (D-129, D-130). · **Ne change pas** : les 5 mains et leurs
  priorités, l'arbitrage automatique de plusieurs mains spéciales et l'égalité de meilleure
  priorité (D-130), deux As, Koraté (jamais après une victoire par main spéciale), commission,
  tirage automatique (D-136), Fap-Fap.
- **Règle** : une main spéciale détenue par un seul joueur gagne TOUJOURS. Le détenteur ne
  peut plus choisir de jouer la manche (pour le Koraté) à la place.
- **Déroulement** (serveur autoritaire) : la main est reconnue à la distribution
  (`specialOutcome`). À la fin de la distribution (`completeGaramDeal`, ou au démarrage sans
  distribution présentée), le premier tour s'ouvre avec une échéance COURTE,
  `GARAM_AUTO_DECLARE_MS` = 800 ms, au lieu des 15 s d'un tour. Personne ne peut jouer de
  carte pendant ce délai (`garamPlayableCards` vide, `PLAY_CARD` refusé). L'échéance
  persistée déclenche `handleTurnTimeout` → `playGaramAutomatically` →
  `declareGaramWin(…, automatic: true)`, la MÊME opération que l'ancienne déclaration
  manuelle (mêmes vérifications). Résultat `GARAM_AUTOMATIC_WIN`, `automatic: true`.
- **Ordre avec le tirage automatique** (D-136) : une main spéciale n'existe qu'avant la
  première carte. Elle est donc toujours résolue avant le premier tour et le tirage : la
  manche se termine sans premier tour, sans tirage, terre intact. Un seul mécanisme
  d'échéance (celui du tour), jamais deux automatismes concurrents.
- **Une seule exécution** : file par partie, `turnTimedOutAt`, version optimiste,
  `commandId` déterministe. Deux échéances traitées en même temps, une commande
  `DECLARE_WIN` concurrente (encore acceptée du seul détenteur, même résultat) ou une reprise
  après redémarrage (`DeadlineSupervisor.recover`) ne produisent qu'une victoire et un
  règlement. Aucune migration : l'échéance du tour existante suffit.
- **Écran** : bouton « Main spéciale » supprimé (`canDeclareInstantWin` toujours faux en GARAM).
  Pendant le délai, la vue publique porte `specialPending` (ni détenteur ni nature révélés) :
  annonce légère « ✨ Main spéciale ! » qui apparaît en douceur (instantanée si « Réduire les
  animations »), sans chrono ni consigne. Puis la présentation de fin habituelle (D-128)
  annonce le gagnant et la main. L'écran n'envoie jamais rien : un rerendu ou une
  reconnexion relit seulement l'état du serveur.
- **Tests** : `garam-engine.test.ts` (G1, G2, G4/G5, G6, aucune carte avant la déclaration,
  attente après la distribution), `garam-auto-declare.test.ts` (HTTP + PostgreSQL : annonce,
  tempo réel, détenteur non-dégageur, G6, concurrence G4/G5, redémarrage G7, terre intact
  G8), `garam-game.test.ts`, `garam-special-hand.test.tsx` (aucun bouton, annonce pour tous,
  ni chrono ni consigne, rerendus sans envoi, rien pendant la distribution).

## D-138 — GARAM TIA : proposition de doubler la mise, retour à la mise de création

- **Date** : 2026-10-21 · **Statut** : demandée par le propriétaire du projet · **Précise** :
  §3.15 (proposition de doubler la mise), D-119, D-127.
- **Égalité** : la manche nulle (plus grand total ou priorité de mains spéciales) est rejouée
  et une proposition de doubler la mise est présentée à tous les joueurs de la manche.
  - **Tous acceptent** : la manche rejouée se joue à 2 × la mise de la manche nulle.
  - **Un refus, ou un joueur sans réponse à l'échéance** : la manche rejouée repart à la mise
    définie à la CRÉATION de la table (`games.state.garamBaseStake`, reportée de manche en
    manche), jamais à une mise déjà doublée. Exemple : table à 100, égalité, doublée à 200,
    nouvelle égalité, un « non » → 100 (et non 200).
  - **Délai** : 10 s affichées au joueur ; le serveur clôt la proposition 3 s plus tard
    (`GARAM_STAKE_VOTE_MS` = 13 s, marge réseau de D-098, comme Continuer/Sortir). Une réponse
    reçue après la clôture est refusée.
- **Commission** : appliquée sur le montant réellement joué. L'engagement et le taux du
  barème sont calculés au démarrage de la manche à partir de sa mise (doublée le cas
  échéant), comme pour toute manche (D-080).
- **Joueur qui débute** : après une égalité, la manche rejouée est débutée par le même
  joueur que la manche nulle (même dégageur, `firstPlayerId` inchangé).
- **Parties enregistrées avant D-138** : sans mise de création enregistrée, leur mise courante
  en tient lieu.
- **Non tranché ici** : la mise de la manche SUIVANTE après une manche doublée terminée par une
  victoire (Continuer) reste celle de la manche précédente, comme avant D-138.

## D-139 — Connexion, inscription et récupération mobiles : un seul champ « téléphone ou e-mail », Cameroun présélectionné

- **Date** : 2026-10-22 · **Statut** : demandée par le propriétaire du projet · **Modifie** :
  l'écran de connexion de D-135 (lien « Se connecter avec l'email » supprimé) et l'écran
  d'inscription et de récupération du mot de passe · **Tranche** : R-33 (Cameroun
  présélectionné, modifiable, sur ces trois écrans)
  · **Ne change pas** : `POST /api/auth/login` et ses deux formes `{ email, password }` /
  `{ country, phone, password }`, sessions, jetons, messages d'échec du serveur.
- **Champ unique** : l'application déduit la forme : un « @ » ou une lettre → e-mail ; sinon
  numéro NATIONAL avec le pays sélectionné (Cameroun `+237` par défaut, modifiable par la liste
  existante des pays) ; un numéro tapé avec son indicatif (« +237… », « 00237… ») l'emporte sur
  le pays sélectionné. Le joueur ne choisit jamais « Téléphone » ou « Email ».
- **Filigrane** : « 695 122 301 ou votre adresse e-mail » (exemple du pays présélectionné),
  jamais une valeur préremplie ni une donnée de joueur.
- **Écran** (`app/(auth)/login.tsx`, `src/features/auth/LoginLayout.tsx`) : fond sombre, un
  panneau centré, marque « LE TER », titre « Connexion », les 2 champs, « Mot de passe
  oublié ? », « Se connecter » (désactivé tant qu'un champ est vide, « Connexion… » pendant
  l'envoi, un seul envoi), « Vous n'avez pas de compte ? S'inscrire ». Cartes décoratives et
  cercle de feutre retirés de cet écran.
- **Inscription** (`app/(auth)/register.tsx`), même modèle : même panneau (large, champs par
  deux), mêmes champs, même téléphone (indicatif `+237` dans le champ, Cameroun présélectionné
  et modifiable, numéro national seul). Étapes, champs, validation, email facultatif, code de
  récupération et `POST /api/auth/register` inchangés.
- **Mot de passe oublié** (`app/(auth)/forgot-password.tsx`), même modèle : même panneau,
  indicateur d'étapes partagé (`LoginSteps`), même téléphone (Cameroun présélectionné). Les 3
  étapes (téléphone → code → nouveau mot de passe → nouveau code) et les routes
  `recovery/verify` / `recovery/reset` sont inchangées.
- **Tests** : `LoginScreen.test.tsx`, `RegisterScreen.test.tsx`,
  `ForgotPasswordScreen.test.tsx`, `LoginLayout.test.ts` (mobile).

## D-140 — Connexion et Inscription : décor LETER, drapeau de l'indicatif, icônes des champs

- **Date** : 2026-10-22 · **Statut** : demandée par le propriétaire du projet (capture de
  référence) · **Complète** : D-139 (même logique, mêmes champs, mêmes routes) · **Ne change
  pas** : authentification, API, validation, « Mot de passe oublié » (sans décor).
- **Décor** (`LoginLayout decorated`, `src/features/auth/LoginDecor.tsx`) : 5 cartes Le Ter
  L E T E R (une lettre centrée par carte, dos `TatamiCard`) à cheval sur le haut du panneau,
  titre gravé doré (« CONNEXION », « Inscription » en Cinzel) ; fond : reflet bordeaux, halo
  doré, étoiles scintillantes (fixes si « réduire les animations »), 3 cartes Le Ter (L) de
  chaque côté (`DecorativeCards`) seulement s'il reste ≥ 64 dp de chaque côté du panneau.
- **Champs** : indicatif avec drapeau (🇨🇲 +237 par défaut) DANS le champ ; la liste des pays
  reste sans drapeau (D-070). Connexion : libellé et filigrane « Téléphone ou email », icône
  bonhomme ; cadenas sur « Mot de passe » ; icône de connexion devant « Se connecter ».
  Inscription : drapeau sur l'indicatif du téléphone, bonhomme sur « Pseudo », cadenas sur les
  deux mots de passe. Icônes décoratives, masquées aux lecteurs d'écran.
- **Tests** : `LoginScreen.test.tsx`, `RegisterScreen.test.tsx`, `LoginLayout.test.ts`.

## D-141 — Connexion, Inscription, Mot de passe oublié : indicatif en bloc distinct, même décor

- **Date** : 2026-10-22 · **Statut** : demandée par le propriétaire du projet · **Complète** :
  D-139, D-140 · **Ne change pas** : API (`recovery/verify` reste pays + numéro), routes,
  services, validations, étapes de chaque écran.
- **Indicatif** : `[ 🇨🇲 +237 ▾ ]` est un bloc encadré distinct, à gauche du champ, sur la même
  ligne (`CountrySelectField appearance="login"`), Cameroun présélectionné. Le drapeau du
  Cameroun est dessiné (SVG) : Windows n'affiche pas les emojis drapeaux ; les autres pays
  gardent l'emoji. La liste des pays reste sans drapeau (D-070).
- **Ligne d'identification** (`src/features/auth/IdentifierField.tsx`, partagée par Connexion
  et Mot de passe oublié) : `[ 🇨🇲 +237 ▾ ] [ 👤 Téléphone ou email ]`, saisie alignée à gauche.
  Inscription : même bloc d'indicatif devant le champ Téléphone (bonhomme), champs inchangés.
- **Mot de passe oublié ?** : même décor que Connexion et Inscription (`LoginLayout decorated` :
  cartes L E T E R, titre gravé « Mot de passe oublié ? », fond, étoiles, cartes latérales),
  cadenas sur les deux nouveaux mots de passe. Une adresse e-mail saisie n'est pas envoyée :
  message « La récupération se fait avec le numéro de téléphone de votre compte… » (la
  récupération par e-mail demanderait une évolution de l'API, non décidée).
- **Tests** : `LoginScreen.test.tsx`, `RegisterScreen.test.tsx`, `ForgotPasswordScreen.test.tsx`.

## D-142 — « Mot de passe oublié ? » : récupération par téléphone OU email

- **Date** : 2026-10-22 · **Statut** : demandée par le propriétaire du projet · **Modifie** :
  D-141 (une adresse e-mail n'était pas envoyée) et `POST /api/auth/recovery/verify` (D-135).
- **API** : le corps accepte `{ country, phone, code }` (inchangé) OU `{ email, code }` ; le
  téléphone l'emporte s'il est fourni (même règle que `/login`). Email normalisé (minuscules,
  espaces retirés). Ni l'un ni l'autre : 400 sur `phone`.
- **Sécurité inchangée** : l'email seul ne prouve rien, le code reste exigé ; email inconnu,
  mauvais code, compte sans code ou bloqué → MÊME refus `RECOVERY_FAILED`, même durée. Le
  compteur `recovery-phone` est indexé sur le téléphone, sinon l'email (ordre du validateur) :
  ajouter un email inventé ne crée jamais un nouveau compteur pour un même numéro.
- **Écran** : le champ « Téléphone ou email » est résolu comme à la connexion
  (`resolveLoginIdentifier`) ; étape 1 renommée « Identifiant ».
- **Tests** : `password-recovery.test.ts`, `ForgotPasswordScreen.test.tsx`.

## D-143 — GARAM TIA : 25 s pour jouer la première carte

- **Date** : 2026-10-22 · **Statut** : demandée par le propriétaire du projet · **Modifie** :
  D-127 (15 s par décision).
- Chaque joueur dispose de **25 s affichées** (compte à rebours 25 → 0) pour jouer sa première
  carte, plus la marge réseau invisible commune de 3 s (D-098) : échéance serveur 28 s
  (`GARAM_DISPLAYED_TURN_MS = 25_000`, `GARAM_TURN_DURATION_MS`). À l'échéance, même
  mécanisme qu'avant (TURN_TIMEOUT, carte légale déterministe). Le chrono de l'écran se déduit
  de l'échéance du serveur : aucune constante côté application.
- **Ne change pas** : tirage automatique, déclaration automatique d'une main spéciale, « Je
  passe », temps de tour de Fap-Fap (13 s dont 10 s affichées).

## D-144 — GARAM TIA : plus de détection anti-collusion

- **Date** : 2026-10-22 · **Statut** : demandée par le propriétaire du projet · **Remplace** :
  D-125 (détection commune avec Fap-Fap).
- **Création** : l'option 🛡️ « Détection anti-collusion » n'est plus proposée pour une table
  GARAM (ni interrupteur à la création, ni colonne bouclier dans la recherche), même quand
  l'administration l'active. Fap-Fap la garde, toujours sous l'interrupteur global (D-053,
  D-081) : interrupteur coupé, l'option n'apparaît pas non plus pour Fap-Fap.
- **Serveur** : `SessionService.createSession` ignore `suspicionDetectionEnabled` pour GARAM ;
  la base le refuse aussi (`sessions_no_detection_for_garam`, migration 0055, `NOT VALID` :
  aucune ligne existante réécrite, D-043).
- **Anciennes tables GARAM surveillées** : traitées comme non surveillées (aucune analyse,
  aucun consentement à la géolocalisation) ; signaux et alertes déjà enregistrés conservés.
- **Ne change pas** : la détection de Fap-Fap (seuils, signaux, score, alertes, administration).

## D-145 — GARAM TIA : « Je passe » du joueur qui a la main sans carte prenable

- **Date** : 2026-10-22 · **Statut** : demandée par le propriétaire du projet · **Modifie** :
  D-136 (« Impossible : le tour passe aussitôt au joueur suivant ») pour tout joueur dont le
  tour s'ouvre sans carte prenable · **Ne change pas** : la règle du tirage (§3.8, limite de
  21, terre vide §3.10), l'ordre du tirage (le contrôleur, puis sens antihoraire), le tempo
  du tirage (D-136), le « Impossible » d'un joueur qui s'arrête APRÈS avoir tiré, le résultat.
- **Principe** : quand la main arrive à un joueur (le contrôleur ou un suivant) qui ne peut
  prendre aucune carte du terre (la tête ferait dépasser 21, deux As gardés à 22, ou terre
  vide), le serveur ne passe plus la main aussitôt : ce joueur annonce « Je passe » à toute la
  table, puis, à l'échéance de son tour, son tirage est clos (aucune carte prise, la carte
  refusée reste au terre) et la main passe au joueur suivant, ou la manche se termine. Le
  message n'apparaît jamais avant que le joueur ait la main.
- **Serveur** (`garam-engine.ts`, `openDrawTurn`) : le tour s'ouvre avec `GaramPlay.passing`
  et l'événement public `game:player_passed` (playerId, cardId éventuel). Échéance persistée
  comme toute échéance de tour (reprise par `DeadlineSupervisor`) : attente normale avant une
  1re carte + `GARAM_PASS_NOTICE_MS` (5 s), soit 3,5 s + 5 s = 8,5 s pour le contrôleur (depuis
  la fin du premier tour) et 0,8 s + 5 s = 5,8 s pour un joueur suivant. À l'échéance,
  `playGaramAutomatically` clôt le tirage (`game:draw_impossible` avec `passed: true`,
  `lastRefusal.passed`) ; aucun `game:auto_card_played`. Une échéance traitée deux fois ne
  passe qu'une fois (commande idempotente). Pendant ce tour, `canDraw` est faux et
  `DRAW_CARD` est refusé.
- **Vue** : `garam.passingPlayerId` (public) pendant le tour « Je passe ».
- **Application mobile** (`GaramPlayArea.tsx`) : « Vous : « Je passe » » / « Bob : « Je
  passe » » s'affiche au centre de la table, en doré et annoncé aux lecteurs d'écran, une fois
  le contrôle annoncé et la dernière carte tirée posée, jusqu'à ce que le serveur passe la
  main : ≈ 4,25 s pour le contrôleur, ≈ 5 s pour un joueur suivant. La notification
  « Impossible » n'est pas répétée pour ce joueur.
- **Tests** : `garam-engine.test.ts`, `garam-game.test.ts`, `garam-auto-draw.test.ts` (tempo
  de production) ; `garam-round-flow.test.tsx` (mobile).

## D-147 — Interrupteur global de la détection : activé par défaut

- **Date** : 2026-10-22 · **Statut** : demandée par le propriétaire du projet · **Modifie** :
  D-053 (paramètre absent = désactivé).
- **Défaut** : tant qu'aucun admin n'a réglé l'interrupteur (aucune ligne `detection_enabled`
  dans `system_settings`), la détection est ACTIVÉE (`PostgresDetectionSettingsRepository`,
  `DEFAULT_ENABLED`). L'option 🛡️ est donc proposée à la création d'une table Fap-Fap.
- **Choix de l'admin respecté** : une valeur déjà enregistrée (activée ou désactivée depuis
  `/admin`) n'est ni réécrite ni ignorée ; aucune migration. Une base où un admin a coupé la
  détection reste coupée jusqu'à ce qu'il la réactive.
- **Ne change pas** : l'option de table 🛡️ reste décochée par défaut et immuable (D-043) ;
  GARAM TIA n'a toujours aucune détection (D-144).

## D-146 — Application mobile : aucun message d'erreur technique à l'écran

- **Date** : 2026-10-22 · **Statut** : demandée par le propriétaire du projet · **Ne change
  pas** : les réponses de l'API, les codes d'erreur, les journaux de développement.
- **Principe** : le joueur ne voit jamais un message technique (exception JavaScript, trace,
  anglais système, réponse brute d'un proxy, code interne, identifiant, adresse, vocabulaire
  interne comme « idempotence », « transition », « session »). Il voit une phrase simple, en
  français, avec une action possible (« Une erreur est survenue. Réessayez. »).
- **Filtre central** (`src/lib/user-facing-error.ts`) : `ApiError` filtre son message et ses
  messages par champ dès sa construction, donc pour tous les clients API. Un message rédigé
  pour le joueur est conservé (même en 5xx : paiement, maintenance) ; un texte technique est
  remplacé (« Le serveur a rencontré une erreur… » en 5xx, sinon « Une erreur est survenue.
  Réessayez. ») ; un champ technique devient « Valeur invalide. ». Les codes au vocabulaire
  interne sont reformulés (`VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`,
  `INVALID_STATUS_TRANSITION`, `INVALID_CARD`, `NOTIFICATION_REJECTED`, `RULE_NOT_DEFINED`).
- **Erreurs non API** : `userErrorMessage(error, fallback)` n'affiche que le message (filtré)
  d'une `ApiError`, sinon le texte de secours ; plus aucun `String(error)` ni `error.message`
  d'une erreur quelconque à l'écran (réclamations, assistant, paiement, tournois, écrans
  d'administration de l'application).
- **Écran de secours** (`app/_layout.tsx` → `ErrorBoundary`, `AppErrorScreen.tsx`) : si un
  écran plante, « Oups… Un problème est survenu sur cet écran. Vos parties et votre solde ne
  sont pas affectés. » et « Réessayer » ; jamais le message ni la trace de l'exception (journal
  de développement seulement).
- **Tests** : `user-facing-error.test.ts`, `AppErrorScreen.test.tsx`, `api-client.test.ts`.

## D-148 — GARAM TIA : « Je passe » plus court, courte pause avant la révélation

- **Date** : 2026-10-22 · **Statut** : demandée par le propriétaire du projet · **Modifie** :
  D-145 (durée de l'annonce « Je passe »), D-128 (présentation de fin de manche).
- **« Je passe »** : `GARAM_PASS_NOTICE_MS` passe de 5 s à **4 s** (contrôleur : 7,5 s depuis la
  fin du premier tour ; joueur suivant : 0,8 s + 4 s). L'écran suit l'échéance du serveur.
- **Avant la révélation** : quand tous les joueurs ont tiré, une pause de **700 ms**
  (`GARAM_REVEAL_PAUSE_MS`, même valeur côté serveur et téléphone) précède la 1re main
  dévoilée. `garamRevealPresentationMs` l'inclut : la ronde Continuer/Sortir commence d'autant
  plus tard (2 joueurs : 8 s ; 4 joueurs : 9,8 s).
- **Ne change pas** : égalité (mains montrées ensemble), tirage automatique, Fap-Fap.

## D-149 — Chat : historique de la table, envoi sans attente, connexion temps réel sans coupure

- **Date** : 2026-10-22 · **Statut** : demandée et tranchée par le propriétaire du projet ·
  **Modifie** : D-045 (portée de l'historique, comportement du champ d'envoi, reconnexion).
- **Historique de la table** : le chat suit la TABLE (session, D-033) de son ouverture à sa
  fermeture. `GET /api/games/:gameId/chat/messages` renvoie les messages de TOUTES les parties
  de la session de `gameId`, dans l'ordre `(createdAt, id)` ; `before`/`after` traversent les
  parties. Un joueur arrivé en cours de session (siège repris) voit tout l'historique de la
  table. Accès inchangé : il faut être joueur de la partie demandée (403 `NOT_A_MEMBER`).
- **Inchangé** : un message appartient à UNE partie (`gameId` d'origine conservé), salle et
  canal par partie ; entre deux parties (partie terminée, ronde Continuer/Quitter), le chat
  reste en LECTURE SEULE (409 `CHAT_CLOSED`) ; aucune migration.
- **Envoi (application)** : à l'appui sur Envoyer, le champ est vidé et le clavier fermé
  immédiatement ; le message s'affiche dès la confirmation du serveur (aucun message local).
  En cas d'échec, le texte revient dans le champ avec l'erreur (même clé d'envoi : aucun
  doublon au renvoi).
- **« Reconnexion… » toutes les 15 min** : le serveur fermait le WebSocket (4401) à
  l'expiration du jeton d'accès. Le client renouvelle désormais le jeton 1 min avant son
  expiration et le présente sur la connexion OUVERTE (trame `auth`, déjà acceptée par la
  passerelle pour le même compte) : ni coupure, ni réabonnement. Échec du renouvellement :
  reprise habituelle (4401 → renouvellement → reconnexion).
- **Tests** : `chat-table-history.test.ts`, « Chat pendant une partie en cours »
  (`chat-realtime.test.ts`), `ChatPanel.test.tsx`, `hooks.test.tsx`, `realtime-client.test.ts`.

## D-150 — Administration : les réclamations à traiter dans la cloche

- **Date** : 2026-10-23 · **Statut** : demandée par le propriétaire du projet (une réclamation
  déposée par l'assistance n'apparaissait pas dans la cloche) · **Complète** : D-114
  (réclamations), D-116 (points d'attention mis à jour automatiquement) · **Ne change pas** :
  le cycle de vie des dossiers, les notifications des joueurs, les droits.
- **Compteur** : `AttentionCounts.pendingComplaints` (`GET /api/admin/attention` et tableau
  de bord) = réclamations en `OPEN`, `AI_ANALYSIS` ou `IN_REVIEW`, c'est-à-dire qui attendent
  l'administration. Une réclamation en attente du joueur (`WAITING_FOR_PLAYER`), décidée ou
  close n'est pas comptée.
- **Signal** : nouvelle source `COMPLAINT` du bus de l'administration, émise après chaque
  écriture validée d'un dossier (dépôt, réponse, pièce, contestation, décision, clôture), sans
  aucune donnée ; jamais en cas de refus. Un signal perdu est rattrapé par la relecture.
- **Interface** : cloche « N réclamations à traiter » et bloc « Alertes » du tableau de bord,
  lien vers `/reclamations`.
- **Tests** : `complaints-admin-attention.test.ts`, `admin-attention.test.ts` (backend) ;
  `topbar-notifications.test.tsx`, `dashboard-hydration.test.tsx` (administration).
