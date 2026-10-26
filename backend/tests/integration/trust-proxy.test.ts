import express from 'express';
import request from 'supertest';

import { readTrustProxy } from '../../src/config/env';
import { createRateLimiter } from '../../src/middleware/rate-limit';

/**
 * `TRUST_PROXY=loopback` derrière un tunnel LOCAL (ngrok, cloudflared ; D-170). L'agent du tunnel
 * se connecte depuis 127.0.0.1 et AJOUTE l'adresse du client à la fin de `X-Forwarded-For` (ce
 * que le client a pu envoyer reste à gauche). Supertest se connecte lui aussi depuis le loopback :
 * il joue ici le rôle de l'agent du tunnel.
 */
function appWith(trustProxy: string | undefined, max = 3) {
  const app = express();
  const parsed = readTrustProxy(trustProxy);
  if (parsed !== undefined) app.set('trust proxy', parsed);
  app.get('/ip', createRateLimiter({ name: 'probe', windowMs: 60_000, max }), (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

/** En-tête tel que le tunnel le transmet : valeurs du client, puis l'adresse vue par le tunnel. */
const forwarded = (clientSent: string | null, seenByTunnel: string) =>
  clientSent ? `${clientSent}, ${seenByTunnel}` : seenByTunnel;

describe('TRUST_PROXY=loopback derrière un tunnel local', () => {
  it("l'adresse retenue est celle ajoutée par le tunnel (dernière valeur)", async () => {
    const res = await request(appWith('loopback'))
      .get('/ip')
      .set('X-Forwarded-For', forwarded(null, '203.0.113.7'))
      .expect(200);
    expect(res.body.ip).toBe('203.0.113.7');
  });

  it("un X-Forwarded-For forgé par le client ne change pas l'adresse retenue", async () => {
    const res = await request(appWith('loopback'))
      .get('/ip')
      .set('X-Forwarded-For', forwarded('1.2.3.4, 10.0.0.1', '203.0.113.7'))
      .expect(200);
    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('limite par IP : un client qui change son en-tête forgé reste compté sur SA vraie adresse', async () => {
    const app = appWith('loopback', 3);
    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .get('/ip')
        .set('X-Forwarded-For', forwarded(`198.51.100.${i}`, '203.0.113.7'))
        .expect(200);
    }
    await request(app)
      .get('/ip')
      .set('X-Forwarded-For', forwarded('198.51.100.99', '203.0.113.7'))
      .expect(429);
    // Un AUTRE joueur (autre adresse vue par le tunnel) n'est pas pénalisé.
    await request(app).get('/ip').set('X-Forwarded-For', forwarded(null, '203.0.113.8')).expect(200);
  });

  it('sans TRUST_PROXY (défaut) : tous les joueurs partagent l’adresse du tunnel (127.0.0.1)', async () => {
    const app = appWith(undefined, 2);
    const a = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.7').expect(200);
    expect(a.body.ip).toMatch(/127\.0\.0\.1|::1/);
    await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.8').expect(200);
    await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.9').expect(429);
  });

  it('`true` reste refusé (ferait confiance à toute la chaîne, donc au client)', () => {
    expect(() => readTrustProxy('true')).toThrow(/TRUST_PROXY invalide/);
  });
});
