import { randomUUID } from 'node:crypto';

import type { GameId } from '../../../src/domain/game/game-id';
import { PostgresGameRepository } from '../../../src/repositories/postgres-game.repository';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
  enterGame,
  expectStatus,
  type GameApiTestContext,
} from '../../fixtures/game-api';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { identityRandom } from '../../fixtures/random';

/**
 * Cartes privées / cartes publiques, règles de PRODUCTION (D-035) : une carte jouée devient
 * visible de TOUS les joueurs et le reste (tours terminés compris) ; les cartes encore en
 * main d'un joueur n'apparaissent jamais dans la vue d'un autre. Distribution déterministe.
 */
jest.setTimeout(30_000);

let database: TestDatabase;
let ctx: GameApiTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  ctx = createGameApiTestApp(database.sql, { random: identityRandom, turnDurationMs: 60_000 });
});
afterEach(async () => {
  await ctx.stopTimers();
  await database.reset();
});

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  return { ...session, api: as(ctx.app, session.accessToken) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

async function startedTable(count: number) {
  const players: Player[] = [await newPlayer()];
  const created = await players[0]!.api.post('/api/games', { maxPlayers: count }).expect(201);
  const gameId: GameId = created.body.game.gameId;
  for (let i = 1; i < count; i++) {
    const p = await newPlayer();
    await expectStatus(enterGame(p.api, database.sql, gameId), 200);
    players.push(p);
  }
  await players[0]!.api.post(`/api/games/${gameId}/start`).expect(200);
  return { players, gameId };
}

const viewOf = async (p: Player, gameId: GameId) =>
  (await p.api.get(`/api/games/${gameId}`).expect(200)).body.game;

const hands = async (gameId: GameId) =>
  (await new PostgresGameRepository(database.sql).findById(gameId))!.play!.hands;

/** Le joueur attendu joue la première carte que le SERVEUR lui autorise. */
async function playAllowedCard(p: Player, gameId: GameId): Promise<string> {
  const view = await viewOf(p, gameId);
  const cardId = view.myActions.playableCardIds[0] as string;
  await p.api
    .post(`/api/games/${gameId}/actions`, {
      commandId: randomUUID(),
      type: 'PLAY_CARD',
      payload: { cardId },
    })
    .expect(200);
  return cardId;
}

/** Aucune carte encore en main d'un AUTRE joueur dans la vue de `viewer`. */
async function expectNoForeignHand(viewer: Player, gameId: GameId) {
  const json = JSON.stringify(await viewOf(viewer, gameId));
  for (const [owner, cards] of Object.entries(await hands(gameId))) {
    if (owner === viewer.userId) continue;
    for (const card of cards) expect(json).not.toContain(`"${card}"`);
  }
}

describe('Cartes jouées publiques, mains privées', () => {
  it('TEST 5 / 7 — A joue : tous voient sa carte ; ses cartes restantes restent privées', async () => {
    const { players, gameId } = await startedTable(3);
    const [A, B, C] = players as [Player, Player, Player];

    const played = await playAllowedCard(A, gameId);

    for (const viewer of [A, B, C]) {
      const view = await viewOf(viewer, gameId);
      expect(view.play.currentTrick).toEqual([{ playerId: A.userId, cardId: played }]);
      expect(view.play.handCounts[A.userId]).toBe(4);
    }
    expect((await viewOf(A, gameId)).play.myHand).toHaveLength(4);
    expect((await viewOf(A, gameId)).play.myHand).not.toContain(played);
    await expectNoForeignHand(B, gameId);
    await expectNoForeignHand(C, gameId);
  });

  it('TEST 6 / 8 — fin du tour : les cartes jouées restent visibles de tous, cumulées', async () => {
    const { players, gameId } = await startedTable(2);
    const [A, B] = players as [Player, Player];

    const first = await playAllowedCard(A, gameId);
    const second = await playAllowedCard(B, gameId);

    for (const viewer of [A, B]) {
      const view = await viewOf(viewer, gameId);
      expect(view.play.currentTrick).toEqual([]);
      expect(view.play.completedTricks).toEqual([
        expect.objectContaining({
          number: 1,
          plays: [
            { playerId: A.userId, cardId: first },
            { playerId: B.userId, cardId: second },
          ],
        }),
      ]);
      await expectNoForeignHand(viewer, gameId);
    }

    // Tour 2 : la nouvelle carte s'ajoute, les anciennes restent publiques.
    const leader = (await viewOf(A, gameId)).play.nextPlayerId === A.userId ? A : B;
    const third = await playAllowedCard(leader, gameId);
    const view = await viewOf(leader === A ? B : A, gameId);
    expect(view.play.currentTrick).toEqual([{ playerId: leader.userId, cardId: third }]);
    expect(view.play.completedTricks[0].plays.map((p: { cardId: string }) => p.cardId)).toEqual([
      first,
      second,
    ]);
  });
});
