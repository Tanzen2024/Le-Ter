import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import request from 'supertest';

import { AdminEventStreams } from '../../../src/controllers/admin-events.controller';
import { InMemoryAdminEventHub } from '../../../src/websocket/admin-event-bus';
import { asAdmin, createAdmin, createAdminTestApp, seedPendingPayment } from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Mise à jour automatique des points d'attention de l'administration (D-116) :
 * - `GET /api/admin/attention` : compteurs seuls, mêmes valeurs que le tableau de bord ;
 * - lecture PASSIVE (`X-Admin-Passive: 1`) : session contrôlée, jamais prolongée ;
 * - `GET /api/admin/events` : flux SSE sans donnée, fermé quand le jeton ou la session ne
 *   sont plus valables, et à l'arrêt du serveur.
 */
jest.setTimeout(PGLITE_TIMEOUT_MS);

let database: TestDatabase;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);

afterAll(() => database.close());
afterEach(() => database.reset());

const MINUTE = 60_000;
const PASSIVE = { 'X-Admin-Passive': '1' };

describe('GET /api/admin/attention', () => {
  it('compteurs des points d’attention, identiques à ceux du tableau de bord', async () => {
    const ctx = createAdminTestApp(database.sql);
    const admin = await createAdmin(ctx.app, database.sql);
    const player = await registerAndLogin(ctx.app);
    await seedPendingPayment(database.sql, player.userId); // 1 h avant l'horloge : ancien
    const api = asAdmin(ctx.app, admin.accessToken);

    const res = await api.get('/api/admin/attention').set(PASSIVE).expect(200);
    expect(res.body.alerts).toEqual({
      newDetectionAlerts: 0,
      pendingTournamentApprovals: 0,
      stalePendingPayments: 1,
      overdueTurns: 0,
      pendingComplaints: 0,
    });
    expect(res.body.reconciliationAnomalies).toMatchObject({ total: expect.any(Number) });
    expect(res.body.generatedAt).toBe(ctx.now().toISOString());

    const dashboard = await api.get('/api/admin/dashboard').expect(200);
    expect(dashboard.body.alerts).toEqual(res.body.alerts);
    expect(dashboard.body.reconciliationAnomalies).toEqual(res.body.reconciliationAnomalies);
  });

  it('protégée comme toute route admin : joueur 403, sans jeton 401', async () => {
    const ctx = createAdminTestApp(database.sql);
    const player = await registerAndLogin(ctx.app);
    await request(ctx.app).get('/api/admin/attention').expect(401);
    await asAdmin(ctx.app, player.accessToken).get('/api/admin/attention').expect(403);
  });
});

describe('lecture passive (X-Admin-Passive: 1)', () => {
  async function lastActivity(userId: string): Promise<string> {
    const { rows } = await database.sql.query<{ last_activity_at: Date }>(
      'SELECT last_activity_at FROM admin_sessions WHERE user_id = $1',
      [userId],
    );
    return rows[0]!.last_activity_at.toISOString();
  }

  it('n’enregistre aucune activité : la session expire après 30 min sans action', async () => {
    const ctx = createAdminTestApp(database.sql);
    const admin = await createAdmin(ctx.app, database.sql);
    const before = await lastActivity(admin.userId);
    const api = asAdmin(ctx.app, admin.accessToken);
    for (let i = 0; i < 4; i += 1) {
      ctx.advance(3 * MINUTE);
      await api.get('/api/admin/attention').set(PASSIVE).expect(200);
    }
    expect(await lastActivity(admin.userId)).toBe(before);

    ctx.advance(19 * MINUTE); // 31 min depuis la dernière action réelle
    const refreshed = await request(ctx.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: admin.refreshToken })
      .expect(200);
    const res = await asAdmin(ctx.app, refreshed.body.accessToken)
      .get('/api/admin/attention')
      .set(PASSIVE);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_SESSION_EXPIRED');
  });

  it('une requête ordinaire reste une activité ; l’en-tête est sans effet sur une modification', async () => {
    const ctx = createAdminTestApp(database.sql);
    const admin = await createAdmin(ctx.app, database.sql);
    const before = await lastActivity(admin.userId);
    ctx.advance(MINUTE);
    await asAdmin(ctx.app, admin.accessToken).get('/api/admin/attention').expect(200);
    const afterGet = await lastActivity(admin.userId);
    expect(afterGet).not.toBe(before);

    ctx.advance(MINUTE);
    await request(ctx.app)
      .post('/api/admin/auth/logout')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set(PASSIVE)
      .expect(204);
    expect(await lastActivity(admin.userId)).not.toBe(afterGet);
  });
});

/** Lecteur d'un flux SSE réel (serveur HTTP, fetch). */
async function openStream(server: Server, token: string) {
  const { port } = server.address() as AddressInfo;
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/events`, {
    headers: { authorization: `Bearer ${token}`, 'x-admin-passive': '1' },
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  const events: { event: string; data: unknown }[] = [];
  const pump = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
      }
    } catch {
      // Flux interrompu par le test.
    }
    done = true;
  })();
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i += 1) await new Promise((r) => setTimeout(r, 10));
  };
  return {
    res,
    events,
    until,
    ended: () => done,
    close: async () => {
      controller.abort();
      await pump;
    },
  };
}

describe('GET /api/admin/events (SSE)', () => {
  let server: Server | undefined;
  const listen = (app: Express) =>
    new Promise<Server>((resolve) => {
      const s = createServer(app);
      s.listen(0, '127.0.0.1', () => resolve(s));
    });

  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server?.close(r) ?? r(undefined));
    server = undefined;
  });

  it('ready, puis un signal par changement, sans donnée métier ; désabonné à la fermeture', async () => {
    const hub = new InMemoryAdminEventHub();
    const ctx = createAdminTestApp(database.sql, { events: hub });
    const admin = await createAdmin(ctx.app, database.sql);
    server = await listen(ctx.app);
    const stream = await openStream(server, admin.accessToken);
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    await stream.until(() => stream.events.length > 0);
    expect(stream.events).toEqual([{ event: 'ready', data: {} }]);
    expect(hub.subscriberCount).toBe(1);

    hub.publish({ type: 'attention', source: 'DETECTION_ALERT' });
    await stream.until(() => stream.events.length > 1);
    expect(stream.events[1]).toEqual({ event: 'attention', data: { source: 'DETECTION_ALERT' } });

    await stream.close();
    await stream.until(() => hub.subscriberCount === 0);
    expect(hub.subscriberCount).toBe(0);
  });

  it('jeton expiré à la revérification : event end UNAUTHENTICATED, flux fermé', async () => {
    const hub = new InMemoryAdminEventHub();
    const ctx = createAdminTestApp(database.sql, {
      events: hub,
      eventStream: { recheckMs: 20 },
    });
    const admin = await createAdmin(ctx.app, database.sql);
    server = await listen(ctx.app);
    const stream = await openStream(server, admin.accessToken);
    await stream.until(() => stream.events.length > 0);
    ctx.advance(16 * MINUTE); // access token de 15 min
    await stream.until(() => stream.ended());
    expect(stream.events.at(-1)).toEqual({ event: 'end', data: { code: 'UNAUTHENTICATED' } });
    expect(hub.subscriberCount).toBe(0);
  });

  it('session d’administration terminée (déconnexion ailleurs) : event end, flux fermé', async () => {
    const hub = new InMemoryAdminEventHub();
    const ctx = createAdminTestApp(database.sql, {
      events: hub,
      eventStream: { recheckMs: 20 },
    });
    const admin = await createAdmin(ctx.app, database.sql);
    server = await listen(ctx.app);
    const stream = await openStream(server, admin.accessToken);
    await stream.until(() => stream.events.length > 0);
    await asAdmin(ctx.app, admin.accessToken).post('/api/admin/auth/logout').expect(204);
    await stream.until(() => stream.ended());
    expect(stream.events.at(-1)?.event).toBe('end');
  });

  it('le flux n’enregistre aucune activité', async () => {
    const hub = new InMemoryAdminEventHub();
    const ctx = createAdminTestApp(database.sql, {
      events: hub,
      eventStream: { recheckMs: 20 },
    });
    const admin = await createAdmin(ctx.app, database.sql);
    const { rows: before } = await database.sql.query<{ last_activity_at: Date }>(
      'SELECT last_activity_at FROM admin_sessions WHERE user_id = $1',
      [admin.userId],
    );
    server = await listen(ctx.app);
    ctx.advance(5 * MINUTE);
    const stream = await openStream(server, admin.accessToken);
    await stream.until(() => stream.events.length > 0);
    await new Promise((r) => setTimeout(r, 100)); // plusieurs revérifications
    const { rows: after } = await database.sql.query<{ last_activity_at: Date }>(
      'SELECT last_activity_at FROM admin_sessions WHERE user_id = $1',
      [admin.userId],
    );
    expect(after[0]!.last_activity_at).toEqual(before[0]!.last_activity_at);
    expect(stream.ended()).toBe(false);
    await stream.close();
  });

  it('arrêt du serveur : event end SERVER_SHUTDOWN', async () => {
    const hub = new InMemoryAdminEventHub();
    const streams = new AdminEventStreams();
    const ctx = createAdminTestApp(database.sql, { events: hub, eventStream: { streams } });
    const admin = await createAdmin(ctx.app, database.sql);
    server = await listen(ctx.app);
    const stream = await openStream(server, admin.accessToken);
    await stream.until(() => stream.events.length > 0);
    expect(streams.size).toBe(1);
    streams.closeAll();
    await stream.until(() => stream.ended());
    expect(stream.events.at(-1)).toEqual({ event: 'end', data: { code: 'SERVER_SHUTDOWN' } });
    expect(streams.size).toBe(0);
  });

  it('sans bus de signaux : 503 REALTIME_UNAVAILABLE', async () => {
    const ctx = createAdminTestApp(database.sql);
    const admin = await createAdmin(ctx.app, database.sql);
    const res = await asAdmin(ctx.app, admin.accessToken).get('/api/admin/events').expect(503);
    expect(res.body.code).toBe('REALTIME_UNAVAILABLE');
  });
});
