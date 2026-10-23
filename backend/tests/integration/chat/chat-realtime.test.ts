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
import { login, registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
  enterGame,
  expectStatus,
  type GameApiTestContext,
} from '../../fixtures/game-api';
import { InMemoryUserEventHub } from '../../../src/websocket/user-event-bus';
import type { UserId } from '../../../src/domain/users/user';
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
/** Journaux de la passerelle (une entrée JSON par ligne). */
let gatewayLogs: Record<string, unknown>[] = [];
/** Fermetures journalisées, quand la passerelle a fini de les écrire. */
async function closeLogs(count: number): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < 40; i += 1) {
    const closes = gatewayLogs.filter((l) => l.message === 'realtime connection closed');
    if (closes.length >= count) return closes;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return gatewayLogs.filter((l) => l.message === 'realtime connection closed');
}
let ctx: GameApiTestContext;
let bus: InMemoryChatEventHub;
let userEvents: InMemoryUserEventHub;
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
  gatewayLogs = [];
  userEvents = new InMemoryUserEventHub();
  gateway = attachRealtimeGateway(server, {
    auth: ctx.auth,
    chat,
    games: ctx.games,
    userEvents,
    logger: createLogger({}, (line) => gatewayLogs.push(JSON.parse(line) as Record<string, unknown>)),
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

/**
 * Signal personnel de fin de tournoi (D-106) : chaque connexion n'est abonnée qu'à l'identité
 * de SON jeton ; le signal ne contient que le type et le tournoi.
 */
describe('WebSocket : signaux personnels (D-106)', () => {
  it('seul le destinataire reçoit ; désabonné à la fermeture', async () => {
    const ana = await newPlayer();
    const ben = await newPlayer();
    const anaClient = await connect(ana);
    const benClient = await connect(ben);
    userEvents.publish({
      type: 'notification',
      userId: ana.id as string as UserId,
      notificationType: 'TOURNAMENT_RESULTS_AVAILABLE',
      tournamentId: 't-1',
    });
    expect(await anaClient.next((f) => f.type === 'notification')).toEqual({
      type: 'notification',
      notificationType: 'TOURNAMENT_RESULTS_AVAILABLE',
      tournamentId: 't-1',
    });
    await settle();
    expect(benClient.frames.filter((f) => f.type === 'notification')).toEqual([]);
    anaClient.close();
    await anaClient.closed;
    await settle();
    expect(userEvents.subscriberCount(ana.id as string as UserId)).toBe(0);
  });
});

/**
 * Suivi de partie (D-101) : dès que le serveur ACCEPTE une carte, tous les joueurs abonnés
 * reçoivent `game:changed` (nouvelle version), sans attendre l'échéance du tour (60 s ici) ni la
 * relecture périodique. Seuls `gameId` et `version` sont transmis.
 */
describe('WebSocket : suivi de partie (carte acceptée → tour terminé partout)', () => {
  async function started(owner: Player, guest: Player): Promise<{ gameId: GameId; version: number }> {
    const gameId = await gameWith(owner, guest);
    const res = await expectStatus(owner.api.post(`/api/games/${gameId}/start`), 200);
    return { gameId, version: res.body.game.version as number };
  }

  /** Carte du joueur attendu, choisie parmi celles que le SERVEUR autorise. */
  async function playFirstCard(p: Player, gameId: GameId) {
    const view = await expectStatus(p.api.get(`/api/games/${gameId}`), 200);
    const cardId = (view.body.game.myActions.playableCardIds as string[])[0];
    return p.api.post(`/api/games/${gameId}/actions`, {
      commandId: randomUUID(),
      type: 'PLAY_CARD',
      payload: { cardId },
    });
  }

  function subscribeGame(client: TestClient, gameId: string): Promise<Frame> {
    client.send({ type: 'game:subscribe', gameId });
    return client.next(
      (f) => (f.type === 'game:subscribed' || f.type === 'error') && f.gameId === gameId,
    );
  }

  it('carte acceptée : game:changed aussitôt chez l’adversaire, ancien tour remplacé par le serveur', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const { gameId } = await started(A, B);
    const first = await expectStatus(A.api.get(`/api/games/${gameId}`), 200);
    const leader = first.body.game.activePlayerId === A.id ? A : B;
    const follower = leader === A ? B : A;
    const watcher = await connect(follower);
    expect((await subscribeGame(watcher, gameId)).type).toBe('game:subscribed');

    const playedAt = Date.now();
    const played = await expectStatus(playFirstCard(leader, gameId), 200);
    const version = played.body.game.version as number;
    // Échéance du tour : 60 s ; le signal arrive sans l'attendre.
    const changed = await watcher.next((f) => f.type === 'game:changed', 2_000);
    expect(Date.now() - playedAt).toBeLessThan(2_000);
    expect(changed).toEqual({ type: 'game:changed', gameId, version });

    // État officiel relu par le suiveur : le tour du meneur est terminé, le sien commence.
    const view = await expectStatus(follower.api.get(`/api/games/${gameId}`), 200);
    expect(view.body.game.version).toBe(version);
    expect(view.body.game.activePlayerId).toBe(follower.id);
    expect(Date.parse(view.body.game.turnStartedAt as string)).toBeGreaterThanOrEqual(
      Date.parse(first.body.game.turnStartedAt as string),
    );
    expect(view.body.game.turnDeadlineAt).not.toBe(first.body.game.turnDeadlineAt);
  });

  it('carte refusée par le serveur : aucun signal, le tour reste celui du joueur attendu', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const { gameId, version } = await started(A, B);
    const first = await expectStatus(A.api.get(`/api/games/${gameId}`), 200);
    const leader = first.body.game.activePlayerId === A.id ? A : B;
    const follower = leader === A ? B : A;
    const watcher = await connect(leader);
    await subscribeGame(watcher, gameId);

    // Ce n'est pas son tour : refus, rien n'est diffusé.
    const refused = await playFirstCard(follower, gameId);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    await settle();
    expect(watcher.frames.filter((f) => f.type === 'game:changed')).toEqual([]);
    const view = await expectStatus(leader.api.get(`/api/games/${gameId}`), 200);
    expect(view.body.game).toMatchObject({
      version,
      activePlayerId: leader.id,
      turnDeadlineAt: first.body.game.turnDeadlineAt,
    });
  });

  it('double abonnement : une seule trame par version ; jamais de contenu d’événement', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const { gameId } = await started(A, B);
    const first = await expectStatus(A.api.get(`/api/games/${gameId}`), 200);
    const leader = first.body.game.activePlayerId === A.id ? A : B;
    const follower = leader === A ? B : A;
    const watcher = await connect(follower);
    await subscribeGame(watcher, gameId);
    await subscribeGame(watcher, gameId);

    await expectStatus(playFirstCard(leader, gameId), 200);
    await watcher.next((f) => f.type === 'game:changed');
    await settle();
    const changes = watcher.frames.filter((f) => f.type === 'game:changed');
    expect(changes).toEqual([]);
    expect(JSON.stringify(watcher.frames)).not.toMatch(/cardId|myHand|payload/);
  });

  it('non membre : refusé ; deux parties ne partagent jamais leurs signaux', async () => {
    const [A, B, C, D] = [await newPlayer(), await newPlayer(), await newPlayer(), await newPlayer()];
    const one = await started(A, B);
    const two = await started(C, D);
    const intruder = await connect(C);
    const refused = await subscribeGame(intruder, one.gameId);
    expect(refused).toMatchObject({ type: 'error', gameId: one.gameId, channel: 'game' });
    expect(await subscribeGame(intruder, two.gameId)).toMatchObject({ type: 'game:subscribed' });

    const view = await expectStatus(A.api.get(`/api/games/${one.gameId}`), 200);
    const leader = view.body.game.activePlayerId === A.id ? A : B;
    await expectStatus(playFirstCard(leader, one.gameId), 200);
    await settle();
    expect(intruder.frames.filter((f) => f.type === 'game:changed')).toEqual([]);
  });
});

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

  it('ferme (4401) la connexion d’une session révoquée ; le jeton renouvelé se reconnecte', async () => {
    const A = await newPlayer();
    // R-32 : une connexion ailleurs révoque la session de l'ancien jeton.
    const other = await login(ctx.app, A.email, A.password);
    const stale = await TestClient.open(url);
    clients.push(stale);
    stale.send({ type: 'auth', token: A.accessToken });
    expect((await stale.next((f) => f.type === 'error')).code).toBe('UNAUTHENTICATED');
    expect((await stale.closed).code).toBe(WS_CLOSE.unauthenticated);

    const renewed = await request(ctx.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: other.refreshToken })
      .expect(200);
    await connect({ ...A, accessToken: renewed.body.accessToken as string });
  });

  it('base indisponible pendant l’authentification : 1013 (réessayer), pas 4401', async () => {
    const A = await newPlayer();
    const spy = jest
      .spyOn(ctx.auth, 'authenticate')
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
    const client = await TestClient.open(url);
    clients.push(client);
    client.send({ type: 'auth', token: A.accessToken });
    const error = await client.next((f) => f.type === 'error');
    expect(error.code).toBe('SERVICE_TEMPORARILY_UNAVAILABLE');
    expect((await client.closed).code).toBe(WS_CLOSE.tryAgainLater);
    spy.mockRestore();
    // Le même jeton, toujours valide, est accepté dès que la base répond.
    await connect(A);
  });

  it('refuse un chemin autre que /ws et une trame trop volumineuse', async () => {
    await expect(TestClient.open(url.replace(REALTIME_PATH, '/autre'))).rejects.toThrow();
    const A = await newPlayer();
    const client = await connect(A);
    client.send({ type: 'ping', padding: 'x'.repeat(16 * 1024) });
    expect((await client.closed).code).toBe(1009);
  });
});

describe('WebSocket : fermetures et journaux', () => {
  it('arrêt du serveur : fermeture annoncée 1001 (pas une coupure 1006)', async () => {
    const A = await newPlayer();
    const client = await connect(A);
    await gateway.close();
    expect((await client.closed).code).toBe(WS_CLOSE.goingAway);
    const [log] = await closeLogs(1);
    expect(log).toMatchObject({
      level: 'info',
      code: WS_CLOSE.goingAway,
      category: 'server_shutdown',
      authenticated: true,
      playerId: A.id,
    });
  });

  it('chaque fermeture est classée ; jamais de jeton dans les journaux', async () => {
    const A = await newPlayer();
    const refused = await TestClient.open(url);
    clients.push(refused);
    refused.send({ type: 'auth', token: 'a.b.c' });
    await refused.closed;
    const normal = await connect(A);
    normal.ws.close(1000);
    await normal.closed;
    const lost = await connect(A);
    lost.ws.terminate(); // Perte du transport : aucune trame de fermeture.
    await lost.closed;

    const closes = await closeLogs(3);
    expect(closes.map((l) => [l.code, l.category])).toEqual([
      [WS_CLOSE.unauthenticated, 'auth_rejected'],
      [1000, 'normal'],
      [1006, 'transport_lost'],
    ]);
    const text = JSON.stringify(gatewayLogs);
    expect(text).not.toContain(A.accessToken);
    expect(text).not.toContain('a.b.c');
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

/**
 * Chat PENDANT la partie (`in_progress`) : le statut d'une partie démarrée ne bloque ni
 * l'envoi, ni la diffusion, ni l'abonnement. Seuls ses joueurs écrivent et reçoivent.
 */
describe('Chat pendant une partie en cours', () => {
  async function startedTable(count: number) {
    const players: Player[] = [];
    for (let i = 0; i < count; i += 1) players.push(await newPlayer());
    const [owner, ...others] = players as [Player, ...Player[]];
    const gameId = await gameWith(owner, ...others);
    const started = await expectStatus(owner.api.post(`/api/games/${gameId}/start`), 200);
    expect(started.body.game.status).toBe('in_progress');
    const sockets: TestClient[] = [];
    for (const p of players) {
      const client = await connect(p);
      expect((await client.subscribe(gameId)).type).toBe('chat:subscribed');
      sockets.push(client);
    }
    return { players, sockets, gameId };
  }

  const contentOf = (f: Frame) => (f.message as { content: string }).content;
  const received = (client: TestClient, content: string) =>
    client.next((f) => f.type === 'chat:message' && contentOf(f) === content);

  it('un joueur envoie ; lui et l’autre joueur le reçoivent ; un extérieur ne reçoit rien', async () => {
    const { players, sockets, gameId } = await startedTable(2);
    const [A, B] = players as [Player, Player];
    const outsider = await connect(await newPlayer());
    expect(await outsider.subscribe(gameId)).toMatchObject({ type: 'error', code: 'NOT_A_MEMBER' });

    const sent = await expectStatus(post(A, gameId, 'Bonjour'), 201);
    expect(sent.body.message).toMatchObject({ gameId, senderId: A.id, content: 'Bonjour' });
    for (const client of sockets) {
      expect((await received(client, 'Bonjour')).message).toEqual(sent.body.message);
    }

    await expectStatus(post(B, gameId, 'Salut'), 201);
    expect(contentOf(await received(sockets[0] as TestClient, 'Salut'))).toBe('Salut');

    await settle();
    expect(outsider.frames.filter((f) => f.type === 'chat:message')).toEqual([]);
  });

  it('un extérieur ne peut pas écrire dans la partie en cours (HTTP et WebSocket)', async () => {
    const { sockets, gameId } = await startedTable(2);
    const intruder = await newPlayer();
    const res = await expectStatus(post(intruder, gameId, 'intrus'), 403);
    expect(res.body.code).toBe('NOT_A_MEMBER');
    const client = await connect(intruder);
    client.send({ type: 'chat:send', gameId, clientMessageId: randomUUID(), content: 'intrus' });
    expect(await client.next((f) => f.type === 'error')).toMatchObject({ code: 'NOT_A_MEMBER' });

    await settle();
    expect(sockets.flatMap((c) => c.frames).filter((f) => f.type === 'chat:message')).toEqual([]);
    const { rows } = await database.sql.query(
      'SELECT 1 FROM game_chat_messages WHERE game_id = $1',
      [gameId],
    );
    expect(rows).toHaveLength(0);
  });

  it('4 joueurs : A → B → C → D → A, chacun reçoit tous les messages', async () => {
    const { players, sockets, gameId } = await startedTable(4);
    for (const [i, p] of players.entries()) {
      await expectStatus(post(p, gameId, `message ${i}`), 201);
      for (const client of sockets) await received(client, `message ${i}`);
    }
    const history = await expectStatus(
      players[3]!.api.get(`/api/games/${gameId}/chat/messages`),
      200,
    );
    expect(history.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'message 0',
      'message 1',
      'message 2',
      'message 3',
    ]);
  });

  it('deux messages envoyés en rafale : aucun n’est perdu', async () => {
    const { players, sockets, gameId } = await startedTable(2);
    const [A] = players as [Player];
    await Promise.all([
      expectStatus(post(A, gameId, 'un'), 201),
      expectStatus(post(A, gameId, 'deux'), 201),
    ]);
    await received(sockets[1] as TestClient, 'un');
    await received(sockets[1] as TestClient, 'deux');
    const history = await expectStatus(A.api.get(`/api/games/${gameId}/chat/messages`), 200);
    expect(history.body.messages.map((m: { content: string }) => m.content).sort()).toEqual([
      'deux',
      'un',
    ]);
  });

  it('reconnexion : les messages manqués sont rattrapés par l’historique', async () => {
    const { players, sockets, gameId } = await startedTable(2);
    const [A, B] = players as [Player, Player];
    await expectStatus(post(A, gameId, 'avant'), 201);
    const before = await received(sockets[1] as TestClient, 'avant');
    sockets[1]!.close();

    await expectStatus(post(A, gameId, 'pendant la coupure'), 201);

    const back = await connect(B);
    expect((await back.subscribe(gameId)).type).toBe('chat:subscribed');
    const lastSeen = (before.message as { id: string }).id;
    const missed = await expectStatus(
      B.api.get(`/api/games/${gameId}/chat/messages?after=${lastSeen}`),
      200,
    );
    expect(missed.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'pendant la coupure',
    ]);
    expect(missed.body.canSend).toBe(true);
  });

  it('le chat continue sans réabonnement quand la partie passe de waiting à in_progress', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);
    const watcher = await connect(B);
    expect((await watcher.subscribe(gameId)).type).toBe('chat:subscribed');

    await expectStatus(post(A, gameId, 'en attente'), 201);
    await received(watcher, 'en attente');
    await expectStatus(A.api.post(`/api/games/${gameId}/start`), 200);
    await expectStatus(post(A, gameId, 'en cours'), 201);
    await received(watcher, 'en cours');
    expect(watcher.frames.filter((f) => f.type === 'chat:subscribed')).toEqual([]);
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
