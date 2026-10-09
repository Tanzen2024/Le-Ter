import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import request from 'supertest';
import { WebSocket } from 'ws';

import type { ChatMessageEvent } from '../../../src/domain/chat/chat';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { PostgresChatRepository } from '../../../src/repositories/postgres-chat.repository';
import { ChatService } from '../../../src/services/chat/chat.service';
import { createLogger } from '../../../src/utils/logger';
import { InMemoryChatEventHub, PubSubChatEventBus } from '../../../src/websocket/chat-event-bus';
import {
  attachRealtimeGateway,
  REALTIME_PATH,
  WS_CLOSE,
  type RealtimeGateway,
} from '../../../src/websocket/realtime-gateway';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
  enterGame,
  expectStatus,
  type GameApiTestContext,
} from '../../fixtures/game-api';
import { flushPubSub, InMemoryPubSubBroker } from '../../fixtures/in-memory-pubsub';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { identityRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

/**
 * Temps réel du chat (D-045) : passerelle WebSocket (`ws`) sur un vrai serveur HTTP, avec
 * de vrais clients WebSocket, et diffusion inter-instances sur un Redis Pub/Sub simulé.
 */
jest.setTimeout(30_000);

type Frame = Record<string, unknown> & { type: string };

/** Client WebSocket de test : garde toutes les trames reçues, attend celles voulues. */
class TestClient {
  readonly frames: Frame[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private waiters: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.frames.push(JSON.parse(String(data)) as Frame);
      this.waiters.forEach((w) => w());
    });
    this.closed = new Promise((resolve) =>
      ws.on('close', (code, reason) => resolve({ code, reason: String(reason) })),
    );
  }

  static open(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new TestClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  static async authenticated(url: string, token: string): Promise<TestClient> {
    const client = await TestClient.open(url);
    client.send({ type: 'auth', token });
    await client.next((f) => f.type === 'ready');
    return client;
  }

  send(frame: object): void {
    this.ws.send(JSON.stringify(frame));
  }

  /** Prochaine trame (déjà reçue ou à venir) qui satisfait le prédicat. */
  next(predicate: (f: Frame) => boolean, timeoutMs = 3_000): Promise<Frame> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const index = this.frames.findIndex(predicate);
        if (index >= 0) {
          const [frame] = this.frames.splice(index, 1);
          this.waiters = this.waiters.filter((w) => w !== check);
          clearTimeout(timer);
          resolve(frame as Frame);
        }
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== check);
        reject(new Error(`trame attendue non reçue ; reçues : ${JSON.stringify(this.frames)}`));
      }, timeoutMs);
      this.waiters.push(check);
      check();
    });
  }

  async subscribe(gameId: string): Promise<Frame> {
    this.send({ type: 'chat:subscribe', gameId });
    return this.next(
      (f) => (f.type === 'chat:subscribed' || f.type === 'error') && f.gameId === gameId,
    );
  }

  messages(): Frame[] {
    return this.frames.filter((f) => f.type === 'chat:message');
  }

  close(): void {
    this.ws.close();
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

let database: TestDatabase;
let ctx: GameApiTestContext;
let bus: InMemoryChatEventHub;
let server: Server;
let gateway: RealtimeGateway;
let url: string;
const clients: TestClient[] = [];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

beforeEach(async () => {
  bus = new InMemoryChatEventHub();
  const chat = new ChatService({
    repository: new PostgresChatRepository(database.sql),
    bus,
    logger: createLogger({}, () => undefined),
    rateLimit: { max: 1_000, windowMs: 10_000 },
  });
  ctx = createGameApiTestApp(database.sql, {
    rules: testRules,
    random: identityRandom,
    decisionWindowMs: 60_000,
    turnDurationMs: 60_000,
    chat,
  });
  server = ctx.app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  gateway = attachRealtimeGateway(server, {
    auth: ctx.auth,
    chat,
    logger: createLogger({}, () => undefined),
  });
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${REALTIME_PATH}`;
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await gateway.close();
  await new Promise((resolve) => server.close(resolve));
  await ctx.stopTimers();
  await database.reset();
});

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  return { ...session, id: session.userId as PlayerId, api: as(ctx.app, session.accessToken) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

async function gameWith(owner: Player, ...others: Player[]): Promise<GameId> {
  const res = await expectStatus(owner.api.post('/api/sessions', { maxPlayers: 4 }), 201);
  const gameId = res.body.game.gameId as GameId;
  for (const p of others) {
    await expectStatus(enterGame(p.api, database.sql, gameId), 200);
  }
  return gameId;
}

async function connect(p: Player): Promise<TestClient> {
  const client = await TestClient.authenticated(url, p.accessToken);
  clients.push(client);
  return client;
}

function post(p: Player, gameId: string, content: string, key = randomUUID()) {
  return request(ctx.app)
    .post(`/api/games/${gameId}/chat/messages`)
    .set('Authorization', `Bearer ${p.accessToken}`)
    .set('Idempotency-Key', key)
    .send({ content });
}

describe('WebSocket : authentification', () => {
  it('ferme (4401) une connexion qui agit sans s’authentifier', async () => {
    const client = await TestClient.open(url);
    clients.push(client);
    client.send({ type: 'chat:subscribe', gameId: randomUUID() });
    const error = await client.next((f) => f.type === 'error');
    expect(error.code).toBe('UNAUTHENTICATED');
    expect((await client.closed).code).toBe(WS_CLOSE.unauthenticated);
  });

  it('ferme (4401) une connexion au jeton invalide', async () => {
    const client = await TestClient.open(url);
    clients.push(client);
    client.send({ type: 'auth', token: 'a.b.c' });
    expect((await client.closed).code).toBe(WS_CLOSE.unauthenticated);
  });

  it('refuse un chemin autre que /ws et une trame trop volumineuse', async () => {
    await expect(TestClient.open(url.replace(REALTIME_PATH, '/autre'))).rejects.toThrow();
    const A = await newPlayer();
    const client = await connect(A);
    client.send({ type: 'ping', padding: 'x'.repeat(16 * 1024) });
    expect((await client.closed).code).toBe(1009);
  });
});

describe('WebSocket : abonnement au chat d’une partie', () => {
  it('un joueur abonné reçoit le message enregistré, avec son gameId', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);
    const clientB = await connect(B);
    expect((await clientB.subscribe(gameId)).type).toBe('chat:subscribed');

    const sent = await expectStatus(post(A, gameId, 'salut B'), 201);
    const received = await clientB.next((f) => f.type === 'chat:message');
    expect(received).toEqual({ type: 'chat:message', gameId, message: sent.body.message });
  });

  it("un utilisateur extérieur ne peut pas s'abonner et ne reçoit rien", async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);
    const outsider = await connect(C);
    const refused = await outsider.subscribe(gameId);
    expect(refused).toMatchObject({ type: 'error', code: 'NOT_A_MEMBER', gameId });
    expect(bus.subscriberCount(gameId)).toBe(0);

    await expectStatus(post(A, gameId, 'privé'), 201);
    await settle();
    expect(outsider.messages()).toHaveLength(0);
  });

  it('salles isolées : un abonné de la partie 1 ne reçoit rien de la partie 2', async () => {
    const [A, B, C, D] = [
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
    ];
    const game1 = await gameWith(A, B);
    const game2 = await gameWith(C, D);
    const clientB = await connect(B);
    const clientD = await connect(D);
    await clientB.subscribe(game1);
    await clientD.subscribe(game2);

    await expectStatus(post(A, game1, 'pour la partie 1'), 201);
    await expectStatus(post(C, game2, 'pour la partie 2'), 201);
    await clientB.next((f) => f.type === 'chat:message');
    await clientD.next((f) => f.type === 'chat:message');
    await settle();
    expect(clientB.messages()).toHaveLength(0);
    expect(clientD.messages()).toHaveLength(0);
  });

  it('un double abonnement ne double pas les messages', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);
    const clientB = await connect(B);
    await clientB.subscribe(gameId);
    await clientB.subscribe(gameId);
    expect(bus.subscriberCount(gameId)).toBe(1);

    await expectStatus(post(A, gameId, 'une seule fois'), 201);
    await clientB.next((f) => f.type === 'chat:message');
    await settle();
    expect(clientB.messages()).toHaveLength(0);
  });

  it('reconnexion : réabonnement + rattrapage `after`, sans doublon', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);
    let clientB = await connect(B);
    await clientB.subscribe(gameId);
    const first = await expectStatus(post(A, gameId, 'avant la coupure'), 201);
    await clientB.next((f) => f.type === 'chat:message');

    clientB.close();
    await clientB.closed;
    await settle();
    expect(bus.subscriberCount(gameId)).toBe(0);
    await expectStatus(post(A, gameId, 'pendant la coupure'), 201);

    clientB = await connect(B);
    await clientB.subscribe(gameId);
    const missed = await expectStatus(
      B.api.get(`/api/games/${gameId}/chat/messages?after=${first.body.message.id}`),
      200,
    );
    expect(missed.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'pendant la coupure',
    ]);
    await expectStatus(post(A, gameId, 'après la reconnexion'), 201);
    const live = await clientB.next((f) => f.type === 'chat:message');
    expect((live.message as { content: string }).content).toBe('après la reconnexion');
  });
});

describe('WebSocket : envoi', () => {
  it('chat:send → accusé à l’expéditeur, diffusion aux joueurs, identité du jeton', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);
    const clientA = await connect(A);
    const clientB = await connect(B);
    await clientA.subscribe(gameId);
    await clientB.subscribe(gameId);

    const clientMessageId = randomUUID();
    clientA.send({
      type: 'chat:send',
      gameId,
      clientMessageId,
      content: ' <b>bonjour</b> ',
      senderId: B.id,
    });
    const ack = await clientA.next((f) => f.type === 'chat:ack');
    expect(ack).toMatchObject({ gameId, clientMessageId });
    const message = ack.message as { senderId: string; content: string };
    expect(message.senderId).toBe(A.id);
    expect(message.content).toBe('<b>bonjour</b>');

    // Expéditeur et autres joueurs reçoivent le MÊME message confirmé par le serveur.
    expect((await clientB.next((f) => f.type === 'chat:message')).message).toEqual(ack.message);
    expect((await clientA.next((f) => f.type === 'chat:message')).message).toEqual(ack.message);

    // Renvoi de la même clé (coupure avant l'accusé) : même message, aucune diffusion de plus.
    clientA.send({ type: 'chat:send', gameId, clientMessageId, content: '<b>bonjour</b>' });
    expect((await clientA.next((f) => f.type === 'chat:ack')).message).toEqual(ack.message);
    await settle();
    expect(clientB.messages()).toHaveLength(0);
    const { rows } = await database.sql.query('SELECT 1 FROM game_chat_messages');
    expect(rows).toHaveLength(1);
  });

  it('chat:send refusé pour un extérieur, un message vide, une partie terminée', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);
    const clientA = await connect(A);
    const outsider = await connect(C);

    outsider.send({ type: 'chat:send', gameId, clientMessageId: randomUUID(), content: 'x' });
    expect(await outsider.next((f) => f.type === 'error')).toMatchObject({ code: 'NOT_A_MEMBER' });

    clientA.send({ type: 'chat:send', gameId, clientMessageId: randomUUID(), content: '   ' });
    expect(await clientA.next((f) => f.type === 'error')).toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    await ctx.games.finishGame(gameId);
    clientA.send({ type: 'chat:send', gameId, clientMessageId: randomUUID(), content: 'fin' });
    expect(await clientA.next((f) => f.type === 'error')).toMatchObject({ code: 'CHAT_CLOSED' });
    // Lecture toujours possible : l'abonnement reste accepté pour un joueur.
    expect((await clientA.subscribe(gameId)).type).toBe('chat:subscribed');
  });
});

describe('Diffusion inter-instances (Redis Pub/Sub simulé)', () => {
  const logger = createLogger({}, () => undefined);
  const gameA = randomUUID() as GameId;
  const gameB = randomUUID() as GameId;
  const event = (gameId: GameId, content: string): ChatMessageEvent => ({
    type: 'chat:message',
    gameId,
    message: {
      id: randomUUID() as never,
      gameId,
      senderId: randomUUID() as PlayerId,
      senderDisplayName: 'joueur',
      content,
      createdAt: new Date('2026-10-08T10:00:00Z'),
    },
  });

  it('publie dans le canal du chat de la partie et livre sur l’autre instance', async () => {
    const broker = new InMemoryPubSubBroker();
    const instance1 = new PubSubChatEventBus(broker.connect(), logger);
    const instance2 = new PubSubChatEventBus(broker.connect(), logger);
    const received: ChatMessageEvent[] = [];
    instance2.subscribe(gameA, (e) => received.push(e));
    await flushPubSub();

    instance1.publish(event(gameA, 'bonjour'));
    instance1.publish(event(gameB, 'autre partie'));
    await flushPubSub();

    expect(broker.published.map((p) => p.channel)).toEqual([
      `le-ter:game:${gameA}:chat`,
      `le-ter:game:${gameB}:chat`,
    ]);
    expect(received.map((e) => e.message.content)).toEqual(['bonjour']);
    expect(received[0]?.message.createdAt).toBeInstanceOf(Date);
  });

  it('ignore un message forgé pour une autre partie sur le canal', async () => {
    const broker = new InMemoryPubSubBroker();
    const instance = new PubSubChatEventBus(broker.connect(), logger);
    const received: ChatMessageEvent[] = [];
    instance.subscribe(gameA, (e) => received.push(e));
    await flushPubSub();
    broker.inject(`le-ter:game:${gameA}:chat`, JSON.stringify(event(gameB, 'forgé')));
    broker.inject(`le-ter:game:${gameA}:chat`, 'pas du json');
    expect(received).toHaveLength(0);
  });

  it('Redis indisponible : livraison locale, sans erreur', async () => {
    const broker = new InMemoryPubSubBroker();
    const instance = new PubSubChatEventBus(broker.connect(), logger, 60_000);
    const received: ChatMessageEvent[] = [];
    instance.subscribe(gameA, (e) => received.push(e));
    await flushPubSub();
    broker.down = true;
    expect(() => instance.publish(event(gameA, 'local'))).not.toThrow();
    await flushPubSub();
    expect(received.map((e) => e.message.content)).toEqual(['local']);
  });
});
