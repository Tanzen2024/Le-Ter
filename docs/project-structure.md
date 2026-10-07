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
| `project-structure.md` | Ce document |
| `decisions.md` | Journal des décisions |
| `TODO.md` | Points à clarifier et travaux à venir |

## frontend/

```
frontend/
├── app/                      Routes Expo Router (UNIQUEMENT des écrans et _layout.tsx)
│   ├── _layout.tsx           Navigateur racine (Stack)
│   ├── index.tsx             Écran d'accueil provisoire
│   ├── (auth)/               Connexion, inscription (à venir)
│   ├── (tabs)/               Navigation principale (à venir)
│   ├── game/                 Écrans de partie (à venir)
│   └── tournament/           Écrans de tournoi (à venir)
├── src/
│   ├── components/           Composants UI réutilisables
│   ├── features/             Modules fonctionnels (auth, lobby, game, tournament, wallet…)
│   ├── domain/               Types/logique d'affichage côté UI (non autoritaires)
│   ├── services/             Client API, temps réel, notifications
│   ├── stores/               Stores Zustand
│   ├── hooks/                Hooks partagés
│   ├── lib/                  Utilitaires et configuration de bibliothèques
│   ├── constants/            Constantes (couleurs, tailles…)
│   └── types/                Types TypeScript partagés dans le frontend
├── assets/                   Icônes, splash, images
├── tests/                    Tests frontend (à configurer)
├── app.json                  Configuration Expo (scheme "leter", plugin expo-router)
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
│   ├── server.ts             Point d'entrée : env, MongoDB, écoute, arrêt propre
│   ├── config/
│   │   ├── env.ts            Lecture et validation des variables d'environnement
│   │   └── database.ts       Connexion/déconnexion/état MongoDB (Mongoose)
│   ├── controllers/          health.controller.ts
│   ├── routes/               index.ts (/api), health.routes.ts (/api/health)
│   ├── middleware/           error-handler.ts (404, 500)
│   ├── services/             Cas d'utilisation (vide)
│   ├── domain/
│   │   ├── cards/            Cartes, paquet, mélange (vide)
│   │   ├── game/             État et déroulement d'une partie (vide)
│   │   └── rules/            Conditions de gain, mises (vide)
│   ├── models/               Schémas Mongoose (vide)
│   ├── repositories/         Accès aux données (vide)
│   ├── validators/           Validation des entrées (vide)
│   ├── websocket/            Temps réel (vide)
│   └── utils/                Utilitaires (vide)
├── tests/
│   ├── unit/                 env.test.ts
│   ├── integration/          health.test.ts (Supertest)
│   └── fixtures/             Données de test (vide)
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
npm run dev                # tsx watch src/server.ts
npm run typecheck          # tsc --noEmit
npm run lint               # ESLint
npm run format:check       # Prettier
npm test                   # Jest + Supertest
npm run build              # dist/
npm start                  # node dist/server.js
```
