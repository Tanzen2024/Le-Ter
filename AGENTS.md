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

- Multi-game: many games run at the same time and each game is an isolated unit (`docs/multi-game-architecture.md`, D-011). Every game operation takes an explicit `gameId`; never add global mutable game state (`currentGame`, a single shared timer…). Mutate a game only through `GameService`, which serializes commands per `gameId`, checks membership and versions writes. Keep `tests/integration/game/multi-game-isolation.test.ts` green.
- Persistence: PostgreSQL is the source of truth (D-022), accessed with `pg` behind the `SqlClient` port, no ORM, parameterized queries only. Schema changes are new files in `backend/migrations/` (`npm run db:migrate`); never edit an applied migration (D-026). The domain and `GameService` depend only on repository ports, never on `pg` or Redis. MongoDB is not used.
- Redis is volatile infrastructure (real-time Pub/Sub, later presence/cache/coordination), never a source of truth: write to PostgreSQL first, and a Redis failure must never fail or corrupt a persisted command (D-024).
- Configuration comes from environment variables (`backend/.env`, see `backend/.env.example`: `DATABASE_URL`, `REDIS_URL`). Never commit secrets, tokens, real database/Redis URLs or Firebase/Mobile Money credentials.
- Authentication (D-029, `docs/authentication.md`): no guest mode (R-10). The acting identity always comes from the verified JWT (`getAuth(res).userId`, converted with `playerIdOf`), never from a `userId`/`playerId` in the body, URL or headers. One active session per user (R-32): every session write locks the `users` row. Never log passwords, hashes, tokens or the `Authorization` header. Auth uses PostgreSQL only, never Redis.
- Game HTTP API (D-030, `docs/multi-game-architecture.md` §7): controllers validate input and call `GameService` only (never repositories, SQL or Redis) and return the player view, never the raw `Game`. Unresolved rules surface as `501 RULE_NOT_DEFINED`; Game lifecycle (D-031): one active game per player (R-18, enforced by a unique partial index on `game_players`), capacity 2/3/4, only the creator starts, from 2 players (R-23); `POST /api/games` requires `Idempotency-Key`. Dealing (D-032): 5 cards per player in two passes (one batch of 3 per player, then one batch of 2, never card by card), no draw pile; the first served plays first and holds the initial control. Sessions (D-033): a game always belongs to a session (`SessionService`); play direction is COUNTER-CLOCKWISE (session seat order); J1 = session creator for the first game, then the previous game's winner if present, else the next active player counter-clockwise. All "next player" logic goes through `domain/sessions/table-order.ts`. Game rules (D-035, the 52-decision truth foundation, overrides older interpretations): official rules in `domain/rules/official-rules.ts` (same colour = same family; must follow the lead card's family if held; control decided at end of trick by the highest card of the lead family); exactly 5 tricks, the 5th auto-played; flee only in trick 1 before one's first card (one per game, controller allowed, fled player keeps session seat); instant win = 6 ranked combinations on the 5 dealt cards, analysed by the server (single holder may declare; several → best rank wins automatically; equal best rank → immediate replay in a new Game of the same session with the same J1, no Continue/Leave). Never invent what D-035 lists as undefined. Session rules (D-034): `maxPlayers` 2/3/4 per session, immutable; one active session per player; FIXED seats (a vacated seat is reused by the next arrival, seats never move when J1 changes); a 10 s Continue/Leave round after each game (no answer = automatic leave); a 10 s turn timer, then TURN_TIMEOUT and an automatic card chosen by `AutomaticCardSelectionStrategy`. Turn timeout (D-036): the default `LowestCardAutomaticSelectionStrategy` only after the 10 s timeout (normal play is always the player's own drag-and-drop choice): the trick opener plays the lowest card of the hand; a following player plays the lowest card of the opening card's family if held, otherwise the lowest card of the hand; the tie-break between families of equal value (`PROVISIONAL_TIE_BREAK_ORDER`) is technical and NOT validated (R-06) — never present it as a game rule; deterministic, never random, played through the normal `engine.playCard` path; the 5th trick never uses it. Both deadlines live in PostgreSQL; timers only trigger `GameService`/`SessionService` commands and are rebuilt by `DeadlineSupervisor` at startup.
