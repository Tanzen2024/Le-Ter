import { randomUUID } from 'node:crypto';

import type { SignalDraft } from '../../../src/domain/detection/detection';
import {
  BEHAVIOR_CONTRIBUTIONS,
  GEOLOCATION_CONFIG,
} from '../../../src/domain/detection/detection-config';
import type { Game } from '../../../src/domain/game/game';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { SessionId } from '../../../src/domain/sessions/session';
import type { DetectionRepository } from '../../../src/repositories/detection.repository';
import { PostgresDetectionRepository } from '../../../src/repositories/postgres-detection.repository';
import { insertGameRows } from '../../../src/repositories/postgres-game.repository';
import { DetectionService } from '../../../src/services/detection/detection.service';
import { createLogger } from '../../../src/utils/logger';
import type { AdminEvent, AdminEventPublisher } from '../../../src/websocket/admin-event-bus';
import { finishedGame } from '../../fixtures/detection-history';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { seedUsers, testPlayerId } from '../../fixtures/users';
import { GLOBAL_DETECTION_ON } from '../../fixtures/detection-switch';

/**
 * Score de suspicion et alertes INTERNES (R-36, étape 4, D-048) sur PostgreSQL. Les
 * signaux sont enregistrés par le chemin réel (`DetectionService.recordSignals`), avec les
 * contributions de la configuration.
 */
jest.setTimeout(60_000);

let database: TestDatabase;
const NAMES = ['amina', 'bruno', 'chloe', 'didier'];
const [A, B, C, D] = NAMES.map(testPlayerId) as [PlayerId, PlayerId, PlayerId, PlayerId];
const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => seedUsers(database.sql, NAMES));
afterEach(() => database.reset());

/** Partie terminée sur une table surveillée (ou non). */
async function game(enabled: boolean, players: PlayerId[]): Promise<GameId> {
  const sessionId = randomUUID() as SessionId;
  await database.sql.query(
    `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at, updated_at,
       suspicion_detection_enabled)
     VALUES ($1, 1, 'open', $2, 4, now(), now(), $3)`,
    [sessionId, players[0], enabled],
  );
  for (const [seat, playerId] of players.entries()) {
    await database.sql.query(
      `INSERT INTO session_players (session_id, player_id, seat, arrival, active, joined_at)
       VALUES ($1, $2, $3, $4, true, now())`,
      [sessionId, playerId, seat, seat + 1],
    );
  }
  const g: Game = finishedGame({ players, sessionId });
  await insertGameRows(database.sql, g);
  await database.sql.query(
    `UPDATE session_players SET active = false, left_at = now() WHERE session_id = $1`,
    [sessionId],
  );
  return g.id;
}

const detection = (
  options: {
    clock?: () => Date;
    repository?: DetectionRepository;
    adminEvents?: AdminEventPublisher;
  } = {},
) =>
  new DetectionService({
    globalSwitch: GLOBAL_DETECTION_ON,
    repository: options.repository ?? new PostgresDetectionRepository(database.sql),
    logger: createLogger({}, () => undefined),
    clock: options.clock ?? (() => NOW),
    ...(options.adminEvents && { adminEvents: options.adminEvents }),
  });

const C3 = GEOLOCATION_CONFIG.contributions;
const draft = (
  type: SignalDraft['type'],
  playerIds: PlayerId[],
  contribution: number,
): SignalDraft => ({
  type,
  severity: 'medium',
  contribution,
  playerIds,
  evidence: { observations: 12, rate: 0.75, periodDays: 30 },
});
/** Paire au niveau HIGH : 20 + 20 + 15 = 55, trois types. */
const highPair = (pair: PlayerId[]) => [
  draft('PROXIMITY', pair, C3.PROXIMITY.strong),
  draft('CARD_CHOICE_ANOMALY', pair, BEHAVIOR_CONTRIBUTIONS.CARD_CHOICE_ANOMALY),
  draft('CORRELATED_WINS', pair, BEHAVIOR_CONTRIBUTIONS.CORRELATED_WINS),
];
/** Complément vers VERY_HIGH : + 15 + 10 + 10 = 90. */
const veryHighExtra = (pair: PlayerId[]) => [
  draft('REPEATED_PROXIMITY', pair, C3.REPEATED_PROXIMITY),
  draft('FREQUENT_COPLAY', pair, BEHAVIOR_CONTRIBUTIONS.FREQUENT_COPLAY),
  draft('CONNECTION_PATTERN', pair, BEHAVIOR_CONTRIBUTIONS.CONNECTION_PATTERN),
];

const counts = async () => {
  const { rows } = await database.sql.query<{ s: string; sc: string; a: string }>(
    `SELECT (SELECT count(*) FROM detection_signals) AS s,
            (SELECT count(*) FROM detection_scores) AS sc,
            (SELECT count(*) FROM detection_alerts) AS a`,
  );
  return { signals: Number(rows[0]!.s), scores: Number(rows[0]!.sc), alerts: Number(rows[0]!.a) };
};

describe('Partie non surveillée', () => {
  it('aucun signal, aucun score, aucune alerte, aucune lecture inutile', async () => {
    const gameId = await game(false, [A, B]);
    const real = new PostgresDetectionRepository(database.sql);
    const calls: string[] = [];
    const spied = new Proxy(real, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (...args: unknown[]) => {
              calls.push(String(prop));
              return value.apply(target, args);
            }
          : value;
      },
    });
    const result = await detection({ repository: spied }).recordSignals(gameId, [
      ...highPair([A, B]),
      ...veryHighExtra([A, B]),
    ]);
    expect(result).toEqual({ skipped: true, recorded: 0 });
    expect(calls).toEqual(['isEnabledForGame']);
    expect(await counts()).toEqual({ signals: 0, scores: 0, alerts: 0 });
  });
});

describe('Score et alertes', () => {
  it('LOW : score enregistré, aucune alerte', async () => {
    const gameId = await game(true, [A, B]);
    await detection().recordSignals(gameId, [draft('CONNECTION_PATTERN', [A, B], 10)]);
    expect(await detection().listScores(gameId)).toEqual([
      expect.objectContaining({ scope: 'PAIR', score: 10, level: 'low', previousScore: null }),
    ]);
    expect((await counts()).alerts).toBe(0);
  });

  it('MODERATE : aucune alerte (configuration)', async () => {
    const gameId = await game(true, [A, B]);
    await detection().recordSignals(gameId, [
      draft('PROXIMITY', [A, B], 20),
      draft('CONNECTION_PATTERN', [A, B], 10),
    ]);
    expect((await detection().listScores(gameId))[0]).toMatchObject({
      score: 30,
      level: 'moderate',
    });
    expect((await counts()).alerts).toBe(0);
  });

  it('HIGH : alerte interne NORMAL, sans élément justificatif recopié', async () => {
    const gameId = await game(true, [A, B]);
    const result = await detection().recordSignals(gameId, highPair([A, B]));
    expect(result).toMatchObject({ recorded: 3, alertsCreated: 1 });
    const [alert] = await detection().listAlerts();
    expect(alert).toMatchObject({
      gameId,
      type: 'SUSPICION_LEVEL',
      scope: 'PAIR',
      playerIds: [A, B].sort(),
      level: 'high',
      priority: 'NORMAL',
      score: 55,
      scoreAlgorithmVersion: 2,
      status: 'NEW',
    });
    expect(alert!.signalTypes.sort()).toEqual([
      'CARD_CHOICE_ANOMALY',
      'CORRELATED_WINS',
      'PROXIMITY',
    ]);
    expect(JSON.stringify(alert)).not.toMatch(/observations|rate|latitude|longitude|COEUR/);
  });

  it('VERY_HIGH : alerte PRIORITY ; une alerte HIGH antérieure de la période est conservée', async () => {
    const gameId = await game(true, [A, B]);
    await detection().recordSignals(gameId, highPair([A, B]));
    await detection().recordSignals(gameId, veryHighExtra([A, B]));
    const alerts = await detection().listAlerts({ playerIds: [A, B] });
    expect(alerts.map((a) => [a.level, a.priority, a.score])).toEqual([
      ['very_high', 'PRIORITY', 90],
      ['high', 'NORMAL', 55],
    ]);
    // Le score de la partie est mis à jour, jamais dupliqué.
    expect(await detection().listScores(gameId)).toEqual([
      expect.objectContaining({ score: 90, level: 'very_high', signalCount: 6 }),
    ]);
  });

  it('plafond à 100 et contributions plafonnées par type', async () => {
    const gameId = await game(true, [A, B]);
    await detection().recordSignals(gameId, [
      ...highPair([A, B]),
      ...veryHighExtra([A, B]).map((d) => ({ ...d, contribution: 100 })),
    ]);
    expect((await detection().listScores(gameId))[0]).toMatchObject({ score: 100 });
  });
});

describe('Temps réel de l’administration (D-116)', () => {
  it('signal DETECTION_ALERT après une NOUVELLE alerte seulement ; un signal en échec ne casse rien', async () => {
    const events: AdminEvent[] = [];
    const service = detection({ adminEvents: { publish: (e) => events.push(e) } });
    const gameId = await game(true, [A, B]);
    await service.recordSignals(gameId, [draft('CONNECTION_PATTERN', [A, B], 10)]);
    expect(events).toEqual([]); // score LOW : aucune alerte
    await service.recordSignals(gameId, highPair([A, B]));
    expect(events).toEqual([{ type: 'attention', source: 'DETECTION_ALERT' }]);
    await service.recordSignals(gameId, highPair([A, B])); // doublon : aucune nouvelle alerte
    expect(events).toHaveLength(1);

    const failing = detection({
      adminEvents: {
        publish: () => {
          throw new Error('Redis indisponible');
        },
      },
    });
    const other = await game(true, [A, C]);
    await expect(failing.recordSignals(other, highPair([A, C]))).resolves.toMatchObject({
      alertsCreated: 1,
    });
  });
});

describe('Idempotence, concurrence, redémarrage', () => {
  it('même analyse exécutée deux fois : aucun doublon (signaux, score, alerte)', async () => {
    const gameId = await game(true, [A, B]);
    const first = await detection().recordSignals(gameId, highPair([A, B]));
    const before = await counts();
    const second = await detection().recordSignals(gameId, highPair([A, B]));
    expect(first).toMatchObject({ recorded: 3, alertsCreated: 1 });
    expect(second).toMatchObject({ recorded: 0, alertsCreated: 0 });
    expect(await counts()).toEqual(before);
    expect(before).toEqual({ signals: 3, scores: 1, alerts: 1 });
  });

  it('deux workers simultanés sur le même événement : aucun doublon', async () => {
    const gameId = await game(true, [A, B]);
    const results = await Promise.all([
      detection().recordSignals(gameId, highPair([A, B])),
      detection().recordSignals(gameId, highPair([A, B])),
    ]);
    expect(await counts()).toEqual({ signals: 3, scores: 1, alerts: 1 });
    expect(results.reduce((sum, r) => sum + r.recorded, 0)).toBe(3);
  });

  it('redémarrage : score et alerte persistés, rejeu sans duplication', async () => {
    const gameId = await game(true, [A, B]);
    await detection().recordSignals(gameId, highPair([A, B]));
    // Nouvelle instance du service, comme après un redémarrage du serveur.
    const restarted = detection({ clock: () => new Date(NOW.getTime() + 60_000) });
    expect(await restarted.listScores(gameId)).toEqual([
      expect.objectContaining({ score: 55, level: 'high' }),
    ]);
    expect(await restarted.listAlerts()).toHaveLength(1);
    await restarted.recordSignals(gameId, highPair([A, B]));
    expect(await counts()).toEqual({ signals: 3, scores: 1, alerts: 1 });
  });
});

describe('Historique du score', () => {
  it('score précédent, nouveau score, signaux en cause, version, date', async () => {
    const first = await game(true, [A, B]);
    await detection({ clock: () => new Date(NOW.getTime() - DAY) }).recordSignals(first, [
      draft('PROXIMITY', [A, B], 20),
    ]);
    const second = await game(true, [A, B]);
    await detection().recordSignals(second, [draft('CORRELATED_WINS', [A, B], 15)]);

    const history = await detection().listSubjectScores([B, A]);
    expect(history.map((h) => [h.gameId, h.previousScore, h.score])).toEqual([
      [second, 20, 35],
      [first, null, 20],
    ]);
    expect(history[0]).toMatchObject({ algorithmVersion: 2, computedAt: NOW, signalCount: 2 });
    expect(history[0]!.components.map((c) => [c.type, c.sourceGameId])).toEqual([
      ['CORRELATED_WINS', second],
      ['PROXIMITY', first],
    ]);
  });

  it('même constat dans plusieurs parties : compté une seule fois', async () => {
    const first = await game(true, [A, B]);
    await detection().recordSignals(first, [draft('FREQUENT_COPLAY', [A, B], 10)]);
    const second = await game(true, [A, B]);
    await detection().recordSignals(second, [draft('FREQUENT_COPLAY', [A, B], 10)]);
    expect((await detection().listScores(second))[0]).toMatchObject({
      score: 10,
      signalCount: 2,
      previousScore: 10,
    });
  });

  it('expiration explicite : un signal de plus de 30 jours ne compte plus', async () => {
    const old = await game(true, [A, B]);
    await detection({ clock: () => new Date(NOW.getTime() - 31 * DAY) }).recordSignals(old, [
      draft('PROXIMITY', [A, B], 20),
    ]);
    const recent = await game(true, [A, B]);
    await detection().recordSignals(recent, [draft('CORRELATED_WINS', [A, B], 15)]);
    expect((await detection().listScores(recent))[0]).toMatchObject({
      score: 15,
      signalCount: 1,
      previousScore: 20,
    });
    // L'ancien score n'est jamais supprimé.
    expect(await detection().listScores(old)).toHaveLength(1);
  });
});

describe('Isolation', () => {
  it('partie A ne pollue pas partie B ; joueur, paire A/B et paire A/C distincts', async () => {
    const gameAB = await game(true, [A, B]);
    const gameCD = await game(true, [C, D]);
    await detection().recordSignals(gameAB, [
      ...highPair([A, B]),
      draft('IMPOSSIBLE_TRAVEL', [A], C3.IMPOSSIBLE_TRAVEL),
    ]);
    await detection().recordSignals(gameCD, [draft('CONNECTION_PATTERN', [C, D], 10)]);

    expect((await detection().listScores(gameCD)).map((s) => [s.subjectKey, s.score])).toEqual([
      [[C, D].sort().join('|'), 10],
    ]);
    expect(await detection().listAlerts({ gameId: gameCD })).toEqual([]);
    const scoresAB = await detection().listScores(gameAB);
    expect(scoresAB.map((s) => [s.scope, s.score])).toEqual([
      ['PAIR', 55],
      ['PLAYER', 15],
    ]);
    // Le joueur A ne récupère pas le score de la paire, et la paire A/C n'existe pas.
    expect((await detection().listSubjectScores([A]))[0]).toMatchObject({ score: 15 });
    expect(await detection().listSubjectScores([A, C])).toEqual([]);
  });

  it('la base refuse un score ou une alerte citant un joueur d’une autre partie', async () => {
    const gameAB = await game(true, [A, B]);
    await expect(
      database.sql.query(
        `INSERT INTO detection_alerts (id, game_id, type, subject_key, player_ids, level, priority,
           score, score_algorithm_version, signal_types, period_start, dedupe_key, created_at,
           updated_at)
         VALUES ($1, $2, 'SUSPICION_LEVEL', 'x', $3, 'high', 'NORMAL', 60, 2, '{}', now(), 'k',
           now(), now())`,
        [randomUUID(), gameAB, [A, C]],
      ),
    ).rejects.toThrow();
    expect(await counts()).toEqual({ signals: 0, scores: 0, alerts: 0 });
  });
});
