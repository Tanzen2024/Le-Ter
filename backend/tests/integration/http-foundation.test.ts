import express from 'express';
import request from 'supertest';

import { createApp } from '../../src/app';
import { createErrorHandler } from '../../src/middleware/error-handler';
import { requestId } from '../../src/middleware/request-id';
import { createLogger, silentLogger, type Logger } from '../../src/utils/logger';

function captureLogger(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  return { logger: createLogger({}, (line) => lines.push(JSON.parse(line))), lines };
}

describe('Socle HTTP', () => {
  it('attribue un X-Request-Id à chaque réponse', async () => {
    const res = await request(createApp()).get('/api/health');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reprend un X-Request-Id valide fourni par l'appelant, remplace un identifiant invalide", async () => {
    const app = createApp();
    const kept = await request(app).get('/api/health').set('X-Request-Id', 'abc-123');
    const replaced = await request(app).get('/api/health').set('X-Request-Id', 'x'.repeat(200));

    expect(kept.headers['x-request-id']).toBe('abc-123');
    expect(replaced.headers['x-request-id']).not.toBe('x'.repeat(200));
  });

  it('un JSON mal formé est une erreur client (400), pas une panne serveur', async () => {
    const { logger, lines } = captureLogger();
    const res = await request(createApp({ logger }))
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"gameId": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request' });
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', status: 400 }));
  });

  it('un corps trop volumineux est refusé (413)', async () => {
    const res = await request(createApp({ logger: silentLogger }))
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(64 * 1024) }));

    expect(res.status).toBe(413);
  });

  it('une panne renvoie 500 sans détail interne et la journalise avec le requestId', async () => {
    const { logger, lines } = captureLogger();
    const app = express();
    app.use(requestId);
    app.get('/boom', () => {
      throw new Error('mot de passe=secret dans un message interne');
    });
    app.use(createErrorHandler(logger));

    const res = await request(app).get('/boom').set('X-Request-Id', 'req-42');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error', requestId: 'req-42' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'request failed',
        requestId: 'req-42',
        method: 'GET',
        path: '/boom',
      }),
    );
  });

  it('un 503 connu journalise sa cause (code système) et la durée, sans la renvoyer au client', async () => {
    const { logger, lines } = captureLogger();
    const app = express();
    app.use(requestId);
    app.get('/db', () => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5433'), { code: 'ECONNREFUSED' });
    });
    app.use(createErrorHandler(logger));

    const res = await request(app).get('/db');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SERVICE_TEMPORARILY_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        status: 503,
        durationMs: expect.any(Number),
        cause: { name: 'Error', code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5433' },
      }),
    );
  });

  it('une erreur client connue (4xx) ne journalise pas de cause', async () => {
    const { logger, lines } = captureLogger();
    const app = express();
    app.use(requestId);
    app.post('/json', express.json(), (_req, res) => {
      res.json({});
    });
    app.use(createErrorHandler(logger));

    await request(app).post('/json').set('Content-Type', 'application/json').send('{oops').expect(400);
    expect(lines.some((l) => 'cause' in l)).toBe(false);
  });
});
