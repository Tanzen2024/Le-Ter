import { CinetPayClient } from '../../../src/services/payments/cinetpay/cinetpay-client';
import { CinetPayTransferGateway } from '../../../src/services/payments/cinetpay/cinetpay-transfer.gateway';
import { CinetPayTreasuryGateway } from '../../../src/services/platform-finance/treasury.gateway';
import { createLogger } from '../../../src/utils/logger';

/**
 * Lecture du solde CinetPay (D-078) contre un `fetch` simulé, d'après le SDK officiel
 * `cinetpay-js` (`src/api/balance.ts` : GET /v1/balances ; `src/types/balance.ts` :
 * `available_balance` chaîne, `currency`). Aucun appel réseau ; lecture seule.
 */
type Reply = { status?: number; body?: unknown } | 'network';

function setup(reply: (url: string, method: string) => Reply) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const lines: string[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    calls.push({
      url,
      method,
      ...(typeof init.body === 'string' && { body: JSON.parse(init.body) }),
    });
    if (url.endsWith('/v1/oauth/login')) {
      return new Response(
        JSON.stringify({ code: 200, status: 'OK', access_token: 'tok', expires_in: 86_400 }),
      );
    }
    const r = reply(url, method);
    if (r === 'network') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  const client = new CinetPayClient({
    baseUrl: 'https://api.cinetpay.net',
    apiKey: 'sk_test_FAKE',
    apiPassword: 'fake',
    logger: createLogger({}, (line) => lines.push(line)),
    fetch: impl,
  });
  return { client, calls, lines };
}

describe('GET /v1/balances', () => {
  it('lecture seule : GET authentifié, montant et devise renvoyés tels quels', async () => {
    const { client, calls, lines } = setup(() => ({
      body: { code: 200, status: 'OK', available_balance: '125000', currency: 'XAF' },
    }));
    const gateway = new CinetPayTreasuryGateway(client, 'test');
    await expect(gateway.readBalance()).resolves.toEqual({
      availableBalance: '125000',
      currency: 'XAF',
    });
    const balanceCall = calls.find((c) => c.url.endsWith('/v1/balances'));
    expect(balanceCall).toMatchObject({ method: 'GET' });
    expect(balanceCall?.body).toBeUndefined();
    // Aucun appel de transfert ; ni jeton ni secret dans les journaux.
    expect(calls.some((c) => c.url.includes('/v1/transfer'))).toBe(false);
    expect(lines.join('\n')).not.toMatch(/tok|sk_test_FAKE|fake/);
  });

  it('réponse sans solde : erreur du prestataire (jamais un solde 0 inventé)', async () => {
    const { client } = setup(() => ({
      status: 403,
      body: { code: 1005, status: 'INVALID_CREDENTIALS' },
    }));
    await expect(client.getBalance()).rejects.toMatchObject({
      name: 'CinetPayError',
      kind: 'http',
    });
    const { client: c2 } = setup(() => ({ body: { foo: 'bar' } }));
    await expect(c2.getBalance()).rejects.toMatchObject({ kind: 'malformed_response' });
    const { client: c3 } = setup(() => 'network');
    await expect(c3.getBalance()).rejects.toMatchObject({ kind: 'network' });
  });

  it('motif de transfert configurable ; défaut inchangé pour les retraits des joueurs', async () => {
    const { client, calls } = setup((url) =>
      url.endsWith('/v1/transfer')
        ? {
            body: {
              code: 200,
              status: 'PENDING',
              transaction_id: 'cp-1',
              merchant_transaction_id: 'LP' + 'a'.repeat(26),
              notify_token: 'n',
            },
          }
        : { body: {} },
    );
    const request = {
      merchantTransactionId: 'LP' + 'a'.repeat(26),
      phoneNumber: '+237670000042',
      amount: 1_000,
      currency: 'XAF' as const,
      operator: 'MTN_CM' as const,
    };
    await new CinetPayTransferGateway({
      client,
      notifyUrl: 'https://x.example/n',
      reason: 'Retrait des revenus Le Ter',
    }).submit(request);
    await new CinetPayTransferGateway({ client, notifyUrl: 'https://x.example/n' }).submit(request);
    const reasons = calls
      .filter((c) => c.url.endsWith('/v1/transfer'))
      .map((c) => (c.body as { reason: string }).reason);
    expect(reasons).toEqual(['Retrait des revenus Le Ter', 'Retrait de jetons Le Ter']);
  });
});
