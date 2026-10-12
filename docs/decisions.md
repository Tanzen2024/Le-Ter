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
- **Fin** (à `ends_at`) : plus aucune table attribuée ; `CALCULATING_RESULTS` attend la fin
  des parties commencées avant `ends_at`, au plus 10 min (au-delà, elles sont `VOID`).
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
  n'est pas révélée).
- **Fin des tables** : `SessionService` accepte une politique FACULTATIVE de continuation
  (sans effet par défaut). Tables de tournoi : aucune nouvelle partie (suivante automatique
  D-042, reprise après égalité, partie demandée → `409 SESSION_CLOSED`) une fois le tournoi
  hors `IN_PROGRESS` ou `ends_at` atteint. Les parties commencées avant `ends_at` se
  terminent et sont réglées dans le délai de grâce de D-054. Les joueurs encore assis
  reçoivent une notification `TOURNAMENT_TABLE_CLOSED` (une par table). Migration **0022**
  (ajout de ce type de notification uniquement).
- **Délai d'une heure** : revérifié à la soumission ET à l'approbation d'une proposition de
  joueur (le début doit rester au moins 1 h plus tard) ; un tournoi de l'administration doit
  seulement commencer dans le futur.
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
  commencé présenté « à venir ». Brouillons et propositions non publiées exclus.
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
