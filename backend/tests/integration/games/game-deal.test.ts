import type { GameEvent } from '../../../src/domain/game/game-events';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
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

/**
 * Distribution au démarrage (D-032), avec la configuration de PRODUCTION : aucun jeu de
 * règles. 5 cartes par joueur en deux passages (3 puis 2), ordre antihoraire de la table (D-033),
 * premier servi = premier joueur et contrôle initial ; aucune main adverse exposée.
 */
jest.setTimeout(30_000);

let database: TestDatabase;
let ctx: GameApiTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  ctx = createGameApiTestApp(database.sql); // pas de jeu de règles, comme en production
});
afterEach(async () => {
  await ctx.stopTimers();
  await database.reset();
});

type Player = Awaited<ReturnType<typeof newPlayer>>;

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  return { ...session, api: as(ctx.app, session.accessToken) };
}

/** Partie de `maxPlayers` places, `present` joueurs dans l'ordre d'arrivée (= sièges). */
async function table(maxPlayers: number, present: number) {
  const players: Player[] = [await newPlayer()];
  const created = await players[0]!.api.post('/api/games', { maxPlayers }).expect(201);
  const gameId: GameId = created.body.game.gameId;
  for (let i = 1; i < present; i++) {
    const p = await newPlayer();
    await expectStatus(enterGame(p.api, database.sql, gameId), 200);
    players.push(p);
  }
  return { players, gameId };
}

const storedHands = async (gameId: GameId) =>
  (await new PostgresGameRepository(database.sql).findById(gameId))!.play!.hands;

describe('Distribution au démarrage (D-032)', () => {
  it.each([
    [2, 2],
    [3, 3],
    [4, 4],
    [4, 2],
    [3, 2],
  ])(
    'capacité %i, %i joueurs : 5 cartes chacun, ordre antihoraire, J1 commence et a le contrôle',
    async (maxPlayers, present) => {
      const { players, gameId } = await table(maxPlayers, present);
      const started = await players[0]!.api.post(`/api/games/${gameId}/start`).expect(200);
      const ids = players.map((p) => p.userId);

      const play = started.body.game.play;
      expect(started.body.game.status).toBe('in_progress');
      expect(play.dealOrder).toEqual(ids); // sièges croissants = sens antihoraire, J1 = créateur
      expect(play.controllerId).toBe(ids[0]);
      expect(play.nextPlayerId).toBe(ids[0]);
      expect(play.trickNumber).toBe(1);
      expect(play.handCounts).toEqual(Object.fromEntries(ids.map((id) => [id, 5])));
      expect(play.dealSequence).toEqual([
        ...ids.map((playerId) => ({ pass: 1, playerId, count: 3 })),
        ...ids.map((playerId) => ({ pass: 2, playerId, count: 2 })),
      ]);
      expect(play.stockCount).toBe(31 - 5 * present);

      // Aucune carte dupliquée entre les mains (état réel, en base).
      const hands = await storedHands(gameId);
      const all = Object.values(hands).flat();
      expect(all).toHaveLength(5 * present);
      expect(new Set(all).size).toBe(5 * present);
    },
  );

  it('confidentialité : chaque joueur voit ses 5 cartes et aucune carte adverse', async () => {
    const { players, gameId } = await table(4, 4);
    await players[0]!.api.post(`/api/games/${gameId}/start`).expect(200);
    const hands = await storedHands(gameId);

    for (const player of players) {
      const view = await player.api.get(`/api/games/${gameId}`).expect(200);
      expect(view.body.game.play.myHand).toEqual(hands[player.userId]);
      const json = JSON.stringify(view.body);
      for (const [owner, cards] of Object.entries(hands)) {
        if (owner === player.userId) continue;
        for (const card of cards) {
          expect(json).not.toContain(`"${card}"`);
        }
      }
      expect(view.body.game.play).not.toHaveProperty('hands');
      expect(view.body.game.play).not.toHaveProperty('stock');
    }
  });

  it('événements : game:started public sans carte ; chaque main en privé, groupée par lots', async () => {
    const { players, gameId } = await table(3, 3);
    const inbox = new Map<string, GameEvent[]>();
    for (const p of players) {
      const events: GameEvent[] = [];
      inbox.set(p.userId, events);
      await ctx.games.subscribe(gameId, p.userId as PlayerId, (e) => events.push(e));
    }
    await players[0]!.api.post(`/api/games/${gameId}/start`).expect(200);
    const hands = await storedHands(gameId);

    for (const p of players) {
      const events = inbox.get(p.userId)!;
      expect(events.map((e) => [e.type, e.version, e.sequence])).toEqual([
        ['game:started', 4, 0],
        ['game:hand_dealt', 4, expect.any(Number)],
      ]);
      expect(JSON.stringify(events[0])).not.toMatch(/COEUR|PIQUE|TREFLE|ETOILE/);
      const mine = hands[p.userId]!;
      expect(events[1]?.payload).toEqual({
        playerId: p.userId,
        cards: mine,
        batches: [mine.slice(0, 3), mine.slice(3)],
      });
    }
  });

  it('double démarrage simultané : une seule distribution, mains inchangées par le second', async () => {
    const { players, gameId } = await table(4, 3);
    const dealt: GameEvent[] = [];
    await ctx.games.subscribe(gameId, players[1]!.userId as PlayerId, (e) => dealt.push(e));

    const results = await Promise.all([
      players[0]!.api.post(`/api/games/${gameId}/start`),
      players[0]!.api.post(`/api/games/${gameId}/start`),
    ]);
    const handsAfter = await storedHands(gameId);
    await players[0]!.api.post(`/api/games/${gameId}/start`).expect(409);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(dealt.filter((e) => e.type === 'game:hand_dealt')).toHaveLength(1);
    expect(await storedHands(gameId)).toEqual(handsAfter);
    expect((await players[0]!.api.get(`/api/games/${gameId}`)).body.game.version).toBe(4);
  });

  it('pas de pioche : la main ne grossit jamais après le démarrage', async () => {
    const { players, gameId } = await table(2, 2);
    await players[0]!.api.post(`/api/games/${gameId}/start`).expect(200);
    const game = await new PostgresGameRepository(database.sql).findById(gameId);
    expect(Object.values(game!.play!.hands).every((h) => h.length === 5)).toBe(true);
    expect(game!.play!.stock).toHaveLength(21); // conservées, jamais distribuées ni exposées
  });
});
