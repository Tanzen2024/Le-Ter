import { readEnv } from '../../../src/config/env';
import { publicUrlProblems } from '../../../src/config/public-url';
import {
  CinetPayClient,
  CinetPayError,
  CinetPayPaymentNotSentError,
  type CinetPayCallOutcome,
} from '../../../src/services/payments/cinetpay/cinetpay-client';
import {
  DirectPaymentUnavailableError,
  PaymentInitializationUncertainError,
} from '../../../src/domain/payments/payment';
import {
  classifyPaymentFailure,
  unavailableMessageOf,
} from '../../../src/services/payments/payment-failure';
import {
  INIT_FAILURE_ALERT_THRESHOLD,
  PaymentHealthMonitor,
  RECONCILER_STALE_MS,
} from '../../../src/services/payments/payment-health';
import { createPaymentHealthReport } from '../../../src/services/payments/payment-health-report';
import {
  PaymentReconciler,
  PROVIDER_PROBE_INTERVAL_MS,
} from '../../../src/services/payments/payment-reconciler';
import { createLogger } from '../../../src/utils/logger';

/**
 * Santé des paiements (D-100) : classification des échecs, état du fournisseur déduit des
 * appels réels, alertes, réconciliateur, URL que CinetPay doit joindre. Aucun appel réel :
 * `fetch`, horloge et dépôts sont simulés ; aucun encaissement.
 */
const notSent = (cause: CinetPayError) => new CinetPayPaymentNotSentError(cause);
const ipRefused = () =>
  new CinetPayError('authentication', 'refus', {
    httpStatus: 422,
    apiCode: 2011,
    apiStatus: 'NOT_ALLOWED',
  });

function logs() {
  const lines: Record<string, unknown>[] = [];
  return { lines, logger: createLogger({}, (line) => lines.push(JSON.parse(line))) };
}

describe('classifyPaymentFailure : une cause par situation', () => {
  it.each([
    ['IP non autorisée (2011), demande jamais partie', notSent(ipRefused()), 'PROVIDER_IP_NOT_ALLOWED', false, false],
    ['identifiants invalides (1005)', notSent(new CinetPayError('authentication', 'x', { httpStatus: 422, apiCode: 1005, apiStatus: 'INVALID_CREDENTIALS' })), 'PROVIDER_AUTH_REFUSED', false, false],
    ['DNS / réseau avant envoi', notSent(new CinetPayError('network', 'x')), 'PROVIDER_UNREACHABLE', true, false],
    ['délai AVANT envoi', notSent(new CinetPayError('timeout', 'x')), 'PROVIDER_TIMEOUT_BEFORE_SEND', true, false],
    ['délai APRÈS envoi', new CinetPayError('timeout', 'x'), 'PROVIDER_TIMEOUT_AFTER_SEND', true, true],
    ['522 Cloudflare au login', notSent(new CinetPayError('http', 'x', { httpStatus: 522 })), 'PROVIDER_HTTP_ERROR', true, false],
    ['500 après envoi', new CinetPayError('http', 'x', { httpStatus: 500 }), 'PROVIDER_HTTP_ERROR', true, true],
    ['réponse illisible', new CinetPayError('malformed_response', 'x'), 'PROVIDER_MALFORMED_RESPONSE', true, true],
    ['refus métier (code API)', new CinetPayError('api', 'x', { apiCode: 1004 }), 'PROVIDER_REFUSED', false, true],
    ['jeton refusé après renouvellement', new CinetPayError('expired_token', 'x'), 'PROVIDER_AUTH_REFUSED', false, true],
    ['direct refusé de façon certaine', new DirectPaymentUnavailableError('PROVIDER_REFUSED'), 'PROVIDER_REFUSED', false, true],
    ['opérateur non activé', new DirectPaymentUnavailableError('METHOD_NOT_ENABLED'), 'METHOD_UNAVAILABLE', false, false],
    ['issue inconnue d’un direct', new PaymentInitializationUncertainError('p-1'), 'OUTCOME_UNKNOWN', false, true],
    ['erreur interne', new Error('boom'), 'UNKNOWN', true, false],
  ])('%s', (_label, err, category, retryable, sent) => {
    expect(classifyPaymentFailure(err)).toMatchObject({ category, retryable, sent });
  });

  it('messages joueur : distincts, jamais de détail interne, « aucun montant débité »', () => {
    const categories = [
      'PROVIDER_IP_NOT_ALLOWED',
      'PROVIDER_UNREACHABLE',
      'PROVIDER_HTTP_ERROR',
      'PROVIDER_REFUSED',
    ];
    const messages = categories.map(unavailableMessageOf);
    expect(new Set(messages).size).toBe(categories.length);
    for (const message of messages) {
      expect(message).toContain('Aucun montant n’a été débité');
      expect(message).not.toMatch(/IP|2011|clé|api_key|NOT_ALLOWED/);
    }
    // Cause inconnue (ancienne opération rejouée) : message historique.
    expect(unavailableMessageOf(undefined)).toMatch(/indisponible/);
  });
});

describe('PaymentHealthMonitor : état du fournisseur et alertes', () => {
  let now = Date.parse('2026-10-14T08:00:00.000Z');
  const clock = () => new Date(now);
  beforeEach(() => {
    now = Date.parse('2026-10-14T08:00:00.000Z');
  });

  it('IP refusée : alerte UNE fois, état exposé ; accès rétabli : retour à OK journalisé', () => {
    const { lines, logger } = logs();
    const monitor = new PaymentHealthMonitor(logger, clock);
    expect(monitor.snapshot().provider.state).toBe('UNKNOWN');
    const refused: CinetPayCallOutcome = {
      type: 'auth_refused',
      httpStatus: 422,
      apiCode: 2011,
      ipNotAllowed: true,
    };
    monitor.recordCall(refused);
    monitor.recordCall(refused);
    monitor.recordCall(refused);
    expect(monitor.snapshot()).toMatchObject({
      provider: { state: 'IP_NOT_ALLOWED', lastAuthentication: { accepted: false, apiCode: 2011 } },
      alerts: ['PROVIDER_IP_NOT_ALLOWED'],
    });
    expect(lines.filter((l) => l.message === 'PAYMENT_PROVIDER_ALERT')).toHaveLength(1);

    monitor.recordCall({ type: 'auth_accepted' });
    expect(monitor.snapshot().provider.state).toBe('OK');
    expect(monitor.snapshot().alerts).toEqual([]);
    expect(lines.some((l) => l.message === 'PAYMENT_PROVIDER_RECOVERED')).toBe(true);
  });

  it('réseau, délai, 5xx : UNREACHABLE ; une réponse lisible le rétablit', () => {
    const monitor = new PaymentHealthMonitor(logs().logger, clock);
    monitor.recordCall({ type: 'timeout' });
    expect(monitor.snapshot().provider.state).toBe('UNREACHABLE');
    monitor.recordCall({ type: 'server_error', httpStatus: 522 });
    expect(monitor.snapshot().provider.state).toBe('UNREACHABLE');
    monitor.recordCall({ type: 'response' });
    expect(monitor.snapshot().provider.state).toBe('OK');
  });

  it('échecs d’initialisation : alerte au seuil (pannes seulement), oubliés après la fenêtre', () => {
    const { lines, logger } = logs();
    const monitor = new PaymentHealthMonitor(logger, clock);
    // Refus individuels (montant, opérateur) : jamais une panne du fournisseur.
    for (let i = 0; i < 10; i += 1) {
      monitor.recordInitializationFailure({ category: 'PROVIDER_REFUSED', retryable: false, sent: true });
    }
    expect(monitor.snapshot().initializationFailures.alert).toBe(false);
    for (let i = 0; i < INIT_FAILURE_ALERT_THRESHOLD; i += 1) {
      monitor.recordInitializationFailure({ category: 'PROVIDER_UNREACHABLE', retryable: true, sent: false });
    }
    expect(monitor.snapshot().initializationFailures).toMatchObject({
      providerFailures: INIT_FAILURE_ALERT_THRESHOLD,
      alert: true,
      byCategory: { PROVIDER_REFUSED: 10, PROVIDER_UNREACHABLE: INIT_FAILURE_ALERT_THRESHOLD },
    });
    expect(lines.filter((l) => l.alert === 'INITIALIZATION_FAILURES')).toHaveLength(1);
    now += 16 * 60_000;
    expect(monitor.snapshot().initializationFailures.alert).toBe(false);
  });

  it('réconciliateur : dernier passage réussi, échecs de lecture, arrêt détecté', () => {
    const monitor = new PaymentHealthMonitor(logs().logger, clock);
    const report = { checked: 1, settled: 1, pending: 0, alreadyFinal: 0, failed: 0 };
    monitor.reconcileStarted();
    monitor.recordReconcileTick(report, false);
    expect(monitor.snapshot().reconciler).toMatchObject({
      running: true,
      lastSuccessAt: new Date(now).toISOString(),
      lastReport: report,
      stale: false,
    });
    now += RECONCILER_STALE_MS + 1;
    monitor.recordReconcileTick({ ...report, checked: 0, settled: 0 }, true);
    expect(monitor.snapshot().reconciler).toMatchObject({ consecutiveLookupFailures: 1, stale: true });
    expect(monitor.snapshot().alerts).toContain('RECONCILER_STALE');
  });
});

describe('CinetPayClient : chaque appel réel est relevé, sans secret', () => {
  const login = { code: 200, status: 'OK', access_token: 'fake.jwt', expires_in: 3600 };
  const client = (fetchImpl: typeof fetch, outcomes: CinetPayCallOutcome[], lines: string[] = []) =>
    new CinetPayClient({
      baseUrl: 'https://api.cinetpay.net',
      apiKey: 'sk_test_FAKE',
      apiPassword: 'fake-pass',
      timeoutMs: 1_000,
      logger: createLogger({}, (line) => lines.push(line)),
      fetch: fetchImpl,
      onOutcome: (o) => outcomes.push(o),
    });

  it('authentification acceptée puis réponse : auth_accepted, response', async () => {
    const outcomes: CinetPayCallOutcome[] = [];
    const fetchImpl = (async (url: string) =>
      new Response(
        JSON.stringify(
          String(url).endsWith('/v1/oauth/login')
            ? login
            : { code: 100, status: 'PENDING', transaction_id: 't', merchant_transaction_id: 'm' },
        ),
      )) as unknown as typeof fetch;
    await client(fetchImpl, outcomes).getPaymentStatus('t');
    expect(outcomes.map((o) => o.type)).toEqual(['auth_accepted', 'response']);
  });

  it('IP non autorisée (422, 2011) : auth_refused avec ipNotAllowed', async () => {
    const outcomes: CinetPayCallOutcome[] = [];
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ code: 2011, status: 'NOT_ALLOWED', description: 'This Ip is not withlisted' }),
        { status: 422 },
      )) as unknown as typeof fetch;
    await expect(client(fetchImpl, outcomes).authenticate()).rejects.toMatchObject({
      kind: 'authentication',
    });
    expect(outcomes).toEqual([
      { type: 'auth_refused', httpStatus: 422, apiCode: 2011, ipNotAllowed: true },
    ]);
  });

  it('DNS introuvable : erreur réseau, code système journalisé, aucun secret', async () => {
    const outcomes: CinetPayCallOutcome[] = [];
    const lines: string[] = [];
    const fetchImpl = (async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ENOTFOUND', hostname: 'api.cinetpay.net' },
      });
    }) as unknown as typeof fetch;
    const error = await client(fetchImpl, outcomes, lines).authenticate().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'network' });
    expect(outcomes).toEqual([{ type: 'unreachable' }]);
    expect(lines.join('\n')).toContain('ENOTFOUND');
    expect(lines.join('\n')).not.toMatch(/sk_test_FAKE|fake-pass/);
  });

  it('un listener qui échoue ne fait jamais échouer l’appel', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify(login))) as unknown as typeof fetch;
    const c = new CinetPayClient({
      baseUrl: 'https://api.cinetpay.net',
      apiKey: 'sk_test_FAKE',
      apiPassword: 'fake-pass',
      logger: createLogger({}, () => undefined),
      fetch: fetchImpl,
      onOutcome: () => {
        throw new Error('listener');
      },
    });
    await expect(c.authenticate()).resolves.toBe('fake.jwt');
  });
});

describe('PaymentReconciler : surveillance et vérification de l’accès', () => {
  const fixedNow = Date.parse('2026-10-14T08:00:00.000Z');

  it('accès vérifié au plus une fois par intervalle ; un refus n’interrompt rien', async () => {
    let now = fixedNow;
    const probe = jest.fn(async () => {
      throw ipRefused();
    });
    const monitor = new PaymentHealthMonitor(logs().logger, () => new Date(now));
    const reconciler = new PaymentReconciler({
      payments: { reconcile: jest.fn() },
      repository: { findPendingForReconciliation: async () => [] },
      logger: logs().logger,
      health: monitor,
      probeProvider: probe,
      clock: () => new Date(now),
    });
    await reconciler.tick();
    await reconciler.tick();
    expect(probe).toHaveBeenCalledTimes(1);
    now += PROVIDER_PROBE_INTERVAL_MS;
    await reconciler.tick();
    expect(probe).toHaveBeenCalledTimes(2);
    expect(monitor.snapshot().reconciler.lastSuccessAt).toBe(new Date(now).toISOString());
  });

  it('paiements bloqués signalés (sans identifiant de payeur), jamais clos pour leur âge', async () => {
    const { lines, logger } = logs();
    const reconcile = jest.fn();
    const reconciler = new PaymentReconciler({
      payments: { reconcile },
      repository: {
        findPendingForReconciliation: async () => [],
        summarizePending: async () => ({
          pending: 3,
          uncertain: 1,
          stuck: 2,
          oldestPendingAt: new Date(fixedNow - 3 * 60 * 60_000),
        }),
      },
      logger,
      clock: () => new Date(fixedNow),
    });
    await reconciler.tick();
    const stuck = lines.find((l) => l.message === 'PAYMENTS_STUCK');
    expect(stuck).toMatchObject({ stuck: 2, uncertain: 1, pending: 3, oldestAgeMinutes: 180 });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('base indisponible : passage relevé comme échec de lecture, jamais de rejet', async () => {
    const monitor = new PaymentHealthMonitor(logs().logger, () => new Date(fixedNow));
    const reconciler = new PaymentReconciler({
      payments: { reconcile: jest.fn() },
      repository: {
        findPendingForReconciliation: async () => {
          throw new Error('connection terminated');
        },
      },
      logger: logs().logger,
      health: monitor,
      clock: () => new Date(fixedNow),
    });
    await expect(reconciler.tick()).resolves.toMatchObject({ checked: 0 });
    expect(monitor.snapshot().reconciler.consecutiveLookupFailures).toBe(1);
  });
});

describe('URL que CinetPay doit joindre depuis Internet', () => {
  it.each([
    ['http://10.248.1.2:3000/api/payments/cinetpay/notify', ['NOT_HTTPS', 'PRIVATE_ADDRESS']],
    ['http://100.72.158.120:3000/notify', ['NOT_HTTPS', 'VPN_ADDRESS']],
    ['https://192.168.1.10/notify', ['PRIVATE_ADDRESS']],
    ['http://localhost:3000/notify', ['NOT_HTTPS', 'LOCALHOST']],
    ['https://abc-def.trycloudflare.com/notify', ['TEMPORARY_TUNNEL']],
    ['https://api.le-ter.example/notify', []],
  ])('%s', (url, problems) => {
    expect(publicUrlProblems(url)).toEqual(problems);
  });

  it('production : adresse privée refusée au démarrage, sans recopier la valeur', () => {
    const env = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://localhost/db',
      JWT_SECRET: 'x'.repeat(40),
      CINETPAY_API_KEY: 'sk_test_FAKE',
      CINETPAY_API_PASSWORD: 'fake',
      CINETPAY_NOTIFY_URL: 'https://10.248.1.2/api/payments/cinetpay/notify',
      CINETPAY_RETURN_URL: 'https://api.le-ter.example/api/payments/cinetpay/return',
    };
    let error: unknown;
    try {
      readEnv(env);
    } catch (err) {
      error = err;
    }
    expect((error as Error).message).toMatch(/CINETPAY_NOTIFY_URL invalide : adresse de réseau privé/);
    expect((error as Error).message).not.toContain('10.248');
  });

  it('développement : adresse privée acceptée (signalée au démarrage seulement)', () => {
    expect(
      readEnv({
        CINETPAY_API_KEY: 'sk_test_FAKE',
        CINETPAY_API_PASSWORD: 'fake',
        CINETPAY_NOTIFY_URL: 'http://10.248.1.2:3000/api/payments/cinetpay/notify',
        CINETPAY_RETURN_URL: 'http://10.248.1.2:3000/api/payments/cinetpay/return',
      }).cinetpay,
    ).toBeDefined();
  });
});

describe('rapport de santé (administration)', () => {
  const cinetpay = readEnv({
    CINETPAY_API_KEY: 'sk_test_FAKE',
    CINETPAY_API_PASSWORD: 'fake',
    CINETPAY_NOTIFY_URL: 'http://10.248.1.2:3000/api/payments/cinetpay/notify',
    CINETPAY_RETURN_URL: 'https://api.le-ter.example/api/payments/cinetpay/return',
  }).cinetpay!;
  const repository = (stuck: number) => ({
    summarizePending: async () => ({ pending: stuck + 1, uncertain: 0, stuck }),
  });

  it('IP refusée : DOWN ; URL privée et paiements bloqués signalés ; aucun secret ni URL', async () => {
    const monitor = new PaymentHealthMonitor(logs().logger);
    monitor.recordCall({ type: 'auth_refused', httpStatus: 422, apiCode: 2011, ipNotAllowed: true });
    const report = await createPaymentHealthReport({ health: monitor, repository: repository(2), cinetpay })();
    expect(report.status).toBe('DOWN');
    expect(report.alerts).toEqual(
      expect.arrayContaining(['PROVIDER_IP_NOT_ALLOWED', 'NOTIFY_URL_NOT_PUBLIC', 'PAYMENTS_STUCK']),
    );
    expect(report.pending).toMatchObject({ pending: 3, stuck: 2 });
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/sk_test_FAKE|10\.248|api\.le-ter|fake/);
  });

  it('accès accepté, URL publiques, rien de bloqué : OK', async () => {
    const monitor = new PaymentHealthMonitor(logs().logger);
    monitor.recordCall({ type: 'auth_accepted' });
    const publicEnv = readEnv({
      CINETPAY_API_KEY: 'sk_test_FAKE',
      CINETPAY_API_PASSWORD: 'fake',
      CINETPAY_NOTIFY_URL: 'https://api.le-ter.example/api/payments/cinetpay/notify',
      CINETPAY_RETURN_URL: 'https://api.le-ter.example/api/payments/cinetpay/return',
    }).cinetpay!;
    const report = await createPaymentHealthReport({
      health: monitor,
      repository: repository(0),
      cinetpay: publicEnv,
    })();
    expect(report).toMatchObject({ status: 'OK', alerts: [] });
  });

  it('non configuré : DOWN, PROVIDER_NOT_CONFIGURED', async () => {
    const report = await createPaymentHealthReport({
      health: new PaymentHealthMonitor(logs().logger),
      repository: repository(0),
    })();
    expect(report).toMatchObject({ status: 'DOWN', configured: false });
    expect(report.alerts).toContain('PROVIDER_NOT_CONFIGURED');
  });
});
