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
    partie (R-19) ou fuir (R-05) n'est pas défini.
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
  - Quitter la session reste refusé pendant **sa** partie active (R-19, R-05).
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
