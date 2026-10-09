import { randomUUID } from 'node:crypto';

import {
  InvalidSignalError,
  SignalOutsideGameError,
  type SignalDraft,
} from '../../../src/domain/detection/detection';
import type { Game } from '../../../src/domain/game/game';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { PostgresDetectionRepository } from '../../../src/repositories/postgres-detection.repository';
import {
  DetectionService,
  type DetectionAnalyzer,
} from '../../../src/services/detection/detection.service';
import { createLogger } from '../../../src/utils/logger';
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
import { GLOBAL_DETECTION_ON } from '../../fixtures/detection-switch';

/**
 * Socle de la détection de potentielle collusion (R-36, étape 1, D-044) sur PostgreSQL :
 * activation par la table (`suspicionDetectionEnabled`), isolation par partie, aucune donnée
 * pour une partie désactivée, aucun impact sur le jeu.
 */
jest.setTimeout(30_000);

let database: TestDatabase;
let ctx: GameApiTestContext;
let logs: Record<string, unknown>[];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  logs = [];
  ctx = createGameApiTestApp(database.sql, {
    rules: testRules,
    random: identityRandom,
    decisionWindowMs: 60_000,
    turnDurationMs: 60_000,
  });
});
afterEach(async () => {
  await ctx.stopTimers();
  await database.reset();
});

const detectionWith = (analyzers: DetectionAnalyzer[] = []) =>
  new DetectionService({
    globalSwitch: GLOBAL_DETECTION_ON,
    repository: new PostgresDetectionRepository(database.sql),
    logger: createLogger({}, (line) => logs.push(JSON.parse(line))),
    analyzers,
    // Le calcul des scores (préparé à l'étape 1) reste testé ; il est désactivé en production.
    scoringEnabled: true,
  });

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  return {
    ...session,
    id: session.userId as PlayerId,
    api: as(ctx.app, session.accessToken),
  };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

/** Partie à 2 (en attente), détection activée ou non sur sa table. */
async function table(enabled: boolean) {
  const [owner, guest] = [await newPlayer(), await newPlayer()];
  const res = await expectStatus(
    owner.api.post('/api/sessions', { maxPlayers: 2, suspicionDetectionEnabled: enabled }),
    201,
  );
  const sessionId = res.body.session.sessionId as string;
  const gameId = res.body.game.gameId as GameId;
  await expectStatus(guest.api.post(`/api/sessions/${sessionId}/join`), 200);
  await expectStatus(guest.api.post(`/api/games/${gameId}/join`), 200);
  return { owner, guest, gameId };
}

const signal = (playerIds: PlayerId[], overrides: Partial<SignalDraft> = {}): SignalDraft => ({
  type: 'PROXIMITY',
  severity: 'medium',
  contribution: 20,
  playerIds,
  evidence: { note: 'test' },
  ...overrides,
});

const rowCount = async (gameId?: GameId) => {
  const where = gameId ? 'WHERE game_id = $1' : '';
  const params = gameId ? [gameId] : [];
  const signals = await database.sql.query<{ n: string }>(
    `SELECT count(*) AS n FROM detection_signals ${where}`,
    params,
  );
  const scores = await database.sql.query<{ n: string }>(
    `SELECT count(*) AS n FROM detection_scores ${where}`,
    params,
  );
  return Number(signals.rows[0]!.n) + Number(scores.rows[0]!.n);
};

const gameRecord = async (gameId: GameId) => (await ctx.games.findGame(gameId)) as Game;

describe('DetectionService : socle', () => {
  it('TEST 1 — s’instancie, sans analyse branchée et sans dépendance au moteur', async () => {
    const detection = detectionWith();
    const { gameId } = await table(true);
    expect(await detection.isEnabled(gameId)).toBe(true);
    expect(await detection.analyzeGame(await gameRecord(gameId))).toEqual({
      skipped: false,
      recorded: 0,
      scores: [],
    });
    expect(await rowCount()).toBe(0);
  });

  it('TEST 2 — détection désactivée : rien n’est lu, analysé ni écrit', async () => {
    const analyze = jest.fn(() => [] as SignalDraft[]);
    const detection = detectionWith([{ name: 'espion', analyze }]);
    const { owner, guest, gameId } = await table(false);

    expect(await detection.isEnabled(gameId)).toBe(false);
    expect(await detection.recordSignals(gameId, [signal([owner.id, guest.id])])).toEqual({
      skipped: true,
      recorded: 0,
    });
    // Même un signal invalide n'est pas examiné : la partie est hors du système.
    expect(
      await detection.recordSignals(gameId, [signal([owner.id], { type: 'SHARED_IP' })]),
    ).toEqual({ skipped: true, recorded: 0 });
    expect(await detection.analyzeGame(await gameRecord(gameId))).toEqual({
      skipped: true,
      recorded: 0,
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(await rowCount()).toBe(0);
  });

  it('TEST 2 bis — la base refuse toute ligne pour une partie désactivée', async () => {
    const { owner, gameId } = await table(false);
    await expect(
      database.sql.query(
        `INSERT INTO detection_scores (game_id, subject_key, player_ids, score, level,
           algorithm_version, computed_at) VALUES ($1, $2, $3, 10, 'low', 1, now())`,
        [gameId, owner.id, [owner.id]],
      ),
    ).rejects.toThrow();
    expect(await rowCount()).toBe(0);
  });

  it('TEST 3 — détection activée : signaux enregistrés, score et niveau calculés', async () => {
    const detection = detectionWith();
    const { owner, guest, gameId } = await table(true);

    const first = await detection.recordSignals(gameId, [signal([owner.id, guest.id])]);
    const second = await detection.recordSignals(gameId, [
      signal([guest.id, owner.id], { type: 'FREQUENT_COPLAY', contribution: 15 }),
    ]);

    expect(first).toMatchObject({ skipped: false, recorded: 1 });
    expect(second).toMatchObject({ skipped: false, recorded: 1 });
    const signals = await detection.listSignals(gameId);
    expect(signals.map((s) => [s.type, s.contribution, s.gameId])).toEqual([
      ['PROXIMITY', 20, gameId],
      ['FREQUENT_COPLAY', 15, gameId],
    ]);
    expect(await detection.listScores(gameId)).toEqual([
      expect.objectContaining({
        gameId,
        playerIds: [owner.id, guest.id].sort(),
        score: 35,
        level: 'moderate',
        algorithmVersion: 2,
      }),
    ]);
  });

  it('TEST 7 — score plafonné à 100', async () => {
    const detection = detectionWith();
    const { owner, guest, gameId } = await table(true);
    const pair = [owner.id, guest.id];
    await detection.recordSignals(gameId, [
      signal(pair, { contribution: 100 }),
      signal(pair, { type: 'CARD_CHOICE_ANOMALY', contribution: 100 }),
      signal(pair, { type: 'CORRELATED_WINS', contribution: 100 }),
      signal(pair, { type: 'REPEATED_PROXIMITY', contribution: 100 }),
    ]);
    expect(await detection.listScores(gameId)).toEqual([
      expect.objectContaining({ score: 100, level: 'very_high' }),
    ]);
  });

  it('TESTS 8 / 9 — signal invalide ou SHARED_IP : rejeté, rien d’écrit', async () => {
    const detection = detectionWith();
    const { owner, guest, gameId } = await table(true);
    await expect(
      detection.recordSignals(gameId, [signal([owner.id], { type: 'SHARED_IP' })]),
    ).rejects.toThrow(InvalidSignalError);
    await expect(
      detection.recordSignals(gameId, [
        signal([owner.id, guest.id]),
        signal([owner.id], { contribution: 250 }),
      ]),
    ).rejects.toThrow(InvalidSignalError);
    expect(await rowCount()).toBe(0);
  });
});

describe('Isolation par partie (TESTS 4 / 5)', () => {
  it('une analyse de la partie A n’écrit jamais dans la partie B, ni avec ses joueurs', async () => {
    const detection = detectionWith();
    const a = await table(true);
    const b = await table(false);
    const c = await table(true);

    // Joueur d'une autre partie cité dans un signal de A : refusé, rien d'écrit.
    await expect(
      detection.recordSignals(a.gameId, [signal([a.owner.id, b.guest.id])]),
    ).rejects.toThrow(SignalOutsideGameError);
    await expect(
      detection.recordSignals(a.gameId, [signal([a.owner.id, c.guest.id])]),
    ).rejects.toThrow(SignalOutsideGameError);
    expect(await rowCount()).toBe(0);

    await detection.recordSignals(a.gameId, [signal([a.owner.id, a.guest.id])]);
    await detection.recordSignals(c.gameId, [
      signal([c.owner.id, c.guest.id], { contribution: 5 }),
    ]);

    expect(await rowCount(b.gameId)).toBe(0);
    expect((await detection.listSignals(a.gameId)).every((s) => s.gameId === a.gameId)).toBe(true);
    expect((await detection.listScores(a.gameId)).map((s) => s.score)).toEqual([20]);
    expect((await detection.listScores(c.gameId)).map((s) => s.score)).toEqual([5]);
    expect(await detection.listSignals(b.gameId)).toEqual([]);
  });

  it('la base refuse une ligne de A citant un joueur de B (même en contournant le service)', async () => {
    const a = await table(true);
    const b = await table(true);
    await expect(
      database.sql.query(
        `INSERT INTO detection_signals (id, game_id, type, severity, contribution, player_ids,
           algorithm_version, created_at)
         VALUES ($1, $2, 'PROXIMITY', 'low', 5, $3, 1, now())`,
        [randomUUID(), a.gameId, [a.owner.id, b.owner.id]],
      ),
    ).rejects.toThrow();
    expect(await rowCount()).toBe(0);
  });

  it('deux parties en parallèle : chaque partie ne voit que ses propres données', async () => {
    const detection = detectionWith();
    const [a, c] = [await table(true), await table(true)];
    await Promise.all([
      detection.recordSignals(a.gameId, [signal([a.owner.id, a.guest.id], { contribution: 7 })]),
      detection.recordSignals(c.gameId, [signal([c.owner.id, c.guest.id], { contribution: 9 })]),
      detection.recordSignals(a.gameId, [
        signal([a.owner.id, a.guest.id], { type: 'FREQUENT_COPLAY', contribution: 3 }),
      ]),
    ]);
    expect((await detection.listScores(a.gameId)).map((s) => s.score)).toEqual([10]);
    expect((await detection.listScores(c.gameId)).map((s) => s.score)).toEqual([9]);
  });
});

describe('TEST 10 — aucun impact sur les règles du jeu', () => {
  /** Distribution « identité » à 2 : le 2e joueur prend le contrôle et gagne. */
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

  async function playToEnd(owner: Player, guest: Player, gameId: GameId) {
    await expectStatus(owner.api.post(`/api/games/${gameId}/start`), 200);
    for (const [who, cardId] of SECOND_WINS) {
      await expectStatus(
        (who === 0 ? owner : guest).api.post(`/api/games/${gameId}/actions`, {
          commandId: randomUUID(),
          type: 'PLAY_CARD',
          payload: { cardId },
        }),
        200,
      );
    }
    return (await expectStatus(owner.api.get(`/api/games/${gameId}`), 200)).body.game;
  }

  it('même déroulé et même gagnant, détection activée ou non, même si l’analyse échoue', async () => {
    const analyze = jest.fn((): SignalDraft[] => {
      throw new Error('analyse en panne');
    });
    const detection = detectionWith([{ name: 'en-panne', analyze }]);
    ctx.games.onGameFinished((game) => detection.observeFinishedGame(game));

    const on = await table(true);
    const off = await table(false);
    const finishedOn = await playToEnd(on.owner, on.guest, on.gameId);
    const finishedOff = await playToEnd(off.owner, off.guest, off.gameId);
    await detection.idle();

    for (const [game, t] of [
      [finishedOn, on],
      [finishedOff, off],
    ] as const) {
      expect(game.status).toBe('finished');
      expect(game.result.winnerId).toBe(t.guest.id);
      expect(game.play.completedTricks).toHaveLength(5);
    }
    // L'analyse n'a tourné que pour la partie surveillée ; son échec est seulement journalisé.
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls).toHaveLength(1);
    expect(logs.some((l) => l.message === 'detection analysis failed')).toBe(true);
    expect(await rowCount()).toBe(0);
  });
});
