import { randomUUID } from 'node:crypto';

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
import { identityRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

/**
 * « Poursuivre » enchaîne directement la partie suivante (D-042) : dès la clôture de la
 * ronde, le serveur crée la nouvelle partie de la MÊME session avec les joueurs restés, J1
 * selon les règles existantes, et la distribue (3 + 2, sens antihoraire). Aucune autre
 * action n'est demandée. Fin de partie : chaque carte jouée n'apparaît qu'une fois.
 */
jest.setTimeout(30_000);

let database: TestDatabase;
let ctx: GameApiTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  ctx = createGameApiTestApp(database.sql, {
    rules: testRules,
    random: identityRandom,
    decisionWindowMs: 60_000,
    turnDurationMs: 60_000,
    autoNextGame: true, // comportement de production
  });
});
afterEach(async () => {
  await ctx.stopTimers();
  await ctx.sessions.idle();
  await database.reset();
});

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  return { ...session, id: session.userId, api: as(ctx.app, session.accessToken) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

/** Distribution « identité » à 2 : B prend le contrôle au 1er tour et le garde (gagne). */
const SECOND_WINS: [0 | 1, string][] = [
  [0, 'COEUR-3'],
  [1, 'COEUR-6'],
  [1, 'PIQUE-3'],
  [0, 'COEUR-9'],
  [1, 'PIQUE-4'],
  [0, 'COEUR-10'],
  [1, 'COEUR-7'],
  [0, 'COEUR-4'],
];

async function finishedGame() {
  const [A, B] = [await newPlayer(), await newPlayer()];
  const created = await expectStatus(A.api.post('/api/sessions', { maxPlayers: 2 }), 201);
  const sessionId = created.body.session.sessionId as string;
  const gameId = created.body.game.gameId as string;
  await expectStatus(B.api.post(`/api/sessions/${sessionId}/join`), 200);
  await expectStatus(B.api.post(`/api/games/${gameId}/join`), 200);
  await expectStatus(A.api.post(`/api/games/${gameId}/start`), 200);
  for (const [who, cardId] of SECOND_WINS) {
    await expectStatus(
      (who === 0 ? A : B).api.post(`/api/games/${gameId}/actions`, {
        commandId: randomUUID(),
        type: 'PLAY_CARD',
        payload: { cardId },
      }),
      200,
    );
  }
  return { A, B, sessionId, gameId };
}

const sessionOf = async (p: Player, sessionId: string) =>
  (await expectStatus(p.api.get(`/api/sessions/${sessionId}`), 200)).body.session;
const decide = (p: Player, sessionId: string, choice: 'continue' | 'leave') =>
  p.api.post(`/api/sessions/${sessionId}/decision`, { choice });

/** La création de la partie suivante est asynchrone (après la clôture de la ronde). */
async function nextGameOf(p: Player, sessionId: string, previous: string) {
  const until = Date.now() + 5_000;
  for (;;) {
    const current = (await sessionOf(p, sessionId)).currentGame;
    if (current && current.gameId !== previous) return current as { gameId: string };
    if (Date.now() > until) throw new Error('partie suivante non créée');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Fin de partie : une carte jouée n’a qu’une place', () => {
  it('après le 5e tour, currentTrick est vide et aucune carte n’apparaît deux fois', async () => {
    const { A, gameId } = await finishedGame();
    const game = (await expectStatus(A.api.get(`/api/games/${gameId}`), 200)).body.game;

    expect(game.status).toBe('finished');
    expect(game.play.currentTrick).toEqual([]);
    const played = game.play.completedTricks.flatMap((t: { plays: { cardId: string }[] }) =>
      t.plays.map((p) => p.cardId),
    );
    expect(played).toHaveLength(10);
    expect(new Set(played).size).toBe(10);
  });
});

describe('Poursuivre → partie suivante directement (D-042)', () => {
  it('tous poursuivent : nouvelle partie de la même session, distribuée, J1 = gagnant', async () => {
    const { A, B, sessionId, gameId } = await finishedGame();
    await expectStatus(decide(A, sessionId, 'continue'), 200);
    await expectStatus(decide(B, sessionId, 'continue'), 200);

    const next = await nextGameOf(A, sessionId, gameId);
    const viewA = (await expectStatus(A.api.get(`/api/games/${next.gameId}`), 200)).body.game;
    const viewB = (await expectStatus(B.api.get(`/api/games/${next.gameId}`), 200)).body.game;

    expect(viewA.sessionId).toBe(sessionId); // pas de nouvelle session
    expect(viewA.status).toBe('in_progress'); // déjà distribuée, aucune action requise
    expect(viewA.firstPlayerId).toBe(B.id); // J1 = gagnant présent (D-033)
    expect(viewA.play.dealSequence).toEqual([
      { pass: 1, playerId: B.id, count: 3 },
      { pass: 1, playerId: A.id, count: 3 },
      { pass: 2, playerId: B.id, count: 2 },
      { pass: 2, playerId: A.id, count: 2 },
    ]);
    expect(viewA.play.myHand).toHaveLength(5);
    expect(viewB.play.myHand).toHaveLength(5);
    expect(viewA.play.completedTricks).toEqual([]); // rien de l'ancienne partie
    expect(viewA.play.currentTrick).toEqual([]);

    const history = (await expectStatus(A.api.get(`/api/sessions/${sessionId}/games`), 200)).body
      .games;
    expect(history.map((g: { gameId: string }) => g.gameId)).toEqual([gameId, next.gameId]);
  });

  it('double clic et déclencheurs multiples : une seule nouvelle partie', async () => {
    const { A, B, sessionId, gameId } = await finishedGame();
    const [first, second] = await Promise.all([
      decide(A, sessionId, 'continue'),
      decide(A, sessionId, 'continue'),
    ]);
    expect([first.status, second.status]).toContain(200);
    await expectStatus(decide(B, sessionId, 'continue'), 200);
    const next = await nextGameOf(A, sessionId, gameId);
    await Promise.all([ctx.sessions.syncSession(sessionId as never), ctx.sessions.idle()]);

    const history = (await expectStatus(A.api.get(`/api/sessions/${sessionId}/games`), 200)).body
      .games;
    expect(history.map((g: { gameId: string }) => g.gameId)).toEqual([gameId, next.gameId]);
  });

  it('un joueur quitte : la partie suivante attend avec ceux qui poursuivent (règles inchangées)', async () => {
    const { A, B, sessionId, gameId } = await finishedGame();
    await expectStatus(decide(A, sessionId, 'continue'), 200);
    await expectStatus(decide(B, sessionId, 'leave'), 200);

    const next = await nextGameOf(A, sessionId, gameId);
    const view = (await expectStatus(A.api.get(`/api/games/${next.gameId}`), 200)).body.game;
    expect(view.status).toBe('waiting'); // moins de 2 joueurs : pas de distribution (R-23)
    expect(view.players.map((p: { playerId: string }) => p.playerId)).toEqual([A.id]);
    expect(view.firstPlayerId).toBe(A.id); // gagnant parti : J1 suivant présent
  });
});
