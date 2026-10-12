import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';
import request from 'supertest';

import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { PostgresDetectionAdminRepository } from '../../../src/repositories/postgres-detection-admin.repository';
import { PostgresDetectionSettingsRepository } from '../../../src/repositories/postgres-detection-settings.repository';
import { PostgresDetectionRepository } from '../../../src/repositories/postgres-detection.repository';
import { PostgresGeolocationRepository } from '../../../src/repositories/postgres-geolocation.repository';
import { DetectionAdminService } from '../../../src/services/detection/detection-admin.service';
import { DetectionSettingsService } from '../../../src/services/detection/detection-settings.service';
import { DetectionService } from '../../../src/services/detection/detection.service';
import { createGeoAnalyzers } from '../../../src/services/detection/geo-analyzers';
import { GeolocationService } from '../../../src/services/detection/geolocation.service';
import { createLogger } from '../../../src/utils/logger';
import { adminLogin } from '../../fixtures/admin';
import { registerAndLogin, TEST_JWT_SECRET } from '../../fixtures/auth';
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

/**
 * Interrupteur GLOBAL de la détection (R-36, D-053) sur PostgreSQL, avec l'assemblage réel :
 * DetectionService et GeolocationService consultent le même DetectionSettingsService que
 * l'administration. Activation effective = global ET table surveillée.
 */
jest.setTimeout(90_000);

const PATH = '/api/admin/settings/detection';
const DOUALA = { latitude: 4.0511, longitude: 9.7679 };
const north = (meters: number) => ({
  latitude: DOUALA.latitude + meters / 111_195,
  longitude: DOUALA.longitude,
});

let database: TestDatabase;
let ctx: GameApiTestContext;
let settings: DetectionSettingsService;
let detection: DetectionService;
let positions: PostgresGeolocationRepository;
let admin: Player;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

/** Assemblage comme en production (create-game-service.ts), sur la même base. */
function assemble() {
  const logger = createLogger({}, () => undefined);
  settings = new DetectionSettingsService({
    repository: new PostgresDetectionSettingsRepository(database.sql),
    logger,
  });
  positions = new PostgresGeolocationRepository(database.sql);
  detection = new DetectionService({
    repository: new PostgresDetectionRepository(database.sql),
    globalSwitch: settings,
    logger,
    analyzers: createGeoAnalyzers(positions),
  });
  ctx = createGameApiTestApp(database.sql, {
    rules: testRules,
    random: identityRandom,
    decisionWindowMs: 60_000,
    turnDurationMs: 60_000,
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
  // Toute route /api/admin/* exige une session d'administration (D-061).
  admin = await newAdmin();
});
afterEach(async () => {
  await ctx.stopTimers();
  await detection.idle();
  await database.reset();
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

/** Administrateur : rôle attribué comme `npm run user:role`, puis session admin (D-061). */
async function newAdmin(): Promise<Player> {
  const account = await newPlayer();
  await database.sql.query("UPDATE users SET role = 'admin' WHERE id = $1", [account.id]);
  const login = await adminLogin(ctx.app, account.email, account.password, account.id);
  return { ...account, ...login, id: account.id, api: as(ctx.app, login.accessToken) };
}

const patch = (p: Player, body: unknown) =>
  request(ctx.app)
    .patch(PATH)
    .set('Authorization', `Bearer ${p.accessToken}`)
    .send(body as object);
const setGlobal = async (enabled: boolean) => expectStatus(patch(admin, { enabled }), 200);

/** Table de 2 joueurs (partie en attente), surveillée ou non. */
async function table(monitored: boolean) {
  const owner = await newPlayer();
  const guest = await newPlayer();
  const res = await expectStatus(
    owner.api.post('/api/sessions', { maxPlayers: 2, suspicionDetectionEnabled: monitored }),
    201,
  );
  const sessionId = res.body.session.sessionId as string;
  const gameId = res.body.game.gameId as GameId;
  await expectStatus(guest.api.post(`/api/sessions/${sessionId}/join`), 200);
  await expectStatus(guest.api.post(`/api/games/${gameId}/join`), 200);
  return { owner, guest, gameId };
}

/** Trace GPS écrite directement : deux joueurs à ~20 m pendant 90 s (signal PROXIMITY). */
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

async function start(owner: Player, gameId: GameId) {
  await expectStatus(owner.api.post(`/api/games/${gameId}/start`), 200);
}
async function playToEnd(owner: Player, guest: Player, gameId: GameId) {
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
  await detection.idle();
}

const count = async (table: string, gameId?: GameId) => {
  const { rows } = await database.sql.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table}${gameId ? ' WHERE game_id = $1' : ''}`,
    gameId ? [gameId] : [],
  );
  return Number(rows[0]!.n);
};
const detectionCounts = async (gameId?: GameId) => ({
  positions: await count('detection_positions', gameId),
  signals: await count('detection_signals', gameId),
  scores: await count('detection_scores', gameId),
  alerts: await count('detection_alerts', gameId),
});
const auditRows = async () =>
  (
    await database.sql.query<{
      actor_id: string;
      action: string;
      target_type: string;
      target_id: string | null;
      details: unknown;
    }>(
      `SELECT actor_id, action, target_type, target_id, details FROM admin_audit_log
       WHERE action NOT IN ('ADMIN_LOGIN_SUCCEEDED', 'ADMIN_LOGIN_FAILED', 'ADMIN_LOGOUT', 'ADMIN_SESSION_EXPIRED') ORDER BY created_at, id`,
    )
  ).rows;

describe('Paramètre global', () => {
  it('paramètre absent → désactivé (false), sans ligne en base', async () => {
    expect(await count('system_settings')).toBe(0);
    expect(await settings.isGloballyEnabled()).toBe(false);
    const res = await expectStatus(admin.api.get(PATH), 200);
    expect(res.body).toEqual({ enabled: false, updatedAt: null });
  });

  it('activation puis désactivation : confirmées par le serveur, relues en base', async () => {
    const on = await setGlobal(true);
    expect(on.body).toEqual({ enabled: true, updatedAt: expect.any(String), changed: true });
    expect((await admin.api.get(PATH)).body.enabled).toBe(true);
    expect(await settings.isGloballyEnabled()).toBe(true);

    const off = await setGlobal(false);
    expect(off.body).toMatchObject({ enabled: false, changed: true });
    expect((await admin.api.get(PATH)).body.enabled).toBe(false);
    const { rows } = await database.sql.query<{ value: unknown; updated_by: string }>(
      "SELECT value, updated_by FROM system_settings WHERE key = 'detection_enabled'",
    );
    expect(rows).toEqual([{ value: false, updated_by: admin.id }]);
  });

  it('entrées invalides → 400, valeur inchangée', async () => {
    for (const body of [
      {},
      { enabled: 'true' },
      { enabled: 1 },
      { enabled: null },
      { enabled: true, adminId: admin.id },
      { enabled: true, key: 'other' },
    ]) {
      const res = await patch(admin, body);
      expect([body, res.status]).toEqual([body, 400]);
    }
    expect(await settings.isGloballyEnabled()).toBe(false);
    expect(await auditRows()).toEqual([]);
  });

  it('la base refuse toute autre clé ou une valeur non booléenne', async () => {
    await expect(
      database.sql.query(
        "INSERT INTO system_settings (key, value, updated_at) VALUES ('other', 'true', now())",
      ),
    ).rejects.toThrow();
    await expect(
      database.sql.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ('detection_enabled', '"yes"', now())`,
      ),
    ).rejects.toThrow();
  });
});

describe('Permissions', () => {
  it('non authentifié → 401 (lecture et modification)', async () => {
    expect((await request(ctx.app).get(PATH)).status).toBe(401);
    expect((await request(ctx.app).patch(PATH).send({ enabled: true })).status).toBe(401);
  });

  it('joueur → 403 : ni lecture, ni activation, ni désactivation', async () => {
    const player = await newPlayer();
    expect((await player.api.get(PATH)).status).toBe(403);
    expect((await patch(player, { enabled: true })).status).toBe(403);
    await setGlobal(true);
    expect((await patch(player, { enabled: false })).status).toBe(403);
    expect(await settings.isGloballyEnabled()).toBe(true);
  });

  it('JWT signé revendiquant admin, rôle en base `user` → 403', async () => {
    const player = await newPlayer();
    const claims = jwt.decode(player.accessToken) as jwt.JwtPayload;
    const forged = jwt.sign({ ...claims, role: 'admin' }, TEST_JWT_SECRET);
    const res = await request(ctx.app)
      .patch(PATH)
      .set('Authorization', `Bearer ${forged}`)
      .send({ enabled: true });
    expect(res.status).toBe(403);
    expect(await settings.isGloballyEnabled()).toBe(false);
  });

  it('rôle retiré → 403 immédiat', async () => {
    await database.sql.query("UPDATE users SET role = 'user' WHERE id = $1", [admin.id]);
    expect((await admin.api.get(PATH)).status).toBe(403);
  });

  it('aucun endpoint joueur ne révèle l’interrupteur', async () => {
    const { owner, gameId } = await table(true);
    const views = [
      await owner.api.get(`/api/games/${gameId}`),
      await owner.api.get(`/api/games/${gameId}/geolocation`),
      await owner.api.get('/api/auth/me'),
    ];
    const text = JSON.stringify(views.map((v) => v.body));
    expect(text).not.toMatch(/detection_enabled|globalDetection|detectionGlobal|system_settings/);
  });
});

describe('Audit administratif', () => {
  it('activation et désactivation auditées (acteur = session, ancienne / nouvelle valeur)', async () => {
    await setGlobal(true);
    await setGlobal(false);
    const audit = await auditRows();
    expect(audit).toHaveLength(2);
    expect(audit).toEqual(
      expect.arrayContaining([
        {
          actor_id: admin.id,
          action: 'DETECTION_ENABLED',
          target_type: 'SYSTEM_SETTING',
          target_id: null,
          details: { key: 'detection_enabled', from: false, to: true },
        },
        {
          actor_id: admin.id,
          action: 'DETECTION_DISABLED',
          target_type: 'SYSTEM_SETTING',
          target_id: null,
          details: { key: 'detection_enabled', from: true, to: false },
        },
      ]),
    );
    const { rows } = await database.sql.query('SELECT row_to_json(a) AS r FROM admin_audit_log a');
    expect(JSON.stringify(rows)).not.toMatch(
      new RegExp(`${admin.accessToken}|Bearer|password|token|latitude|"ip"`, 'i'),
    );
    expect(JSON.stringify(ctx.logLines)).not.toContain(admin.accessToken);
  });

  it('idempotence : même valeur → 200, changed=false, aucun audit', async () => {
    const offWhileAbsent = await setGlobal(false);
    expect(offWhileAbsent.body).toMatchObject({ enabled: false, changed: false });
    await setGlobal(true);
    const again = await setGlobal(true);
    expect(again.body).toMatchObject({ enabled: true, changed: false });
    expect((await auditRows()).map((r) => r.action)).toEqual(['DETECTION_ENABLED']);
  });

  it('concurrence : deux activations simultanées → un seul changement audité', async () => {
    const second = await newAdmin();
    const results = await Promise.all([
      patch(admin, { enabled: true }),
      patch(second, { enabled: true }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.changed).sort()).toEqual([false, true]);
    expect(await auditRows()).toHaveLength(1);
    expect(await count('system_settings')).toBe(1);
  });

  it('concurrence : ON et OFF simultanés → sérialisés, audit cohérent avec la valeur finale', async () => {
    const second = await newAdmin();
    await setGlobal(true);
    await Promise.all([patch(admin, { enabled: false }), patch(second, { enabled: true })]);
    const audit = (await auditRows()) as { details: { from: boolean; to: boolean } }[];
    // Chaque changement part de la valeur laissée par le précédent : aucune écriture perdue.
    audit.slice(1).forEach((next, i) => {
      expect(next.details.from).toBe(audit[i]!.details.to);
    });
    expect(audit.at(-1)!.details.to).toBe(await settings.isGloballyEnabled());
  });
});

describe('Redémarrage : la valeur est toujours relue dans PostgreSQL', () => {
  it.each([true, false])('global %s → redémarrage → même valeur', async (value) => {
    await setGlobal(!value);
    await setGlobal(value);
    await ctx.stopTimers();
    assemble(); // nouvelles instances de tous les services, même base
    expect(await settings.isGloballyEnabled()).toBe(value);
    expect((await admin.api.get(PATH)).body.enabled).toBe(value);
  });
});

describe('Hiérarchie global / partie', () => {
  it('GLOBAL OFF bloque DetectionService avant toute lecture ou écriture', async () => {
    const { gameId } = await table(true);
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
    const service = new DetectionService({
      repository: spied,
      globalSwitch: settings,
      logger: createLogger({}, () => undefined),
    });
    expect(await service.isEnabled(gameId)).toBe(false);
    expect(
      await service.recordSignals(gameId, [
        { type: 'PROXIMITY', severity: 'high', contribution: 20, playerIds: [], evidence: {} },
      ]),
    ).toEqual({ skipped: true, recorded: 0 });
    expect(calls).toEqual([]);
  });

  it('GLOBAL OFF + partie surveillée → aucune détection en fin de partie', async () => {
    // Table surveillée créée détection active, puis coupée par l'administration (D-081 :
    // détection coupée, l'option n'est plus proposée à la création).
    await setGlobal(true);
    const { owner, guest, gameId } = await table(true);
    await closeTogether(gameId, owner.id, guest.id);
    await setGlobal(false);
    await start(owner, gameId);
    await playToEnd(owner, guest, gameId);
    expect(await detectionCounts(gameId)).toEqual({
      positions: 6,
      signals: 0,
      scores: 0,
      alerts: 0,
    });
  });

  it('GLOBAL OFF : option non proposée (detectionAvailable) et jamais enregistrée à la création', async () => {
    const owner = await newPlayer();
    const list = await expectStatus(owner.api.get('/api/sessions/open'), 200);
    expect(list.body.detectionAvailable).toBe(false);
    // Ancien client qui envoie quand même l'option : la table n'est PAS surveillée.
    const res = await expectStatus(
      owner.api.post('/api/sessions', { maxPlayers: 2, suspicionDetectionEnabled: true }),
      201,
    );
    expect(res.body.session.suspicionDetectionEnabled).toBe(false);
    // Activation ultérieure du global : cette table reste non surveillée (option immuable).
    await setGlobal(true);
    const status = await owner.api.get(`/api/games/${res.body.game.gameId}/geolocation`);
    expect(status.body).toEqual({ detectionEnabled: false });
  });

  it('GLOBAL ON : option proposée et enregistrée telle que choisie', async () => {
    await setGlobal(true);
    const owner = await newPlayer();
    const list = await expectStatus(owner.api.get('/api/sessions/open'), 200);
    expect(list.body.detectionAvailable).toBe(true);
    const res = await expectStatus(
      owner.api.post('/api/sessions', { maxPlayers: 2, suspicionDetectionEnabled: true }),
      201,
    );
    expect(res.body.session.suspicionDetectionEnabled).toBe(true);
    // Coupure par l'administration : l'option disparaît aussitôt (relue à chaque appel).
    await setGlobal(false);
    const after = await expectStatus(owner.api.get('/api/sessions/open'), 200);
    expect(after.body.detectionAvailable).toBe(false);
  });

  it('GLOBAL ON + partie non surveillée → aucune détection', async () => {
    await setGlobal(true);
    const { owner, guest, gameId } = await table(false);
    await start(owner, gameId);
    await playToEnd(owner, guest, gameId);
    expect(await detectionCounts(gameId)).toEqual({
      positions: 0,
      signals: 0,
      scores: 0,
      alerts: 0,
    });
    const status = await owner.api.get(`/api/games/${gameId}/geolocation`);
    expect(status.body).toEqual({ detectionEnabled: false });
  });

  it('GLOBAL ON + partie surveillée → détection active (signal et score)', async () => {
    await setGlobal(true);
    const { owner, guest, gameId } = await table(true);
    await closeTogether(gameId, owner.id, guest.id);
    await start(owner, gameId);
    await playToEnd(owner, guest, gameId);
    const counts = await detectionCounts(gameId);
    expect(counts.signals).toBe(1);
    expect(counts.scores).toBe(1);
    expect((await detection.listSignals(gameId))[0]).toMatchObject({ type: 'PROXIMITY' });
  });
});

describe('Géolocalisation anti-collusion', () => {
  it('GLOBAL OFF : aucune collecte demandée ni acceptée, même réponse qu’une table non surveillée', async () => {
    const { owner, gameId } = await table(true);
    const status = await expectStatus(owner.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(status.body).toEqual({ detectionEnabled: false });
    const sent = await owner.api.post(`/api/games/${gameId}/position`, {
      ...DOUALA,
      accuracy: 12,
      capturedAt: Date.now(),
    });
    expect(sent.status).toBe(409);
    expect(sent.body.code).toBe('DETECTION_DISABLED');
    expect(await count('detection_positions')).toBe(0);
  });

  it('GLOBAL ON : collecte acceptée sur une table surveillée', async () => {
    await setGlobal(true);
    const { owner, gameId } = await table(true);
    const status = await owner.api.get(`/api/games/${gameId}/geolocation`);
    expect(status.body).toMatchObject({ detectionEnabled: true, collecting: true });
    await expectStatus(
      owner.api.post(`/api/games/${gameId}/position`, {
        ...DOUALA,
        accuracy: 12,
        capturedAt: Date.now(),
      }),
      201,
    );
    expect(await count('detection_positions', gameId)).toBe(1);
  });
});

describe('Désactivation pendant une partie surveillée en cours', () => {
  it('la partie continue normalement ; aucune nouvelle activité ; données conservées', async () => {
    await setGlobal(true);
    const { owner, guest, gameId } = await table(true);
    await start(owner, gameId);
    await expectStatus(
      owner.api.post(`/api/games/${gameId}/position`, {
        ...DOUALA,
        accuracy: 12,
        capturedAt: Date.now(),
      }),
      201,
    );
    await closeTogether(gameId, owner.id, guest.id);
    const before = await ctx.games.findGame(gameId);

    await setGlobal(false);

    const sent = await guest.api.post(`/api/games/${gameId}/position`, {
      ...north(20),
      accuracy: 12,
      capturedAt: Date.now(),
    });
    expect(sent.body.code).toBe('DETECTION_DISABLED');
    expect((await owner.api.get(`/api/games/${gameId}/geolocation`)).body).toEqual({
      detectionEnabled: false,
    });
    // Le jeu n'est pas touché : mêmes mains, même tour, puis fin normale.
    const after = await ctx.games.findGame(gameId);
    expect(after).toEqual(before);
    await playToEnd(owner, guest, gameId);
    const finished = await ctx.games.findGame(gameId);
    expect(finished).toMatchObject({ status: 'finished' });
    expect(finished!.endReason).not.toBe('ADMIN_STOP');
    // Positions déjà collectées conservées (purge 24 h inchangée) ; aucun signal ni score.
    expect(await detectionCounts(gameId)).toEqual({
      positions: 7,
      signals: 0,
      scores: 0,
      alerts: 0,
    });
  });

  it('même partie jouée global ON ou OFF : résultat identique', async () => {
    const results: unknown[] = [];
    for (const enabled of [true, false]) {
      await setGlobal(enabled);
      const { owner, guest, gameId } = await table(true);
      await start(owner, gameId);
      await playToEnd(owner, guest, gameId);
      const game = await ctx.games.findGame(gameId);
      const winnerSeat = game!.players.findIndex((p) => p.playerId === game!.result?.winnerId);
      results.push({ status: game!.status, endReason: game!.endReason, winnerSeat });
    }
    // Distribution « identité » : le 2e joueur gagne, que la détection soit active ou non.
    expect(results[0]).toEqual({
      status: 'finished',
      endReason: expect.any(String),
      winnerSeat: 1,
    });
    expect(results[1]).toEqual(results[0]);
  });
});

describe('Historique conservé après OFF', () => {
  it('signaux, scores et alertes existants restent consultables par l’administration', async () => {
    await setGlobal(true);
    const { owner, guest, gameId } = await table(true);
    await closeTogether(gameId, owner.id, guest.id);
    await start(owner, gameId);
    await playToEnd(owner, guest, gameId);
    const before = await detectionCounts();
    expect(before.signals).toBe(1);

    await setGlobal(false);
    expect(await detectionCounts()).toEqual(before);
    const alerts = await expectStatus(admin.api.get('/api/admin/detection/alerts'), 200);
    expect(alerts.body.total).toBe(before.alerts);
    const subject = [owner.id, guest.id].sort().join('|');
    const history = await expectStatus(
      admin.api.get(`/api/admin/detection/subjects/${subject}/score-history`),
      200,
    );
    expect(history.body.total).toBe(1);
  });
});
