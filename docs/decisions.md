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

- **Date** : 2026-10-07 · **Statut** : validée
- **Décision** : Mongoose est installé ; `backend/src/config/database.ts` gère connexion,
  déconnexion et état. L'URI vient de `MONGODB_URI` (`backend/.env`, modèle dans `.env.example`).
  Aucune collection métier n'est créée.
- **Conséquences** : si `MONGODB_URI` est vide, le serveur démarre sans base (phase de fondation)
  et `/api/health` renvoie `"database": "disconnected"`. Aucune URI réelle n'est versionnée.
