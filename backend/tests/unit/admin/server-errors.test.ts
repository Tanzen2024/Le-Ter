import express from 'express';
import request from 'supertest';

import {
  routeOf,
  serverErrorFingerprint,
  type ServerErrorOccurrence,
} from '../../../src/domain/admin/server-errors';
import { UnresolvedRuleError } from '../../../src/domain/rules/unresolved-rule';
import { createErrorHandler } from '../../../src/middleware/error-handler';
import { requestId } from '../../../src/middleware/request-id';
import type { ServerErrorRepository } from '../../../src/repositories/server-error.repository';
import { silentLogger } from '../../../src/utils/logger';

class FakeServerErrors implements ServerErrorRepository {
  recorded: ServerErrorOccurrence[] = [];
  failing = false;
  async record(o: ServerErrorOccurrence): Promise<void> {
    if (this.failing) throw new Error('base injoignable');
    this.recorded.push(o);
  }
  async list() {
    return { total: 0, items: [] };
  }
}

/** Laisse passer la promesse d'enregistrement, lancée sans être attendue. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function appWith(serverErrors: ServerErrorRepository) {
  const app = express();
  app.use(requestId);
  app.get('/api/games/:gameId', () => {
    throw new Error('panne interne');
  });
  app.get('/api/known', () => {
    throw Object.assign(new Error('pool saturé'), { name: 'PoolError' });
  });
  app.get('/api/refused', (_req, _res, next) => {
    next(Object.assign(new Error('x'), { status: 404 }));
  });
  app.use(createErrorHandler(silentLogger, serverErrors));
  return app;
}

describe('pannes du serveur condensées pour le back-office (D-168)', () => {
  it('une panne 500 est enregistrée : route Express (sans identifiant), requête, trace', async () => {
    const repo = new FakeServerErrors();
    const res = await request(appWith(repo))
      .get('/api/games/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f?token=secret')
      .set('X-Request-Id', 'req-7');
    await flush();

    expect(res.status).toBe(500);
    expect(repo.recorded).toHaveLength(1);
    expect(repo.recorded[0]).toMatchObject({
      method: 'GET',
      route: '/api/games/:gameId',
      status: 500,
      code: null,
      errorName: 'Error',
      message: 'panne interne',
      requestId: 'req-7',
    });
    expect(repo.recorded[0]!.stack).toContain('panne interne');
    expect(JSON.stringify(repo.recorded[0])).not.toContain('secret');
  });

  it('un refus 4xx n’est pas une panne : rien n’est enregistré', async () => {
    const repo = new FakeServerErrors();
    const res = await request(appWith(repo)).get('/api/refused');
    await flush();

    expect(res.status).toBe(404);
    expect(repo.recorded).toHaveLength(0);
  });

  it('erreur connue de statut 5xx (base injoignable) : enregistrée avec son code stable', async () => {
    const repo = new FakeServerErrors();
    const app = express();
    app.get('/api/wallet', () => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    });
    app.use(createErrorHandler(silentLogger, repo));
    const res = await request(app).get('/api/wallet');
    await flush();

    expect(res.status).toBe(503);
    expect(repo.recorded[0]).toMatchObject({
      route: '/api/wallet',
      status: 503,
      code: 'SERVICE_TEMPORARILY_UNAVAILABLE',
    });
  });

  it('501 RULE_NOT_DEFINED : réponse prévue d’une règle non tranchée, pas une panne', async () => {
    const repo = new FakeServerErrors();
    const app = express();
    app.get('/api/rule', () => {
      throw new UnresolvedRuleError('R-99', 'test');
    });
    app.use(createErrorHandler(silentLogger, repo));
    const res = await request(app).get('/api/rule');
    await flush();

    expect(res.status).toBe(501);
    expect(repo.recorded).toHaveLength(0);
  });

  it('l’enregistrement qui échoue ne change jamais la réponse', async () => {
    const repo = new FakeServerErrors();
    repo.failing = true;
    const res = await request(appWith(repo)).get('/api/known').set('X-Request-Id', 'req-9');
    await flush();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error', requestId: 'req-9' });
  });

  it('regroupement : même méthode, route, statut, code et type → même empreinte, message exclu', () => {
    const base = { method: 'GET', route: '/api/x', status: 500, code: null, errorName: 'Error' };
    expect(serverErrorFingerprint(base)).toBe(serverErrorFingerprint({ ...base }));
    expect(serverErrorFingerprint(base)).not.toBe(serverErrorFingerprint({ ...base, status: 503 }));
    expect(serverErrorFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('route sans motif Express : identifiants remplacés par :id, jamais la query string', () => {
    expect(routeOf({ path: '/api/games/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f/actions' })).toBe(
      '/api/games/:id/actions',
    );
    expect(routeOf({ path: '/api/users/42' })).toBe('/api/users/:id');
    expect(routeOf({ baseUrl: '/api/admin', path: '/x/1', route: { path: '/x/:n' } })).toBe(
      '/api/admin/x/:n',
    );
  });
});
