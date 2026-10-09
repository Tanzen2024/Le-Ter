import { randomUUID } from 'node:crypto';

import {
  lastTrickPresentationMs,
  LAST_TRICK_CARD_GAP_MS,
  LAST_TRICK_CARD_PRESENTATION_MS,
  LAST_TRICK_PRESENTATION_MARGIN_MS,
} from '../../../src/domain/sessions/session';
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
 * 5e tour automatique (D-035, D-041) : le serveur joue les dernières cartes en une fois, dans
 * l'ordre du tour ; les écrans les présentent une par une. La ronde Poursuivre/Quitter
 * (10 s, D-034) ne commence qu'après cette présentation.
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
    decisionWindowMs: 10_000,
    turnDurationMs: 60_000,
    lastTrickPresentationMs, // rythme réel des écrans
  });
});
afterEach(async () => {
  await ctx.stopTimers();
  await database.reset();
});

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  return { ...session, id: session.userId, api: as(ctx.app, session.accessToken) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

const play = (p: Player, gameId: string, cardId: string) =>
  expectStatus(
    p.api.post(`/api/games/${gameId}/actions`, {
      commandId: randomUUID(),
      type: 'PLAY_CARD',
      payload: { cardId },
    }),
    200,
  );

/** Distribution « identité » à 2 : J2 prend le contrôle au 1er tour et le garde (gagne). */
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

describe('Présentation du 5e tour (D-041)', () => {
  it('durée : marge + 3,2 s par carte + 2 s entre deux cartes', () => {
    expect(lastTrickPresentationMs(0)).toBe(0);
    expect(lastTrickPresentationMs(1)).toBe(
      LAST_TRICK_PRESENTATION_MARGIN_MS + LAST_TRICK_CARD_PRESENTATION_MS,
    );
    expect(lastTrickPresentationMs(4)).toBe(
      LAST_TRICK_PRESENTATION_MARGIN_MS +
        4 * LAST_TRICK_CARD_PRESENTATION_MS +
        3 * LAST_TRICK_CARD_GAP_MS,
    );
  });

  it('5e tour joué par le serveur dans l’ordre du tour ; ronde = fin + présentation + 10 s', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const created = await expectStatus(A.api.post('/api/sessions', { maxPlayers: 2 }), 201);
    const sessionId = created.body.session.sessionId as string;
    const gameId = created.body.game.gameId as string;
    await expectStatus(B.api.post(`/api/sessions/${sessionId}/join`), 200);
    await expectStatus(B.api.post(`/api/games/${gameId}/join`), 200);
    await expectStatus(A.api.post(`/api/games/${gameId}/start`), 200);
    for (const [who, card] of SECOND_WINS) await play(who === 0 ? A : B, gameId, card);

    const game = (await expectStatus(A.api.get(`/api/games/${gameId}`), 200)).body.game;
    expect(game.status).toBe('finished');
    // Une carte par joueur actif, dans l'ordre du tour : le contrôleur (B) mène.
    expect(game.play.completedTricks[4]).toMatchObject({
      number: 5,
      plays: [
        { playerId: B.id, cardId: 'COEUR-8' },
        { playerId: A.id, cardId: 'COEUR-5' },
      ],
    });

    const session = (await expectStatus(A.api.get(`/api/sessions/${sessionId}`), 200)).body.session;
    const finishedAt = new Date(game.finishedAt).getTime();
    expect(new Date(session.decision.deadlineAt).getTime() - finishedAt).toBe(
      lastTrickPresentationMs(2) + 10_000,
    );
    expect(session.decision.open).toBe(true);
  });
});
