import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';
import request from 'supertest';

import type { SignalDraft } from '../../../src/domain/detection/detection';
import {
  BEHAVIOR_CONTRIBUTIONS,
  GEOLOCATION_CONFIG,
} from '../../../src/domain/detection/detection-config';
import type { Game } from '../../../src/domain/game/game';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { SessionId } from '../../../src/domain/sessions/session';
import { PostgresDetectionAdminRepository } from '../../../src/repositories/postgres-detection-admin.repository';
import { PostgresDetectionRepository } from '../../../src/repositories/postgres-detection.repository';
import { insertGameRows } from '../../../src/repositories/postgres-game.repository';
import { DetectionAdminService } from '../../../src/services/detection/detection-admin.service';
import { DetectionService } from '../../../src/services/detection/detection.service';
import { createLogger } from '../../../src/utils/logger';
import { adminLogin } from '../../fixtures/admin';
import { registerAndLogin, TEST_JWT_SECRET } from '../../fixtures/auth';
import { finishedGame } from '../../fixtures/detection-history';
import { as, createGameApiTestApp, type GameApiTestContext } from '../../fixtures/game-api';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { seedUsers, testPlayerId } from '../../fixtures/users';
import { GLOBAL_DETECTION_ON } from '../../fixtures/detection-switch';

/**
 * Administration de la détection (R-36, étape 5, D-049) par HTTP, sur PostgreSQL (PGlite) :
 * permissions, liste paginée, filtres, tri, détail, signaux, historique, statut, audit,
 * concurrence, idempotence, confidentialité. Les alertes sont produites par le chemin réel
 * de l'étape 4 (`DetectionService.recordSignals`).
 */
jest.setTimeout(60_000);

const BASE = '/api/admin/detection';
const NAMES = ['amina', 'bruno', 'chloe', 'didier'];
const [A, B, C, D] = NAMES.map(testPlayerId) as [PlayerId, PlayerId, PlayerId, PlayerId];
const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const subjectOf = (...ids: PlayerId[]) => [...ids].sort().join('|');

let database: TestDatabase;
let ctx: GameApiTestContext;
let admin: { userId: string; accessToken: string };
let player: { userId: string; accessToken: string };

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

beforeEach(async () => {
  await seedUsers(database.sql, NAMES);
  ctx = createGameApiTestApp(database.sql, {
    detectionAdmin: new DetectionAdminService({
      repository: new PostgresDetectionAdminRepository(database.sql),
      logger: createLogger({}, () => undefined),
      clock: () => NOW,
    }),
  });
  const account = await registerAndLogin(ctx.app);
  player = await registerAndLogin(ctx.app);
  // Seul moyen de devenir admin : l'outil d'exploitation (`npm run user:role`), même SQL.
  await setRole(account.userId, 'admin');
  // Toute route /api/admin/* exige une session d'administration (D-061).
  admin = await adminLogin(ctx.app, account.email, account.password, account.userId);
});
afterEach(async () => {
  await ctx.stopTimers();
  await database.reset();
});

async function setRole(userId: string, role: 'user' | 'admin') {
  await database.sql.query('UPDATE users SET role = $2 WHERE id = $1', [userId, role]);
}

/** Partie terminée sur une table surveillée. */
async function game(players: PlayerId[]): Promise<GameId> {
  const sessionId = randomUUID() as SessionId;
  await database.sql.query(
    `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at, updated_at,
       suspicion_detection_enabled)
     VALUES ($1, 1, 'open', $2, 4, now(), now(), true)`,
    [sessionId, players[0]],
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

const detection = (clock: Date) =>
  new DetectionService({
    globalSwitch: GLOBAL_DETECTION_ON,
    repository: new PostgresDetectionRepository(database.sql),
    logger: createLogger({}, () => undefined),
    clock: () => clock,
  });

const C3 = GEOLOCATION_CONFIG.contributions;
const draft = (
  type: SignalDraft['type'],
  pair: PlayerId[],
  contribution: number,
  evidence: Record<string, unknown> = { observations: 12, rate: 0.75, periodDays: 30 },
): SignalDraft => ({ type, severity: 'medium', contribution, playerIds: pair, evidence });
/** 20 + 20 + 15 = 55 (HIGH, NORMAL). */
const highPair = (pair: PlayerId[]) => [
  draft('PROXIMITY', pair, C3.PROXIMITY.strong),
  draft('CARD_CHOICE_ANOMALY', pair, BEHAVIOR_CONTRIBUTIONS.CARD_CHOICE_ANOMALY),
  draft('CORRELATED_WINS', pair, BEHAVIOR_CONTRIBUTIONS.CORRELATED_WINS),
];
/** + 15 + 10 + 10 = 90 (VERY_HIGH, PRIORITY). */
const veryHighExtra = (pair: PlayerId[]) => [
  draft('REPEATED_PROXIMITY', pair, C3.REPEATED_PROXIMITY),
  draft('FREQUENT_COPLAY', pair, BEHAVIOR_CONTRIBUTIONS.FREQUENT_COPLAY),
  draft('CONNECTION_PATTERN', pair, BEHAVIOR_CONTRIBUTIONS.CONNECTION_PATTERN),
];

/**
 * Quatre alertes : AB high (J-2), CD high + very_high (J-1), AC high (J).
 * Renvoie les identifiants des parties.
 */
async function seedAlerts() {
  const ab = await game([A, B]);
  await detection(at(-2 * DAY)).recordSignals(ab, highPair([A, B]));
  const cd = await game([C, D]);
  await detection(at(-DAY)).recordSignals(cd, highPair([C, D]));
  await detection(at(-DAY + 1000)).recordSignals(cd, veryHighExtra([C, D]));
  const ac = await game([A, C]);
  await detection(NOW).recordSignals(ac, highPair([A, C]));
  return { ab, cd, ac };
}

const adminApi = () => as(ctx.app, admin.accessToken);
const patch = (token: string, path: string, body: object) =>
  request(ctx.app).patch(path).set('Authorization', `Bearer ${token}`).send(body);

async function alertIdOf(subject: string, level = 'high'): Promise<string> {
  const { rows } = await database.sql.query<{ id: string }>(
    'SELECT id FROM detection_alerts WHERE subject_key = $1 AND level = $2',
    [subject, level],
  );
  return rows[0]!.id;
}

async function auditRows() {
  const { rows } = await database.sql.query<{
    actor_id: string;
    action: string;
    target_type: string;
    target_id: string;
    details: unknown;
  }>(
    // Actions sur les alertes seulement (les connexions admin sont auditées à part, D-061).
    `SELECT actor_id, action, target_type, target_id, details FROM admin_audit_log
     WHERE action NOT IN ('ADMIN_LOGIN_SUCCEEDED', 'ADMIN_LOGIN_FAILED', 'ADMIN_LOGOUT', 'ADMIN_SESSION_EXPIRED') ORDER BY created_at, id`,
  );
  return rows;
}

describe('Permissions', () => {
  const routes = [
    ['get', `${BASE}/alerts`],
    ['get', `${BASE}/alerts/${randomUUID()}`],
    ['get', `${BASE}/alerts/${randomUUID()}/signals`],
    ['get', `${BASE}/subjects/${subjectOf(A, B)}/score-history`],
    ['patch', `${BASE}/alerts/${randomUUID()}/status`],
  ] as const;

  it.each(routes)('%s %s : non authentifié → 401', async (method, path) => {
    const res = await request(ctx.app)[method](path).send({ status: 'REVIEWED' });
    expect(res.status).toBe(401);
  });

  it.each(routes)('%s %s : joueur authentifié → 403', async (method, path) => {
    const res = await request(ctx.app)
      [method](path)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .send({ status: 'REVIEWED' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('jeton falsifié → 401', async () => {
    const res = await request(ctx.app)
      .get(`${BASE}/alerts`)
      .set('Authorization', `Bearer ${admin.accessToken}x`);
    expect(res.status).toBe(401);
  });

  it('jeton correctement signé mais revendiquant `admin` : 403 (seul le rôle en base compte)', async () => {
    const claims = jwt.decode(player.accessToken) as jwt.JwtPayload;
    const forged = jwt.sign({ ...claims, role: 'admin' }, TEST_JWT_SECRET);
    const res = await request(ctx.app)
      .get(`${BASE}/alerts`)
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(403);
  });

  it('rôle relu en base à chaque requête : retrait du rôle → 403 immédiat, jeton inchangé', async () => {
    expect((await adminApi().get(`${BASE}/alerts`)).status).toBe(200);
    await setRole(admin.userId, 'user');
    expect((await adminApi().get(`${BASE}/alerts`)).status).toBe(403);
  });

  it('un joueur promu admin doit ouvrir une session d’administration (D-061)', async () => {
    await setRole(player.userId, 'admin');
    // Sa session mobile ne suffit plus : 401 ADMIN_SESSION_REQUIRED.
    const mobile = await as(ctx.app, player.accessToken).get(`${BASE}/alerts`);
    expect(mobile.status).toBe(401);
    expect(mobile.body.code).toBe('ADMIN_SESSION_REQUIRED');
  });

  it('administrateur → 200', async () => {
    const res = await adminApi().get(`${BASE}/alerts`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ page: 1, limit: 20, total: 0, items: [] });
  });

  it('aucune route de promotion : le rôle ne se change pas par HTTP', async () => {
    for (const path of ['/api/admin/users/role', `${BASE}/roles`, '/api/auth/role']) {
      const res = await request(ctx.app)
        .post(path)
        .set('Authorization', `Bearer ${player.accessToken}`)
        .send({ role: 'admin' });
      expect([403, 404]).toContain(res.status);
    }
    const { rows } = await database.sql.query<{ role: string }>(
      'SELECT role FROM users WHERE id = $1',
      [player.userId],
    );
    expect(rows[0]!.role).toBe('user');
  });
});

describe('Liste paginée, filtres, tri', () => {
  it('ligne de liste : champs attendus, aucun élément justificatif', async () => {
    const { ac } = await seedAlerts();
    const res = await adminApi().get(`${BASE}/alerts`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 4 });
    const [first] = res.body.items;
    expect(Object.keys(first).sort()).toEqual(
      [
        'alertId',
        'type',
        'level',
        'priority',
        'status',
        'subject',
        'score',
        'algorithmVersion',
        'scoreAlgorithm',
        'gameId',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(first).toMatchObject({
      type: 'SUSPICION_LEVEL',
      level: 'high',
      priority: 'NORMAL',
      status: 'NEW',
      score: 55,
      algorithmVersion: 2,
      scoreAlgorithm: 'SUSPICION_SCORE_V2',
      gameId: ac,
      subject: { key: subjectOf(A, C), scope: 'PAIR', playerIds: [A, C].sort() },
      createdAt: NOW.toISOString(),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/evidence|observations|signalTypes|components/);
  });

  it('pagination : page, limite, total ; page au-delà de la fin vide', async () => {
    await seedAlerts();
    const all = (await adminApi().get(`${BASE}/alerts?limit=100`)).body.items.map(
      (i: { alertId: string }) => i.alertId,
    );
    const p1 = await adminApi().get(`${BASE}/alerts?limit=3&page=1`);
    const p2 = await adminApi().get(`${BASE}/alerts?limit=3&page=2`);
    const p3 = await adminApi().get(`${BASE}/alerts?limit=3&page=3`);
    expect([p1.body.total, p2.body.total, p3.body.total]).toEqual([4, 4, 4]);
    expect(p1.body.items).toHaveLength(3);
    expect(p2.body.items).toHaveLength(1);
    expect(p3.body.items).toEqual([]);
    expect([...p1.body.items, ...p2.body.items].map((i: { alertId: string }) => i.alertId)).toEqual(
      all,
    );
  });

  it('filtres : statut, niveau, priorité, type, sujet, joueur, période', async () => {
    await seedAlerts();
    const count = async (qs: string) => {
      const res = await adminApi().get(`${BASE}/alerts?${qs}`);
      expect(res.status).toBe(200);
      return res.body.total as number;
    };
    expect(await count('status=NEW')).toBe(4);
    expect(await count('status=REVIEWED')).toBe(0);
    expect(await count('level=high')).toBe(3);
    expect(await count('level=very_high')).toBe(1);
    expect(await count('priority=PRIORITY')).toBe(1);
    expect(await count('type=SUSPICION_LEVEL')).toBe(4);
    expect(await count(`subject=${encodeURIComponent(subjectOf(C, D))}`)).toBe(2);
    expect(await count(`playerId=${A}`)).toBe(2);
    expect(await count(`playerId=${D}&level=very_high`)).toBe(1);
    const mid = encodeURIComponent(at(-1.5 * DAY).toISOString());
    expect(await count(`from=${mid}`)).toBe(3);
    expect(await count(`to=${mid}`)).toBe(1);
    expect(await count(`playerId=${randomUUID()}`)).toBe(0);
  });

  it('tri par liste blanche : date, score, priorité, niveau', async () => {
    await seedAlerts();
    const order = async (sort: string) =>
      (await adminApi().get(`${BASE}/alerts?sort=${sort}`)).body.items.map(
        (i: { score: number; level: string; subject: { key: string } }) => [
          i.subject.key,
          i.level,
          i.score,
        ],
      );
    const AB = subjectOf(A, B);
    const AC = subjectOf(A, C);
    const CD = subjectOf(C, D);
    expect((await order('created_at_desc'))[0]).toEqual([AC, 'high', 55]);
    expect((await order('created_at_asc'))[0]).toEqual([AB, 'high', 55]);
    expect((await order('score_desc'))[0]).toEqual([CD, 'very_high', 90]);
    expect((await order('score_asc')).at(-1)).toEqual([CD, 'very_high', 90]);
    expect((await order('priority'))[0]).toEqual([CD, 'very_high', 90]);
    expect((await order('level'))[0]).toEqual([CD, 'very_high', 90]);
  });

  it('entrées invalides → 400, sans exécuter de SQL injecté', async () => {
    await seedAlerts();
    for (const qs of [
      'sort=score;DROP TABLE detection_alerts',
      'sort=player_ids',
      'status=OPEN',
      'level=critical',
      'priority=HIGH',
      'type=OTHER',
      'playerId=abc',
      `subject=${encodeURIComponent(`${subjectOf(A, B).split('|').reverse().join('|')}`)}`,
      'from=yesterday',
      'limit=101',
      'page=0',
      'page=-1',
      'unknown=1',
      'status=NEW&status=REVIEWED',
    ]) {
      const res = await adminApi().get(`${BASE}/alerts?${qs}`);
      expect([qs, res.status]).toEqual([qs, 400]);
    }
    expect((await adminApi().get(`${BASE}/alerts`)).body.total).toBe(4);
  });
});

describe("Détail d'une alerte et signaux", () => {
  it('détail : alerte, période, score au moment de l’analyse, signaux retenus', async () => {
    const { cd } = await seedAlerts();
    const alertId = await alertIdOf(subjectOf(C, D), 'very_high');
    const res = await adminApi().get(`${BASE}/alerts/${alertId}`);
    expect(res.status).toBe(200);
    const { alert } = res.body;
    expect(alert).toMatchObject({
      alertId,
      level: 'very_high',
      priority: 'PRIORITY',
      status: 'NEW',
      score: 90,
      algorithmVersion: 2,
      gameId: cd,
      subject: { key: subjectOf(C, D), scope: 'PAIR' },
      period: { start: expect.any(String), end: expect.any(String) },
      scoreAtAnalysis: {
        gameId: cd,
        score: 90,
        level: 'very_high',
        // Score précédent = celui de la partie précédente du sujet (étape 4) : aucune ici.
        previousScore: null,
        previousLevel: null,
        algorithmVersion: 2,
        signalCount: 6,
      },
    });
    expect(alert.signalTypes).toHaveLength(6);
    expect(alert.scoreAtAnalysis.contributions).toHaveLength(6);
    expect(alert.scoreAtAnalysis.contributions[0]).toEqual({
      type: expect.any(String),
      contribution: expect.any(Number),
      signalId: expect.any(String),
      sourceGameId: cd,
      algorithm: expect.stringMatching(/_V\d+$/),
    });
  });

  it('alerte inexistante → 404 ; identifiant invalide → 400', async () => {
    const missing = randomUUID();
    expect((await adminApi().get(`${BASE}/alerts/${missing}`)).status).toBe(404);
    expect((await adminApi().get(`${BASE}/alerts/${missing}/signals`)).status).toBe(404);
    const bad = await adminApi().get(`${BASE}/alerts/not-an-id`);
    expect(bad.status).toBe(400);
    expect((await adminApi().get(`${BASE}/alerts/1%27%20OR%201=1/signals`)).status).toBe(400);
  });

  it('signaux : type, contribution, version, partie source, joueurs, date, retenu', async () => {
    const { ab } = await seedAlerts();
    const alertId = await alertIdOf(subjectOf(A, B));
    const res = await adminApi().get(`${BASE}/alerts/${alertId}/signals`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ alertId, subject: { key: subjectOf(A, B), scope: 'PAIR' } });
    expect(res.body.signals).toHaveLength(3);
    for (const signal of res.body.signals) {
      expect(signal).toEqual({
        signalId: expect.any(String),
        type: expect.any(String),
        algorithm: expect.stringMatching(/_V\d+$/),
        severity: 'medium',
        contribution: expect.any(Number),
        retained: true,
        gameId: ab,
        playerIds: expect.arrayContaining([A, B]),
        createdAt: at(-2 * DAY).toISOString(),
        evidence: { observations: 12, rate: 0.75, periodDays: 30 },
      });
    }
  });

  it('confidentialité : ni coordonnée, ni IP, ni carte, ni main, ni jeton dans les réponses', async () => {
    const g = await game([A, B]);
    const leaky = {
      latitude: 4.0511,
      longitude: 9.7679,
      accuracy: 8,
      ip: '203.0.113.7',
      cards: ['COEUR-7'],
      hand: ['PIQUE-12'],
      token: 'tok_secret',
      approxDistanceMeters: 30,
      observations: 9,
      nested: { lat: 4.05, peerAddress: '198.51.100.4', lastCard: 'ETOILE-2' },
    };
    await detection(NOW).recordSignals(g, [
      draft('PROXIMITY', [A, B], C3.PROXIMITY.strong, leaky),
      draft('CARD_CHOICE_ANOMALY', [A, B], BEHAVIOR_CONTRIBUTIONS.CARD_CHOICE_ANOMALY, leaky),
      draft('CORRELATED_WINS', [A, B], BEHAVIOR_CONTRIBUTIONS.CORRELATED_WINS, leaky),
    ]);
    const alertId = await alertIdOf(subjectOf(A, B));
    const bodies = [
      (await adminApi().get(`${BASE}/alerts`)).body,
      (await adminApi().get(`${BASE}/alerts/${alertId}`)).body,
      (await adminApi().get(`${BASE}/alerts/${alertId}/signals`)).body,
      (await adminApi().get(`${BASE}/subjects/${subjectOf(A, B)}/score-history`)).body,
    ];
    const text = JSON.stringify(bodies);
    expect(text).not.toMatch(
      /latitude|longitude|accuracy|"lat"|4\.05|9\.76|203\.0\.113|198\.51\.100|COEUR-7|PIQUE-12|ETOILE-2|tok_secret|"hand"|"cards"|"token"/,
    );
    const signals = bodies[2].signals as { evidence: unknown }[];
    expect(signals[0]!.evidence).toEqual({
      approxDistanceMeters: 30,
      observations: 9,
      nested: { peerAddress: '[masqué]', lastCard: '[masqué]' },
    });
    // Aucune donnée personnelle de compte (email, téléphone, nom) n'est exposée.
    expect(text).not.toMatch(/@test\.local|password|phone|email/);
  });
});

describe('Historique du score', () => {
  it('lecture seule, du plus récent au plus ancien, paginée', async () => {
    const first = await game([A, B]);
    await detection(at(-DAY)).recordSignals(first, [draft('PROXIMITY', [A, B], 20)]);
    const second = await game([A, B]);
    await detection(NOW).recordSignals(second, [draft('CORRELATED_WINS', [A, B], 15)]);
    const path = `${BASE}/subjects/${subjectOf(A, B)}/score-history`;

    const res = await adminApi().get(path);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subjectKey: subjectOf(A, B), page: 1, limit: 20, total: 2 });
    expect(
      res.body.items.map((i: { gameId: string; previousScore: number | null; score: number }) => [
        i.gameId,
        i.previousScore,
        i.score,
      ]),
    ).toEqual([
      [second, 20, 35],
      [first, null, 20],
    ]);
    expect(res.body.items[0]).toMatchObject({
      computedAt: NOW.toISOString(),
      level: 'moderate',
      previousLevel: 'low',
      algorithmVersion: 2,
      scoreAlgorithm: 'SUSPICION_SCORE_V2',
      signalCount: 2,
    });
    expect(
      res.body.items[0].contributions.map((c: { type: string; sourceGameId: string }) => [
        c.type,
        c.sourceGameId,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['CORRELATED_WINS', second],
        ['PROXIMITY', first],
      ]),
    );

    const page2 = await adminApi().get(`${path}?limit=1&page=2`);
    expect(page2.body.items.map((i: { gameId: string }) => i.gameId)).toEqual([first]);
    expect(
      (await adminApi().get(`${BASE}/subjects/${subjectOf(C, D)}/score-history`)).body,
    ).toMatchObject({
      total: 0,
      items: [],
    });
  });

  it('sujet ou pagination invalides → 400 ; aucune écriture possible sur un score', async () => {
    const unsorted = encodeURIComponent([...subjectOf(A, B).split('|')].reverse().join('|'));
    const history = (subject: string, qs = '') =>
      adminApi().get(`${BASE}/subjects/${subject}/score-history${qs}`);
    expect((await history(unsorted)).status).toBe(400);
    expect((await history('abc')).status).toBe(400);
    expect((await history(subjectOf(A, B), '?sort=score')).status).toBe(400);
    expect((await history(subjectOf(A, B), '?limit=0')).status).toBe(400);
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(ctx.app)
        [method](`${BASE}/subjects/${subjectOf(A, B)}/score-history`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ score: 0 });
      expect([method, res.status]).toEqual([method, 404]);
    }
  });
});

describe('Statut des alertes et audit', () => {
  it('NEW → REVIEWED → RESOLVED : audité (acteur = session, ancien / nouveau statut)', async () => {
    await seedAlerts();
    const alertId = await alertIdOf(subjectOf(A, B));
    const path = `${BASE}/alerts/${alertId}/status`;

    const reviewed = await patch(admin.accessToken, path, { status: 'REVIEWED' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body).toMatchObject({
      changed: true,
      alert: { alertId, status: 'REVIEWED', updatedAt: NOW.toISOString() },
    });
    const resolved = await patch(admin.accessToken, path, {
      status: 'RESOLVED',
      expectedStatus: 'REVIEWED',
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.alert.status).toBe('RESOLVED');

    // Même horodatage (horloge de test figée) : l'ordre des deux lignes n'est pas garanti.
    const audit = await auditRows();
    expect(audit).toHaveLength(2);
    expect(audit).toEqual(
      expect.arrayContaining([
        {
          actor_id: admin.userId,
          action: 'ALERT_STATUS_CHANGED',
          target_type: 'DETECTION_ALERT',
          target_id: alertId,
          details: { from: 'NEW', to: 'REVIEWED' },
        },
        {
          actor_id: admin.userId,
          action: 'ALERT_STATUS_CHANGED',
          target_type: 'DETECTION_ALERT',
          target_id: alertId,
          details: { from: 'REVIEWED', to: 'RESOLVED' },
        },
      ]),
    );
    // Le journal ne contient ni jeton, ni mot de passe, ni IP, ni donnée de jeu.
    const { rows } = await database.sql.query<{ row: unknown }>(
      'SELECT row_to_json(a) AS row FROM admin_audit_log a',
    );
    expect(JSON.stringify(rows)).not.toMatch(
      new RegExp(`${admin.accessToken}|Bearer|password|token|"ip"|latitude|COEUR`, 'i'),
    );
    const filtered = await adminApi().get(`${BASE}/alerts?status=RESOLVED`);
    expect(filtered.body.items.map((i: { alertId: string }) => i.alertId)).toEqual([alertId]);
  });

  it('NEW → DISMISSED ; DISMISSED et RESOLVED sont finaux (409)', async () => {
    await seedAlerts();
    const dismissed = await alertIdOf(subjectOf(A, B));
    const path = `${BASE}/alerts/${dismissed}/status`;
    expect((await patch(admin.accessToken, path, { status: 'DISMISSED' })).status).toBe(200);
    for (const status of ['NEW', 'REVIEWED', 'RESOLVED']) {
      const res = await patch(admin.accessToken, path, { status });
      expect([status, res.status, res.body.code]).toEqual([
        status,
        409,
        'ALERT_TRANSITION_NOT_ALLOWED',
      ]);
    }
  });

  it('transitions interdites depuis NEW et REVIEWED → 409, rien écrit', async () => {
    await seedAlerts();
    const alertId = await alertIdOf(subjectOf(A, C));
    const path = `${BASE}/alerts/${alertId}/status`;
    const early = await patch(admin.accessToken, path, { status: 'RESOLVED' });
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({
      code: 'ALERT_TRANSITION_NOT_ALLOWED',
      details: { from: 'NEW', to: 'RESOLVED' },
    });
    await patch(admin.accessToken, path, { status: 'REVIEWED' });
    for (const status of ['NEW', 'DISMISSED']) {
      expect((await patch(admin.accessToken, path, { status })).status).toBe(409);
    }
    expect(await auditRows()).toHaveLength(1);
  });

  it('entrées invalides → 400 ; alerte inexistante → 404 ; aucun audit', async () => {
    await seedAlerts();
    const alertId = await alertIdOf(subjectOf(A, B));
    const path = `${BASE}/alerts/${alertId}/status`;
    for (const body of [
      {},
      { status: 'reviewed' },
      { status: 'BANNED' },
      { status: 'REVIEWED', expectedStatus: 'OPEN' },
      // L'administrateur vient TOUJOURS de la session : un adminId reçu est refusé.
      { status: 'REVIEWED', adminId: player.userId },
      { status: 'REVIEWED', score: 0 },
    ]) {
      const res = await patch(admin.accessToken, path, body);
      expect([body, res.status]).toEqual([body, 400]);
    }
    expect(
      (
        await patch(admin.accessToken, `${BASE}/alerts/${randomUUID()}/status`, {
          status: 'REVIEWED',
        })
      ).status,
    ).toBe(404);
    expect(
      (await patch(admin.accessToken, `${BASE}/alerts/x/status`, { status: 'REVIEWED' })).status,
    ).toBe(400);
    expect(await auditRows()).toEqual([]);
  });

  it('idempotence : requête répétée → 200, changed=false, un seul audit', async () => {
    await seedAlerts();
    const alertId = await alertIdOf(subjectOf(A, B));
    const path = `${BASE}/alerts/${alertId}/status`;
    const first = await patch(admin.accessToken, path, { status: 'REVIEWED' });
    const again = await patch(admin.accessToken, path, { status: 'REVIEWED' });
    const stale = await patch(admin.accessToken, path, {
      status: 'REVIEWED',
      expectedStatus: 'NEW',
    });
    expect([first.body.changed, again.body.changed, stale.body.changed]).toEqual([
      true,
      false,
      false,
    ]);
    expect(again.body.alert).toEqual(first.body.alert);
    expect(await auditRows()).toHaveLength(1);
  });

  it('expectedStatus périmé → 409 ALERT_STATUS_CONFLICT, rien écrasé', async () => {
    await seedAlerts();
    const alertId = await alertIdOf(subjectOf(A, B));
    const path = `${BASE}/alerts/${alertId}/status`;
    await patch(admin.accessToken, path, { status: 'REVIEWED' });
    const res = await patch(admin.accessToken, path, {
      status: 'DISMISSED',
      expectedStatus: 'NEW',
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'ALERT_STATUS_CONFLICT',
      details: { expected: 'NEW', current: 'REVIEWED' },
    });
    const detail = await adminApi().get(`${BASE}/alerts/${alertId}`);
    expect(detail.body.alert.status).toBe('REVIEWED');
  });
});

describe('Concurrence entre administrateurs', () => {
  let second: { userId: string; accessToken: string };
  beforeEach(async () => {
    const account = await registerAndLogin(ctx.app);
    await setRole(account.userId, 'admin');
    second = await adminLogin(ctx.app, account.email, account.password, account.userId);
  });

  it('REVIEWED et DISMISSED simultanés : un seul gagne, l’autre 409, audit cohérent', async () => {
    await seedAlerts();
    const alertId = await alertIdOf(subjectOf(A, B));
    const path = `${BASE}/alerts/${alertId}/status`;
    const [r1, r2] = await Promise.all([
      patch(admin.accessToken, path, { status: 'REVIEWED' }),
      patch(second.accessToken, path, { status: 'DISMISSED' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const winner = r1.status === 200 ? r1 : r2;
    const winnerId = r1.status === 200 ? admin.userId : second.userId;
    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_id: winnerId,
      details: { from: 'NEW', to: winner.body.alert.status },
    });
    const detail = await adminApi().get(`${BASE}/alerts/${alertId}`);
    expect(detail.body.alert.status).toBe(winner.body.alert.status);
  });

  it('même changement simultané : un seul appliqué et audité, les deux 200', async () => {
    await seedAlerts();
    const alertId = await alertIdOf(subjectOf(A, B));
    const path = `${BASE}/alerts/${alertId}/status`;
    const results = await Promise.all([
      patch(admin.accessToken, path, { status: 'REVIEWED', expectedStatus: 'NEW' }),
      patch(second.accessToken, path, { status: 'REVIEWED', expectedStatus: 'NEW' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.changed).sort()).toEqual([false, true]);
    expect(await auditRows()).toHaveLength(1);
  });

  it('isolation : deux alertes modifiées en parallèle restent indépendantes', async () => {
    await seedAlerts();
    const ab = await alertIdOf(subjectOf(A, B));
    const ac = await alertIdOf(subjectOf(A, C));
    const [r1, r2] = await Promise.all([
      patch(admin.accessToken, `${BASE}/alerts/${ab}/status`, { status: 'REVIEWED' }),
      patch(second.accessToken, `${BASE}/alerts/${ac}/status`, { status: 'DISMISSED' }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const { rows } = await database.sql.query<{ subject_key: string; status: string }>(
      'SELECT subject_key, status FROM detection_alerts ORDER BY subject_key, level',
    );
    expect(rows).toEqual([
      { subject_key: subjectOf(A, B), status: 'REVIEWED' },
      { subject_key: subjectOf(A, C), status: 'DISMISSED' },
      { subject_key: subjectOf(C, D), status: 'NEW' },
      { subject_key: subjectOf(C, D), status: 'NEW' },
    ]);
  });
});

describe('Aucun effet sur le jeu ni sur la détection', () => {
  it('changer un statut ne modifie ni parties, ni scores, ni signaux, ni comptes', async () => {
    await seedAlerts();
    const snapshot = async () => {
      const { rows } = await database.sql.query<{
        games: unknown;
        scores: unknown;
        signals: unknown;
        users: unknown;
      }>(
        `SELECT
           (SELECT json_agg(g ORDER BY g.id) FROM games g) AS games,
           (SELECT json_agg(s ORDER BY s.game_id, s.subject_key) FROM detection_scores s) AS scores,
           (SELECT json_agg(x ORDER BY x.id) FROM detection_signals x) AS signals,
           (SELECT json_agg(json_build_object('id', u.id, 'role', u.role) ORDER BY u.id)
              FROM users u) AS users`,
      );
      return rows[0];
    };
    const before = await snapshot();
    const alertId = await alertIdOf(subjectOf(A, B));
    await patch(admin.accessToken, `${BASE}/alerts/${alertId}/status`, { status: 'DISMISSED' });
    expect(await snapshot()).toEqual(before);
  });

  it('rejeu de l’analyse après DISMISSED : aucune nouvelle alerte (déduplication étape 4)', async () => {
    const { ab } = await seedAlerts();
    const alertId = await alertIdOf(subjectOf(A, B));
    await patch(admin.accessToken, `${BASE}/alerts/${alertId}/status`, { status: 'DISMISSED' });
    const replay = await detection(at(-2 * DAY)).recordSignals(ab, highPair([A, B]));
    expect(replay).toMatchObject({ recorded: 0, alertsCreated: 0 });
    const { rows } = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM detection_alerts WHERE subject_key = $1',
      [subjectOf(A, B)],
    );
    expect(rows[0]!.n).toBe(1);
    expect((await adminApi().get(`${BASE}/alerts/${alertId}`)).body.alert.status).toBe('DISMISSED');
  });

  it('journaux : ni jeton, ni en-tête Authorization', async () => {
    await seedAlerts();
    await as(ctx.app, player.accessToken).get(`${BASE}/alerts`);
    const alertId = await alertIdOf(subjectOf(A, B));
    await patch(admin.accessToken, `${BASE}/alerts/${alertId}/status`, { status: 'REVIEWED' });
    const logs = JSON.stringify(ctx.logLines);
    expect(logs).not.toContain(admin.accessToken);
    expect(logs).not.toContain(player.accessToken);
    expect(logs).not.toMatch(/Bearer/);
  });
});

describe('Service absent', () => {
  it('administration non configurée → 503, même pour un admin', async () => {
    const bare = createGameApiTestApp(database.sql);
    try {
      const res = await as(bare.app, admin.accessToken).get(`${BASE}/alerts`);
      expect(res.status).toBe(503);
    } finally {
      await bare.stopTimers();
    }
  });
});
