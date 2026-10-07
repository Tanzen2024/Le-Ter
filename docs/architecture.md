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
                                                                      ▼
                                                              ┌───────────────┐
                                                              │ MongoDB       │
                                                              └───────────────┘
```

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

Le frontend possède ses propres types d'UI. Il ne duplique pas les règles du jeu
(voir [decisions.md](decisions.md), D-009).

## 4. Backend (`backend/`)

| Élément | Choix |
|---|---|
| Runtime | Node.js ≥ 22 |
| Framework HTTP | Express 5 |
| Langage | TypeScript 6 (strict), module `NodeNext`, sortie CommonJS dans `dist/` |
| Base de données | MongoDB via Mongoose 9 (configuration seulement) |
| Développement | `tsx watch` |
| Tests | Jest 30 + ts-jest + Supertest |
| Qualité | ESLint 10 + typescript-eslint, Prettier |
| Configuration | Variables d'environnement, chargement natif de `backend/.env` (`process.loadEnvFile`) |

Découpage en couches (flux d'une requête) :

```
routes/ → middleware/ + validators/ → controllers/ → services/ → domain/ (règles pures)
                                                         └──────→ repositories/ → models/ → MongoDB
websocket/ → services/ (même logique que le REST, autre transport)
```

- `domain/` (`cards/`, `game/`, `rules/`) : **logique métier pure**, sans Express ni MongoDB,
  entièrement testable unitairement. C'est le domaine officiel du jeu.
- `services/` : orchestration des cas d'utilisation (créer une partie, jouer une carte…).
- `repositories/` + `models/` : persistance MongoDB, isolée du domaine.
- `controllers/` : traduction HTTP ⇄ services. Aucune règle métier.
- `config/` : lecture de l'environnement (`env.ts`) et connexion MongoDB (`database.ts`).

En place aujourd'hui :

- `GET /api/health` → `{ "status": "ok", "database": "disconnected" | "connected" | … }`
- gestion 404 et erreurs 500 génériques ;
- connexion MongoDB **uniquement si** `MONGODB_URI` est défini ; sinon le serveur démarre
  sans base et le signale dans les logs ;
- arrêt propre sur `SIGINT`/`SIGTERM`.

## 5. Temps réel

La spécification mentionne à la fois Firebase Realtime Database (chat) et WebSocket /
Socket.IO (latence, reconnexion). Le choix n'est **pas encore fait** (voir [TODO.md](TODO.md)).
Le dossier `backend/src/websocket/` est réservé et vide.

## 6. Sécurité

- Aucun secret dans Git : `.env` et `.env.*` sont ignorés, seul `backend/.env.example` est versionné.
- Les fichiers de credentials Firebase et les clés de signature sont ignorés par le `.gitignore` racine.
- Prévu par la spécification : JWT, bcrypt, HTTPS, protection contre les injections NoSQL et le XSS.
