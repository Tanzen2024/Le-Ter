import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { MAX_CHAT_MESSAGE_LENGTH, type ChatMessageEvent } from '../../../src/domain/chat/chat';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { PostgresChatRepository } from '../../../src/repositories/postgres-chat.repository';
import { ChatService } from '../../../src/services/chat/chat.service';
import { InMemoryChatEventHub } from '../../../src/websocket/chat-event-bus';
import { createLogger } from '../../../src/utils/logger';
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
import { testRules } from '../../fixtures/rules';

/**
 * Chat de partie (D-045) en HTTP : GET/POST /api/games/:gameId/chat/messages, sur une
 * base PostgreSQL réelle (PGlite) et l'application assemblée comme en production.
 */
jest.setTimeout(30_000);

let database: TestDatabase;
let ctx: GameApiTestContext;
let bus: InMemoryChatEventHub;
let chat: ChatService;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  bus = new InMemoryChatEventHub();
  chat = new ChatService({
    repository: new PostgresChatRepository(database.sql),
    bus,
    logger: createLogger({}, () => undefined),
    // Anti-spam neutralisé, sauf dans son propre test.
    rateLimit: { max: 1_000, windowMs: 10_000 },
  });
  ctx = createGameApiTestApp(database.sql, {
    rules: testRules,
    random: identityRandom,
    decisionWindowMs: 60_000,
    turnDurationMs: 60_000,
    chat,
  });
});
afterEach(async () => {
  await ctx.stopTimers();
  await database.reset();
});

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  const api = as(ctx.app, session.accessToken);
  const me = await expectStatus(api.get('/api/auth/me'), 200);
  return {
    ...session,
    id: session.userId as PlayerId,
    username: me.body.user.username as string,
    api,
  };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

/** Partie réelle : `owner` la crée, les autres la rejoignent par le parcours normal. */
async function gameWith(owner: Player, ...others: Player[]): Promise<GameId> {
  const res = await expectStatus(owner.api.post('/api/sessions', { maxPlayers: 4 }), 201);
  const gameId = res.body.game.gameId as GameId;
  for (const p of others) {
    await expectStatus(enterGame(p.api, database.sql, gameId), 200);
  }
  return gameId;
}

const chatPath = (gameId: string) => `/api/games/${gameId}/chat/messages`;

function send(p: Player, gameId: string, body: object, key: string = randomUUID()) {
  return request(ctx.app)
    .post(chatPath(gameId))
    .set('Authorization', `Bearer ${p.accessToken}`)
    .set('Idempotency-Key', key)
    .send(body);
}

const history = (p: Player, gameId: string, query = '') => p.api.get(`${chatPath(gameId)}${query}`);

function capture(gameId: GameId): ChatMessageEvent[] {
  const events: ChatMessageEvent[] = [];
  bus.subscribe(gameId, (e) => events.push(e));
  return events;
}

describe('Chat de partie : authentification et autorisation', () => {
  it('exige une authentification (401) pour lire comme pour envoyer', async () => {
    const A = await newPlayer();
    const gameId = await gameWith(A);
    await request(ctx.app).get(chatPath(gameId)).expect(401);
    await request(ctx.app)
      .post(chatPath(gameId))
      .set('Idempotency-Key', randomUUID())
      .send({ content: 'salut' })
      .expect(401);
    await request(ctx.app)
      .get(chatPath(gameId))
      .set('Authorization', 'Bearer pas.un.jeton')
      .expect(401);
  });

  it('autorise les joueurs de la partie, refuse un utilisateur extérieur (403)', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);

    await expectStatus(send(A, gameId, { content: 'Bonjour B' }), 201);
    await expectStatus(history(B, gameId), 200);

    const read = await expectStatus(history(C, gameId), 403);
    expect(read.body.code).toBe('NOT_A_MEMBER');
    const write = await expectStatus(send(C, gameId, { content: 'intrus' }), 403);
    expect(write.body.code).toBe('NOT_A_MEMBER');
    // Rien n'a été enregistré pour l'intrus.
    const { rows } = await database.sql.query(
      'SELECT 1 FROM game_chat_messages WHERE sender_id = $1',
      [C.id],
    );
    expect(rows).toHaveLength(0);
  });

  it('gameId invalide : 400 ; partie inexistante : 404', async () => {
    const A = await newPlayer();
    await expectStatus(history(A, 'pas-un-uuid'), 400);
    const missing = await expectStatus(history(A, randomUUID()), 404);
    expect(missing.body.code).toBe('GAME_NOT_FOUND');
  });
});

describe('Chat de partie : envoi', () => {
  it('enregistre le message en base, pour cette partie, au nom du titulaire du JWT', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);

    const res = await expectStatus(
      send(A, gameId, {
        content: '  Bonne chance !  ',
        // Champs d'identité forgés : ignorés, l'expéditeur est celui du jeton.
        senderId: B.id,
        senderDisplayName: B.username,
        userId: B.id,
        gameId: randomUUID(),
        id: randomUUID(),
      }),
      201,
    );
    const message = res.body.message;
    expect(message).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      gameId,
      senderId: A.id,
      senderDisplayName: A.username,
      content: 'Bonne chance !',
      createdAt: expect.any(String),
    });

    const { rows } = await database.sql.query<{
      game_id: string;
      sender_id: string;
      content: string;
    }>('SELECT game_id, sender_id, content FROM game_chat_messages WHERE id = $1', [message.id]);
    expect(rows).toEqual([{ game_id: gameId, sender_id: A.id, content: 'Bonne chance !' }]);
  });

  it('refuse un message vide ou fait seulement d’espaces (400)', async () => {
    const A = await newPlayer();
    const gameId = await gameWith(A);
    for (const content of ['', '   ', '\n\t ', undefined, 42, { text: 'x' }]) {
      const res = await expectStatus(send(A, gameId, { content }), 400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.fields.content).toBeDefined();
    }
  });

  it('refuse un message trop long, accepte la limite exacte', async () => {
    const A = await newPlayer();
    const gameId = await gameWith(A);
    await expectStatus(send(A, gameId, { content: 'é'.repeat(MAX_CHAT_MESSAGE_LENGTH) }), 201);
    const tooLong = await expectStatus(
      send(A, gameId, { content: 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1) }),
      400,
    );
    expect(tooLong.body.fields.content).toContain(String(MAX_CHAT_MESSAGE_LENGTH));
  });

  it('refuse un corps démesuré (413) et les caractères de contrôle (400)', async () => {
    const A = await newPlayer();
    const gameId = await gameWith(A);
    await expectStatus(send(A, gameId, { content: 'x'.repeat(64 * 1024) }), 413);
    await expectStatus(send(A, gameId, { content: 'nul\u0000byte' }), 400);
  });

  it('exige une clé d’envoi (Idempotency-Key)', async () => {
    const A = await newPlayer();
    const gameId = await gameWith(A);
    const res = await request(ctx.app)
      .post(chatPath(gameId))
      .set('Authorization', `Bearer ${A.accessToken}`)
      .send({ content: 'sans clé' });
    expect(res.status).toBe(400);
  });

  it('double envoi (même clé) : un seul message, une seule diffusion', async () => {
    const A = await newPlayer();
    const gameId = await gameWith(A);
    const events = capture(gameId);
    const key = randomUUID();

    const [first, second] = await Promise.all([
      send(A, gameId, { content: 'une fois' }, key),
      send(A, gameId, { content: 'une fois' }, key),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.message.id).toBe(second.body.message.id);
    const replay = await expectStatus(send(A, gameId, { content: 'une fois' }, key), 200);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    const { rows } = await database.sql.query('SELECT 1 FROM game_chat_messages');
    expect(rows).toHaveLength(1);
    expect(events).toHaveLength(1);

    // La même clé pour un autre contenu est refusée.
    const reused = await expectStatus(send(A, gameId, { content: 'autre' }, key), 422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('le contenu reste du texte brut : HTML/script stocké et renvoyé tel quel, en JSON', async () => {
    const A = await newPlayer();
    const gameId = await gameWith(A);
    const payload = `<script>alert("x")</script><img src=x onerror=alert(1)> **gras** '; DROP TABLE games; --`;
    const res = await expectStatus(send(A, gameId, { content: payload }), 201);
    expect(res.body.message.content).toBe(payload);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");

    const list = await expectStatus(history(A, gameId), 200);
    expect(list.body.messages[0].content).toBe(payload);
    // L'injection SQL n'a eu aucun effet : la partie existe toujours.
    await expectStatus(A.api.get(`/api/games/${gameId}`), 200);
  });

  it('anti-spam : au-delà de la limite, 429 sans rien enregistrer', async () => {
    const limited = new ChatService({
      repository: new PostgresChatRepository(database.sql),
      bus,
      logger: createLogger({}, () => undefined),
      rateLimit: { max: 2, windowMs: 60_000 },
    });
    ctx = createGameApiTestApp(database.sql, { rules: testRules, chat: limited });
    const A = await newPlayer();
    const gameId = await gameWith(A);
    await expectStatus(send(A, gameId, { content: '1' }), 201);
    await expectStatus(send(A, gameId, { content: '2' }), 201);
    const res = await expectStatus(send(A, gameId, { content: '3' }), 429);
    expect(res.body.code).toBe('RATE_LIMITED');
    const { rows } = await database.sql.query('SELECT 1 FROM game_chat_messages');
    expect(rows).toHaveLength(2);
  });
});

describe('Chat de partie : historique et pagination', () => {
  async function seed(p: Player, gameId: GameId, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 1; i <= count; i += 1) {
      ids.push((await expectStatus(send(p, gameId, { content: `m${i}` }), 201)).body.message.id);
    }
    return ids;
  }

  it('dernière page par défaut, puis pages plus anciennes avec `before`', async () => {
    const A = await newPlayer();
    const gameId = await gameWith(A);
    await seed(A, gameId, 7);

    const last = await expectStatus(history(A, gameId, '?limit=3'), 200);
    expect(last.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'm5',
      'm6',
      'm7',
    ]);
    expect(last.body.hasMore).toBe(true);
    expect(last.body.canSend).toBe(true);
    expect(last.body.maxMessageLength).toBe(MAX_CHAT_MESSAGE_LENGTH);

    const older = await expectStatus(
      history(A, gameId, `?limit=3&before=${last.body.messages[0].id}`),
      200,
    );
    expect(older.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'm2',
      'm3',
      'm4',
    ]);
    const oldest = await expectStatus(
      history(A, gameId, `?limit=3&before=${older.body.messages[0].id}`),
      200,
    );
    expect(oldest.body.messages.map((m: { content: string }) => m.content)).toEqual(['m1']);
    expect(oldest.body.hasMore).toBe(false);
  });

  it('rattrapage avec `after` : seulement les messages manqués, dans l’ordre', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);
    const ids = await seed(A, gameId, 3);
    await seed(B, gameId, 2);

    const missed = await expectStatus(history(A, gameId, `?after=${ids[2]}`), 200);
    expect(missed.body.messages.map((m: { content: string }) => m.content)).toEqual(['m1', 'm2']);
    expect(missed.body.messages.every((m: { senderId: string }) => m.senderId === B.id)).toBe(true);
    expect(missed.body.hasMore).toBe(false);
  });

  it('valide la pagination (limite, curseur inconnu, curseur d’une autre partie)', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const gameA = await gameWith(A);
    const gameB = await gameWith(B, C);
    const [foreign] = await seed(B, gameB, 1);

    await expectStatus(history(A, gameA, '?limit=0'), 400);
    await expectStatus(history(A, gameA, '?limit=51'), 400);
    await expectStatus(history(A, gameA, '?before=abc'), 400);
    await expectStatus(history(A, gameA, `?before=${randomUUID()}&after=${randomUUID()}`), 400);
    // Un identifiant de message d'une autre partie ne révèle rien : 400, pas sa page.
    await expectStatus(history(A, gameA, `?after=${foreign}`), 400);
  });
});

describe('Chat de partie : isolation par gameId', () => {
  it('deux parties ne partagent ni historique ni diffusion', async () => {
    const [A, B, C, D] = [
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
    ];
    const game1 = await gameWith(A, B);
    const game2 = await gameWith(C, D);
    const events1 = capture(game1);
    const events2 = capture(game2);

    await expectStatus(send(A, game1, { content: 'secret de la partie 1' }), 201);
    await expectStatus(send(C, game2, { content: 'secret de la partie 2' }), 201);

    const h1 = await expectStatus(history(B, game1), 200);
    const h2 = await expectStatus(history(D, game2), 200);
    expect(h1.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'secret de la partie 1',
    ]);
    expect(h2.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'secret de la partie 2',
    ]);
    expect(events1.map((e) => e.gameId)).toEqual([game1]);
    expect(events2.map((e) => e.gameId)).toEqual([game2]);

    // Un joueur de la partie 1 ne lit ni n'écrit dans la partie 2.
    await expectStatus(history(A, game2), 403);
    await expectStatus(send(A, game2, { content: 'fuite' }), 403);
  });
});

describe('Chat de partie : diffusion', () => {
  it('diffuse exactement le message enregistré, une fois, après écriture', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);
    const events: ChatMessageEvent[] = [];
    const storedAtPublish: Promise<number>[] = [];
    bus.subscribe(gameId, (event) => {
      events.push(event);
      // Au moment de la diffusion, le message est déjà en base.
      storedAtPublish.push(
        database.sql
          .query('SELECT 1 FROM game_chat_messages WHERE id = $1', [event.message.id])
          .then((r) => r.rows.length),
      );
    });

    const res = await expectStatus(send(B, gameId, { content: 'gg' }), 201);
    expect(await Promise.all(storedAtPublish)).toEqual([1]);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('chat:message');
    expect(events[0]?.gameId).toBe(gameId);
    expect({
      ...events[0]?.message,
      createdAt: events[0]?.message.createdAt.toISOString(),
    }).toEqual(res.body.message);
  });

  it('une panne de diffusion ne fait pas échouer un envoi déjà enregistré', async () => {
    const A = await newPlayer();
    const gameId = await gameWith(A);
    bus.publish = () => {
      throw new Error('diffusion indisponible');
    };
    await expectStatus(send(A, gameId, { content: 'toujours enregistré' }), 201);
    const list = await expectStatus(history(A, gameId), 200);
    expect(list.body.messages).toHaveLength(1);
  });
});

describe('Chat de partie : partie terminée', () => {
  it('historique lisible par les joueurs, envoi refusé (409 CHAT_CLOSED)', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const gameId = await gameWith(A, B);
    await expectStatus(send(A, gameId, { content: 'avant la fin' }), 201);
    const key = randomUUID();
    await expectStatus(send(B, gameId, { content: 'envoyé juste avant' }, key), 201);

    await ctx.games.finishGame(gameId);

    const list = await expectStatus(history(B, gameId), 200);
    expect(list.body.canSend).toBe(false);
    expect(list.body.messages).toHaveLength(2);

    const closed = await expectStatus(send(A, gameId, { content: 'après la fin' }), 409);
    expect(closed.body.code).toBe('CHAT_CLOSED');
    // Un renvoi d'un message déjà enregistré reste reconnu (aucun doublon, aucune erreur).
    await expectStatus(send(B, gameId, { content: 'envoyé juste avant' }, key), 200);
    // Un extérieur reste refusé, même partie terminée.
    await expectStatus(history(C, gameId), 403);
  });
});
