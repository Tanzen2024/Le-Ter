import { randomUUID } from 'node:crypto';

import request from 'supertest';

import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { GaramCardId } from '../../../src/domain/garam/garam-cards';
import { PostgresDetectionAdminRepository } from '../../../src/repositories/postgres-detection-admin.repository';
import { PostgresBehaviorHistoryRepository } from '../../../src/repositories/postgres-behavior-history.repository';
import { PostgresDetectionSettingsRepository } from '../../../src/repositories/postgres-detection-settings.repository';
import { PostgresDetectionRepository } from '../../../src/repositories/postgres-detection.repository';
import { PostgresGameRepository } from '../../../src/repositories/postgres-game.repository';
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
 * GARAM TIA sans détection anti-collusion (D-144, remplace D-125), assemblé comme en
 * production (create-game-service.ts) : l'option est ignorée à la création, aucune
 * géolocalisation ni analyse de fin de manche, et la base refuse une table GARAM surveillée.
 * Fap-Fap garde la détection (R-36, D-043 à D-053).
 */
jest.setTimeout(90_000);

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

/**
 * Ancienne table GARAM surveillée (avant D-144), reproduite pour le test seulement : la
 * contrainte 0055 et le verrou d'immuabilité (D-043) sont levés le temps de l'écriture.
 */
async function legacyMonitoredGaram(sessionId: string) {
  await database.sql.query('ALTER TABLE sessions DROP CONSTRAINT sessions_no_detection_for_garam');
  await database.sql.query(
    'ALTER TABLE sessions DISABLE TRIGGER sessions_suspicion_detection_immutable',
  );
  try {
    await database.sql.query(
      `UPDATE sessions SET suspicion_detection_enabled = true WHERE id = $1`,
      [sessionId],
    );
  } finally {
    await database.sql.query(
      'ALTER TABLE sessions ENABLE TRIGGER sessions_suspicion_detection_immutable',
    );
    await database.sql.query(
      `ALTER TABLE sessions ADD CONSTRAINT sessions_no_detection_for_garam
         CHECK (NOT (game_type = 'GARAM' AND suspicion_detection_enabled)) NOT VALID`,
    );
  }
}

describe('création d’une partie GARAM : aucune détection (D-144)', () => {
  it('global ON et option demandée : table non surveillée, aucun consentement', async () => {
    await setGlobal(true);
    const a = await newPlayer();
    const b = await newPlayer();
    const { created, sessionId, gameId } = await garamTable(a, b, true);
    expect(created.body.session).toMatchObject({
      gameType: 'GARAM',
      suspicionDetectionEnabled: false,
    });
    const { rows } = await database.sql.query<{ detection: boolean }>(
      'SELECT suspicion_detection_enabled AS detection FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(rows[0]).toEqual({ detection: false });
    const status = await expectStatus(a.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(status.body).toEqual({ detectionEnabled: false });
    // Démarrage sans consentement de géolocalisation.
    await expectStatus(a.api.post(`/api/games/${gameId}/start`), 200);
  });

  it('Fap-Fap inchangé : même demande, table surveillée et consentement exigé', async () => {
    await setGlobal(true);
    const a = await newPlayer();
    const created = await expectStatus(
      a.api.post('/api/sessions', {
        maxPlayers: 2,
        stakeAmount: 100,
        suspicionDetectionEnabled: true,
      }),
      201,
    );
    expect(created.body.session.suspicionDetectionEnabled).toBe(true);
    const gameId = created.body.game.gameId as GameId;
    const status = await expectStatus(a.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(status.body).toMatchObject({ detectionEnabled: true, consentGiven: false });
  });

  it('la base refuse une table GARAM surveillée (migration 0055)', async () => {
    const a = await newPlayer();
    await expect(
      database.sql.query(
        `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at,
           updated_at, suspicion_detection_enabled, game_type, garam_variant)
         VALUES ($1, 1, 'open', $2, 2, now(), now(), true, 'GARAM', 15)`,
        [randomUUID(), a.id],
      ),
    ).rejects.toThrow(/sessions_no_detection_for_garam/);
  });
});

describe('fin de manche GARAM : jamais analysée (D-144)', () => {
  it('option demandée à la création : aucune analyse, aucune écriture', async () => {
    await setGlobal(true);
    const a = await newPlayer();
    const b = await newPlayer();
    const { gameId } = await garamTable(a, b, true);
    await playShortRound(a, b, gameId);
    expect(await counts(gameId)).toEqual({ positions: 0, signals: 0, scores: 0, alerts: 0 });
  });

  it('ancienne table GARAM surveillée : ni consentement, ni analyse', async () => {
    await setGlobal(true);
    const a = await newPlayer();
    const b = await newPlayer();
    const { sessionId, gameId } = await garamTable(a, b, false);
    await legacyMonitoredGaram(sessionId);
    const status = await expectStatus(a.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(status.body).toEqual({ detectionEnabled: false });
    await playShortRound(a, b, gameId);
    expect(await counts(gameId)).toEqual({ positions: 0, signals: 0, scores: 0, alerts: 0 });
  });
});
