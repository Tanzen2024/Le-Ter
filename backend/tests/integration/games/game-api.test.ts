import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import request from 'supertest';

import type { GameEvent } from '../../../src/domain/game/game-events';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { createApp } from '../../../src/app';
import { silentLogger } from '../../../src/utils/logger';
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

// Suites HTTP complètes (inscription, connexion, PGlite) lancées en parallèle : 5 s ne
// suffisent pas toujours sous charge.
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

/** Un utilisateur connecté et ses requêtes authentifiées. */
async function player() {
  const session = await registerAndLogin(ctx.app);
  return { ...session, api: as(ctx.app, session.accessToken) };
}

async function createGame(owner: Awaited<ReturnType<typeof player>>, body: object = {}) {
  const res = await owner.api.post('/api/games', { maxPlayers: 2, ...body }).expect(201);
  return res.body.game as { gameId: GameId; version: number; sessionId: string };
}

const action = (type: string, payload: object = {}, extra: object = {}) => ({
  commandId: randomUUID(),
  type,
  payload,
  ...extra,
});

describe('Routes /api/games — authentification et validation', () => {
  beforeEach(() => {
    ctx = createGameApiTestApp(database.sql);
  });

  it('toutes les routes exigent un access token (401)', async () => {
    const id = randomUUID();
    const calls = [
      request(ctx.app).post('/api/games').send({ maxPlayers: 2 }),
      request(ctx.app).get('/api/games/me/active'),
      request(ctx.app).get(`/api/games/${id}`),
      request(ctx.app).post(`/api/games/${id}/join`),
      request(ctx.app).post(`/api/games/${id}/actions`).send(action('FLEE')),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    }
  });

  it('un gameId invalide est refusé (400) avant tout accès au service', async () => {
    const alice = await player();
    for (const id of ['abc', randomUUID().toUpperCase(), '1 OR 1=1']) {
      const res = await alice.api.get(`/api/games/${encodeURIComponent(id)}`).expect(400);
      expect(res.body.fields).toHaveProperty('gameId');
    }
  });

  it.each([
    [{}, 'maxPlayers'],
    [{ maxPlayers: 1 }, 'maxPlayers'],
    [{ maxPlayers: 5 }, 'maxPlayers'],
    [{ maxPlayers: '4' }, 'maxPlayers'],
    [{ maxPlayers: 2, stakeAmount: -1 }, 'stakeAmount'],
    [{ maxPlayers: 2, stakeAmount: 1.5 }, 'stakeAmount'],
  ])('création refusée pour %j', async (body, field) => {
    const alice = await player();
    const res = await alice.api.post('/api/games', body).expect(400);
    expect(res.body.fields).toHaveProperty(field);
  });

  it.each([
    [{ type: 'FLEE', payload: {} }, 'commandId'],
    [{ ...action('FLEE'), commandId: 'pas-un-uuid' }, 'commandId'],
    [action('START_GAME'), 'type'],
    [action('PLAY_CARD'), 'cardId'],
    [action('FLEE', {}, { expectedVersion: 0 }), 'expectedVersion'],
  ])('action refusée pour %j', async (body, field) => {
    const alice = await player();
    const game = await createGame(alice);
    const res = await alice.api.post(`/api/games/${game.gameId}/actions`, body).expect(400);
    expect(res.body.fields).toHaveProperty(field);
  });

  it('sans GameService configuré, /api/games répond 503', async () => {
    const res = await request(createApp({ logger: silentLogger })).get('/api/games/me/active');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('GAMES_UNAVAILABLE');
  });
});

describe('Créer, consulter, rejoindre', () => {
  beforeEach(() => {
    ctx = createGameApiTestApp(database.sql);
  });

  it('crée une partie dont le créateur est le joueur du JWT (champs d’identité ignorés)', async () => {
    const alice = await player();
    const bob = await player();
    const res = await alice.api
      .post('/api/games', {
        maxPlayers: 3,
        stakeAmount: 100,
        creatorId: bob.userId,
        playerId: bob.userId,
      })
      .expect(201);

    expect(res.body.game).toMatchObject({
      version: 1,
      status: 'waiting',
      creatorId: alice.userId,
      viewerId: alice.userId,
      maxPlayers: 3,
      stakeAmount: 100,
      players: [{ playerId: alice.userId, seat: 0 }],
    });
    const { rows } = await database.sql.query<{ creator_id: string }>(
      'SELECT creator_id FROM games WHERE id = $1',
      [res.body.game.gameId],
    );
    expect(rows[0]?.creator_id).toBe(alice.userId);
  });

  it('un membre lit sa partie ; un non-membre reçoit 403 ; une partie inconnue 404', async () => {
    const alice = await player();
    const mallory = await player();
    const game = await createGame(alice);

    await alice.api.get(`/api/games/${game.gameId}`).expect(200);
    const denied = await mallory.api.get(`/api/games/${game.gameId}`).expect(403);
    expect(denied.body.code).toBe('NOT_A_MEMBER');
    const missing = await alice.api.get(`/api/games/${randomUUID()}`).expect(404);
    expect(missing.body.code).toBe('GAME_NOT_FOUND');
  });

  it('rejoindre : ajoute le joueur ; rejoindre deux fois est sans effet ; partie complète → 409', async () => {
    const alice = await player();
    const bob = await player();
    const carol = await player();
    const game = await createGame(alice);

    const joined = await expectStatus(enterGame(bob.api, database.sql, game.gameId), 200);
    expect(joined.body.game).toMatchObject({ version: 2, viewerId: bob.userId });
    expect(joined.body.game.players).toHaveLength(2);

    const again = await expectStatus(enterGame(bob.api, database.sql, game.gameId), 200);
    expect(again.body.game.version).toBe(2);

    // D-034 : la capacité est celle de la SESSION (2 places ici) : la table est pleine
    // avant même que la partie le soit.
    const full = await expectStatus(enterGame(carol.api, database.sql, game.gameId), 409);
    expect(full.body.code).toBe('SESSION_FULL');
  });

  it('une partie démarrée ou terminée n’accepte plus de joueurs (409)', async () => {
    ctx = createGameApiTestApp(database.sql, { rules: testRules, random: identityRandom });
    const alice = await player();
    const bob = await player();
    const carol = await player();
    const dave = await player();
    const started = await createGame(alice, { maxPlayers: 4 });
    await expectStatus(enterGame(bob.api, database.sql, started.gameId), 200);
    await alice.api.post(`/api/games/${started.gameId}/start`).expect(200);
    // R-18 : une partie par créateur actif ; la partie terminée appartient à un autre joueur.
    const finished = await createGame(dave, { maxPlayers: 4 });
    await ctx.games.finishGame(finished.gameId);

    // Carol entre dans la SESSION (place libre) mais pas dans la partie en cours (D-034).
    const notJoinable = await expectStatus(enterGame(carol.api, database.sql, started.gameId), 409);
    expect(notJoinable.body.code).toBe('GAME_NOT_JOINABLE');
    const over = await dave.api.post(`/api/games/${finished.gameId}/join`, {}).expect(409);
    expect(over.body.code).toBe('GAME_FINISHED');
  });

  it('GET /me/active ne renvoie que les parties actives du joueur', async () => {
    const alice = await player();
    const bob = await player();
    // R-18 : une partie terminée ne bloque pas la suivante. Partie arrêtée sans gagnant : J1
    // de la suivante n'est pas défini dans cette session ; Alice choisit « Quitter » (D-034)
    // et ouvre une nouvelle session.
    const finished = await createGame(alice);
    await ctx.games.finishGame(finished.gameId);
    await alice.api
      .post(`/api/sessions/${finished.sessionId}/decision`, { choice: 'leave' })
      .expect(200);
    const mine = await createGame(alice);
    await createGame(bob);

    const res = await alice.api.get('/api/games/me/active').expect(200);
    expect(res.body.games.map((g: { gameId: string }) => g.gameId)).toEqual([mine.gameId]);
    expect(res.body.games[0].viewerId).toBe(alice.userId);
  });

  it('R-18 : déjà membre d’une partie active → 409 ALREADY_IN_ACTIVE_GAME', async () => {
    const alice = await player();
    const bob = await player();
    const bobsGame = await createGame(bob);
    await createGame(alice);

    const create = await alice.api.post('/api/games', { maxPlayers: 2 }).expect(409);
    expect(create.body.code).toBe('ALREADY_IN_ACTIVE_GAME');
    // D-034 : Alice est déjà présente dans sa propre session : elle ne peut pas entrer dans
    // celle de Bob (une seule session active par joueur).
    const join = await expectStatus(enterGame(alice.api, database.sql, bobsGame.gameId), 409);
    expect(join.body.code).toBe('ALREADY_IN_SESSION');
  });
});

describe('Actions de jeu', () => {
  /**
   * Configuration de PRODUCTION (aucune règle injectée) : les règles officielles du socle
   * (D-035) s'appliquent. Distribution « identité » : Alice a COEUR-3, 4, 5, 9, 10 (5 cartes
   * de la même famille → main gagnante de rang 3) ; Bob a COEUR-6, 7, 8, PIQUE-3, 4.
   */
  async function productionGame() {
    ctx = createGameApiTestApp(database.sql, { random: identityRandom });
    const alice = await player();
    const bob = await player();
    const game = await createGame(alice);
    await expectStatus(enterGame(bob.api, database.sql, game.gameId), 200);
    await alice.api.post(`/api/games/${game.gameId}/start`).expect(200);
    return { alice, bob, gameId: game.gameId };
  }

  it('production : règles officielles, plus de 501 RULESET ; obligation de suivre la famille', async () => {
    const { alice, bob, gameId } = await productionGame();
    await alice.api
      .post(`/api/games/${gameId}/actions`, action('PLAY_CARD', { cardId: 'COEUR-3' }))
      .expect(200);
    const bobView = (await bob.api.get(`/api/games/${gameId}`).expect(200)).body.game;
    expect(bobView.myActions.playableCardIds.sort()).toEqual(['COEUR-6', 'COEUR-7', 'COEUR-8']);
    const refused = await bob.api
      .post(`/api/games/${gameId}/actions`, action('PLAY_CARD', { cardId: 'PIQUE-3' }))
      .expect(422);
    expect(refused.body.code).toBe('CARD_NOT_PLAYABLE');
    await bob.api
      .post(`/api/games/${gameId}/actions`, action('PLAY_CARD', { cardId: 'COEUR-6' }))
      .expect(200);
  });

  it('victoire instantanée : droit visible du seul détenteur, victoire simple à la déclaration', async () => {
    const { alice, bob, gameId } = await productionGame();
    const aliceView = (await alice.api.get(`/api/games/${gameId}`)).body.game;
    const bobView = (await bob.api.get(`/api/games/${gameId}`)).body.game;
    expect(aliceView.myActions).toMatchObject({ canDeclareInstantWin: true, canPlayCard: true });
    expect(aliceView.myInstantWin).toEqual({ rank: 3, combination: 'FIVE_SAME_SUIT' });
    expect(bobView.myActions.canDeclareInstantWin).toBe(false);
    expect(bobView).not.toHaveProperty('myInstantWin');
    expect(JSON.stringify(bobView)).not.toContain('FIVE_SAME_SUIT');

    const bobTry = await bob.api.post(`/api/games/${gameId}/actions`, action('DECLARE_WIN'));
    expect(bobTry.status).toBe(422);
    expect(bobTry.body.code).toBe('NOT_A_WINNING_HAND');

    const [first, second] = await Promise.all([
      alice.api.post(`/api/games/${gameId}/actions`, action('DECLARE_WIN')),
      alice.api.post(`/api/games/${gameId}/actions`, action('DECLARE_WIN')),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const won = (await bob.api.get(`/api/games/${gameId}`)).body.game;
    expect(won).toMatchObject({ status: 'finished', endReason: 'INSTANT_WIN' });
    expect(won.result).toMatchObject({
      winnerId: alice.userId,
      instantWinRank: 3,
      victoryType: 'SIMPLE',
      automatic: false,
    });
  });

  it('le droit à la victoire instantanée disparaît après la première carte', async () => {
    const { alice, gameId } = await productionGame();
    await alice.api
      .post(`/api/games/${gameId}/actions`, action('PLAY_CARD', { cardId: 'COEUR-3' }))
      .expect(200);
    const view = (await alice.api.get(`/api/games/${gameId}`)).body.game;
    expect(view.myActions.canDeclareInstantWin).toBe(false);
    const late = await alice.api
      .post(`/api/games/${gameId}/actions`, action('DECLARE_WIN'))
      .expect(422);
    expect(late.body.code).toBe('WIN_DECLARATION_NOT_ALLOWED');
  });

  /** Partie à 2 démarrée avec la distribution « identité » : alice (1re servie) a COEUR-3… */
  async function startedGame() {
    ctx = createGameApiTestApp(database.sql, { rules: testRules, random: identityRandom });
    const alice = await player();
    const bob = await player();
    const game = await createGame(alice);
    await expectStatus(enterGame(bob.api, database.sql, game.gameId), 200);
    await alice.api.post(`/api/games/${game.gameId}/start`).expect(200);
    return { alice, bob, gameId: game.gameId };
  }

  it('jouer une carte passe par GameService : version +1, carte posée, main mise à jour', async () => {
    const { alice, gameId } = await startedGame();
    const before = await alice.api.get(`/api/games/${gameId}`).expect(200);
    expect(before.body.game.play.myHand).toContain('COEUR-3');

    const res = await alice.api
      .post(`/api/games/${gameId}/actions`, action('PLAY_CARD', { cardId: 'COEUR-3' }))
      .expect(200);
    expect(res.body.game.version).toBe(before.body.game.version + 1);
    expect(res.body.game.play.currentTrick).toEqual([
      { playerId: alice.userId, cardId: 'COEUR-3' },
    ]);
    expect(res.body.game.play.myHand).not.toContain('COEUR-3');
  });

  it('la vue d’un joueur ne contient jamais la main de l’adversaire', async () => {
    const { alice, bob, gameId } = await startedGame();
    const aliceHand: string[] = (await alice.api.get(`/api/games/${gameId}`)).body.game.play.myHand;
    const bobView = await bob.api.get(`/api/games/${gameId}`).expect(200);

    for (const card of aliceHand) {
      expect(JSON.stringify(bobView.body)).not.toContain(`"${card}"`);
    }
    expect(bobView.body.game.play).not.toHaveProperty('hands');
    expect(bobView.body.game.play.handCounts).toEqual({ [alice.userId]: 5, [bob.userId]: 5 });
  });

  it('violations des règles : 422 avec un code stable, état inchangé', async () => {
    const { alice, bob, gameId } = await startedGame();
    const notYourTurn = await bob.api
      .post(`/api/games/${gameId}/actions`, action('PLAY_CARD', { cardId: 'COEUR-4' }))
      .expect(422);
    expect(notYourTurn.body.code).toBe('NOT_YOUR_TURN');

    const notInHand = await alice.api
      .post(`/api/games/${gameId}/actions`, action('PLAY_CARD', { cardId: 'COEUR-6' }))
      .expect(422);
    expect(notInHand.body.code).toBe('CARD_NOT_IN_HAND');

    const unknownCard = await alice.api
      .post(`/api/games/${gameId}/actions`, action('PLAY_CARD', { cardId: 'PIQUE-10' }))
      .expect(422);
    expect(unknownCard.body.code).toBe('INVALID_CARD');

    expect((await alice.api.get(`/api/games/${gameId}`)).body.game.version).toBe(3);
  });

  it('une règle non tranchée reste refusée : fuite laissant un seul joueur → 501 R-30', async () => {
    const { bob, gameId } = await startedGame();
    const res = await bob.api.post(`/api/games/${gameId}/actions`, action('FLEE')).expect(501);
    expect(res.body.details).toEqual({ ruleRef: 'R-30' });
  });

  it('idempotence : le même commandId renvoyé deux fois n’est appliqué qu’une fois', async () => {
    const { alice, gameId } = await startedGame();
    const body = action('PLAY_CARD', { cardId: 'COEUR-3' });
    const first = await alice.api.post(`/api/games/${gameId}/actions`, body).expect(200);
    const retry = await alice.api.post(`/api/games/${gameId}/actions`, body).expect(200);

    expect(retry.body.game.version).toBe(first.body.game.version);
    expect(retry.body.game.play.currentTrick).toHaveLength(1);
  });

  it('concurrence optimiste : expectedVersion périmée → 409 avec la version courante', async () => {
    const { alice, gameId } = await startedGame();
    const res = await alice.api
      .post(
        `/api/games/${gameId}/actions`,
        action('PLAY_CARD', { cardId: 'COEUR-3' }, { expectedVersion: 1 }),
      )
      .expect(409);
    expect(res.body).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 3 } });
  });

  it('ANTI-USURPATION : un playerId dans le corps n’est jamais l’acteur', async () => {
    const { alice, bob, gameId } = await startedGame();
    const res = await bob.api
      .post(`/api/games/${gameId}/actions`, {
        ...action('PLAY_CARD', { cardId: 'COEUR-3', playerId: alice.userId }),
        playerId: alice.userId,
        userId: alice.userId,
      })
      .expect(422);
    // Bob agit en son nom : ce n'est pas son tour. La carte d'Alice n'est pas jouée.
    expect(res.body.code).toBe('NOT_YOUR_TURN');
    const view = await alice.api.get(`/api/games/${gameId}`);
    expect(view.body.game.play.myHand).toContain('COEUR-3');
  });

  it('isolation : un joueur de A ne peut agir ni lire dans B', async () => {
    const { alice, gameId: gameA } = await startedGame();
    const carol = await player();
    const dave = await player();
    const gameB = await createGame(carol);
    await expectStatus(enterGame(dave.api, database.sql, gameB.gameId), 200);

    await alice.api.get(`/api/games/${gameB.gameId}`).expect(403);
    await alice.api.post(`/api/games/${gameB.gameId}/actions`, action('FLEE')).expect(403);
    expect((await carol.api.get(`/api/games/${gameB.gameId}`)).body.game.version).toBe(2);
    expect((await alice.api.get(`/api/games/${gameA}`)).body.game.version).toBe(3);
  });

  it('limite le débit des écritures par utilisateur (429)', async () => {
    ctx = createGameApiTestApp(database.sql, { gameWritesPerMinute: 2 });
    const alice = await player();
    await alice.api.post('/api/games', { maxPlayers: 2 }).expect(201);
    // Seconde création refusée par R-18, mais comptée comme une écriture.
    await alice.api.post('/api/games', { maxPlayers: 2 }).expect(409);
    const limited = await alice.api.post('/api/games', { maxPlayers: 2 }).expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    await alice.api.get('/api/games/me/active').expect(200); // les lectures ne sont pas limitées
  });
});

describe('Événements et observabilité', () => {
  it('une commande HTTP produit des événements versionnés et séquencés pour la partie', async () => {
    ctx = createGameApiTestApp(database.sql, { rules: testRules, random: identityRandom });
    const alice = await player();
    const bob = await player();
    const game = await createGame(alice);
    const received: GameEvent[] = [];
    await ctx.games.subscribe(game.gameId, alice.userId as PlayerId, (e) => received.push(e));

    await expectStatus(enterGame(bob.api, database.sql, game.gameId), 200);
    await alice.api.post(`/api/games/${game.gameId}/start`).expect(200);
    await alice.api
      .post(`/api/games/${game.gameId}/actions`, action('PLAY_CARD', { cardId: 'COEUR-3' }))
      .expect(200);

    expect(received[0]).toMatchObject({
      gameId: game.gameId,
      version: 2,
      sequence: 0,
      type: 'game:player_joined',
      actorId: bob.userId,
    });
    expect(received.filter((e) => e.version === 4).map((e) => [e.type, e.sequence])).toEqual([
      ['game:card_played', 0],
      ['game:turn_changed', 1],
    ]);
    // Alice ne reçoit que sa propre main.
    const hands = received.filter((e) => e.type === 'game:hand_dealt');
    expect(hands).toHaveLength(1);
  });

  it('les logs de commande portent requestId, gameId, playerId, action — sans carte privée', async () => {
    ctx = createGameApiTestApp(database.sql);
    const alice = await player();
    const res = await alice.api
      .post('/api/games', { maxPlayers: 2 })
      .set('X-Request-Id', 'req-phase-c')
      .expect(201);

    expect(ctx.logLines).toContainEqual(
      expect.objectContaining({
        message: 'game created',
        requestId: 'req-phase-c',
        gameId: res.body.game.gameId,
        playerId: alice.userId,
        action: 'CREATE_GAME',
      }),
    );
    expect(JSON.stringify(ctx.logLines)).not.toContain(alice.accessToken);
  });

  it('en-têtes de sécurité : aucune réponse n’est mise en cache (mains privées, jetons)', async () => {
    ctx = createGameApiTestApp(database.sql);
    const res = await request(ctx.app).get('/api/health');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('Architecture', () => {
  it('contrôleurs et routes n’accèdent jamais aux dépôts ni à la base (GameService seul)', () => {
    const offenders: string[] = [];
    for (const dir of ['controllers', 'routes']) {
      const path = join(__dirname, '../../../src', dir);
      for (const file of readdirSync(path)) {
        const source = readFileSync(join(path, file), 'utf8');
        if (/from '\.\.\/(repositories|database)\//.test(source) || /\bpg\b'/.test(source)) {
          offenders.push(`${dir}/${file}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
