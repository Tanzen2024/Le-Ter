import { readEnv } from '../../src/config/env';
import { CINETPAY_CALLBACK_PATHS, tunnelEnvironment } from '../../src/config/tunnel-env';

/** Mode « tunnel local » de l'environnement de test (D-170) : aucune connexion, aucun tunnel lancé. */
describe('tunnelEnvironment', () => {
  const ORIGIN = 'https://le-ter-test.example.org';

  it('impose le loopback, la confiance au seul saut local et les URL CinetPay sur les routes existantes', () => {
    expect(tunnelEnvironment(ORIGIN)).toEqual({
      HOST: '127.0.0.1',
      TRUST_PROXY: 'loopback',
      CINETPAY_NOTIFY_URL: `${ORIGIN}/api/payments/cinetpay/notify`,
      CINETPAY_RETURN_URL: `${ORIGIN}/api/payments/cinetpay/return`,
      CINETPAY_TRANSFER_NOTIFY_URL: `${ORIGIN}/api/withdrawals/cinetpay/notify`,
    });
    expect(Object.values(CINETPAY_CALLBACK_PATHS)).toHaveLength(3);
  });

  it.each([
    ['http://le-ter-test.example.org', /https/],
    ['https://192.168.1.20', /réseau privé/],
    ['https://100.101.102.103', /VPN/],
    ['https://localhost', /locale/],
    ['https://abc.trycloudflare.com', /temporaire/],
    ['https://le-ter-test.example.org/api', /sans chemin/],
    ['https://user:pass@le-ter-test.example.org', /sans chemin/],
    ['pas une url', /invalide/],
  ])('refuse %s', (url, message) => {
    expect(() => tunnelEnvironment(url)).toThrow(message);
  });

  it('refuse une origine qui rendrait une URL CinetPay trop longue (120 caractères)', () => {
    expect(() => tunnelEnvironment(`https://${'a'.repeat(60)}.example.org`)).toThrow(/trop longue/);
  });

  it('les variables produites passent readEnv avec une clé sandbox (et une clé live reste refusée)', () => {
    const sandbox = {
      CINETPAY_API_KEY: 'sk_test_FAKE',
      CINETPAY_API_PASSWORD: 'fake',
      CINETPAY_TRANSFERS_ENABLED: 'true',
      ...tunnelEnvironment(ORIGIN),
    };
    const env = readEnv(sandbox);
    expect(env).toMatchObject({ host: '127.0.0.1', trustProxy: 'loopback' });
    expect(env.cinetpay).toMatchObject({
      environment: 'test',
      notifyUrl: `${ORIGIN}/api/payments/cinetpay/notify`,
      transfers: { notifyUrl: `${ORIGIN}/api/withdrawals/cinetpay/notify` },
    });
    expect(() => readEnv({ ...sandbox, CINETPAY_API_KEY: 'sk_live_FAKE' })).toThrow(/sk_live_/);
  });
});
