This repository contains the "Le Ter" card game. It is a container with two independent applications and the documentation:

- `frontend/`: Expo/React Native mobile app. Prioritize mobile-first patterns, performance, and cross-platform compatibility.
- `backend/`: Node.js/Express/TypeScript API. It is the authority on all critical game rules (server-authoritative).
- `docs/`: source of truth (functional and technical specs, UML diagrams, architecture decisions). Never delete or move documents. Business rules listed as "À CLARIFIER" in `docs/TODO.md` must not be resolved by assumption.

There is no npm workspace: `frontend/` and `backend/` each have their own `package.json`, `package-lock.json` and `node_modules`. Run every command from the matching folder. Do not create a root `package.json` or a `shared/` folder without an explicit decision in `docs/decisions.md`.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `frontend/package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands (frontend)

Run these from `frontend/`. Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `frontend/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code in `frontend/src/` (`components/`, `features/`, `domain/`, `services/`, `stores/`, `hooks/`, `lib/`, `constants/`, `types/`).
- Never create `frontend/src/app/`: Expo Router would use it instead of `frontend/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `frontend/ios/` and `frontend/android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Backend

Run these from `backend/`:

```bash
npm run dev        # start the API with tsx watch
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
npm test           # Jest + Supertest
npm run build      # compile to dist/
```

- Configuration comes from environment variables (`backend/.env`, see `backend/.env.example`). Never commit secrets, tokens, real MongoDB URIs or Firebase/Mobile Money credentials.
