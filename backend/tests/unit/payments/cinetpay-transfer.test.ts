import {
  CinetPayClient,
  CinetPayError,
  type CinetPayTransferRequest,
} from '../../../src/services/payments/cinetpay/cinetpay-client';
import { CinetPayTransferGateway } from '../../../src/services/payments/cinetpay/cinetpay-transfer.gateway';
import { createLogger } from '../../../src/utils/logger';

/**
 * Transferts CinetPay v1 (D-075) contre un `fetch` simulé, d'après le code du SDK officiel
 * `cinetpay-js` (`src/api/transfer.ts`, fixtures `TRANSFER_PENDING`, `TRANSFER_STATUS_SUCCESS`) :
 * POST /v1/transfer, GET /v1/transfer/{id}, classement des réponses (acceptée, refusée,
 * existante, incertaine). Aucun appel réseau, aucun transfert réel ; aucun numéro ni secret
 * dans les journaux.
 */
const PHONE = '+237670000042';
const NOTIFY_TOKEN = 'fake-transfer-notify-token';

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}
type Reply = { status?: number; body?: unknown } | 'network' | 'timeout';

function setup(reply: (call: Call) => Reply) {
  const calls: Call[] = [];
  const lines: string[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      ...(typeof init.body === 'string' && { body: JSON.parse(init.body) }),
    };
    calls.push(call);
    if (url.endsWith('/v1/oauth/login')) {
      return new Response(
        JSON.stringify({ code: 200, status: 'OK', access_token: 'tok', expires_in: 86_400 }),
      );
    }
    const r = reply(call);
    if (r === 'network') throw new TypeError('fetch failed');
    if (r === 'timeout') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  const client = new CinetPayClient({
    baseUrl: 'https://api.cinetpay.net',
    apiKey: 'sk_test_FAKE',
    apiPassword: 'fake',
    logger: createLogger({}, (line) => lines.push(line)),
    fetch: impl,
  });
  const gateway = new CinetPayTransferGateway({
    client,
    notifyUrl: 'https://api.test.local/api/withdrawals/cinetpay/notify',
  });
  return { client, gateway, calls, lines };
}

const REQUEST: CinetPayTransferRequest = {
  merchantTransactionId: 'LW0001',
  phoneNumber: PHONE,
  amount: 1000,
  currency: 'XAF',
  paymentMethod: 'MTN_CM',
  reason: 'Retrait de jetons Le Ter',
  notifyUrl: 'https://api.test.local/api/withdrawals/cinetpay/notify',
};

const TRANSFER_PENDING = {
  code: 2002,
  status: 'PENDING',
  merchant_transaction_id: 'LW0001',
  transaction_id: 'cp-transfer-1',
  notify_token: NOTIFY_TOKEN,
  amount: '1000',
  fee_amount: '15',
  phone_number: PHONE,
  currency: 'XAF',
};

describe('CinetPayClient.createTransfer', () => {
  it('POST /v1/transfer avec les champs du SDK ; réponse PENDING, jamais une réussite', async () => {
    const { client, calls, lines } = setup(() => ({ body: TRANSFER_PENDING }));
    const created = await client.createTransfer(REQUEST);
    expect(created).toEqual({
      code: 2002,
      status: 'PENDING',
      transactionId: 'cp-transfer-1',
      merchantTransactionId: 'LW0001',
      notifyToken: NOTIFY_TOKEN,
      feeAmount: 15,
    });
    expect(calls[1]).toEqual({
      method: 'POST',
      url: 'https://api.cinetpay.net/v1/transfer',
      body: {
        currency: 'XAF',
        merchant_transaction_id: 'LW0001',
        phone_number: PHONE,
        amount: 1000,
        payment_method: 'MTN_CM',
        reason: 'Retrait de jetons Le Ter',
        notify_url: 'https://api.test.local/api/withdrawals/cinetpay/notify',
      },
    });
    const logs = lines.join('\n');
    expect(logs).not.toContain(PHONE);
    expect(logs).not.toContain(NOTIFY_TOKEN);
  });

  it('référence marchande différente dans la réponse : réponse invalide', async () => {
    const { client } = setup(() => ({
      body: { ...TRANSFER_PENDING, merchant_transaction_id: 'AUTRE' },
    }));
    await expect(client.createTransfer(REQUEST)).rejects.toMatchObject({
      kind: 'malformed_response',
    });
  });
});

describe('CinetPayClient.getTransferStatus', () => {
  it('GET /v1/transfer/{merchant_transaction_id} : statut, montant et frais', async () => {
    const { client, calls } = setup(() => ({
      body: {
        code: 100,
        status: 'SUCCESS',
        merchant_transaction_id: 'LW0001',
        transaction_id: 'cp-transfer-1',
        amount: '1000',
        fee_amount: '15',
        user: { name: 'A', email: 'a@test.local', phone_number: PHONE },
      },
    }));
    await expect(client.getTransferStatus('LW0001')).resolves.toEqual({
      found: true,
      code: 100,
      status: 'SUCCESS',
      transactionId: 'cp-transfer-1',
      merchantTransactionId: 'LW0001',
      amount: 1000,
      feeAmount: 15,
    });
    expect(calls[1]).toEqual({ method: 'GET', url: 'https://api.cinetpay.net/v1/transfer/LW0001' });
  });

  it.each([
    [{ status: 404, body: { code: 404, status: 'NOT_FOUND' } }],
    [{ status: 200, body: { code: 404, status: 'NOT_FOUND', description: 'x' } }],
  ])('transfert inconnu (%j) : { found: false }', async (reply) => {
    const { client } = setup(() => reply);
    await expect(client.getTransferStatus('LW0001')).resolves.toEqual({ found: false });
  });

  it('HTTP 500 sans code NOT_FOUND : erreur (rien n’est décidé)', async () => {
    const { client } = setup(() => ({ status: 500, body: {} }));
    await expect(client.getTransferStatus('LW0001')).rejects.toBeInstanceOf(CinetPayError);
  });
});

describe('CinetPayTransferGateway.submit : classement des réponses', () => {
  it('acceptée : référence, statut initial, jeton de notification', async () => {
    const { gateway } = setup(() => ({ body: TRANSFER_PENDING }));
    await expect(
      gateway.submit({
        merchantTransactionId: 'LW0001',
        phoneNumber: PHONE,
        amount: 1000,
        currency: 'XAF',
        operator: 'MTN_CM',
      }),
    ).resolves.toEqual({
      kind: 'accepted',
      providerReference: 'cp-transfer-1',
      providerStatus: 'PENDING',
      notifyToken: NOTIFY_TOKEN,
      feeAmount: 15,
    });
  });

  it.each([
    [{ status: 422, body: { code: 1004, status: 'INVALID_PARAMS' } }, 'INVALID_PARAMS'],
    [{ status: 422, body: { code: 2005, status: 'INSUFFICIENT_BALANCE' } }, 'INSUFFICIENT_BALANCE'],
    [{ status: 403, body: { code: 2011, status: 'NOT_ALLOWED' } }, 'NOT_ALLOWED'],
  ])('refus explicite %j → rejected (rien créé)', async (reply, providerStatus) => {
    const { gateway } = setup(() => reply);
    await expect(submit(gateway)).resolves.toEqual({ kind: 'rejected', providerStatus });
  });

  it('TRANSACTION_EXIST (1200) → already_exists (à relire, jamais renvoyé)', async () => {
    const { gateway } = setup(() => ({
      status: 422,
      body: { code: 1200, status: 'TRANSACTION_EXIST' },
    }));
    await expect(submit(gateway)).resolves.toEqual({ kind: 'already_exists' });
  });

  it.each([
    ['réseau', 'network' as const, 'CINETPAY_NETWORK'],
    ['délai dépassé', 'timeout' as const, 'CINETPAY_TIMEOUT'],
    ['HTTP 502', { status: 502, body: {} }, 'CINETPAY_HTTP'],
    ['code inconnu', { status: 422, body: { code: 9999, status: 'WHATEVER' } }, 'CINETPAY_HTTP_9999'],
    ['réponse illisible', { status: 200, body: { hello: 'world' } }, 'CINETPAY_MALFORMED_RESPONSE'],
  ])('%s → uncertain (issue inconnue, rien n’est décidé)', async (_label, reply, errorCode) => {
    const { gateway } = setup(() => reply);
    await expect(submit(gateway)).resolves.toEqual({ kind: 'uncertain', errorCode });
  });
});

const submit = (gateway: CinetPayTransferGateway) =>
  gateway.submit({
    merchantTransactionId: 'LW0001',
    phoneNumber: PHONE,
    amount: 1000,
    currency: 'XAF',
    operator: 'OM_CM',
  });

describe('Demande non envoyée et relecture seule (D-076)', () => {
  /** Client dont l'authentification échoue : aucune requête de transfert ne doit partir. */
  function failingLogin(loginReply: 'network' | { status: number; body: unknown }) {
    const calls: string[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
      if (url.endsWith('/v1/oauth/login')) {
        if (loginReply === 'network') throw new TypeError('fetch failed');
        return new Response(JSON.stringify(loginReply.body), { status: loginReply.status });
      }
      return new Response(JSON.stringify(TRANSFER_PENDING));
    }) as unknown as typeof fetch;
    const client = new CinetPayClient({
      baseUrl: 'https://api.cinetpay.net',
      apiKey: 'sk_test_FAKE',
      apiPassword: 'fake',
      logger: createLogger({}, () => undefined),
      fetch: impl,
    });
    return { client, calls };
  }

  it.each([
    ['authentification refusée', { status: 401, body: { code: 1005, status: 'INVALID_CREDENTIALS' } }],
    ['authentification injoignable', 'network' as const],
  ])('%s → not_sent, AUCUN POST /v1/transfer', async (_label, loginReply) => {
    const { client, calls } = failingLogin(loginReply);
    const gateway = new CinetPayTransferGateway({
      client,
      notifyUrl: 'https://api.test.local/api/withdrawals/cinetpay/notify',
    });
    const result = await submit(gateway);
    expect(result.kind).toBe('not_sent');
    expect(calls).toEqual(['POST /v1/oauth/login']);
  });

  it('jeton expiré après un POST puis renouvellement refusé → uncertain (une requête est partie)', async () => {
    let logins = 0;
    const calls: string[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
      if (url.endsWith('/v1/oauth/login')) {
        logins += 1;
        return logins === 1
          ? new Response(JSON.stringify({ code: 200, status: 'OK', access_token: 'tok' }))
          : new Response(JSON.stringify({ code: 1005, status: 'INVALID_CREDENTIALS' }), {
              status: 401,
            });
      }
      return new Response(JSON.stringify({ code: 1003, status: 'EXPIRED_TOKEN' }), { status: 422 });
    }) as unknown as typeof fetch;
    const client = new CinetPayClient({
      baseUrl: 'https://api.cinetpay.net',
      apiKey: 'sk_test_FAKE',
      apiPassword: 'fake',
      logger: createLogger({}, () => undefined),
      fetch: impl,
    });
    const gateway = new CinetPayTransferGateway({
      client,
      notifyUrl: 'https://api.test.local/api/withdrawals/cinetpay/notify',
    });
    expect(await submit(gateway)).toEqual({
      kind: 'uncertain',
      errorCode: 'CINETPAY_AUTHENTICATION_AFTER_SEND',
    });
    expect(calls).toContain('POST /v1/transfer');
  });

  it('sans URL de notification (transferts désactivés) : relecture possible, AUCUN envoi', async () => {
    const { client, calls } = setup(() => ({
      body: {
        code: 2002,
        status: 'PENDING',
        merchant_transaction_id: 'LW0001',
        transaction_id: 'cp-transfer-1',
      },
    }));
    const gateway = new CinetPayTransferGateway({ client });
    expect(gateway.canSubmit).toBe(false);
    expect(gateway.canLookup).toBe(true);
    expect(await submit(gateway)).toEqual({ kind: 'not_sent', errorCode: 'TRANSFERS_DISABLED' });
    expect(calls).toHaveLength(0);
    await expect(gateway.lookup('LW0001')).resolves.toEqual(
      expect.objectContaining({ found: true, providerStatus: 'PENDING' }),
    );
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET']); // login puis relecture
  });
});
