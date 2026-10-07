import { randomUUID } from 'node:crypto';

import type { CardId } from '../../../src/domain/cards/card';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { SessionId } from '../../../src/domain/sessions/session';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
  expectStatus,
  type GameApiTestContext,
} from '../../fixtures/game-api';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { deckForHands, decksRandom } from '../../fixtures/random';

/**
 * Socle de vérité (D-035), par l'API : victoire instantanée automatique, égalité de
 * priorité → reprise IMMÉDIATE dans la même session (sans Poursuivre/Quitter, même J1,
 * mêmes sièges, nouveau mélange), fuite (le joueur garde sa session et son siège).
 * Configuration de production (règles officielles) ; seuls les paquets sont imposés.
 */
jest.setTimeout(30_000);

let database: TestDatabase;
let ctx: GameApiTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
afterEach(async () => {
  await ctx?.stopTimers();
  await database.reset();
});

// Mains imposées (5 cartes chacune).
const RANK_2: CardId[] = ['COEUR-3', 'COEUR-4', 'COEUR-5', 'PIQUE-3', 'PIQUE-4'];
const RANK_5_A: CardId[] = ['COEUR-9', 'PIQUE-9', 'TREFLE-9', 'COEUR-10', 'TREFLE-10'];
const RANK_5_B: CardId[] = ['COEUR-8', 'PIQUE-8', 'TREFLE-8', 'COEUR-6', 'PIQUE-6'];
const NOTHING_A: CardId[] = ['COEUR-7', 'PIQUE-9', 'TREFLE-10', 'ETOILE-4', 'COEUR-8'];
const NOTHING_B: CardId[] = ['COEUR-10', 'PIQUE-7', 'TREFLE-9', 'ETOILE-5', 'PIQUE-8'];
const NOTHING_C: CardId[] = ['COEUR-9', 'PIQUE-5', 'TREFLE-8', 'ETOILE-10', 'TREFLE-6'];

const TIE = deckForHands([RANK_5_A, RANK_5_B]);
const NORMAL = deckForHands([NOTHING_A, NOTHING_B]);

type Player = Awaited<ReturnType<typeof newPlayer>>;

async function newPlayer() {
  const s = await registerAndLogin(ctx.app);
  return { ...s, id: s.userId as PlayerId, api: as(ctx.app, s.accessToken) };
}

/** Session de 2 (ou plus) places, tous dans la partie 1, démarrée par A (J1 = A). */
async function startedSession(decks: CardId[][], size = 2, maxPlayers = size) {
  ctx = createGameApiTestApp(database.sql, {
    random: decksRandom(...decks),
    decisionWindowMs: 60_000,
    turnDurationMs: 60_000,
  });
  const players: Player[] = [];
  for (let i = 0; i < size; i++) players.push(await newPlayer());
  const [A] = players as [Player];
  const created = await expectStatus(A.api.post('/api/sessions', { maxPlayers }), 201);
  const sessionId = created.body.session.sessionId as SessionId;
  const gameId = created.body.game.gameId as GameId;
  for (const p of players.slice(1)) {
    await expectStatus(p.api.post(`/api/sessions/${sessionId}/join`), 200);
    await expectStatus(p.api.post(`/api/games/${gameId}/join`), 200);
  }
  await expectStatus(A.api.post(`/api/games/${gameId}/start`), 200);
  await ctx.sessions.idle(); // la reprise est déclenchée en arrière-plan par la fin de partie
  return { players, sessionId, gameId };
}

const sessionView = async (p: Player, sessionId: string) =>
  (await expectStatus(p.api.get(`/api/sessions/${sessionId}`), 200)).body.session;
const history = async (p: Player, sessionId: string) =>
  (await expectStatus(p.api.get(`/api/sessions/${sessionId}/games`), 200)).body.games as {
    gameId: string;
    status: string;
    firstPlayerId: string;
    winnerId?: string;
  }[];

describe('Égalité de priorité → reprise immédiate (décisions 17, 23)', () => {
  it('même session, mêmes joueurs, mêmes sièges, même J1, nouvelle donne, sans Poursuivre/Quitter', async () => {
    const { players, sessionId, gameId } = await startedSession([TIE, NORMAL]);
    const [A, B] = players as [Player, Player];

    const tied = (await expectStatus(A.api.get(`/api/games/${gameId}`), 200)).body.game;
    expect(tied).toMatchObject({
      status: 'finished',
      endReason: 'INSTANT_WIN_TIE',
      instantWinTie: { rank: 5, playerIds: [A.id, B.id] },
    });
    expect(tied).not.toHaveProperty('result');

    const session = await sessionView(A, sessionId);
    expect(session.decision).toBeNull(); // aucune ronde Poursuivre/Quitter
    expect(session.seats.map((s: { playerId: string }) => s.playerId)).toEqual([A.id, B.id]);
    const replayId = session.currentGame.gameId as string;
    expect(replayId).not.toBe(gameId);

    const replay = (await expectStatus(B.api.get(`/api/games/${replayId}`), 200)).body.game;
    expect(replay).toMatchObject({
      status: 'in_progress',
      sessionId,
      firstPlayerId: A.id,
      replayOfGameId: gameId,
    });
    expect(replay.play.dealOrder).toEqual([A.id, B.id]);
    expect(replay.play.myHand.sort()).toEqual([...NOTHING_B].sort()); // remélangé, redistribué
    expect(replay.play.dealSequence.map((b: { count: number }) => b.count).join('')).toBe('3322');

    const games = await history(A, sessionId);
    expect(games.map((g) => g.gameId)).toEqual([gameId, replayId]);
    const rounds = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM session_decision_rounds WHERE session_id = $1',
      [sessionId],
    );
    expect(rounds.rows[0]?.n).toBe(0);
  });

  it('égalités successives : reprises répétées jusqu’à une donne sans égalité', async () => {
    const { players, sessionId, gameId } = await startedSession([TIE, TIE, TIE, NORMAL]);
    const [A] = players as [Player];
    const games = await history(A, sessionId);
    expect(games).toHaveLength(4);
    expect(games.slice(0, 3).every((g) => g.status === 'finished')).toBe(true);
    expect(games[3]?.status).toBe('in_progress');
    expect(games.every((g) => g.firstPlayerId === A.id)).toBe(true);
    const chain = await database.sql.query<{ id: string; replay_of_game_id: string | null }>(
      'SELECT id, replay_of_game_id FROM games WHERE session_id = $1 ORDER BY created_at, id',
      [sessionId],
    );
    expect(chain.rows[0]).toEqual({ id: gameId, replay_of_game_id: null });
    for (let i = 1; i < 4; i++) {
      expect(chain.rows[i]?.replay_of_game_id).toBe(chain.rows[i - 1]?.id);
    }
  });

  it('J1 de la partie annulée reste J1, même quand ce n’est pas le créateur', async () => {
    // Partie 1 normale gagnée par B (instantanée automatique : rang 2 contre rang 5) ;
    // partie 2 (J1 = B) : égalité ; reprise : J1 = B.
    const { players, sessionId } = await startedSession([
      deckForHands([RANK_5_A, RANK_2]),
      deckForHands([RANK_5_A, RANK_5_B]),
      NORMAL,
    ]);
    const [A, B] = players as [Player, Player];
    for (const p of [A, B]) {
      await expectStatus(
        p.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }),
        200,
      );
    }
    const game2 = (await expectStatus(A.api.post(`/api/sessions/${sessionId}/games`, {}), 201)).body
      .game;
    expect(game2.firstPlayerId).toBe(B.id);
    await expectStatus(B.api.post(`/api/games/${game2.gameId}/join`), 200);
    await expectStatus(A.api.post(`/api/games/${game2.gameId}/start`), 200);
    await ctx.sessions.idle();

    const games = await history(A, sessionId);
    expect(games).toHaveLength(3);
    expect(games[2]).toMatchObject({ status: 'in_progress', firstPlayerId: B.id });
  });

  it('reprise après redémarrage : une égalité non rejouée est reprise par le superviseur, une seule fois', async () => {
    const { players, sessionId, gameId } = await startedSession([TIE, NORMAL]);
    const [A] = players as [Player];
    // Simule un arrêt avant la reprise : on retire la partie de reprise.
    const replayId = (await sessionView(A, sessionId)).currentGame.gameId;
    await database.sql.query('DELETE FROM game_players WHERE game_id = $1', [replayId]);
    await database.sql.query('DELETE FROM games WHERE id = $1', [replayId]);

    const report = await Promise.all([ctx.supervisor.recover(), ctx.supervisor.recover()]);
    await ctx.sessions.idle();
    expect(report.reduce((n, r) => n + r.decisionsProcessed, 0)).toBeGreaterThanOrEqual(1);
    const replays = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM games WHERE replay_of_game_id = $1',
      [gameId],
    );
    expect(replays.rows[0]?.n).toBe(1);
    expect((await sessionView(A, sessionId)).currentGame.status).toBe('in_progress');
  });

  it('concurrence : deux reprises simultanées de la même égalité → une seule partie', async () => {
    const { players, sessionId, gameId } = await startedSession([TIE, NORMAL, NORMAL]);
    const [A] = players as [Player];
    const replayId = (await sessionView(A, sessionId)).currentGame.gameId;
    await database.sql.query('DELETE FROM game_players WHERE game_id = $1', [replayId]);
    await database.sql.query('DELETE FROM games WHERE id = $1', [replayId]);

    await Promise.all([
      ctx.sessions.syncSession(sessionId),
      ctx.sessions.syncSession(sessionId),
      ctx.sessions.syncSession(sessionId),
    ]);
    const replays = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM games WHERE replay_of_game_id = $1',
      [gameId],
    );
    expect(replays.rows[0]?.n).toBe(1);
  });
});

describe('Victoire instantanée automatique (rangs différents)', () => {
  it('le meilleur rang gagne au démarrage ; victoire simple ; ronde Poursuivre/Quitter ouverte', async () => {
    const { players, sessionId, gameId } = await startedSession([deckForHands([RANK_5_A, RANK_2])]);
    const [A, B] = players as [Player, Player];
    const game = (await expectStatus(A.api.get(`/api/games/${gameId}`), 200)).body.game;
    expect(game).toMatchObject({ status: 'finished', endReason: 'INSTANT_WIN' });
    expect(game.result).toMatchObject({
      winnerId: B.id,
      instantWinRank: 2,
      automatic: true,
      victoryType: 'SIMPLE',
    });
    expect((await sessionView(A, sessionId)).decision).toMatchObject({ open: true, gameId });
  });
});

describe('Fuir (D-035)', () => {
  it('le fuyard reste dans la session, à son siège, et peut jouer la partie suivante', async () => {
    const { players, sessionId, gameId } = await startedSession(
      [deckForHands([NOTHING_A, NOTHING_B, NOTHING_C])],
      3,
    );
    const [A, B, C] = players as [Player, Player, Player];
    const before = await sessionView(A, sessionId);

    const view = (await expectStatus(C.api.get(`/api/games/${gameId}`), 200)).body.game;
    expect(view.myActions.canFlee).toBe(true);
    const fled = await expectStatus(
      C.api.post(`/api/games/${gameId}/actions`, {
        commandId: randomUUID(),
        type: 'FLEE',
        payload: {},
      }),
      200,
    );
    expect(fled.body.game.myActions).toMatchObject({ canFlee: false, canPlayCard: false });
    expect(
      fled.body.game.players.find((p: { playerId: string }) => p.playerId === C.id).fledAt,
    ).toEqual(expect.any(String));

    const second = await B.api.post(`/api/games/${gameId}/actions`, {
      commandId: randomUUID(),
      type: 'FLEE',
      payload: {},
    });
    expect(second.status).toBe(422);
    expect(second.body.code).toBe('FLEE_NOT_ALLOWED');

    const after = await sessionView(A, sessionId);
    expect(after.seats).toEqual(before.seats); // C garde son siège
    expect(after.players.find((p: { playerId: string }) => p.playerId === C.id).active).toBe(true);
  });
});
