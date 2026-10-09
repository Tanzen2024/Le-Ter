import { readEnv } from '../../../src/config/env';

/** Configuration CinetPay v1 (D-050) : jamais de valeur recopiée dans une erreur. */
const BASE = {
  CINETPAY_API_KEY: 'sk_test_FAKE_KEY',
  CINETPAY_API_PASSWORD: 'fake-password',
  CINETPAY_NOTIFY_URL: 'https://api.example.com/api/payments/cinetpay/notify',
  CINETPAY_RETURN_URL: 'https://api.example.com/api/payments/cinetpay/return',
};

describe('readEnv — CinetPay', () => {
  it('désactivé sans clé ni mot de passe', () => {
    expect(readEnv({}).cinetpay).toBeUndefined();
  });

  it('clé sandbox : URL sandbox, retour application et délai par défaut', () => {
    expect(readEnv(BASE).cinetpay).toEqual({
      apiKey: 'sk_test_FAKE_KEY',
      apiPassword: 'fake-password',
      baseUrl: 'https://api.cinetpay.net',
      notifyUrl: BASE.CINETPAY_NOTIFY_URL,
      returnUrl: BASE.CINETPAY_RETURN_URL,
      appReturnUrl: 'leter://payment/return',
      timeoutMs: 15_000,
    });
  });

  it('clé production : URL production', () => {
    expect(readEnv({ ...BASE, CINETPAY_API_KEY: 'sk_live_FAKE' }).cinetpay?.baseUrl).toBe(
      'https://api.cinetpay.co',
    );
  });

  it.each([
    [{ CINETPAY_API_PASSWORD: '' }, /ensemble/],
    [{ CINETPAY_API_KEY: '' }, /ensemble/],
    [{ CINETPAY_API_KEY: 'pk_FAKE_SECRET' }, /préfixe/],
    [{ CINETPAY_NOTIFY_URL: '' }, /requis/],
    [{ CINETPAY_BASE_URL: 'http://api.cinetpay.net' }, /CINETPAY_BASE_URL/],
    [{ CINETPAY_TIMEOUT_MS: '10' }, /CINETPAY_TIMEOUT_MS/],
  ])('configuration invalide %p', (override, message) => {
    let error: unknown;
    try {
      readEnv({ ...BASE, ...override });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).not.toMatch(/FAKE|fake-password/);
  });

  it('production : URL publiques HTTPS obligatoires', () => {
    const production = {
      ...BASE,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://localhost/db',
      JWT_SECRET: 'x'.repeat(40),
      CINETPAY_NOTIFY_URL: 'http://api.example.com/notify',
    };
    expect(() => readEnv(production)).toThrow(/CINETPAY_NOTIFY_URL/);
  });
});
