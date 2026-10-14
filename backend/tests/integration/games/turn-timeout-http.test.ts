import type { CardId } from '../../../src/domain/cards/card';
import type { GameEvent } from '../../../src/domain/game/game-events';
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
 * Scénario HTTP réel du timeout de tour (D-034, D-036), avec le timer de PRODUCTION
 * (10 s, aucune durée injectée) : session → partie → distribution → aucune action des
 * joueurs → TURN_TIMEOUT → PLAY_CARD automatique → GET de la partie.
 *
 *   A (J1, meneur) : 5♠ 10♣ 8♥ 9⭐ 10♥  → ouvre le tour : plus petite carte, 5♠
 *   B              : 7♠ 9♠ 4♥ 6♣ 8♠   → doit suivre ♠ : plus petite ♠, 7♠ (pas le 4♥)
 */
jest.setTimeout(120_000);

const H_A: CardId[] = ['PIQUE-5', 'TREFLE-10', 'COEUR-8', 'ETOILE-9', 'COEUR-10'];
const H_B: CardId[] = ['PIQUE-7', 'PIQUE-9', 'COEUR-4', 'TREFLE-6', 'PIQUE-8'];

let database: TestDatabase;
let ctx: GameApiTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
afterEach(async () => {
  await ctx.stopTimers();
  await ctx.games.idle();
  await database.reset();
});

async function newPlayer() {
  const s = await registerAndLogin(ctx.app);
  return { id: s.userId as PlayerId, api: as(ctx.app, s.accessToken) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Les attentes partent de l'échéance FIXÉE PAR LE SERVEUR (`turnDeadlineAt`), jamais de la
 * fin d'une requête : sous charge, la latence ne décale pas le scénario. Après l'échéance,
 * on interroge l'API jusqu'à l'état attendu (au plus `timeoutMs`), sans durée fixe.
 */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000) {
  const limit = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > limit) {
      return value;
    }
    await sleep(100);
  }
}

describe('HTTP — aucune action du joueur pendant 10 s : le serveur joue à sa place', () => {
  it('session → partie → distribution → 10 s → coup automatique D-036 visible par GET', async () => {
    ctx = createGameApiTestApp(database.sql, { random: decksRandom(deckForHands([H_A, H_B])) });
    const [A, B] = [await newPlayer(), await newPlayer()];

    const created = await expectStatus(A.api.post('/api/sessions', { maxPlayers: 2 }), 201);
    const sessionId = created.body.session.sessionId as SessionId;
    const gameId = created.body.game.gameId as GameId;
    await expectStatus(B.api.post(`/api/sessions/${sessionId}/join`), 200);
    await expectStatus(B.api.post(`/api/games/${gameId}/join`), 200);
    const started = await expectStatus(A.api.post(`/api/games/${gameId}/start`), 200);
    const startVersion = started.body.game.version as number;
    expect(started.body.game.activePlayerId).toBe(A.id);
    expect(started.body.game.play.myHand).toEqual(H_A);

    // B écoute les événements de la partie (salle game:{gameId}).
    const eventsB: GameEvent[] = [];
    await ctx.games.subscribe(gameId, B.id, (e) => eventsB.push(e));

    // Timer de production : 10 s, décidé par le serveur.
    const deadlineA = Date.parse(started.body.game.turnDeadlineAt as string);
    expect(deadlineA - Date.parse(started.body.game.turnStartedAt as string)).toBe(13_000);

    // Aucune action, peu avant l'échéance : le serveur n'a encore rien joué. L'assertion
    // ne vaut que si le serveur lui-même situe la lecture avant l'échéance (`serverNow`).
    await sleep(Math.max(0, deadlineA - 1_500 - Date.now()));
    const before = await expectStatus(A.api.get(`/api/games/${gameId}`), 200);
    if (Date.parse(before.body.game.serverNow as string) < deadlineA) {
      expect(before.body.game.play.currentTrick).toEqual([]);
      expect(before.body.game.activePlayerId).toBe(A.id);
    }

    // Échéance de A : 5♠ joué automatiquement, le tour passe à B.
    await sleep(Math.max(0, deadlineA - Date.now()));
    const afterA = await until(
      () => expectStatus(A.api.get(`/api/games/${gameId}`), 200),
      (res) => res.body.game.activePlayerId === B.id,
    );
    expect(afterA.body.game).toMatchObject({
      version: startVersion + 2,
      activePlayerId: B.id,
      play: {
        currentTrick: [{ playerId: A.id, cardId: 'PIQUE-5' }],
        myHand: ['TREFLE-10', 'COEUR-8', 'ETOILE-9', 'COEUR-10'],
      },
    });
    expect(afterA.body.game.turnTimedOutAt).toBeUndefined();

    // Échéance de B (10 s après le début de SON tour) : il possède des ♠ → 7♠, pas le 4♥.
    const deadlineB = Date.parse(afterA.body.game.turnDeadlineAt as string);
    expect(deadlineB - Date.parse(afterA.body.game.turnStartedAt as string)).toBe(13_000);
    await sleep(Math.max(0, deadlineB - Date.now()));
    const viewB = await until(
      () => expectStatus(B.api.get(`/api/games/${gameId}`), 200),
      (res) => res.body.game.play.completedTricks.length === 1,
    );
    await ctx.games.idle();
    expect(viewB.body.game.play.completedTricks[0].plays).toEqual([
      { playerId: A.id, cardId: 'PIQUE-5' },
      { playerId: B.id, cardId: 'PIQUE-7' },
    ]);
    expect(viewB.body.game.play.myHand).toEqual(['PIQUE-9', 'COEUR-4', 'TREFLE-6', 'PIQUE-8']);
    expect(viewB.body.game.version).toBe(startVersion + 4);
    // La vue de B ne révèle jamais les cartes encore en main de A.
    expect(JSON.stringify(viewB.body)).not.toMatch(/TREFLE-10|COEUR-8|ETOILE-9|COEUR-10/);

    // B a reçu les événements publics des deux coups automatiques.
    const autos = eventsB.filter((e) => e.type === 'game:auto_card_played');
    expect(autos.map((e) => e.payload.playerId)).toEqual([A.id, B.id]);
    expect(
      eventsB.filter((e) => e.type === 'game:card_played').map((e) => e.payload.cardId),
    ).toEqual(['PIQUE-5', 'PIQUE-7']);

    // Le client n'a envoyé AUCUNE commande PLAY_CARD : tout vient du serveur.
    expect(ctx.logLines.filter((l) => l.action === 'PLAY_CARD')).toEqual([]);
    expect(JSON.stringify(ctx.logLines)).not.toMatch(/play-card/);
    expect(ctx.logLines.filter((l) => l.message === 'AUTO_CARD_PLAY')).toHaveLength(2);
  });
});
