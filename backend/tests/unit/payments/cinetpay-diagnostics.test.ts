import type { CinetPayEnv } from '../../../src/config/env';
import {
  diagnoseCinetPay,
  explainCinetPayDiagnostic,
} from '../../../src/services/payments/cinetpay/cinetpay-diagnostics';
import { createLogger } from '../../../src/utils/logger';

/**
 * Diagnostic CinetPay (`npm run payments:diagnose`) contre un `fetch` simulé : configuré,
 * joignable et authentification acceptée sont trois niveaux distincts ; une panne d'origine
 * (Cloudflare 52x) est reconnue comme telle ; aucun paiement créé, aucun secret restitué.
 */
const API_KEY = 'sk_test_FAKE_DIAG_KEY';
const API_PASSWORD = 'fake-diag-password';
const ACCESS_TOKEN = 'fake.diag.token';

const ENV: CinetPayEnv = {
  apiKey: API_KEY,
  apiPassword: API_PASSWORD,
  environment: 'test',
  baseUrl: 'https://api.cinetpay.net',
  notifyUrl: 'https://api.test.local/api/payments/cinetpay/notify',
  returnUrl: 'https://api.test.local/api/payments/cinetpay/return',
  appReturnUrl: 'leter://payment/return',
  timeoutMs: 5_000,
  reconcileIntervalMs: 30_000,
  directPayMethods: ['MTN_CM'],
  pagePreselectMethods: [],
};

type Reply = { status: number; body?: unknown; raw?: string } | 'hang';

function setup(probe: Reply, login: Reply = { status: 200, body: LOGIN_OK }) {
  const urls: string[] = [];
  const lines: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    urls.push(`${init.method ?? 'GET'} ${url}`);
    const reply = url.endsWith('/v1/oauth/login') ? login : probe;
    if (reply === 'hang') {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    return new Response(reply.raw ?? JSON.stringify(reply.body), { status: reply.status });
  }) as unknown as typeof fetch;
  const run = (env: CinetPayEnv | undefined) =>
    diagnoseCinetPay(env, {
      logger: createLogger({}, (line) => lines.push(line)),
      fetch: fetchImpl,
      probeTimeoutMs: 50,
    });
  return { run, urls, lines };
}

const LOGIN_OK = { code: 200, status: 'OK', access_token: ACCESS_TOKEN, expires_in: 86_400 };

function expectNoSecret(text: string) {
  for (const secret of [API_KEY, API_PASSWORD, ACCESS_TOKEN]) expect(text).not.toContain(secret);
}

describe('diagnostic CinetPay', () => {
  it('non configuré : aucun appel réseau, diagnostic explicite', async () => {
    const { run, urls } = setup({ status: 404 });
    const report = await run(undefined);
    expect(report).toMatchObject({
      configured: false,
      reachability: { status: 'SKIPPED' },
      authentication: { status: 'SKIPPED', reason: 'NOT_CONFIGURED' },
      payment: 'NOT_VERIFIED',
    });
    expect(urls).toHaveLength(0);
    expect(explainCinetPayDiagnostic(report)).toMatch(/non configuré/);
  });

  it('Cloudflare 522 : panne chez CinetPay, authentification non tentée', async () => {
    const { run, urls } = setup({ status: 522, raw: 'error code: 522' });
    const report = await run(ENV);
    expect(report.reachability).toMatchObject({ status: 'ORIGIN_UNREACHABLE', httpStatus: 522 });
    expect(report.authentication).toEqual({ status: 'SKIPPED', reason: 'UNREACHABLE' });
    expect(urls).toEqual(['GET https://api.cinetpay.net/']);
    expect(explainCinetPayDiagnostic(report)).toMatch(/Panne CHEZ CinetPay/);
  });

  it('aucune réponse dans le délai : TIMEOUT (réseau sortant à vérifier)', async () => {
    const { run } = setup('hang');
    const report = await run(ENV);
    expect(report.reachability.status).toBe('TIMEOUT');
    expect(explainCinetPayDiagnostic(report)).toMatch(/injoignable depuis ce serveur/);
  });

  it('joignable et authentification acceptée : configuration valide, paiement non vérifié, aucun secret', async () => {
    const { run, urls, lines } = setup({ status: 404, body: { code: 404 } });
    const report = await run(ENV);
    expect(report).toMatchObject({
      configured: true,
      environment: 'test',
      directPayMethods: ['MTN_CM'],
      reachability: { status: 'REACHABLE', httpStatus: 404 },
      authentication: { status: 'ACCEPTED' },
      payment: 'NOT_VERIFIED',
    });
    // Aucun paiement créé : seulement la sonde et l'authentification.
    expect(urls).toEqual([
      'GET https://api.cinetpay.net/',
      'POST https://api.cinetpay.net/v1/oauth/login',
    ]);
    expectNoSecret(JSON.stringify(report));
    expectNoSecret(lines.join('\n'));
  });

  it('2011 NOT_ALLOWED : refus d’authentification attribué à l’IP non autorisée', async () => {
    const { run, lines } = setup(
      { status: 404 },
      { status: 200, body: { code: 2011, status: 'NOT_ALLOWED' } },
    );
    const report = await run(ENV);
    expect(report.authentication).toMatchObject({ status: 'REFUSED', apiCode: 2011 });
    expect(explainCinetPayDiagnostic(report)).toMatch(/adresse IP publique/);
    expectNoSecret(JSON.stringify(report));
    expectNoSecret(lines.join('\n'));
  });

  it('5xx à l’authentification : erreur du fournisseur, jamais un refus de clé', async () => {
    const { run } = setup({ status: 404 }, { status: 503, raw: 'unavailable' });
    const report = await run(ENV);
    expect(report.authentication).toMatchObject({ status: 'PROVIDER_ERROR', httpStatus: 503 });
  });
});
