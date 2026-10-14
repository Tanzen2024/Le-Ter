import {
  CINETPAY_TOKEN_TTL_SECONDS,
  CinetPayClient,
  CinetPayError,
  CinetPayPaymentNotSentError,
  type CinetPayPaymentRequest,
} from '../../../src/services/payments/cinetpay/cinetpay-client';
import { failureReasonOf } from '../../../src/services/payments/cinetpay/cinetpay.gateway';
import { MobileMoneyProviderError } from '../../../src/services/wallet/mobile-money.gateway';
import { createLogger } from '../../../src/utils/logger';

/**
 * Client CinetPay v1 (D-050) contre un `fetch` simulé : contrats des SDK officiels
 * (POST /v1/oauth/login, POST /v1/payment, GET /v1/payment/{id}), cache et renouvellement
 * du jeton, erreurs HTTP, délai dépassé, réponses invalides. Aucun secret dans les logs.
 */
const API_KEY = 'sk_test_FAKE_KEY_0001';
const API_PASSWORD = 'fake-password-0001';
const ACCESS_TOKEN = 'fake.jwt.token';
const NOTIFY_TOKEN = 'fake-notify-token-0001';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

type Reply = { status?: number; body?: unknown; raw?: string } | 'hang';

function scriptedFetch(replies: (call: Call) => Reply) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      headers: init.headers as Record<string, string>,
      ...(typeof init.body === 'string' && { body: JSON.parse(init.body) }),
    };
    calls.push(call);
    const reply = replies(call);
    if (reply === 'hang') {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    return new Response(reply.raw ?? JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const LOGIN_OK = {
  code: 200,
  status: 'OK',
  access_token: ACCESS_TOKEN,
  token_type: 'bearer',
  expires_in: 86_400,
};

const PAYMENT_OK = {
  code: 200,
  status: 'OK',
  payment_token: 'fake-payment-token',
  notify_token: NOTIFY_TOKEN,
  transaction_id: 'cp-tx-1',
  merchant_transaction_id: 'LT0001',
  payment_url: 'https://secure.sandbox.cinetpay.net/payment/fake',
  details: { code: 2001, status: 'INITIATED', message: 'ok', must_be_redirected: true },
};

const REQUEST: CinetPayPaymentRequest = {
  merchantTransactionId: 'LT0001',
  amount: 1000,
  currency: 'XAF',
  lang: 'fr',
  designation: 'Achat de 1000 jetons Le Ter',
  clientEmail: 'player@test.local',
  clientFirstName: 'Alice',
  clientLastName: 'Test',
  successUrl: 'https://api.test.local/api/payments/cinetpay/return/x',
  failedUrl: 'https://api.test.local/api/payments/cinetpay/return/x',
  notifyUrl: 'https://api.test.local/api/payments/cinetpay/notify',
  channel: 'PUSH',
};

function setup(replies: (call: Call) => Reply, options: { timeoutMs?: number } = {}) {
  const fetchMock = scriptedFetch(replies);
  const lines: string[] = [];
  let now = 1_000_000;
  const client = new CinetPayClient({
    baseUrl: 'https://api.cinetpay.net/',
    apiKey: API_KEY,
    apiPassword: API_PASSWORD,
    timeoutMs: options.timeoutMs ?? 5_000,
    logger: createLogger({}, (line) => lines.push(line)),
    fetch: fetchMock.impl,
    clock: () => now,
  });
  return {
    client,
    calls: fetchMock.calls,
    lines,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Routage simple : login, création, statut. */
const routes =
  (overrides: { login?: Reply; payment?: Reply; status?: Reply } = {}) =>
  (call: Call): Reply => {
    if (call.url.endsWith('/v1/oauth/login')) return overrides.login ?? { body: LOGIN_OK };
    if (call.method === 'POST' && call.url.endsWith('/v1/payment')) {
      return overrides.payment ?? { body: PAYMENT_OK };
    }
    return (
      overrides.status ?? {
        body: {
          code: 100,
          status: 'SUCCESS',
          transaction_id: 'cp-tx-1',
          merchant_transaction_id: 'LT0001',
          user: { name: 'A', email: 'a@test.local', phone_number: '+237600000000' },
        },
      }
    );
  };

function expectNoSecret(text: string) {
  for (const secret of [API_KEY, API_PASSWORD, ACCESS_TOKEN, NOTIFY_TOKEN, 'Bearer']) {
    expect(text).not.toContain(secret);
  }
}

describe('authenticate()', () => {
  it('authentication success : POST /v1/oauth/login { api_key, api_password }', async () => {
    const { client, calls } = setup(routes());
    await expect(client.authenticate()).resolves.toBe(ACCESS_TOKEN);
    expect(calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: 'https://api.cinetpay.net/v1/oauth/login',
        body: { api_key: API_KEY, api_password: API_PASSWORD },
      }),
    ]);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it('authentication failure : erreur typée, sans aucun secret dans le message ni les logs', async () => {
    const { client, lines } = setup(
      routes({
        login: {
          status: 401,
          body: { code: 1005, status: 'INVALID_CREDENTIALS', description: 'invalid' },
        },
      }),
    );
    const err = await client.authenticate().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CinetPayError);
    expect(err).toMatchObject({ kind: 'authentication', details: { apiCode: 1005 } });
    expectNoSecret(String((err as Error).message));
    expectNoSecret(lines.join('\n'));
    expectNoSecret(JSON.stringify(client));
  });

  it('réponse 200 sans access_token : authentification refusée', async () => {
    const { client } = setup(routes({ login: { body: { code: 200, status: 'OK' } } }));
    await expect(client.authenticate()).rejects.toMatchObject({ kind: 'authentication' });
  });

  it('token caching : un seul login pour plusieurs appels (y compris simultanés)', async () => {
    const { client, calls } = setup(routes());
    await Promise.all([client.authenticate(), client.authenticate()]);
    await client.createPayment(REQUEST);
    await client.getPaymentStatus('cp-tx-1');
    expect(calls.filter((c) => c.url.endsWith('/v1/oauth/login'))).toHaveLength(1);
  });

  it('token expiration : renouvelé après sa durée de vie (plafonnée à 23 h, avec marge)', async () => {
    const { client, calls, advance } = setup(routes());
    await client.authenticate();
    advance((CINETPAY_TOKEN_TTL_SECONDS - 600) * 1000);
    await client.authenticate();
    expect(calls).toHaveLength(1);
    advance(600 * 1000);
    await client.authenticate();
    expect(calls).toHaveLength(2);
  });

  it('jeton refusé par CinetPay (1003 EXPIRED_TOKEN) : ré-authentification et nouvel essai, une fois', async () => {
    let expiredOnce = false;
    const { client, calls } = setup((call) => {
      if (call.method === 'POST' && call.url.endsWith('/v1/payment') && !expiredOnce) {
        expiredOnce = true;
        return { status: 401, body: { code: 1003, status: 'EXPIRED_TOKEN', description: 'x' } };
      }
      return routes()(call);
    });
    await expect(client.createPayment(REQUEST)).resolves.toMatchObject({
      transactionId: 'cp-tx-1',
    });
    expect(calls.map((c) => c.url.replace('https://api.cinetpay.net', ''))).toEqual([
      '/v1/oauth/login',
      '/v1/payment',
      '/v1/oauth/login',
      '/v1/payment',
    ]);
  });

  it('jeton toujours refusé après renouvellement : erreur, pas de boucle', async () => {
    const { client, calls } = setup(
      routes({ payment: { body: { code: 1003, status: 'EXPIRED_TOKEN' } } }),
    );
    await expect(client.createPayment(REQUEST)).rejects.toMatchObject({ kind: 'expired_token' });
    expect(calls).toHaveLength(4);
  });
});

/**
 * Réponses RÉELLES du sandbox observées le 2026-10-08 sans aucun identifiant (sonde curl) :
 * CinetPay répond HTTP 422, pas 401, avec { code, status, description }.
 */
describe('formats d’erreur observés sur api.cinetpay.net', () => {
  it('login sans paramètres : 422 { code: 1004, INVALID_PARAMS } → authentification refusée', async () => {
    const { client } = setup(
      routes({
        login: {
          status: 422,
          body: {
            code: 1004,
            status: 'INVALID_PARAMS',
            description: 'Params you provides are invalid',
          },
        },
      }),
    );
    await expect(client.authenticate()).rejects.toMatchObject({
      kind: 'authentication',
      details: { httpStatus: 422, apiCode: 1004, apiStatus: 'INVALID_PARAMS' },
    });
  });

  // Réponse réellement observée sur le sandbox avec une paire clé / mot de passe incohérente.
  it('identifiants invalides : 422 { code: 1005, INVALID_CREDENTIALS } → refus typé, sans secret ni nouvel essai', async () => {
    const { client, calls, lines } = setup(
      routes({
        login: {
          status: 422,
          body: { code: 1005, status: 'INVALID_CREDENTIALS', description: 'invalid credentials' },
        },
      }),
    );
    const err = await client.authenticate().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CinetPayError);
    expect(err).toMatchObject({
      kind: 'authentication',
      details: { httpStatus: 422, apiCode: 1005, apiStatus: 'INVALID_CREDENTIALS' },
    });
    expect(calls.filter((c) => c.url.endsWith('/v1/oauth/login'))).toHaveLength(1);
    expectNoSecret(String((err as Error).message));
    expectNoSecret(lines.join('\n'));
  });

  // Observé le 2026-10-13 : origine CinetPay injoignable, Cloudflare répond 522 en texte brut.
  it('login 522 (Cloudflare, origine CinetPay en panne) : erreur http 522, jamais un refus d’authentification', async () => {
    const { client, calls } = setup(routes({ login: { status: 522, raw: 'error code: 522' } }));
    const err = await client.authenticate().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'http', details: { httpStatus: 522 } });
    const notSent = await client.createPayment(REQUEST).catch((e: unknown) => e);
    expect(notSent).toBeInstanceOf(CinetPayPaymentNotSentError);
    expect(failureReasonOf(notSent)).toBe('CinetPayPaymentNotSentError:http:522');
    expect(calls.some((c) => c.url.endsWith('/v1/payment'))).toBe(false);
  });

  // Matrice des échecs au login (D-094) : un refus (4xx) reste un refus d'authentification ;
  // une panne (5xx, délai, réseau) garde son type. Dans tous les cas, POST /v1/payment n'est
  // jamais émis : demande « non envoyée », jamais « issue inconnue ».
  it.each<[string, Reply, string, string]>([
    ['401', { status: 401, raw: 'Unauthorized' }, 'authentication', 'authentication:401'],
    ['403', { status: 403, raw: 'Forbidden' }, 'authentication', 'authentication:403'],
    [
      '422 1005',
      { status: 422, body: { code: 1005, status: 'INVALID_CREDENTIALS' } },
      'authentication',
      'authentication:1005:INVALID_CREDENTIALS',
    ],
    ['500', { status: 500, raw: 'Internal error' }, 'http', 'http:500'],
    ['503', { status: 503, raw: 'Service unavailable' }, 'http', 'http:503'],
    ['522', { status: 522, raw: 'error code: 522' }, 'http', 'http:522'],
    ['délai', 'hang', 'timeout', 'timeout'],
  ])('login %s : type %s, demande jamais envoyée', async (_label, login, kind, reason) => {
    const { client, calls, lines } = setup(routes({ login }), { timeoutMs: 50 });
    const err = await client.createPayment(REQUEST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CinetPayPaymentNotSentError);
    expect((err as CinetPayPaymentNotSentError).cause).toMatchObject({ kind });
    expect(failureReasonOf(err)).toBe(`CinetPayPaymentNotSentError:${reason}`);
    expect(calls.some((c) => c.url.endsWith('/v1/payment'))).toBe(false);
    expectNoSecret(lines.join('\n'));
  });

  it('login, erreur réseau : type network, demande jamais envoyée', async () => {
    const client = new CinetPayClient({
      baseUrl: 'https://api.cinetpay.net',
      apiKey: API_KEY,
      apiPassword: API_PASSWORD,
      logger: createLogger({}, () => undefined),
      fetch: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
    });
    const err = await client.createPayment(REQUEST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CinetPayPaymentNotSentError);
    expect(failureReasonOf(err)).toBe('CinetPayPaymentNotSentError:network');
  });

  it('jeton invalide : 422 { code: 1002, INVALID_TOKEN } → erreur, sans boucle de renouvellement', async () => {
    const { client, calls } = setup(
      routes({
        payment: {
          status: 422,
          body: { code: 1002, status: 'INVALID_TOKEN', description: 'Token is invalid' },
        },
      }),
    );
    await expect(client.createPayment(REQUEST)).rejects.toMatchObject({
      kind: 'http',
      details: { httpStatus: 422, apiCode: 1002 },
    });
    expect(calls.filter((c) => c.url.endsWith('/v1/oauth/login'))).toHaveLength(1);
  });

  it('jeton expiré renvoyé en 422 { code: 1003 } : renouvelé une fois', async () => {
    let first = true;
    const { client, calls } = setup((call) => {
      if (call.method === 'GET' && first) {
        first = false;
        return { status: 422, body: { code: 1003, status: 'EXPIRED_TOKEN' } };
      }
      return routes()(call);
    });
    await expect(client.getPaymentStatus('cp-tx-1')).resolves.toMatchObject({ status: 'SUCCESS' });
    expect(calls.filter((c) => c.url.endsWith('/v1/oauth/login'))).toHaveLength(2);
  });
});

describe('createPayment()', () => {
  it('create payment : POST /v1/payment, champs du SDK officiel, jeton Bearer', async () => {
    const { client, calls, lines } = setup(routes());
    const created = await client.createPayment(REQUEST);

    expect(created).toEqual({
      transactionId: 'cp-tx-1',
      merchantTransactionId: 'LT0001',
      paymentUrl: PAYMENT_OK.payment_url,
      notifyToken: NOTIFY_TOKEN,
      initialStatus: 'INITIATED',
      mustBeRedirected: true,
    });
    const post = calls[1]!;
    expect(post.method).toBe('POST');
    expect(post.url).toBe('https://api.cinetpay.net/v1/payment');
    expect(post.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(post.body).toEqual({
      currency: 'XAF',
      merchant_transaction_id: 'LT0001',
      amount: 1000,
      lang: 'fr',
      designation: 'Achat de 1000 jetons Le Ter',
      client_email: 'player@test.local',
      client_first_name: 'Alice',
      client_last_name: 'Test',
      success_url: REQUEST.successUrl,
      failed_url: REQUEST.failedUrl,
      notify_url: REQUEST.notifyUrl,
      channel: 'PUSH',
    });
    expectNoSecret(lines.join('\n'));
  });

  it('refus métier (code ≠ 200) : erreur api avec code et statut', async () => {
    const { client } = setup(
      routes({ payment: { body: { code: 1004, status: 'INVALID_PARAMS', description: 'bad' } } }),
    );
    await expect(client.createPayment(REQUEST)).rejects.toMatchObject({
      kind: 'api',
      details: { apiCode: 1004, apiStatus: 'INVALID_PARAMS' },
    });
  });

  it('HTTP error : 500 → erreur http', async () => {
    const { client } = setup(routes({ payment: { status: 500, raw: 'Internal error' } }));
    await expect(client.createPayment(REQUEST)).rejects.toMatchObject({
      kind: 'http',
      details: { httpStatus: 500 },
    });
  });

  it('timeout : AbortSignal.timeout interrompt l’appel', async () => {
    const { client } = setup(routes({ payment: 'hang' }), { timeoutMs: 50 });
    await expect(client.createPayment(REQUEST)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('erreur réseau : erreur network, sans détail interne', async () => {
    const lines: string[] = [];
    const client = new CinetPayClient({
      baseUrl: 'https://api.cinetpay.net',
      apiKey: API_KEY,
      apiPassword: API_PASSWORD,
      logger: createLogger({}, (l) => lines.push(l)),
      fetch: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
    });
    await expect(client.authenticate()).rejects.toMatchObject({ kind: 'network' });
    expectNoSecret(lines.join('\n'));
  });

  it.each([
    ['corps non JSON', { raw: '<html>' }],
    ['payment_url absente', { body: { ...PAYMENT_OK, payment_url: undefined } }],
    ['payment_url non HTTPS', { body: { ...PAYMENT_OK, payment_url: 'http://evil.test/pay' } }],
    ['notify_token absent', { body: { ...PAYMENT_OK, notify_token: '' } }],
    ['transaction_id absent', { body: { ...PAYMENT_OK, transaction_id: undefined } }],
    ['autre merchant_transaction_id', { body: { ...PAYMENT_OK, merchant_transaction_id: 'X' } }],
  ])('malformed response : %s', async (_label, reply) => {
    const { client } = setup(routes({ payment: reply as Reply }));
    await expect(client.createPayment(REQUEST)).rejects.toMatchObject({
      kind: 'malformed_response',
    });
  });
});

describe('getPaymentStatus()', () => {
  it('get payment status : GET /v1/payment/{id} (encodé), statut et références', async () => {
    const { client, calls } = setup(routes());
    await expect(client.getPaymentStatus('cp-tx-1')).resolves.toEqual({
      code: 100,
      status: 'SUCCESS',
      transactionId: 'cp-tx-1',
      merchantTransactionId: 'LT0001',
    });
    expect(calls[1]).toEqual(
      expect.objectContaining({
        method: 'GET',
        url: 'https://api.cinetpay.net/v1/payment/cp-tx-1',
      }),
    );
    expect(calls[1]!.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    await client.getPaymentStatus('a/b?c');
    expect(calls[2]!.url).toBe('https://api.cinetpay.net/v1/payment/a%2Fb%3Fc');
  });

  it.each(['FAILED', 'PENDING', 'EXPIRED', 'INITIATED'])(
    'statut %s lu tel quel',
    async (status) => {
      const { client } = setup(
        routes({
          status: {
            body: {
              code: 2010,
              status,
              transaction_id: 'cp-tx-1',
              merchant_transaction_id: 'LT0001',
            },
          },
        }),
      );
      await expect(client.getPaymentStatus('cp-tx-1')).resolves.toMatchObject({ status });
    },
  );

  it('montant et devise lus seulement s’ils sont renvoyés', async () => {
    const { client } = setup(
      routes({
        status: {
          body: {
            code: 100,
            status: 'SUCCESS',
            transaction_id: 'cp-tx-1',
            merchant_transaction_id: 'LT0001',
            amount: '1000',
            currency: 'XAF',
          },
        },
      }),
    );
    await expect(client.getPaymentStatus('cp-tx-1')).resolves.toMatchObject({
      amount: 1000,
      currency: 'XAF',
    });
  });

  it('paiement inconnu (404 NOT_FOUND) : erreur http', async () => {
    const { client } = setup(
      routes({ status: { status: 404, body: { code: 404, status: 'NOT_FOUND' } } }),
    );
    await expect(client.getPaymentStatus('nope')).rejects.toMatchObject({ kind: 'http' });
  });

  it('réponse sans références : malformed response', async () => {
    const { client } = setup(routes({ status: { body: { foo: 'bar' } } }));
    await expect(client.getPaymentStatus('cp-tx-1')).rejects.toMatchObject({
      kind: 'malformed_response',
    });
  });
});

/**
 * Paiement DIRECT (D-083) : même POST /v1/payment, champs du SDK officiel `cinetpay-js`
 * (`serializePaymentRequest`) : `payment_method`, `client_phone_number`, `direct_pay`.
 */
describe('createPayment() — paiement direct (sans redirection)', () => {
  const PHONE = '+237670000001';
  const DIRECT: CinetPayPaymentRequest = {
    ...REQUEST,
    direct: { paymentMethod: 'MTN_CM', phoneNumber: PHONE },
  };
  const DIRECT_OK = {
    ...PAYMENT_OK,
    payment_url: undefined,
    details: {
      code: 2001,
      status: 'INITIATED',
      message: 'Validez sur votre téléphone',
      must_be_redirected: false,
    },
  };

  it('champs direct_pay, payment_method, client_phone_number ; jamais d’otp_code ; numéro jamais journalisé', async () => {
    const { client, calls, lines } = setup(routes({ payment: { body: DIRECT_OK } }));
    const created = await client.createPayment(DIRECT);
    expect(created).toEqual({
      transactionId: 'cp-tx-1',
      merchantTransactionId: 'LT0001',
      notifyToken: NOTIFY_TOKEN,
      initialStatus: 'INITIATED',
      mustBeRedirected: false,
    });
    expect(calls[1]!.body).toMatchObject({
      payment_method: 'MTN_CM',
      client_phone_number: PHONE,
      direct_pay: true,
      channel: 'PUSH',
    });
    expect(calls[1]!.body).not.toHaveProperty('otp_code');
    const logs = lines.join('\n');
    expect(logs).not.toContain(PHONE);
    expectNoSecret(logs);
  });

  it('paiement classique : aucun champ direct envoyé', async () => {
    const { client, calls } = setup(routes());
    await client.createPayment(REQUEST);
    for (const field of ['payment_method', 'client_phone_number', 'direct_pay', 'otp_code']) {
      expect(calls[1]!.body).not.toHaveProperty(field);
    }
  });

  it('redirection exigée par CinetPay : URL HTTPS renvoyée, sinon réponse invalide', async () => {
    const redirect = {
      ...DIRECT_OK,
      payment_url: PAYMENT_OK.payment_url,
      details: { ...DIRECT_OK.details, must_be_redirected: true },
    };
    const ok = setup(routes({ payment: { body: redirect } }));
    expect(await ok.client.createPayment(DIRECT)).toMatchObject({
      mustBeRedirected: true,
      paymentUrl: PAYMENT_OK.payment_url,
    });
    const missing = setup(routes({ payment: { body: { ...redirect, payment_url: undefined } } }));
    await expect(missing.client.createPayment(DIRECT)).rejects.toMatchObject({
      kind: 'malformed_response',
    });
    const insecure = setup(
      routes({ payment: { body: { ...DIRECT_OK, payment_url: 'http://evil.test' } } }),
    );
    await expect(insecure.client.createPayment(DIRECT)).rejects.toMatchObject({
      kind: 'malformed_response',
    });
  });

  it('« SUCCESS » annoncé à la création : simple statut initial, jamais interprété', async () => {
    const instant = {
      ...DIRECT_OK,
      details: { ...DIRECT_OK.details, code: 100, status: 'SUCCESS' },
    };
    const { client } = setup(routes({ payment: { body: instant } }));
    expect(await client.createPayment(DIRECT)).toMatchObject({ initialStatus: 'SUCCESS' });
  });

  it('opérateur refusé (422 NOT_ALLOWED) : erreur http avec code CinetPay', async () => {
    const { client } = setup(
      routes({ payment: { status: 422, body: { code: 2011, status: 'NOT_ALLOWED' } } }),
    );
    await expect(client.createPayment(DIRECT)).rejects.toMatchObject({
      kind: 'http',
      details: { httpStatus: 422, apiCode: 2011, apiStatus: 'NOT_ALLOWED' },
    });
  });

  it('authentification refusée : demande JAMAIS envoyée (CinetPayPaymentNotSentError)', async () => {
    const { client, calls } = setup(
      routes({ login: { status: 422, body: { code: 1005, status: 'INVALID_CREDENTIALS' } } }),
    );
    await expect(client.createPayment(DIRECT)).rejects.toBeInstanceOf(CinetPayPaymentNotSentError);
    expect(calls.some((c) => c.url.endsWith('/v1/payment'))).toBe(false);
  });

  it('délai dépassé APRÈS l’envoi : erreur timeout (issue inconnue), pas « non envoyée »', async () => {
    const { client } = setup(routes({ payment: 'hang' }), { timeoutMs: 50 });
    const err = await client.createPayment(DIRECT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CinetPayError);
    expect(err).not.toBeInstanceOf(CinetPayPaymentNotSentError);
    expect(err).toMatchObject({ kind: 'timeout' });
  });
});

describe('createPayment() — page hébergée avec opérateur présélectionné (D-087)', () => {
  it('payment_method seul, sans direct_pay, numéro ni OTP', async () => {
    const { client, calls } = setup(routes());
    await client.createPayment({ ...REQUEST, pagePaymentMethod: 'OM_CM' });
    expect(calls[1]!.body).toMatchObject({ payment_method: 'OM_CM', channel: 'PUSH' });
    for (const field of ['direct_pay', 'client_phone_number', 'otp_code']) {
      expect(calls[1]!.body).not.toHaveProperty(field);
    }
  });
});

describe('createPayment() — numéro du payeur (D-088)', () => {
  it('page hébergée : client_phone_number transmis, sans direct_pay', async () => {
    const { client, calls, lines } = setup(routes());
    await client.createPayment({ ...REQUEST, clientPhoneNumber: '+237692130271' });
    expect(calls[1]!.body).toMatchObject({ client_phone_number: '+237692130271' });
    expect(calls[1]!.body).not.toHaveProperty('direct_pay');
    expect(lines.join('\n')).not.toContain('+237692130271');
  });
});

describe('erreurs du fournisseur (D-091)', () => {
  it('CinetPayError et CinetPayPaymentNotSentError sont des erreurs du FOURNISSEUR', () => {
    expect(new CinetPayError('timeout', 'x')).toBeInstanceOf(MobileMoneyProviderError);
    expect(new CinetPayPaymentNotSentError(new Error('x'))).toBeInstanceOf(
      MobileMoneyProviderError,
    );
    expect(new Error('Connection terminated unexpectedly')).not.toBeInstanceOf(
      MobileMoneyProviderError,
    );
  });
});
