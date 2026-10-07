# Architecture — Le Ter

> Statut : **phase de fondation** (octobre 2026). Ce document décrit l'architecture cible
> et ce qui est réellement en place. Les règles métier non tranchées sont listées dans
> [TODO.md](TODO.md) et ne doivent pas être implémentées par hypothèse.

## 1. Vue d'ensemble

Le Ter est un jeu de cartes multijoueur (2 à 4 joueurs) avec mises, tournois et chat.
Le dépôt contient deux applications indépendantes et la documentation :

```
┌──────────────────────────┐        HTTPS (REST)         ┌──────────────────────────┐
│ frontend/                │ ──────────────────────────► │ backend/                 │
│ Expo / React Native      │                             │ Node.js / Express / TS   │
│ iOS + Android (+ web)    │ ◄────────────────────────── │ Autorité des règles      │
│                          │   temps réel (à décider)    │                          │
└──────────────────────────┘                             └────────────┬─────────────┘
                                                                      │
                                                       ┌──────────────┴──────────────┐
                                                       ▼                             ▼
                                               ┌───────────────┐            ┌───────────────┐
                                               │ PostgreSQL    │            │ Redis         │
                                               │ source de     │            │ temps réel,   │
                                               │ vérité        │            │ volatile      │
                                               └───────────────┘            └───────────────┘
```

PostgreSQL est la base principale et la source de vérité ; Redis sert à la diffusion
temps réel entre instances et, plus tard, à la coordination. Détails :
[data-architecture.md](data-architecture.md) (D-022 à D-026).

Services externes prévus par la spécification technique (non intégrés à ce stade) :
Firebase Cloud Messaging (push), API MTN Mobile Money et Orange Money (paiements),
géolocalisation, groupe WhatsApp (communication des tournois).

## 2. Principe directeur : backend server-authoritative

Le backend est **la seule autorité** sur tout ce qui touche à l'équité du jeu et à l'argent :

- mélange et distribution des cartes ;
- validité d'une carte jouée, prise de contrôle, fin de tour ;
- détection des gains instantanés et du gagnant ;
- fuite, minuteur, jeu automatique en cas de déconnexion ;
- calcul des mises, du prélèvement du Katika, des soldes et des transactions ;
- jetons et classement des tournois.

Conséquences :

- Le client n'envoie que des **intentions** (« jouer telle carte », « déclarer main gagnante »).
  Le serveur valide et renvoie le nouvel état.
- Chaque joueur ne reçoit que **sa propre main** (spécification §2.3). Les mains adverses ne
  doivent jamais transiter vers un autre client avant d'être jouées ou révélées.
- Le frontend peut afficher des indications (cartes jouables, etc.), mais elles n'ont aucune
  valeur d'autorité.

## 2 bis. Plusieurs parties simultanées

Le système est **multi-parties** dès sa conception : chaque partie (`Game`, identifiée par
son `gameId`) est une unité d'isolation totalement indépendante (D-011). Toute commande,
lecture, abonnement, événement, timer et log porte un `gameId` explicite. Il n'existe aucun
état global de « partie courante ».

Détails complets (identité, état, concurrence, temps réel, timers, sécurité, persistance,
frontend, tests) : [multi-game-architecture.md](multi-game-architecture.md).

## 3. Frontend (`frontend/`)

| Élément | Choix |
|---|---|
| Framework | Expo SDK 57, React Native 0.86.3, React 19.2.3 |
| Navigation | Expo Router 57, routes dans `frontend/app/` |
| État serveur | TanStack Query 5 |
| État client | Zustand 5 |
| Animations | React Native Reanimated 4.7.1 (installé comme dépendance d'Expo Router) |
| Langage | TypeScript (strict) |

Organisation :

- `app/` : **uniquement les routes** (écrans et `_layout.tsx`). Groupes prévus : `(auth)`,
  `(tabs)`, `game/`, `tournament/`.
- `src/features/` : modules fonctionnels (auth, lobby, partie, tournoi, portefeuille…)
  qui assemblent composants, hooks et appels de services.
- `src/domain/` : types et logique **d'affichage** propres à l'UI (pas les règles officielles).
- `src/services/` : accès réseau (client API, temps réel, notifications).
- `src/stores/` : stores Zustand (état local de l'UI, session).
- `src/components/`, `src/hooks/`, `src/lib/`, `src/constants/`, `src/types/` : briques partagées.

Une partie s'ouvre par la route `app/game/[gameId].tsx`. Son état serveur est mis en cache
sous la clé `['games', gameId]`, et l'état d'UI propre à une partie est indexé par `gameId`.
Il n'y a pas de `currentGame` global (D-017).

### Mise en page : paysage uniquement (D-028)

L'orientation est verrouillée globalement dans `app.json`. Aucun écran ne la gère. Règles pour
tous les écrans :

- **Racine d'écran** : `src/components/Screen.tsx` (zone de sécurité sur tous les bords, car
  l'encoche est sur le côté en paysage). L'en-tête de pile est masqué par défaut : un écran ne
  l'affiche que s'il en a besoin.
- **Dimensions** : `flex`, pourcentages et `maxWidth`/`minWidth`. Pas de largeur ni de hauteur
  fixe pensée pour un seul appareil (`width: 800`). `useWindowDimensions` seulement quand une
  taille dépend vraiment de l'écran (taille des cartes, par exemple). Cibles : petit téléphone
  (hauteur utile d'environ 320 pt), grand téléphone, tablette.
- **Hauteur rare** : la hauteur est la dimension contrainte. Les contenus longs vont dans une
  `ScrollView`. On répartit en colonnes plutôt que d'empiler.
- **Formulaires** (connexion, inscription en deux étapes) : champs en deux colonnes
  (prénom | nom, pseudo | email), contenu centré avec une largeur maximale, dans une
  `ScrollView` avec `keyboardShouldPersistTaps="handled"`. En paysage, le clavier couvre plus
  de la moitié de la hauteur : `KeyboardAvoidingView` (`behavior="padding"` sur iOS ; Android
  redimensionne déjà la fenêtre, `adjustResize`) doit laisser visibles le champ actif et le
  bouton de validation.
- **Écran de jeu** : tapis au centre, adversaires répartis sur les bords, main et actions du
  joueur en bas. La disposition doit rester utilisable à 2, 3 et 4 joueurs.
- **Chat** : panneau latéral ou zone basse, jamais un écran qui suppose une grande hauteur. Le
  message en cours de saisie est conservé dans l'état et pas seulement dans le champ.
- **Modales** (confirmation, victoire, Kora, Double Kora, abandon, erreurs, résultats,
  paramètres) : largeur et hauteur maximales relatives, contenu défilant si besoin, boutons
  d'action toujours visibles.

Le frontend possède ses propres types d'UI. Il ne duplique pas les règles du jeu
(voir [decisions.md](decisions.md), D-009).

## 4. Backend (`backend/`)

| Élément | Choix |
|---|---|
| Runtime | Node.js ≥ 22 |
| Framework HTTP | Express 5 |
| Langage | TypeScript 6 (strict), module `NodeNext`, sortie CommonJS dans `dist/` |
| Base de données | PostgreSQL via `pg` (node-postgres), sans ORM, migrations SQL versionnées |
| Temps réel / coordination | Redis via `redis` (node-redis) : Pub/Sub inter-instances |
| Développement | `tsx watch` |
| Tests | Jest 30 + ts-jest + Supertest |
| Qualité | ESLint 10 + typescript-eslint, Prettier |
| Configuration | Variables d'environnement, chargement natif de `backend/.env` (`process.loadEnvFile`) |

Découpage en couches (flux d'une requête) :

```
routes/ → middleware/ + validators/ → controllers/ → services/ → domain/ (règles pures)
                                                         └──────→ repositories/ → database/ → PostgreSQL
websocket/ → services/ (même logique que le REST, autre transport)
services/ → GameEventPublisher → websocket/ (PubSubGameEventBus) → Redis
```

- `domain/` (`cards/`, `game/`, `rules/`) : **logique métier pure**, sans Express, PostgreSQL ni Redis,
  entièrement testable unitairement. C'est le domaine officiel du jeu.
- `services/` : orchestration des cas d'utilisation (créer une partie, jouer une carte…).
- `repositories/` : persistance PostgreSQL (et implémentation en mémoire), isolée du domaine.
- `database/` : port `SqlClient`, exécuteur de migrations (`backend/migrations/*.sql`).
- `controllers/` : traduction HTTP ⇄ services. Aucune règle métier.
- `config/` : lecture de l'environnement (`env.ts`), pool PostgreSQL (`database.ts`),
  connexions Redis (`redis.ts`).

En place aujourd'hui :

- `GET /api/health` → `{ "status": "ok", "database": …, "redis": … }`, chacun valant
  `disconnected` (non configuré), `connected` ou `unavailable`
- gestion 404 et erreurs 500 génériques ;
- connexion PostgreSQL **uniquement si** `DATABASE_URL` est défini, Redis **uniquement si**
  `REDIS_URL` est défini ; sinon le serveur démarre sans eux et le signale dans les logs ;
- schéma : `npm run db:migrate` (table `games` + `game_players`, D-025) ;
- arrêt propre sur `SIGINT`/`SIGTERM` ;
- **socle multi-parties** (sans règles du jeu ni routes HTTP de partie) :
  - `domain/game/` : `GameId` (UUID validé), agrégat `Game` versionné, contrôle
    d'appartenance, vue joueur, enveloppe d'événement, erreurs ;
  - `services/game/game.service.ts` : point d'entrée unique, avec une file de commandes par
    partie, la concurrence optimiste et l'idempotence par `commandId` ;
  - `services/game/game-timer-registry.ts` : un timer par partie ;
  - `repositories/` : contrat `GameRepository`, `PostgresGameRepository` et implémentation
    en mémoire, vérifiées par la même suite de tests ;
  - `websocket/` : salles `game:{gameId}`, port de diffusion, hub en mémoire,
    `PubSubGameEventBus` (diffusion inter-instances via Redis) ;
  - `utils/logger.ts` : logs JSON avec `gameId`, `playerId`, `action` ;
- **moteur du Ter** ([game-domain.md](game-domain.md), D-018 à D-021) :
  - `domain/cards/` : 31 cartes, Fisher-Yates avec hasard injecté, distribution ;
  - `domain/game/ter-engine.ts` : démarrage, jouer une carte, contrôle, 5 tours, gain
    instantané, fuite ;
  - `domain/rules/` : constantes certaines, `TerRuleSet` (une politique par règle ambiguë,
    sans valeur par défaut), conditions de gain, mise simple, `UnresolvedRuleError` ;
  - `GameService` : `startGame`, `playCard`, `declareWin`, `flee`. Ces commandes sont refusées
    tant qu'aucun jeu de règles de production n'est configuré.

## 5. Temps réel

La spécification mentionne à la fois Firebase Realtime Database (chat) et WebSocket /
Socket.IO (latence, reconnexion). Le choix du transport n'est **pas encore fait**
(voir [TODO.md](TODO.md), T-01).

Le modèle, en revanche, est fixé (D-014) : une salle `game:{gameId}` par partie, un canal
`game:{gameId}:chat` pour le chat, et une enveloppe d'événement portant `gameId`, `version` et
`sequence` (rang dans la commande, D-027).
L'abonnement est soumis au contrôle d'appartenance. Le code dépend d'un port
(`GameEventPublisher` / `GameEventSubscriber`) que l'adaptateur du transport choisi implémentera.

Entre instances du backend, les événements passent par Redis Pub/Sub (`PubSubGameEventBus`,
D-024). Une panne Redis n'affecte que la diffusion : l'état est déjà enregistré dans PostgreSQL.

## 6. Sécurité

- Aucun secret dans Git : `.env` et `.env.*` sont ignorés, seul `backend/.env.example` est versionné.
- Les fichiers de credentials Firebase et les clés de signature sont ignorés par le `.gitignore` racine.
- Requêtes SQL toujours paramétrées ; `gameId` validé (UUID) avant toute requête.
- Redis sur réseau privé, avec authentification et TLS en production (il transporte des
  événements privés).
- Authentification (D-029, [authentication.md](authentication.md)) : bcrypt, JWT 15 min,
  refresh token opaque haché et tourné, une seule session active (R-32), identité issue du
  JWT uniquement, aucun mode invité (R-10). `JWT_SECRET` obligatoire en production.
- Prévu par la spécification : HTTPS, protection contre les injections et le XSS.
