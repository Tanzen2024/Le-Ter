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
 * Continuité d'une partie sans le téléphone d'un joueur, puis reprise (HTTP, comme
 * l'application) : le serveur joue seul les cartes du joueur absent à chaque échéance
 * (D-034, D-036), jusqu'à la fin ; au retour, le joueur relit l'état autoritaire
 * (`/me/active`, `/:gameId`) sans qu'aucune action ne soit rejouée. Aucun « état
 * d'absence » n'existe côté serveur : un joueur absent est un joueur qui ne joue pas
 * avant l'échéance, et la partie n'attend jamais son retour.
 *
 * Mains sans gain instantané (même jeu que turn-timeout-http.test.ts) :
 *   A (J1) : 5♠ 10♣ 8♥ 9⭐ 10♥     B : 7♠ 9♠ 4♥ 6♣ 8♠
 */
jest.setTimeout(120_000);

const H_A: CardId[] = ['PIQUE-5', 'TREFLE-10', 'COEUR-8', 'ETOILE-9', 'COEUR-10'];
const H_B: CardId[] = ['PIQUE-7', 'PIQUE-9', 'COEUR-4', 'TREFLE-6', 'PIQUE-8'];
/** Tour très court : le scénario complet (5 tours) dure quelques secondes. */
const TURN_MS = 250;

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
type Player = Awaited<ReturnType<typeof newPlayer>>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 20_000) {
  const limit = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > limit) throw new Error('état attendu non atteint');
    await sleep(50);
  }
}

/** Table de deux joueurs démarrée par `a` ; renvoie la partie et sa session. */
async function startedTable(a: Player, b: Player) {
  const created = await expectStatus(a.api.post('/api/sessions', { maxPlayers: 2 }), 201);
  const sessionId = created.body.session.sessionId as SessionId;
  const gameId = created.body.game.gameId as GameId;
  await expectStatus(b.api.post(`/api/sessions/${sessionId}/join`), 200);
  await expectStatus(b.api.post(`/api/games/${gameId}/join`), 200);
  await expectStatus(a.api.post(`/api/games/${gameId}/start`), 200);
  return { gameId, sessionId };
}

const view = async (p: Player, gameId: string) =>
  (await expectStatus(p.api.get(`/api/games/${gameId}`), 200)).body.game;
const active = async (p: Player) =>
  (await expectStatus(p.api.get('/api/games/me/active'), 200)).body.games as {
    gameId: string;
    status: string;
  }[];

/** Cartes jouées par `playerId` dans tous les tours (terminés et en cours). */
function playedBy(
  game: {
    play: {
      completedTricks: { plays: { playerId: string; cardId: string }[] }[];
      currentTrick: { playerId: string; cardId: string }[];
    };
  },
  playerId: string,
) {
  return [...game.play.completedTricks.flatMap((t) => t.plays), ...game.play.currentTrick]
    .filter((p) => p.playerId === playerId)
    .map((p) => p.cardId);
}

describe('Joueur absent : la partie continue sans son téléphone, puis il la retrouve', () => {
  it('plusieurs tours joués à sa place, reprise par /me/active, fin sans retour, résultat lisible', async () => {
    ctx = createGameApiTestApp(database.sql, {
      random: decksRandom(deckForHands([H_A, H_B])),
      turnDurationMs: TURN_MS,
      decisionWindowMs: 60_000,
    });
    const [A, B] = [await newPlayer(), await newPlayer()];
    const { gameId, sessionId } = await startedTable(A, B);

    // A est présent et joue lui-même ; B a quitté l'application : aucune requête de B.
    await expectStatus(
      A.api.post(`/api/games/${gameId}/actions`, {
        commandId: randomUUID(),
        type: 'PLAY_CARD',
        payload: { cardId: 'PIQUE-5' },
      }),
      200,
    );

    // Plusieurs tours se jouent par le serveur seul (B à chaque échéance, A aussi ensuite).
    await until(
      () => view(A, gameId),
      (g) => g.status === 'in_progress' && g.play.completedTricks.length >= 2,
    );

    // B revient : la partie active est retrouvée, avec l'état réel et SA main seulement.
    const mine = await active(B);
    expect(mine.map((g) => [g.gameId, g.status])).toEqual([[gameId, 'in_progress']]);
    const restored = await view(B, gameId);
    const played = playedBy(restored, B.id);
    expect(played.length).toBeGreaterThanOrEqual(2);
    expect(restored.play.myHand).toEqual(H_B.filter((c) => !played.includes(c)));
    expect(JSON.stringify(restored.play.myHand)).not.toMatch(/TREFLE-10|COEUR-8|ETOILE-9|COEUR-10/);

    // B repart sans rien faire : la partie se termine sans lui.
    const finished = await until(
      () => view(A, gameId),
      (g) => g.status === 'finished',
    );
    await ctx.games.idle();
    expect(finished.play.completedTricks).toHaveLength(5);
    // Une seule carte par joueur et par tour : aucune double exécution.
    for (const trick of finished.play.completedTricks) {
      expect(trick.plays.map((p: { playerId: string }) => p.playerId).sort()).toEqual(
        [A.id, B.id].sort(),
      );
    }
    expect(playedBy(finished, B.id).sort()).toEqual([...H_B].sort());

    // Retour après la fin : plus de partie active ; la ronde Poursuivre/Quitter de la session
    // désigne la partie terminée, que le joueur peut encore ouvrir (écran de fin).
    expect(await active(B)).toEqual([]);
    const sessions = await expectStatus(B.api.get('/api/sessions/me/active'), 200);
    expect(sessions.body.sessions).toHaveLength(1);
    expect(sessions.body.sessions[0]).toMatchObject({
      sessionId,
      decision: { gameId, open: true },
    });
    expect(sessions.body.sessions[0].decision.pendingPlayerIds).toContain(B.id);
    const result = await view(B, gameId);
    expect(result).toMatchObject({ status: 'finished', version: finished.version });
    expect(result.result.winnerId).toEqual(expect.any(String));
  });

  it('relire l’état ne joue rien ; après la perte des timers (redémarrage), la partie reprend', async () => {
    ctx = createGameApiTestApp(database.sql, {
      random: decksRandom(deckForHands([H_A, H_B])),
      turnDurationMs: TURN_MS,
      decisionWindowMs: 60_000,
    });
    const [A, B] = [await newPlayer(), await newPlayer()];
    const { gameId } = await startedTable(A, B);
    await until(
      () => view(A, gameId),
      (g) => g.play.completedTricks.length >= 1,
    );

    // Instance arrêtée : timers en mémoire perdus, échéances conservées dans PostgreSQL.
    ctx.timers.cancelAll();
    await ctx.games.idle();
    await sleep(TURN_MS * 3);
    // Reconnexions répétées pendant l'arrêt : lectures pures, version inchangée.
    const first = await view(B, gameId);
    for (let i = 0; i < 3; i += 1) {
      await active(B);
      expect((await view(B, gameId)).version).toBe(first.version);
    }

    // Redémarrage : reprise depuis la base, échéance dépassée traitée, partie menée à son terme.
    await ctx.supervisor.recover();
    const finished = await until(
      () => view(B, gameId),
      (g) => g.status === 'finished',
    );
    await ctx.games.idle();
    expect(finished.play.completedTricks).toHaveLength(5);
    expect(playedBy(finished, A.id).sort()).toEqual([...H_A].sort());
    expect(playedBy(finished, B.id).sort()).toEqual([...H_B].sort());
  });

  it('reprise autorisée seulement au membre ; deux parties simultanées restent séparées', async () => {
    ctx = createGameApiTestApp(database.sql, {
      random: decksRandom(deckForHands([H_A, H_B]), deckForHands([H_A, H_B])),
      turnDurationMs: TURN_MS,
      decisionWindowMs: 60_000,
    });
    const [A, B, C, D] = [
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
    ];
    const first = await startedTable(A, B);
    const second = await startedTable(C, D);

    // Un joueur ne retrouve que SA partie ; celle d'une autre table lui est refusée.
    expect((await active(B)).map((g) => g.gameId)).toEqual([first.gameId]);
    expect((await active(D)).map((g) => g.gameId)).toEqual([second.gameId]);
    const denied = await expectStatus(C.api.get(`/api/games/${first.gameId}`), 403);
    expect(denied.body.code).toBe('NOT_A_MEMBER');
    expect(JSON.stringify(denied.body)).not.toMatch(/PIQUE|COEUR|TREFLE|ETOILE/);

    // Les deux parties se jouent seules en parallèle, chacune avec ses seuls joueurs.
    const [g1, g2] = await Promise.all([
      until(
        () => view(A, first.gameId),
        (g) => g.status === 'finished',
      ),
      until(
        () => view(C, second.gameId),
        (g) => g.status === 'finished',
      ),
    ]);
    await ctx.games.idle();
    const playersOf = (g: typeof g1) =>
      [
        ...new Set(
          g.play.completedTricks.flatMap((t: { plays: { playerId: string }[] }) =>
            t.plays.map((p) => p.playerId),
          ),
        ),
      ].sort();
    expect(playersOf(g1)).toEqual([A.id, B.id].sort());
    expect(playersOf(g2)).toEqual([C.id, D.id].sort());
  });
});
