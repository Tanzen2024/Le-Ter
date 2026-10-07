# Structure du projet — Le Ter

```
le-ter/
├── AGENTS.md                 Consignes pour les agents de code (Expo, routes, backend)
├── LICENSE
├── .gitignore                Racine unique pour frontend/, backend/ et docs/
├── docs/                     SOURCE DE VÉRITÉ (specs, diagrammes UML, décisions)
├── frontend/                 Application mobile Expo (indépendante)
└── backend/                  API Node.js/Express/TypeScript (indépendante)
```

Il n'y a **pas** de `package.json` à la racine ni de workspace npm (voir [decisions.md](decisions.md), D-007).

## docs/

| Fichier | Rôle |
|---|---|
| `SPECIFICATION FONCTIONNELLE DE LE TER.docx` | Spécification fonctionnelle (normative) |
| `Spécifications Techniques pour le jeu de cartes Le Ter.docx` | Spécification technique (normative) |
| `scenario_jeu_cartes.docx` | Scénario détaillé d'une session de jeu |
| `Diagramme_de_classe_de_LE_TER.jpg` | Diagramme de classes UML |
| `Cas_utilisation_partie_jeu.png` | Diagramme de cas d'utilisation |
| `diagramme_sequence_*.png` (7) | Séquences : connexion, création de compte, création/rejoindre une partie, déroulement, soldes, tournois, administration |
| `Voici des critères de réussite pour chaque sprint….docx` | Plan et critères des 9 sprints |
| `Gérer la complexité…`, `Melanger cartes`, `Pour intégrer la vérification des points…`, `Problèmes Potentiels et Solutions` (.docx) | Notes de recommandations (non normatives) |
| `architecture.md` | Architecture technique |
| `multi-game-architecture.md` | Architecture multi-parties (isolation par `gameId`) |
| `game-domain.md` | Moteur du Ter : matrice des règles, modèle, règles, événements |
| `data-architecture.md` | PostgreSQL (source de vérité, schéma, migrations) et Redis (temps réel) |
| `project-structure.md` | Ce document |
| `decisions.md` | Journal des décisions |
| `TODO.md` | Points à clarifier et travaux à venir |

## frontend/

```
frontend/
├── app/                      Routes Expo Router (UNIQUEMENT des écrans et _layout.tsx)
│   ├── _layout.tsx           Navigateur racine (Stack)
│   ├── index.tsx             Accueil : session restaurée, sinon redirection vers /login
│   ├── (auth)/               _layout.tsx, login.tsx (/login), register.tsx (/register, 2 étapes)
│   ├── (tabs)/               Navigation principale (à venir)
│   ├── game/[gameId].tsx     Écran d'une partie (identifiée par la route, D-017)
│   ├── session/[sessionId].tsx  Écran d'une session : sièges (vacants compris), partie en
│   │                         cours, Poursuivre/Quitter avec compte à rebours, historique
│   └── tournament/           Écrans de tournoi (à venir)
├── src/
│   ├── components/           Composants UI réutilisables (Screen : racine d'écran)
│   ├── features/             Modules fonctionnels (auth, lobby, game, tournament, wallet…)
│   ├── domain/               Types/logique d'affichage côté UI (non autoritaires)
│   ├── services/             Client API, temps réel, notifications
│   ├── stores/               Stores Zustand
│   ├── hooks/                Hooks partagés (use-server-countdown : compte à rebours aligné sur le serveur)
│   ├── lib/                  Utilitaires et configuration de bibliothèques
│   ├── constants/            Constantes (couleurs, tailles…)
│   └── types/                Types TypeScript partagés dans le frontend
├── assets/                   Icônes, splash, images
├── tests/                    Tests frontend (à configurer)
├── app.json                  Configuration Expo (scheme "leter", paysage uniquement — D-028)
├── plugins/                  Config plugins Expo locaux (Android sensorLandscape)
├── package.json              main = "expo-router/entry"
├── package-lock.json
└── tsconfig.json
```

**Ne jamais créer `frontend/src/app/`** : Expo Router l'utiliserait à la place de `frontend/app/`.

Commandes (depuis `frontend/`) :

```bash
npm install
npx expo start -c          # démarrer Metro (cache vidé)
npx tsc --noEmit           # typecheck
npx expo-doctor --verbose  # diagnostic
npx expo install --check   # compatibilité des versions avec le SDK
npx expo install <paquet>  # ajouter une dépendance (jamais npm install <paquet>)
```

## backend/

```
backend/
├── src/
│   ├── app.ts                Création de l'application Express (sans écoute réseau)
│   ├── server.ts             Point d'entrée : env, PostgreSQL, Redis, écoute, arrêt propre
│   ├── config/
│   │   ├── env.ts            Lecture et validation des variables d'environnement
│   │   ├── database.ts       Pool PostgreSQL : connexion, arrêt, état
│   │   └── redis.ts          Connexions Redis (commandes + abonnements), état
│   ├── controllers/          health, auth, game.controller.ts (minces : GameService seul)
│   ├── routes/               index.ts (/api), health, auth.routes.ts (/api/auth/*),
│   │                         game.routes.ts (/api/games/*)
│   ├── middleware/           request-id.ts, security-headers.ts, error-handler.ts,
│   │                         api-errors.ts (erreur → HTTP), require-auth.ts
│   │                         (requireAuth, getAuth), rate-limit.ts
│   ├── services/
│   │   ├── auth/                        AuthService, PasswordService (bcrypt), AccessTokenService
│   │   │                                (JWT), refresh-token.ts, auth-errors.ts, create-auth-service.ts
│   │   ├── sessions/session.service.ts  SessionService (D-033, D-034) : sièges, décision
│   │   │                                Poursuivre/Quitter, J1, parties successives
│   │   ├── game/
│   │   │   ├── game.service.ts          Point d'entrée unique des commandes d'une partie
│   │   │   │                            (dont TURN_TIMEOUT et coup automatique, D-034)
│   │   │   ├── create-game-service.ts      Assemblage (PostgreSQL + bus Redis + superviseur)
│   │   │   ├── participation-policies.ts   R-18 : une seule partie active (D-031)
│   │   │   └── game-timer-registry.ts   KeyedTimerRegistry : un timer par partie (tour) ou
│   │   │                                par session (décision), copie des échéances en base
│   │   └── timers/deadline-supervisor.ts  Reconstruction des timers au démarrage, balayage
│   │                                      des échéances dépassées (D-034)
│   ├── domain/
│   │   ├── users/user.ts     UserId, User, PublicUser, playerIdOf (UserId → PlayerId)
│   │   ├── sessions/         session.ts (Session, sièges, ronde Poursuivre/Quitter,
│   │   │                     transitions pures), table-order.ts (ordre antihoraire unique,
│   │   │                     J1 par siège), session-events.ts (D-033, D-034)
│   │   ├── cards/
│   │   │   ├── card.ts       Card, Suit, CardValue, CardId, composition (31 cartes)
│   │   │   ├── deck.ts       createDeck, shuffleDeck (Fisher-Yates), dealInPasses (lots 3 puis 2)
│   │   │   └── random-source.ts   Interface RandomSource (hasard injecté)
│   │   ├── game/
│   │   │   ├── game-id.ts    GameId / PlayerId (types marqués), parseGameId
│   │   │   ├── game.ts       Agrégat Game (unité d'isolation), statuts
│   │   │   ├── game-access.ts   Contrôle d'appartenance
│   │   │   ├── game-view.ts  Vue joueur (seul état envoyé au client, sa main seulement)
│   │   │   ├── ter-engine.ts startGame, playCard, declareWin, flee (moteur du Ter)
│   │   │   ├── automatic-card-selection.ts   Port AutomaticCardSelectionStrategy et
│   │   │   │                 LowestCardAutomaticSelectionStrategy (D-036)
│   │   │   ├── game-events.ts   Enveloppe d'événement (gameId, version, sequence)
│   │   │   └── game-errors.ts   Erreurs du domaine
│   │   └── rules/
│   │       ├── rule-set.ts          Constantes certaines + TerRuleSet (règles ambiguës)
│   │       ├── rule-candidates.ts   Interprétations candidates (non officielles)
│   │       ├── win-conditions.ts    Conditions de gain instantané
│   │       ├── stake.ts             Mise : gagné simple, Kora (interface)
│   │       └── unresolved-rule.ts   UnresolvedRuleError
│   ├── cli/finish-game.ts    npm run game:finish -- <gameId> (administration, via GameService)
│   ├── database/
│   │   ├── sql-client.ts     Port SqlClient (query paramétrée, transaction), adaptateur pg
│   │   ├── migrator.ts       Migrations versionnées (transaction, verrou, empreinte)
│   │   └── migrate.ts        CLI : npm run db:migrate
│   ├── repositories/
│   │   ├── game.repository.ts             Contrat (save versionné)
│   │   ├── postgres-game.repository.ts    Implémentation PostgreSQL (UPDATE versionné)
│   │   ├── in-memory-game.repository.ts   Implémentation tests/dev (copies profondes)
│   │   ├── user.repository.ts / postgres-user.repository.ts         Comptes
│   │   ├── auth-session.repository.ts / postgres-auth-session.repository.ts   Sessions d'auth (R-32)
│   │   └── session.repository.ts / postgres-session.repository.ts   Sessions de jeu (D-033)
│   ├── validators/           auth.validators.ts, game.validators.ts, validation-error.ts
│   ├── websocket/
│   │   ├── game-rooms.ts                Noms des salles game:{gameId}, game:{gameId}:chat
│   │   ├── game-event-publisher.ts      Port de diffusion (transport à choisir)
│   │   ├── in-memory-game-event-hub.ts  Implémentation de référence (une instance)
│   │   ├── pubsub-transport.ts          Port Pub/Sub + adaptateur Redis
│   │   └── pubsub-game-event-bus.ts     Diffusion inter-instances (un canal par partie)
│   └── utils/
│       ├── keyed-serial-queue.ts        File de tâches par clé (par gameId)
│       ├── logger.ts                    Logs JSON (gameId, playerId, action)
│       └── crypto-random-source.ts      Hasard cryptographique (production)
├── tests/
│   ├── unit/                 env.test.ts, cards/ (paquet), rules/ (gains, mises),
│   │                         game/ (moteur, file, timers, gameId, dépôt, salles)
│   ├── integration/          health.test.ts, game/ (isolation, moteur, multi-instances),
│   │                         database/ (dépôt PostgreSQL, migrations)
│   └── fixtures/             service en mémoire, PGlite, courtier Pub/Sub, contrat du dépôt,
│                             hasard déterministe, règles de test, parties
├── migrations/               Migrations SQL versionnées (0001_create_games.sql…)
├── docker-compose.yml        PostgreSQL + Redis locaux (développement uniquement)
├── .env.example              Modèle de configuration (sans secret)
├── eslint.config.mjs         ESLint (flat config) + typescript-eslint + prettier
├── .prettierrc.json / .prettierignore
├── tsconfig.json             Typecheck de src/ et tests/ (noEmit)
├── tsconfig.build.json       Compilation de src/ vers dist/
├── package.json              Scripts + configuration Jest
└── package-lock.json
```

Les dossiers vides contiennent un `.gitkeep` pour être versionnés.

Commandes (depuis `backend/`) :

```bash
npm install
cp .env.example .env       # puis adapter
docker compose up -d       # PostgreSQL + Redis locaux (optionnel)
npm run db:migrate         # applique backend/migrations/
npm run dev                # tsx watch src/server.ts
npm run typecheck          # tsc --noEmit
npm run lint               # ESLint
npm run format:check       # Prettier
npm test                   # Jest + Supertest (PostgreSQL via PGlite, sans serveur)
npm run build              # dist/
npm start                  # node dist/server.js
```
