import { randomUUID } from 'node:crypto';

import type { Game } from '../../../src/domain/game/game';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { SessionId } from '../../../src/domain/sessions/session';
import type { BehaviorHistoryRepository } from '../../../src/repositories/behavior-history.repository';
import { PostgresBehaviorHistoryRepository } from '../../../src/repositories/postgres-behavior-history.repository';
import { PostgresDetectionRepository } from '../../../src/repositories/postgres-detection.repository';
import {
  insertGameRows,
  PostgresGameRepository,
} from '../../../src/repositories/postgres-game.repository';
import { createBehaviorAnalyzers } from '../../../src/services/detection/behavior-analyzers';
import { DetectionService } from '../../../src/services/detection/detection.service';
import { createLogger } from '../../../src/utils/logger';
import {
  declinesAgainst,
  finishedGame,
  takesAgainst,
  type TrickScript,
} from '../../fixtures/detection-history';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { seedUsers, testPlayerId } from '../../fixtures/users';
import { GLOBAL_DETECTION_ON } from '../../fixtures/detection-switch';

/**
 * Analyses comportementales (R-36, étape 3, D-047) sur PostgreSQL, avec un historique de
 * parties TERMINÉES écrit dans les vraies tables du jeu (`games`, `game_players`,
 * `sessions`, `session_players`). Aucune donnée inventée dans l'application.
 */
jest.setTimeout(60_000);

let database: TestDatabase;
const NAMES = ['xavier', 'yanis', 'zoe', 'wendy', 'victor', 'ursula'];
const [X, Y, Z, W, V, U] = NAMES.map(testPlayerId) as [
  PlayerId,
  PlayerId,
  PlayerId,
  PlayerId,
  PlayerId,
  PlayerId,
];
const NOW = new Date();
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => seedUsers(database.sql, NAMES));
afterEach(() => database.reset());

/** Espionne l'historique : prouve qu'une partie non surveillée ne lit RIEN. */
function spiedHistory() {
  const real = new PostgresBehaviorHistoryRepository(database.sql);
  const calls: string[] = [];
  const spy: BehaviorHistoryRepository = {
    coplayStats: (...a) => (calls.push('coplayStats'), real.coplayStats(...a)),
    outcomes: (...a) => (calls.push('outcomes'), real.outcomes(...a)),
    playedToTheEndGameIds: (...a) => (
      calls.push('playedToTheEnd'),
      real.playedToTheEndGameIds(...a)
    ),
    sharedTables: (...a) => (calls.push('sharedTables'), real.sharedTables(...a)),
  };
  return { spy, calls };
}

function detectionWith(
  history: BehaviorHistoryRepository = new PostgresBehaviorHistoryRepository(database.sql),
) {
  return new DetectionService({
    globalSwitch: GLOBAL_DETECTION_ON,
    repository: new PostgresDetectionRepository(database.sql),
    logger: createLogger({}, () => undefined),
    clock: () => NOW,
    analyzers: createBehaviorAnalyzers(history, new PostgresGameRepository(database.sql)),
  });
}

/** Table (session) terminée, surveillée ou non ; arrivées des joueurs datées. */
async function table(enabled: boolean, arrivals: [PlayerId, Date][]): Promise<SessionId> {
  const id = randomUUID() as SessionId;
  const first = arrivals[0]![1];
  await database.sql.query(
    `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at, updated_at,
       suspicion_detection_enabled)
     VALUES ($1, 1, 'open', $2, 4, $3, $3, $4)`,
    [id, arrivals[0]![0], first.toISOString(), enabled],
  );
  for (const [i, [playerId, joinedAt]] of arrivals.entries()) {
    await database.sql.query(
      `INSERT INTO session_players (session_id, player_id, seat, arrival, active, joined_at, left_at)
       VALUES ($1, $2, $3, $4, false, $5, $6)`,
      [id, playerId, i, i + 1, joinedAt.toISOString(), NOW.toISOString()],
    );
  }
  return id;
}

/** Partie terminée de la table : joueurs présents le temps de l'écriture, comme en jeu. */
async function seed(sessionId: SessionId, game: Game): Promise<Game> {
  game.sessionId = sessionId;
  const ids = game.players.map((p) => p.playerId);
  await database.sql.query(
    `UPDATE session_players SET active = true, left_at = NULL
     WHERE session_id = $1 AND player_id = ANY($2::uuid[])`,
    [sessionId, ids],
  );
  await insertGameRows(database.sql, game);
  await database.sql.query(
    `UPDATE session_players SET active = false, left_at = $3
     WHERE session_id = $1 AND player_id = ANY($2::uuid[])`,
    [sessionId, ids, NOW.toISOString()],
  );
  return game;
}

async function seedGames(
  enabled: boolean,
  players: PlayerId[],
  count: number,
  options: {
    tricks?: TrickScript[];
    winner?: (i: number) => PlayerId;
    tables?: number;
    auto?: boolean;
  } = {},
): Promise<Game[]> {
  const tables = options.tables ?? 1;
  const sessions: SessionId[] = [];
  for (let t = 0; t < tables; t += 1) {
    sessions.push(
      await table(
        enabled,
        players.map((p, i) => [p, minutesAgo(600 - t * 60 + i * 30)]),
      ),
    );
  }
  const games: Game[] = [];
  for (let i = 0; i < count; i += 1) {
    games.push(
      await seed(
        sessions[i % tables]!,
        finishedGame({
          players,
          tricks: options.tricks,
          finishedAt: minutesAgo(300 - i),
          ...(options.winner && { winnerId: options.winner(i) }),
          ...(options.auto && {
            recentCommandIds: (id: GameId) => [`auto-play:${id}:1:1`, `auto-play:${id}:2:1`],
          }),
        }),
      ),
    );
  }
  return games;
}

const signalRows = async (gameId?: GameId) => {
  const { rows } = await database.sql.query<{
    game_id: GameId;
    type: string;
    player_ids: string[];
  }>(
    `SELECT game_id, type, player_ids FROM detection_signals
     ${gameId ? 'WHERE game_id = $1' : ''} ORDER BY type`,
    gameId ? [gameId] : [],
  );
  return rows;
};
const typesOf = async (gameId: GameId) => (await signalRows(gameId)).map((r) => r.type);
const detectionRowCount = async () => {
  const { rows } = await database.sql.query<{ n: string }>(
    `SELECT (SELECT count(*) FROM detection_signals) + (SELECT count(*) FROM detection_scores) AS n`,
  );
  return Number(rows[0]!.n);
};

describe('Partie non surveillée', () => {
  it('aucune analyse : aucune lecture de l’historique, aucune écriture', async () => {
    // Historique très fourni (surveillé) pour la même paire…
    await seedGames(true, [X, Y], 6, { tables: 3, tricks: declinesAgainst(X, Y) });
    // … mais la partie observée est sur une table NON surveillée.
    const [observed] = await seedGames(false, [X, Y], 1, { tricks: declinesAgainst(X, Y) });
    const { spy, calls } = spiedHistory();
    expect(await detectionWith(spy).analyzeGame(observed!)).toEqual({ skipped: true, recorded: 0 });
    expect(calls).toEqual([]);
    expect(await detectionRowCount()).toBe(0);
  });
});

describe('FREQUENT_COPLAY', () => {
  it('historique insuffisant : aucun signal', async () => {
    const games = await seedGames(true, [X, Y], 3, { tables: 3 });
    await detectionWith().analyzeGame(games.at(-1)!);
    expect(await typesOf(games.at(-1)!.id)).not.toContain('FREQUENT_COPLAY');
  });

  it('paire fréquente sur plusieurs tables : signal documenté sur la partie observée', async () => {
    const games = await seedGames(true, [X, Y], 6, { tables: 3 });
    const observed = games.at(-1)!;
    await detectionWith().analyzeGame(observed);
    const signals = (await detectionWith().listSignals(observed.id)).filter(
      (s) => s.type === 'FREQUENT_COPLAY',
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      gameId: observed.id,
      playerIds: [X, Y].sort(),
      algorithmVersion: 1,
      evidence: {
        algorithm: 'FREQUENT_COPLAY_V1',
        scope: 'LONGITUDINAL',
        observedGameId: observed.id,
        history: { windowDays: 30, source: 'MONITORED_FINISHED_GAMES' },
        metrics: { gamesTogether: 6, sessionsTogether: 3, gamesOfFirst: 6, gamesOfSecond: 6 },
      },
    });
    // Les autres parties de l'historique ne reçoivent rien.
    for (const g of games.slice(0, -1)) expect(await signalRows(g.id)).toEqual([]);
  });

  it('joueurs différents : la paire observée n’hérite pas de la fréquence d’une autre paire', async () => {
    await seedGames(true, [X, Y], 6, { tables: 3 });
    const [observed] = await seedGames(true, [X, Z], 1);
    await detectionWith().analyzeGame(observed!);
    expect(await typesOf(observed!.id)).not.toContain('FREQUENT_COPLAY');
  });

  it('les parties NON surveillées n’alimentent jamais l’historique', async () => {
    await seedGames(false, [X, Y], 6, { tables: 3 });
    const [observed] = await seedGames(true, [X, Y], 1);
    await detectionWith().analyzeGame(observed!);
    expect(await typesOf(observed!.id)).toEqual([]);
  });
});

describe('CARD_CHOICE_ANOMALY', () => {
  it('comportement atypique face à un même contrôleur : signal orienté [décideur, contrôleur]', async () => {
    await seedGames(true, [Z, X], 4, { tricks: takesAgainst(X, Z) });
    const games = await seedGames(true, [Y, X], 4, { tricks: declinesAgainst(X, Y) });
    const observed = games.at(-1)!;
    await detectionWith().analyzeGame(observed);
    const signal = (await detectionWith().listSignals(observed.id)).find(
      (s) => s.type === 'CARD_CHOICE_ANOMALY',
    );
    expect(signal).toMatchObject({
      playerIds: [X, Y],
      evidence: {
        algorithm: 'CARD_CHOICE_ANOMALY_V1',
        metrics: {
          opportunitiesWithController: 8,
          declinedWithController: 8,
          declineRateWithController: 1,
          opportunitiesWithOthers: 8,
          declineRateWithOthers: 0,
          gamesRead: 8,
        },
      },
    });
    // Jamais de main ni de carte dans les éléments justificatifs.
    expect(JSON.stringify(signal!.evidence)).not.toMatch(/COEUR|PIQUE|TREFLE|ETOILE|hand/);
  });

  it('comportement normal : aucun signal', async () => {
    await seedGames(true, [Z, X], 4, { tricks: takesAgainst(X, Z) });
    const games = await seedGames(true, [Y, X], 4, { tricks: takesAgainst(X, Y) });
    await detectionWith().analyzeGame(games.at(-1)!);
    expect(await typesOf(games.at(-1)!.id)).not.toContain('CARD_CHOICE_ANOMALY');
  });

  it('données insuffisantes : aucun signal', async () => {
    await seedGames(true, [Z, X], 4, { tricks: takesAgainst(X, Z) });
    const games = await seedGames(true, [Y, X], 3, { tricks: declinesAgainst(X, Y) });
    await detectionWith().analyzeGame(games.at(-1)!);
    expect(await typesOf(games.at(-1)!.id)).not.toContain('CARD_CHOICE_ANOMALY');
  });

  it('timeout : les mêmes renoncements joués automatiquement ne comptent pas', async () => {
    await seedGames(true, [Z, X], 4, { tricks: takesAgainst(X, Z) });
    const games = await seedGames(true, [Y, X], 4, { tricks: declinesAgainst(X, Y), auto: true });
    await detectionWith().analyzeGame(games.at(-1)!);
    expect(await typesOf(games.at(-1)!.id)).not.toContain('CARD_CHOICE_ANOMALY');
  });
});

describe('CORRELATED_WINS', () => {
  it('corrélation forte à 4 joueurs : observation statistique documentée', async () => {
    const games = await seedGames(true, [X, Y, Z, W], 10, { winner: (i) => (i % 2 ? X : Y) });
    const observed = games.at(-1)!;
    await detectionWith().analyzeGame(observed);
    const signal = (await detectionWith().listSignals(observed.id)).find(
      (s) => s.type === 'CORRELATED_WINS',
    );
    expect(signal).toMatchObject({
      playerIds: [X, Y].sort(),
      evidence: {
        algorithm: 'CORRELATED_WINS_V1',
        metrics: { gamesTogether: 10, pairWins: 10, observedRate: 1, expectedRate: 0.5 },
      },
    });
  });

  it('corrélation normale : aucun signal', async () => {
    const games = await seedGames(true, [X, Y, Z, W], 12, { winner: (i) => [X, Y, Z, W][i % 4]! });
    await detectionWith().analyzeGame(games.at(-1)!);
    expect(await typesOf(games.at(-1)!.id)).not.toContain('CORRELATED_WINS');
  });

  it('échantillon insuffisant : aucun signal', async () => {
    const games = await seedGames(true, [X, Y, Z], 5, { winner: () => X });
    await detectionWith().analyzeGame(games.at(-1)!);
    expect(await typesOf(games.at(-1)!.id)).not.toContain('CORRELATED_WINS');
  });
});

describe('CONNECTION_PATTERN', () => {
  async function sharedTables(pair: [PlayerId, PlayerId], gapsSeconds: number[]) {
    let last: Game | undefined;
    for (const [i, gap] of gapsSeconds.entries()) {
      const arrival = minutesAgo(1_000 - i * 100);
      const sessionId = await table(true, [
        [pair[0], arrival],
        [pair[1], new Date(arrival.getTime() + gap * 1000)],
      ]);
      last = await seed(
        sessionId,
        finishedGame({ players: pair, finishedAt: minutesAgo(900 - i * 100) }),
      );
    }
    return last!;
  }

  it('aucune donnée de synchronisation : aucun signal', async () => {
    const observed = await sharedTables([X, Y], [600, 900, 1_200]);
    await detectionWith().analyzeGame(observed);
    expect(await typesOf(observed.id)).not.toContain('CONNECTION_PATTERN');
  });

  it('arrivées synchronisées répétées : signal, sans aucune IP ni donnée réseau', async () => {
    const observed = await sharedTables([X, Y], [3, 6, 9]);
    await detectionWith().analyzeGame(observed);
    const signal = (await detectionWith().listSignals(observed.id)).find(
      (s) => s.type === 'CONNECTION_PATTERN',
    );
    expect(signal).toMatchObject({
      playerIds: [X, Y].sort(),
      evidence: {
        algorithm: 'CONNECTION_PATTERN_V1',
        metrics: { tablesTogether: 3, synchronizedArrivals: 3, networkData: 'NOT_AVAILABLE' },
      },
    });
    expect(JSON.stringify(signal)).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b|"ip"/i);
  });

  it('isolation : la synchronisation d’une autre paire ne touche pas la partie observée', async () => {
    await sharedTables([V, U], [3, 6, 9]);
    const observed = await sharedTables([X, Y], [600, 900, 1_200]);
    await detectionWith().analyzeGame(observed);
    expect(await typesOf(observed.id)).toEqual([]);
  });
});

describe('Isolation, concurrence et idempotence', () => {
  it('plusieurs parties et tables : les signaux ne touchent que la partie observée', async () => {
    await seedGames(true, [V, U], 6, { tables: 3 });
    const games = await seedGames(true, [X, Y], 6, { tables: 3 });
    const observed = games.at(-1)!;
    await detectionWith().analyzeGame(observed);
    const rows = await signalRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.game_id === observed.id)).toBe(true);
    expect(rows.flatMap((r) => r.player_ids).every((id) => id === X || id === Y)).toBe(true);
  });

  it('idempotence : le même événement traité deux fois ne crée aucun doublon', async () => {
    const games = await seedGames(true, [X, Y], 6, { tables: 3 });
    const detection = detectionWith();
    const first = await detection.analyzeGame(games.at(-1)!);
    const before = await signalRows();
    const second = await detection.analyzeGame(games.at(-1)!);
    expect(first).toMatchObject({ recorded: before.length });
    expect(second).toMatchObject({ skipped: false, recorded: 0 });
    expect(await signalRows()).toEqual(before);
  });

  it('concurrence : deux analyses simultanées (deux instances) ne créent aucun doublon', async () => {
    const games = await seedGames(true, [X, Y], 6, { tables: 3 });
    const observed = games.at(-1)!;
    const results = await Promise.all([
      detectionWith().analyzeGame(observed),
      detectionWith().analyzeGame(observed),
    ]);
    const rows = await signalRows();
    expect(new Set(rows.map((r) => `${r.type}|${r.player_ids.join(',')}`)).size).toBe(rows.length);
    expect(results.reduce((n, r) => n + r.recorded, 0)).toBe(rows.length);
  });

  it('étape 4 : score de la paire calculé, aucune alerte pour un seul type de signal', async () => {
    const games = await seedGames(true, [X, Y], 6, { tables: 3 });
    const detection = detectionWith();
    await detection.analyzeGame(games.at(-1)!);
    expect(await detection.listScores(games.at(-1)!.id)).toEqual([
      expect.objectContaining({ scope: 'PAIR', score: 10, level: 'low' }),
    ]);
    expect(await detection.listAlerts()).toEqual([]);
  });
});
