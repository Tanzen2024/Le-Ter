# Architecture multi-parties — Le Ter

> Statut : architecture validée et socle d'isolation implémenté dans le backend
> (octobre 2026). Les règles du jeu ne sont **pas** implémentées. Les questions
> métier ouvertes sont dans [TODO.md](TODO.md) (R-18 à R-25).

## 1. Principe : la partie est l'unité d'isolation

Des dizaines, centaines ou milliers de parties existent en même temps. Chacune est
**totalement indépendante** :

```
Game A (gameId=6703…a1)          Game B (gameId=6703…b2)          Game C (gameId=6703…c3)
├── joueurs, sièges              ├── joueurs, sièges              └── état totalement
├── paquet, mains*               ├── paquet, mains*                   indépendant
├── tour, contrôle, round*       ├── tour, contrôle, round*
├── cartes jouées*               ├── cartes jouées*
├── version                      ├── version
├── échéance du timer            ├── échéance du timer
├── file de commandes            ├── file de commandes
└── salle temps réel + chat      └── salle temps réel + chat
                                                       * ajoutés avec les règles du jeu
```

Règles d'architecture, vérifiées par les tests :

1. **Tout passe par un `gameId` explicite** : commande, lecture, abonnement, événement,
   timer, log. Aucune opération ne s'applique à « la partie courante ».
2. **Aucun état global mutable de jeu** : pas de `currentGame`, pas de `currentGameTimer`.
   Les seules structures partagées sont des **registres indexés par `gameId`**
   (`Map<GameId, …>`) qui ne contiennent que des données de leur propre clé.
3. **Pas de référence partagée** : le dépôt renvoie et stocke des copies profondes.
   Modifier l'objet d'une partie ne peut pas modifier une autre partie.
4. **Le serveur décide** (D-008) : appartenance, validité et ordre des actions sont
   vérifiés sur l'état réel de la partie, jamais sur une information du client.

## 2. Identité d'une partie (`gameId`)

> **Mise à jour (D-023)** : avec le passage à PostgreSQL (D-022), `gameId` est désormais un
> **UUID v4** en minuscules, clé primaire `uuid` de la table `games`. Le raisonnement de
> sécurité ci-dessous reste valable. Le tableau suivant est l'analyse initiale (D-012).

| Option | Avantages | Inconvénients |
|---|---|---|
| ObjectId MongoDB comme `gameId` (retenu initialement, remplacé par D-023) | Natif, index `_id` gratuit, unique sans coordination, triable par date de création | Partiellement prévisible (horodatage + compteur) |
| UUID v4 dans un champ dédié | Imprévisible, indépendant de la base | Second index unique à maintenir, deux identifiants à gérer |
| ObjectId interne + identifiant public court (ex. code à 6 caractères) | Partage facile d'une partie privée | Collision à gérer, troisième identifiant. Aucun besoin exprimé dans les documents |

**Décision (D-012)** : `gameId` = `_id` du document `games`, sérialisé en 24 caractères
hexadécimaux. Il n'y a pas d'identifiant public séparé.

Pourquoi la prévisibilité de l'ObjectId n'est pas un problème : **la sécurité ne repose
pas sur le secret du `gameId`**. Le lobby affiche de toute façon toutes les parties en
cours (spec §13.1), donc les identifiants sont publics. La protection vient du contrôle
d'appartenance côté serveur (§8). Si un code de partage court devient nécessaire (parties
privées), il sera ajouté comme champ indexé sans changer `gameId`.

Côté code (`backend/src/domain/game/game-id.ts`) :

- `GameId` et `PlayerId` sont des **types marqués** : on ne peut pas passer un identifiant
  de joueur là où un `gameId` est attendu.
- Toute valeur venant de l'extérieur (URL, message temps réel) passe par `parseGameId`,
  qui refuse tout ce qui n'est pas un UUID canonique en minuscules. Cela bloque aussi les
  objets du type `{ "$ne": null }` et toute chaîne destinée à une injection.

## 3. État d'une partie

### 3.1 Où vit l'état

| Couche | Rôle | Règle d'isolation |
|---|---|---|
| **PostgreSQL, tables `games` + `game_players`** | Source de vérité durable, une ligne par partie | L'écriture est conditionnée à `WHERE id = gameId AND version = v` |
| **Mémoire du processus** | Copie de travail pendant le traitement d'**une** commande | Copie locale, jetée après la commande |
| **Registres par `gameId`** | File de commandes, timers, salles temps réel | Une entrée par partie, supprimée quand elle n'est plus utile |
| Redis | Diffusion des événements entre instances (Pub/Sub). Pas de cache d'état de partie | Un canal par partie ; jamais source de vérité (D-024) |

Chaque commande suit ce cycle : relire la partie, valider, appliquer sur une copie,
enregistrer avec contrôle de version, puis diffuser. Il n'y a donc **pas de cache d'état
de partie** à invalider ni à synchroniser. Avec au plus 4 joueurs et 31 cartes, une
partie pèse quelques Ko et se relit en une requête indexée par clé primaire.

### 3.2 Agrégat `Game` (implémenté)

```ts
interface Game {
  id: GameId;                 // UUID = games.id
  version: number;            // +1 à chaque changement validé
  status: 'waiting' | 'in_progress' | 'finished';
  creatorId: PlayerId;
  maxPlayers: number;         // 2 à 4 (spec §1)
  players: { playerId; seat; joinedAt }[];
  createdAt; updatedAt; startedAt?; finishedAt?;
  turnDeadlineAt?: Date;      // échéance du timer, persistée
  recentCommandIds: string[]; // idempotence (50 derniers)
}
```

Depuis le moteur de jeu (D-018), l'agrégat porte aussi `stakeAmount`, `play` (ordre de
distribution, mains, talon, tour en cours, cartes jouées, contrôle, joueur attendu), `result`
et `players[].fledAt`. Le détail est dans [game-domain.md](game-domain.md). Restent à ajouter :
le mot de passe haché et l'option « noms cryptés » (R-12). Les statuts « bloquée » et
« suspendue » viendront quand leur effet sera défini (R-25).

### 3.3 Vue joueur

Un client ne reçoit **jamais** l'agrégat `Game`, seulement `toPlayerView(game, viewerId)`
(`domain/game/game-view.ts`). Quand les mains existeront, cette projection ne contiendra
que la main du joueur qui regarde (spec §2.3). Les champs internes, comme
`recentCommandIds`, en sont déjà exclus.

## 4. Commandes et concurrence

### 4.1 Risques

- Deux joueurs de la même partie jouent au même instant.
- Un joueur clique deux fois, ou le client renvoie une commande après une coupure réseau.
- Un client agit sur un état périmé (il n'a pas encore reçu le dernier événement).
- Le timer expire au moment où le joueur joue.
- Plusieurs instances du backend écrivent la même partie (montée en charge future).

### 4.2 Stratégie retenue (D-013)

Trois mécanismes simples, complémentaires :

1. **File de commandes par partie** (`utils/keyed-serial-queue.ts`). Les commandes d'une
   même partie s'exécutent **une à la fois, dans l'ordre d'arrivée**. Celles de parties
   différentes s'exécutent en parallèle : la partie A ne ralentit jamais la partie B.
   L'ordre officiel des événements d'une partie est l'ordre de cette file.
2. **Concurrence optimiste** par `version`. Chaque écriture est conditionnée à la version
   lue : `UPDATE games SET … WHERE id = $1 AND version = $2` (implémenté,
   `PostgresGameRepository`). 0 ligne modifiée signifie qu'un conflit a eu lieu. Ce
   mécanisme protège aussi entre plusieurs instances (testé :
   `tests/integration/game/multi-instance.test.ts`).
3. **Idempotence** par `commandId`. Le client génère un identifiant unique par intention.
   Une commande déjà traitée est ignorée et renvoie l'état courant, sans double effet.

Le client peut en plus envoyer `expectedVersion`. Si l'état a changé depuis, la commande
est refusée (`GameVersionConflictError`) : le client se resynchronise et l'utilisateur
rejoue en connaissance de cause.

Ordre des contrôles dans `GameService.mutate` :

```
file(gameId) → relire la partie → appartenance de l'acteur → commandId déjà vu ?
→ expectedVersion → logique de la commande (règles) → version+1 → save(version lue)
→ diffusion dans game:{gameId} → log
```

Le contrôle d'appartenance passe **avant** la détection de doublon. Ainsi, un non-membre
qui rejoue le `commandId` d'un membre est refusé et ne reçoit pas l'état de la partie.

Inutile à ce stade : verrous distribués, event sourcing complet, file de messages
externe. La file en mémoire et la version suffisent pour une instance. La version suffit
à détecter les conflits entre instances.

## 5. Temps réel

### 5.1 Une salle par partie (D-014)

```
Serveur temps réel
├── game:{A}          ← événements publics de A (joueurs de A uniquement)
│   └── game:{A}:chat ← chat de A
├── game:{B}
│   └── game:{B}:chat
└── …
```

- Les noms de salle sont produits **uniquement** par `websocket/game-rooms.ts`
  (`gameRoom`, `gameChatRoom`). Aucun nom n'est construit à la main.
- Un événement **public** est publié dans `game:{event.gameId}`. Le `gameId` est un
  champ obligatoire de l'enveloppe : un événement sans partie ne peut pas être routé.
- Un événement **privé** (par exemple sa main) est envoyé au seul joueur visé, et
  seulement sur sa connexion à **cette** partie (`publishToPlayer`).
- S'abonner passe obligatoirement par `GameService.subscribe(gameId, playerId, …)`, qui
  vérifie l'appartenance. Le transport n'effectue aucun contrôle de lui-même.
- Le transport reste ouvert (Socket.IO, ws ou Firebase : T-01). Le code dépend du port
  `GameEventPublisher` / `GameEventSubscriber`. `InMemoryGameEventHub` en est
  l'implémentation de référence, testée.

### 5.2 Enveloppe d'événement

```json
{
  "eventId": "uuid",
  "gameId": "6703…a1",
  "version": 7,
  "type": "game:player_joined",
  "occurredAt": "2026-10-07T10:00:00.000Z",
  "actorId": "user456",
  "payload": { }
}
```

Types émis aujourd'hui : `game:created`, `game:player_joined`, `game:started`,
`game:hand_dealt` (privé), `game:card_played`, `game:trick_completed`, `game:turn_changed`,
`game:player_fled`, `game:finished` et `game:turn_timeout`. Leurs charges utiles sont décrites dans
[game-domain.md](game-domain.md) §4. `game:player_left` viendra avec R-19. Il n'y a pas de
`game:round_changed` : les documents ne définissent pas de manche (D-021).

`version` permet au client d'ignorer un événement déjà appliqué, et de détecter un trou
(version reçue supérieure à sa version + 1). Dans ce cas, il relit l'état complet.

### 5.3 Commandes client

Message temps réel `game:command` (ou `POST /api/games/:gameId/actions` en secours) :

```json
{ "gameId": "6703…a1", "commandId": "uuid", "expectedVersion": 7, "type": "PLAY_CARD", "payload": { } }
```

L'utilisateur est identifié par le token de la connexion, **jamais** par un champ du message.

### 5.4 Connexion, déconnexion, reconnexion

| Situation | Comportement |
|---|---|
| Connexion | Authentification de la connexion (JWT), puis abonnement explicite à chaque `gameId` demandé, après contrôle d'appartenance |
| Déconnexion | Les abonnements de la connexion sont retirés. La partie **continue** côté serveur, son état et son timer ne dépendent pas d'une connexion |
| Reconnexion | `findActiveGamesForPlayer(playerId)` retrouve les parties actives du joueur, puis il se réabonne et relit la vue de chaque partie (snapshot + version) |
| Reprise après redémarrage du serveur | Les parties sont relues depuis PostgreSQL et les timers réarmés à partir de `turnDeadlineAt` (à implémenter avec le timer réel) |

Ce que le système fait pendant l'absence du joueur (attendre, passer le tour, jouer à
sa place) dépend de R-06 et R-24.

## 6. Timers (D-015)

- `GameTimerRegistry` : `Map<GameId, Timeout>`, **un timer au plus par partie**.
  Il n'existe aucun `let currentGameTimer`.
- **Création** : `armTurnTimer(gameId, delayMs)`. La durée vient de l'appelant, car elle
  n'est pas encore définie (R-06). L'échéance est persistée dans `turnDeadlineAt`.
- **Réarmement** : armer à nouveau remplace le timer de **cette** partie seulement.
- **Expiration** : la callback ne modifie rien directement. Elle soumet une commande
  `TURN_TIMEOUT` dans la **file de la partie**, avec la version au moment de l'armement.
  Si la partie a évolué entre-temps (le joueur a joué), la version diffère et le timer
  périmé est ignoré. Cela élimine la course « le joueur joue au moment où le temps expire ».
- **Destruction** : `finishGame` annule le timer de la partie. `cancelAll` sert à
  l'arrêt du serveur.
- **Pause** : aucune pause aujourd'hui. Une pause pendant une déconnexion dépend de R-24.
- **Reconnexion d'un joueur** : elle ne touche pas au timer, qui appartient à la partie
  et non à la connexion.
- **Redémarrage** : réarmement à partir de `turnDeadlineAt`. Un index sur ce champ
  permettra de retrouver les échéances en cours.

## 7. API REST (conventions, non implémentée)

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| `POST` | `/api/games` | authentifié | Créer une partie (le créateur y est ajouté) |
| `GET` | `/api/games` | authentifié | Lobby : résumé **public** des parties ouvertes (montant, créateur, statut, remplissage) |
| `GET` | `/api/games/me/active` | authentifié | Parties actives du joueur (reconnexion) |
| `GET` | `/api/games/:gameId` | membre | Vue joueur de la partie (état + version) |
| `POST` | `/api/games/:gameId/join` | authentifié | Rejoindre |
| `POST` | `/api/games/:gameId/leave` | membre | Quitter (règles à définir : R-19, fuite R-05) |
| `POST` | `/api/games/:gameId/actions` | membre | Commande de jeu (même format que `game:command`) |

Conventions :

- Toute route de partie contient `:gameId`. Un middleware commun le traite :
  `parseGameId` (400 si invalide), puis chargement (404), puis contrôle d'appartenance
  (403). Aucun contrôleur ne lit un `gameId` dans le corps de la requête pour décider
  de la partie visée.
- Le `playerId` vient du token JWT, jamais du corps ni de l'URL.
- 403 plutôt que 404 pour un non-membre : l'existence des parties est publique (lobby).
- Les écritures renvoient la nouvelle vue joueur et sa `version`.
- `GameVersionConflictError` → 409, `GameFullError` / `GameNotJoinableError` /
  `GameFinishedError` → 409, `ParticipationRefusedError` → 403.

## 8. Sécurité et isolation

Un joueur de A ne peut jamais, sur B :

| Tentative | Barrière côté serveur |
|---|---|
| Lire l'état privé | `getGameForPlayer` → `assertPlayerInGame` |
| Recevoir les événements | `subscribe` → `assertPlayerInGame`. Diffusion limitée à `game:{gameId}` |
| Jouer une carte | `executePlayerCommand` → appartenance vérifiée dans la file, sur l'état réel |
| Modifier le timer | Aucune commande client n'arme ou n'annule un timer : seul le serveur le fait |
| Voir les cartes d'un joueur | Vue joueur (`toPlayerView`) et événements privés limités au destinataire |

Autres règles :

- Identité tirée du token, jamais d'un champ envoyé par le client.
- `gameId` validé par motif strict avant toute requête SQL (toujours paramétrée).
- Les requêtes du lobby utilisent une **projection** qui exclut l'état de jeu.
- Le frontend peut masquer des boutons, mais aucune protection ne dépend de lui.

## 9. Persistance PostgreSQL (D-022, D-025)

> Remplace l'ancienne section « MongoDB » (D-016, remplacée).

**Une ligne par partie dans `games`, un siège par ligne dans `game_players`, l'état de jeu
en JSONB.** L'état de jeu est petit, borné et toujours lu et écrit d'un bloc : il reste
groupé dans `games.state`. Les joueurs, qui seront reliés aux comptes et aux transactions,
sont relationnels. Une écriture = une transaction conditionnée à la version de la ligne `games`.

| Index | Usage |
|---|---|
| `games (id)` (clé primaire) | Accès par `gameId` |
| `games (status, created_at DESC)` | Lobby (parties ouvertes, récentes d'abord) |
| `game_players (player_id)` | Parties actives d'un joueur (reconnexion), historique |
| `games (turn_deadline_at)` partiel sur `status = 'in_progress'` | Réarmement des timers au redémarrage |

`PostgresGameRepository` implémente le contrat `GameRepository` (`findById`, `insert`,
`save` versionné, `findActiveByPlayer`). `InMemoryGameRepository` reste l'implémentation des
tests et du développement sans base ; une suite de tests commune vérifie que les deux se
comportent de la même façon.

Tables **non créées**, à évaluer le moment venu :

- `game_events` : journal append-only des événements, pour l'audit et les litiges (argent réel).
- `chat_messages` : seulement si le chat ne passe pas par Firebase (T-01).
- Parties terminées : elles restent dans `games` avec `status = 'finished'` (historique).

Détails (schéma, migrations, Redis, pannes) : [data-architecture.md](data-architecture.md).

## 10. Chat

- Canal `game:{gameId}:chat`, mêmes règles d'accès que la partie.
- Chaque message porte son `gameId`. Le serveur vérifie que l'auteur appartient à la
  partie avant de diffuser.
- Les observateurs (R-10) et la modération (R-14) restent à définir.
- Si Firebase est retenu (T-01) : chemin `chats/{gameId}/messages`, avec des règles de
  sécurité Firebase qui vérifient l'appartenance. Cela demande des tokens Firebase émis
  par le backend.

## 11. Frontend (D-017, à implémenter)

- **Route** : `frontend/app/game/[gameId].tsx`. `/game/abc…` et `/game/xyz…` sont deux
  écrans indépendants. Le `gameId` vient de `useLocalSearchParams` et il est validé.
- **État serveur (TanStack Query)**, clés toujours paramétrées par `gameId` :
  `['games', 'lobby']`, `['games', 'active']`, `['games', gameId]`.
- **Événements temps réel** : un seul socket pour l'application (`src/services/`) et un
  hook `useGameChannel(gameId)` qui s'abonne au montage et se désabonne au démontage ou au
  changement de `gameId`. Chaque événement reçu :
  1. est ignoré si `event.gameId !== gameId` ;
  2. est ignoré si `event.version` est inférieure ou égale à la version en cache ;
  3. déclenche une relecture de l'état si un trou de version est détecté ;
  4. sinon, met à jour le cache `['games', gameId]`.
- **Zustand** : un store de session global (utilisateur, token) est légitime. **Pas de
  `currentGame`**. L'état d'UI propre à une partie (carte sélectionnée, glisser-déposer)
  est indexé par `gameId` (`Record<GameId, GameUiState>`) et nettoyé quand on quitte la
  partie.
- **Reconnexion** : à la reconnexion du socket, réabonnement aux parties montées, puis
  invalidation des requêtes `['games', gameId]`.
- **Changement de partie** : naviguer vers un autre `gameId` change de clé de cache et
  d'abonnement. Aucune donnée de l'ancienne partie n'est réutilisée.

## 12. Observabilité

Logger JSON structuré (`utils/logger.ts`). Chaque commande produit une ligne avec
`gameId`, `playerId`, `action`, `version`, `commandId` et un horodatage :

```json
{"timestamp":"2026-10-07T10:00:00.000Z","level":"info","message":"game command applied","gameId":"6703…a1","playerId":"user456","action":"JOIN_GAME","version":2}
```

`logger.child({ gameId })` donne un logger lié à une partie. Un `requestId` par requête
HTTP (middleware) et par message temps réel sera ajouté avec les routes de jeu.

## 13. Tests d'isolation

Fichier `backend/tests/integration/game/multi-game-isolation.test.ts` :

| Test | Vérifie |
|---|---|
| TEST 1 | Modifier A laisse B strictement identique |
| TEST 2 | Un événement de A n'est reçu que par les abonnés de A |
| TEST 3 | Deux timers indépendants. Un timer périmé est ignoré |
| TEST 4 | Actions simultanées dans A et B, sans interférence |
| TEST 5 | Un joueur de A ne peut ni lire, ni écouter, ni agir sur B |
| TEST 6 | La reconnexion ne renvoie que les parties du joueur |
| TEST 7 | Terminer A détruit son timer, B continue normalement |
| Concurrence | Arrivées simultanées sans dépasser la capacité, double soumission appliquée une fois, version périmée refusée, non-membre refusé même avec un `commandId` valide |
| Observabilité | Les logs contiennent `gameId`, `playerId`, `action` |

Tests unitaires (`tests/unit/game/`) : file par clé, registre de timers, validation du
`gameId`, copies profondes du dépôt, conflit de version, salles et événements privés.

Un test de mutation a confirmé leur utilité : en désactivant la file par partie, deux
tests échouent (capacité et double soumission).

## 14. Montée en charge (plus tard)

Plusieurs instances partagent PostgreSQL (source de vérité) et Redis (diffusion). Déjà en place :

- **diffusion inter-instances** : `PubSubGameEventBus`, un canal Redis par partie (D-024) ;
- **écritures concurrentes entre instances** : la version optimiste garantit qu'aucune
  écriture n'est perdue ; la commande perdante reçoit `GameVersionConflictError`.

Reste à décider (T-08) : une **affinité par `gameId`** (commandes et timer d'une partie sur
la même instance) ou une coordination des timers et des commandes via Redis. Les verrous
distribués ne seront introduits que si la version optimiste ne suffit plus.
