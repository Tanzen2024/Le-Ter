import { randomUUID } from 'node:crypto';

import request from 'supertest';

import type { SignalDraft } from '../../../src/domain/detection/detection';
import type { SignalType } from '../../../src/domain/detection/detection-config';
import type { Game, GameType } from '../../../src/domain/game/game';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { GaramCardId } from '../../../src/domain/garam/garam-cards';
import type { SessionId } from '../../../src/domain/sessions/session';
import { PostgresDetectionAdminRepository } from '../../../src/repositories/postgres-detection-admin.repository';
import { PostgresBehaviorHistoryRepository } from '../../../src/repositories/postgres-behavior-history.repository';
import { PostgresDetectionSettingsRepository } from '../../../src/repositories/postgres-detection-settings.repository';
import { PostgresDetectionRepository } from '../../../src/repositories/postgres-detection.repository';
import {
  insertGameRows,
  PostgresGameRepository,
} from '../../../src/repositories/postgres-game.repository';
import { PostgresGeolocationRepository } from '../../../src/repositories/postgres-geolocation.repository';
import { createBehaviorAnalyzers } from '../../../src/services/detection/behavior-analyzers';
import { DetectionAdminService } from '../../../src/services/detection/detection-admin.service';
import { DetectionSettingsService } from '../../../src/services/detection/detection-settings.service';
import { DetectionService } from '../../../src/services/detection/detection.service';
import { createGeoAnalyzers } from '../../../src/services/detection/geo-analyzers';
import { GeolocationService } from '../../../src/services/detection/geolocation.service';
import { createLogger } from '../../../src/utils/logger';
import { adminLogin } from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import { finishedGame } from '../../fixtures/detection-history';
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
import { garamDecksRandom } from '../../fixtures/random';

/**
 * Détection anti-collusion des manches GARAM TIA (D-125) : le MÊME système que Fap-Fap
 * (R-36, D-043 à D-053), assemblé comme en production (create-game-service.ts) : option de
 * table, interrupteur global de l'administration, consentement, analyse en fin de manche,
 * signaux, score et alertes internes. Aucun moteur ni réglage propre à GARAM.
 */
jest.setTimeout(90_000);

const DOUALA = { latitude: 4.0511, longitude: 9.7679 };
const north = (meters: number) => ({
  latitude: DOUALA.latitude + meters / 111_195,
  longitude: DOUALA.longitude,
});
/** Manche courte : a joue COEUR-9, b COEUR-3, b tire ; a gagne au meilleur total. */
const SHORT_ROUND: GaramCardId[] = [
  'COEUR-9', 'TREFLE-10', 'PIQUE-10',
  'COEUR-3', 'CARREAU-4', 'TREFLE-5',
  'PIQUE-3', 'CARREAU-11', 'TREFLE-7',
];

let database: TestDatabase;
let ctx: GameApiTestContext;
let detection: DetectionService;
let positions: PostgresGeolocationRepository;
let admin: Player;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

/** Assemblage comme en production : géographie ET comportement, même interrupteur global. */
function assemble() {
  const logger = createLogger({}, () => undefined);
  const settings = new DetectionSettingsService({
    repository: new PostgresDetectionSettingsRepository(database.sql),
    logger,
  });
  positions = new PostgresGeolocationRepository(database.sql);
  detection = new DetectionService({
    repository: new PostgresDetectionRepository(database.sql),
    globalSwitch: settings,
    logger,
    analyzers: [
      ...createGeoAnalyzers(positions),
      ...createBehaviorAnalyzers(
        new PostgresBehaviorHistoryRepository(database.sql),
        new PostgresGameRepository(database.sql),
      ),
    ],
  });
  ctx = createGameApiTestApp(database.sql, {
    random: garamDecksRandom(SHORT_ROUND),
    turnDurationMs: 60_000,
    decisionWindowMs: 60_000,
    stakePolicies: true,
    geolocation: new GeolocationService({ repository: positions, globalSwitch: settings, logger }),
    detectionAdmin: new DetectionAdminService({
      repository: new PostgresDetectionAdminRepository(database.sql),
      logger,
    }),
    detectionSettings: settings,
  });
  ctx.games.onGameFinished((game) => detection.observeFinishedGame(game));
}

beforeEach(async () => {
  assemble();
  admin = await newAdmin();
});
afterEach(async () => {
  await ctx.stopTimers();
  await detection.idle();
  await database.reset();
});

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  await database.sql.query(
    'INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, 10000, now(), now())',
    [session.userId],
  );
  return { ...session, id: session.userId as PlayerId, api: as(ctx.app, session.accessToken) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

async function newAdmin(): Promise<Player> {
  const account = await newPlayer();
  await database.sql.query("UPDATE users SET role = 'admin' WHERE id = $1", [account.id]);
  const login = await adminLogin(ctx.app, account.email, account.password, account.id);
  return { ...account, ...login, id: account.id, api: as(ctx.app, login.accessToken) };
}

/** Réglage de l'administration (Paramètres → Détection anti-collusion), commun aux jeux. */
const setGlobal = (enabled: boolean) =>
  expectStatus(
    request(ctx.app)
      .patch('/api/admin/settings/detection')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ enabled }),
    200,
  );

/** Table GARAM de 2 joueurs, surveillée ou non ; b assis et inscrit à la manche. */
async function garamTable(a: Player, b: Player, monitored: boolean) {
  const created = await expectStatus(
    a.api.post('/api/sessions', {
      maxPlayers: 2,
      stakeAmount: 100,
      gameType: 'GARAM',
      garamVariant: 15,
      suspicionDetectionEnabled: monitored,
    }),
    201,
  );
  const sessionId = created.body.session.sessionId as string;
  const gameId = created.body.game.gameId as GameId;
  await expectStatus(b.api.post(`/api/sessions/${sessionId}/join`), 200);
  await expectStatus(b.api.post(`/api/games/${gameId}/join`), 200);
  return { created, sessionId, gameId };
}

async function consentAll(gameId: GameId, ...players: Player[]) {
  for (const p of players) {
    await expectStatus(p.api.post(`/api/games/${gameId}/geolocation/consent`, {}), 200);
  }
}

const act = (p: Player, gameId: GameId, type: string, payload?: object) =>
  expectStatus(
    p.api.post(`/api/games/${gameId}/actions`, {
      commandId: randomUUID(),
      type,
      ...(payload && { payload }),
    }),
    200,
  );

/** Manche jouée par HTTP jusqu'au bout, puis analyse de fin de manche attendue. */
async function playShortRound(a: Player, b: Player, gameId: GameId) {
  await expectStatus(a.api.post(`/api/games/${gameId}/start`), 200);
  await act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-9' });
  await act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-3' });
  await act(b, gameId, 'DRAW_CARD');
  const view = await expectStatus(a.api.get(`/api/games/${gameId}`), 200);
  expect(view.body.game.status).toBe('finished');
  await detection.idle();
}

/** Deux joueurs à ~20 m pendant 90 s (proximité forte). */
async function closeTogether(gameId: GameId, a: PlayerId, b: PlayerId) {
  const base = Date.now() - 10 * 60_000;
  for (const [playerId, where, offset] of [
    [a, DOUALA, 0],
    [b, north(20), 5],
  ] as const) {
    for (const seconds of [0, 45, 90]) {
      await positions.insertPosition({
        id: randomUUID(),
        gameId,
        playerId,
        ...where,
        accuracyMeters: 10,
        capturedAt: new Date(base + (seconds + offset) * 1000),
        receivedAt: new Date(),
      });
    }
  }
}

/**
 * Historique GARAM SURVEILLÉ déjà terminé de la paire (écrit dans les vraies tables) : 3 tables
 * aux arrivées synchronisées, 2 manches chacune. Renvoie les manches.
 */
async function garamHistory(a: PlayerId, b: PlayerId): Promise<Game[]> {
  const games: Game[] = [];
  for (let t = 0; t < 3; t += 1) {
    const sessionId = randomUUID() as SessionId;
    const arrival = new Date(Date.now() - (600 - t * 60) * 60_000);
    await database.sql.query(
      `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at,
         updated_at, suspicion_detection_enabled, game_type, garam_variant)
       VALUES ($1, 1, 'open', $2, 2, $3, $3, true, 'GARAM', 15)`,
      [sessionId, a, arrival.toISOString()],
    );
    for (const [seat, playerId] of [a, b].entries()) {
      await database.sql.query(
        `INSERT INTO session_players (session_id, player_id, seat, arrival, active, joined_at)
         VALUES ($1, $2, $3, $4, true, $5)`,
        [sessionId, playerId, seat, seat + 1, new Date(arrival.getTime() + seat * 3_000)],
      );
    }
    for (let i = 0; i < 2; i += 1) {
      const game = finishedGame({
        players: [a, b],
        sessionId,
        endReason: 'GARAM_BEST_SCORE',
        finishedAt: new Date(Date.now() - (300 - t * 60 - i) * 60_000),
      });
      game.gameType = 'GARAM';
      game.garamVariant = 15;
      await insertGameRows(database.sql, game);
      games.push(game);
    }
    await database.sql.query(
      `UPDATE session_players SET active = false, left_at = now() WHERE session_id = $1`,
      [sessionId],
    );
  }
  return games;
}

const counts = async (gameId: GameId) => {
  const n = async (table: string) => {
    const { rows } = await database.sql.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE game_id = $1`,
      [gameId],
    );
    return Number(rows[0]!.n);
  };
  return {
    positions: await n('detection_positions'),
    signals: await n('detection_signals'),
    scores: await n('detection_scores'),
    alerts: await n('detection_alerts'),
  };
};

describe('création d’une partie GARAM : configuration et initialisation', () => {
  it('global ON : option proposée pour GARAM, table surveillée, consentement exigé', async () => {
    await setGlobal(true);
    const a = await newPlayer();
    const b = await newPlayer();
    const open = await expectStatus(a.api.get('/api/sessions/open?gameType=GARAM'), 200);
    expect(open.body.detectionAvailable).toBe(true);

    const { created, sessionId, gameId } = await garamTable(a, b, true);
    expect(created.body.session).toMatchObject({
      gameType: 'GARAM',
      suspicionDetectionEnabled: true,
    });
    const { rows } = await database.sql.query<{ game_type: string; detection: boolean }>(
      `SELECT game_type, suspicion_detection_enabled AS detection FROM sessions WHERE id = $1`,
      [sessionId],
    );
    expect(rows[0]).toEqual({ game_type: 'GARAM', detection: true });

    // Même initialisation que Fap-Fap : géolocalisation active, démarrage bloqué sans
    // le consentement de chaque joueur (D-095).
    const status = await expectStatus(a.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(status.body).toMatchObject({ detectionEnabled: true, consentGiven: false });
    const refused = await a.api.post(`/api/games/${gameId}/start`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('DETECTION_CONSENT_PENDING');
    await consentAll(gameId, a, b);
    await expectStatus(a.api.post(`/api/games/${gameId}/start`), 200);
  });

  it('global OFF : l’option n’est jamais enregistrée pour une table GARAM', async () => {
    await setGlobal(false);
    const a = await newPlayer();
    const b = await newPlayer();
    const { created, gameId } = await garamTable(a, b, true);
    expect(created.body.session.suspicionDetectionEnabled).toBe(false);
    const status = await expectStatus(a.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(status.body).toEqual({ detectionEnabled: false });
  });
});

describe('fin de manche GARAM : analyse par le système commun', () => {
  it('table non surveillée : aucune analyse, aucune écriture', async () => {
    await setGlobal(true);
    const a = await newPlayer();
    const b = await newPlayer();
    const { gameId } = await garamTable(a, b, false);
    await playShortRound(a, b, gameId);
    expect(await counts(gameId)).toEqual({ positions: 0, signals: 0, scores: 0, alerts: 0 });
  });

  it('table surveillée : proximité détectée sur la manche, signal et score enregistrés', async () => {
    await setGlobal(true);
    const a = await newPlayer();
    const b = await newPlayer();
    const { gameId } = await garamTable(a, b, true);
    await consentAll(gameId, a, b);
    await closeTogether(gameId, a.id, b.id);
    await playShortRound(a, b, gameId);

    const signals = await detection.listSignals(gameId);
    expect(signals).toEqual([
      expect.objectContaining({
        type: 'PROXIMITY',
        gameId,
        playerIds: expect.arrayContaining([a.id, b.id]),
      }),
    ]);
    expect(await detection.listScores(gameId)).toEqual([
      expect.objectContaining({ scope: 'PAIR', score: 20 }),
    ]);
  });

  it('comportement suspect répété : alerte interne créée sur la manche GARAM', async () => {
    await setGlobal(true);
    const a = await newPlayer();
    const b = await newPlayer();
    // Historique GARAM : 6 manches sur 3 tables synchronisées, proximité sur 2 d'entre elles.
    const history = await garamHistory(a.id, b.id);
    for (const game of history.slice(-2)) {
      await closeTogether(game.id, a.id, b.id);
      await detection.analyzeGame(game);
    }
    const { gameId } = await garamTable(a, b, true);
    await consentAll(gameId, a, b);
    await closeTogether(gameId, a.id, b.id);
    await playShortRound(a, b, gameId);

    const types = (await detection.listSignals(gameId)).map((s) => s.type).sort();
    expect(types).toEqual([
      'CONNECTION_PATTERN',
      'FREQUENT_COPLAY',
      'PROXIMITY',
      'REPEATED_PROXIMITY',
    ]);
    // 20 + 15 + 10 + 10 = 55 : niveau élevé, alerte NORMAL (mêmes seuils que Fap-Fap).
    expect(await detection.listScores(gameId)).toEqual([
      expect.objectContaining({ scope: 'PAIR', score: 55, level: 'high' }),
    ]);
    expect(await detection.listAlerts({ gameId })).toEqual([
      expect.objectContaining({ level: 'high', priority: 'NORMAL', status: 'NEW', gameId }),
    ]);
    // Visible par l'administration existante, comme une alerte Fap-Fap.
    const listed = await expectStatus(
      request(ctx.app)
        .get('/api/admin/detection/alerts')
        .set('Authorization', `Bearer ${admin.accessToken}`),
      200,
    );
    expect(listed.body.items).toEqual([expect.objectContaining({ gameId, level: 'high' })]);
  });
});

/** Partie surveillée terminée d'un jeu donné, pour la paire (vraies tables du jeu). */
async function monitoredGame(a: PlayerId, b: PlayerId, gameType: GameType): Promise<GameId> {
  const sessionId = randomUUID() as SessionId;
  await database.sql.query(
    `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at,
       updated_at, suspicion_detection_enabled, game_type, garam_variant)
     VALUES ($1, 1, 'open', $2, 2, now(), now(), true, $3,
       CASE WHEN $3::text = 'GARAM' THEN 15 END)`,
    [sessionId, a, gameType],
  );
  for (const [seat, playerId] of [a, b].entries()) {
    await database.sql.query(
      `INSERT INTO session_players (session_id, player_id, seat, arrival, active, joined_at)
       VALUES ($1, $2, $3, $4, true, now())`,
      [sessionId, playerId, seat, seat + 1],
    );
  }
  const game = finishedGame({
    players: [a, b],
    sessionId,
    ...(gameType === 'GARAM' && { endReason: 'GARAM_BEST_SCORE' as const }),
  });
  if (gameType === 'GARAM') {
    game.gameType = 'GARAM';
    game.garamVariant = 15;
  }
  await insertGameRows(database.sql, game);
  await database.sql.query(
    `UPDATE session_players SET active = false, left_at = now() WHERE session_id = $1`,
    [sessionId],
  );
  return game.id;
}

/** Contributions usuelles (detection-config.ts) : aucune valeur propre au test. */
const CONTRIBUTION: Partial<Record<SignalType, number>> = {
  PROXIMITY: 20,
  REPEATED_PROXIMITY: 15,
  IMPOSSIBLE_TRAVEL: 15,
  INCOHERENT_LOCATION: 10,
  FREQUENT_COPLAY: 10,
  CARD_CHOICE_ANOMALY: 20,
};
const drafts = (pair: [PlayerId, PlayerId], types: SignalType[]): SignalDraft[] =>
  types.map((type) => ({
    type,
    severity: 'medium',
    contribution: CONTRIBUTION[type]!,
    playerIds: [...pair],
    evidence: {},
  }));
const alertRows = async () =>
  (
    await database.sql.query<{ game_id: GameId; level: string; dedupe_key: string }>(
      'SELECT game_id, level, dedupe_key FROM detection_alerts ORDER BY created_at, id',
    )
  ).rows;

describe('isolation des scores Fap-Fap / GARAM (D-125)', () => {
  const HIGH: SignalType[] = ['PROXIMITY', 'REPEATED_PROXIMITY', 'FREQUENT_COPLAY', 'INCOHERENT_LOCATION'];

  it('un score Fap-Fap ignore les signaux GARAM de la même paire, et inversement', async () => {
    await setGlobal(true);
    const a = await newPlayer();
    const b = await newPlayer();
    const pair: [PlayerId, PlayerId] = [a.id, b.id];
    const garam = await monitoredGame(a.id, b.id, 'GARAM');
    const ter = await monitoredGame(a.id, b.id, 'TER');
    const garam2 = await monitoredGame(a.id, b.id, 'GARAM');

    // GARAM : 20 + 15 + 10 + 10 = 55 (élevé).
    await detection.recordSignals(garam, drafts(pair, HIGH));
    expect(await detection.listScores(garam)).toEqual([
      expect.objectContaining({ score: 55, level: 'high', previousScore: null }),
    ]);

    // Fap-Fap, même paire : seul son signal compte ; aucun score précédent hérité de GARAM.
    await detection.recordSignals(ter, drafts(pair, ['PROXIMITY']));
    const [terScore] = await detection.listScores(ter);
    expect(terScore).toMatchObject({ score: 20, level: 'low', previousScore: null });
    expect(terScore!.components.map((c) => c.sourceGameId)).toEqual([ter]);

    // GARAM de nouveau : ses signaux GARAM, son score précédent GARAM, rien du Ter.
    await detection.recordSignals(garam2, drafts(pair, ['CARD_CHOICE_ANOMALY']));
    const [garamScore] = await detection.listScores(garam2);
    expect(garamScore).toMatchObject({ score: 75, level: 'very_high', previousScore: 55 });
    expect(new Set(garamScore!.components.map((c) => c.sourceGameId))).toEqual(
      new Set([garam, garam2]),
    );
  });

  it('alertes : une alerte GARAM ne déduplique ni ne masque une alerte Fap-Fap', async () => {
    await setGlobal(true);
    const a = await newPlayer();
    const b = await newPlayer();
    const pair: [PlayerId, PlayerId] = [a.id, b.id];
    const garam = await monitoredGame(a.id, b.id, 'GARAM');
    const ter = await monitoredGame(a.id, b.id, 'TER');

    // GARAM très élevé (≥ 75) puis Fap-Fap élevé, même paire, même période de 30 jours.
    await detection.recordSignals(garam, drafts(pair, [...HIGH, 'CARD_CHOICE_ANOMALY']));
    await detection.recordSignals(ter, drafts(pair, HIGH));

    const alerts = await alertRows();
    expect(alerts).toEqual([
      expect.objectContaining({ game_id: garam, level: 'very_high' }),
      expect.objectContaining({ game_id: ter, level: 'high' }),
    ]);
    // Clé Fap-Fap au format d'origine (inchangée) ; clé GARAM suffixée du jeu.
    const day = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/);
    const subject = [a.id, b.id].sort();
    expect(alerts[1]!.dedupe_key.split('|')).toEqual([
      'SUSPICION_LEVEL', ...subject, 'high', 'v2', day,
    ]);
    expect(alerts[0]!.dedupe_key.split('|')).toEqual([
      'SUSPICION_LEVEL', ...subject, 'very_high', 'v2', day, 'GARAM',
    ]);

    // Rejeu : aucun doublon, dans aucun des deux jeux.
    await detection.recordSignals(garam, drafts(pair, [...HIGH, 'CARD_CHOICE_ANOMALY']));
    await detection.recordSignals(ter, drafts(pair, HIGH));
    expect(await alertRows()).toHaveLength(2);
  });
});
