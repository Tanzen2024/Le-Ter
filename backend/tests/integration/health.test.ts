import request from 'supertest';

import { createApp } from '../../src/app';

describe('GET /api/health', () => {
  const app = createApp();

  it('répond avec le statut ok', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'disconnected', redis: 'disconnected' });
  });

  it('renvoie 404 sur une route inconnue', async () => {
    const res = await request(app).get('/api/inconnue');

    expect(res.status).toBe(404);
  });
});
