import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { PostgresChatRepository } from '../../../src/repositories/postgres-chat.repository';
import { ChatService } from '../../../src/services/chat/chat.service';
import { createLogger } from '../../../src/utils/logger';
import { InMemoryChatEventHub } from '../../../src/websocket/chat-event-bus';
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
 * Historique du chat à l'échelle de la TABLE (D-149) : de l'ouverture de la table à sa
 * fermeture, chaque partie de la session affiche les messages des parties précédentes. Un
 * message appartient toujours à sa partie ; entre deux parties, le chat est en lecture seule.
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
    autoNextGame: true,
    chat: new ChatService({
      repository: new PostgresChatRepository(database.sql),
      bus: new InMemoryChatEventHub(),
      logger: createLogger({}, () => undefined),
      rateLimit: { max: 1_000, windowMs: 10_000 },
    }),
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

/** Distribution « identité » à 2 : la partie se termine en 8 cartes (cf. continue-next-game). */
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

async function startedTable() {
  const [A, B] = [await newPlayer(), await newPlayer()];
  const created = await expectStatus(A.api.post('/api/sessions', { maxPlayers: 2 }), 201);
  const sessionId = created.body.session.sessionId as string;
  const gameId = created.body.game.gameId as string;
  await expectStatus(B.api.post(`/api/sessions/${sessionId}/join`), 200);
  await expectStatus(B.api.post(`/api/games/${gameId}/join`), 200);
  await expectStatus(A.api.post(`/api/games/${gameId}/start`), 200);
  return { A, B, sessionId, gameId };
}

async function playToEnd(A: Player, B: Player, gameId: string) {
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
}

/** La partie suivante est créée après la clôture de la ronde Poursuivre/Quitter. */
async function nextGame(A: Player, B: Player, sessionId: string, previous: string) {
  await expectStatus(A.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }), 200);
  await expectStatus(B.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }), 200);
  const until = Date.now() + 5_000;
  for (;;) {
    const session = (await expectStatus(A.api.get(`/api/sessions/${sessionId}`), 200)).body.session;
    const current = session.currentGame as { gameId: string } | null;
    if (current && current.gameId !== previous) return current.gameId;
    if (Date.now() > until) throw new Error('partie suivante non créée');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const send = (p: Player, gameId: string, content: string) =>
  request(ctx.app)
    .post(`/api/games/${gameId}/chat/messages`)
    .set('Authorization', `Bearer ${p.accessToken}`)
    .set('Idempotency-Key', randomUUID())
    .send({ content });
const history = (p: Player, gameId: string, query = '') =>
  expectStatus(p.api.get(`/api/games/${gameId}/chat/messages${query}`), 200);
const contents = (res: { body: { messages: { content: string }[] } }) =>
  res.body.messages.map((m) => m.content);

describe('Chat : historique de la table (D-149)', () => {
  it('la partie suivante de la même table affiche les messages des parties précédentes', async () => {
    const { A, B, sessionId, gameId } = await startedTable();
    await expectStatus(send(A, gameId, 'bonne chance'), 201);
    await expectStatus(send(B, gameId, 'merci'), 201);
    await playToEnd(A, B, gameId);

    // Entre deux parties : historique lisible, envoi refusé (lecture seule).
    const between = await history(A, gameId);
    expect(between.body.canSend).toBe(false);
    expect((await expectStatus(send(A, gameId, 'trop tard'), 409)).body.code).toBe('CHAT_CLOSED');

    const second = await nextGame(A, B, sessionId, gameId);
    await expectStatus(send(B, second, 'revanche'), 201);

    for (const p of [A, B]) {
      const res = await history(p, second);
      expect(contents(res)).toEqual(['bonne chance', 'merci', 'revanche']);
      expect(res.body.canSend).toBe(true);
    }
    // Chaque message garde sa partie d'origine.
    const res = await history(A, second);
    expect(res.body.messages.map((m: { gameId: string }) => m.gameId)).toEqual([
      gameId,
      gameId,
      second,
    ]);
  });

  it('pagination et rattrapage traversent les parties de la table', async () => {
    const { A, B, sessionId, gameId } = await startedTable();
    const first = await expectStatus(send(A, gameId, 'partie 1'), 201);
    await playToEnd(A, B, gameId);
    const second = await nextGame(A, B, sessionId, gameId);
    const latest = await expectStatus(send(B, second, 'partie 2'), 201);

    const older = await history(A, second, `?before=${latest.body.message.id}`);
    expect(contents(older)).toEqual(['partie 1']);
    const missed = await history(A, second, `?after=${first.body.message.id}`);
    expect(contents(missed)).toEqual(['partie 2']);
  });

  it('une autre table ne voit rien de cette table', async () => {
    const one = await startedTable();
    const other = await startedTable();
    await expectStatus(send(one.A, one.gameId, 'table 1'), 201);
    await expectStatus(send(other.A, other.gameId, 'table 2'), 201);

    expect(contents(await history(other.B, other.gameId))).toEqual(['table 2']);
    // Curseur d'une autre table : refusé, rien ne fuit.
    const message = (await history(one.A, one.gameId)).body.messages[0].id as string;
    await expectStatus(other.B.api.get(`/api/games/${other.gameId}/chat/messages?after=${message}`), 400);
    // Un joueur d'une autre table n'a aucun accès.
    await expectStatus(other.B.api.get(`/api/games/${one.gameId}/chat/messages`), 403);
  });
});
