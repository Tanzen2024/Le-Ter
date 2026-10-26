import { readEnv, type NodeEnv } from '../../../src/config/env';
import type { SqlClient } from '../../../src/database/sql-client';
import type { CinetPayClient } from '../../../src/services/payments/cinetpay/cinetpay-client';
import { createWithdrawalServices } from '../../../src/services/withdrawals/create-withdrawal-service';
import {
  isPublicHttpsUrl,
  resolveWithdrawalAvailability,
  type WithdrawalAvailability,
} from '../../../src/services/withdrawals/withdrawal-availability';
import { createLogger } from '../../../src/utils/logger';

/**
 * Disponibilité des retraits (D-077) : indisponible, sandbox, production. Fonction pure sur la
 * configuration ; aucun appel CinetPay, aucun transfert.
 */
const CINETPAY = {
  CINETPAY_API_KEY: 'sk_test_FAKE_KEY',
  CINETPAY_API_PASSWORD: 'fake-password',
  CINETPAY_NOTIFY_URL: 'https://api.example.com/api/payments/cinetpay/notify',
  CINETPAY_RETURN_URL: 'https://api.example.com/api/payments/cinetpay/return',
};
const ENABLED = {
  ...CINETPAY,
  CINETPAY_TRANSFERS_ENABLED: 'true',
  CINETPAY_TRANSFER_NOTIFY_URL: 'https://api.example.com/api/withdrawals/cinetpay/notify',
};
const LIVE = { ...ENABLED, CINETPAY_API_KEY: 'sk_live_FAKE_KEY' };
/** Exigés par readEnv en production ; valeurs fictives, jamais contactées. */
const PRODUCTION_BASE = { DATABASE_URL: 'postgres://fake/fake', JWT_SECRET: 'x'.repeat(32) };

function resolve(
  source: Record<string, string>,
  nodeEnv: NodeEnv = 'development',
  schemaReady = true,
): WithdrawalAvailability {
  const env = readEnv({ ...PRODUCTION_BASE, ...source, NODE_ENV: nodeEnv });
  return resolveWithdrawalAvailability({ nodeEnv, cinetpay: env.cinetpay, schemaReady });
}

describe('resolveWithdrawalAvailability — indisponible', () => {
  it('aucun identifiant CinetPay', () => {
    expect(resolve({})).toEqual({
      mode: 'unavailable',
      reason: 'PROVIDER_NOT_CONFIGURED',
      warnings: [],
    });
  });

  it('identifiants présents mais transferts non activés : JAMAIS suffisant', () => {
    expect(resolve(CINETPAY)).toMatchObject({ mode: 'unavailable', reason: 'TRANSFERS_DISABLED' });
    expect(resolve({ ...CINETPAY, CINETPAY_API_KEY: 'sk_live_FAKE' }, 'production')).toMatchObject({
      mode: 'unavailable',
      reason: 'TRANSFERS_DISABLED',
    });
  });

  it('migrations des retraits non appliquées', () => {
    expect(resolve(ENABLED, 'development', false)).toMatchObject({
      mode: 'unavailable',
      reason: 'SCHEMA_OUTDATED',
    });
  });

  it('URL de base de l’environnement opposé à la clé', () => {
    // Refusée dès le démarrage (D-170) ; le contrôle des retraits reste une seconde barrière.
    expect(() => resolve({ ...ENABLED, CINETPAY_BASE_URL: 'https://api.cinetpay.co' })).toThrow(
      /CINETPAY_BASE_URL refusée/,
    );
    const env = readEnv({ ...PRODUCTION_BASE, ...ENABLED, NODE_ENV: 'development' });
    expect(
      resolveWithdrawalAvailability({
        nodeEnv: 'development',
        cinetpay: { ...env.cinetpay!, baseUrl: 'https://api.cinetpay.co' },
        schemaReady: true,
      }),
    ).toMatchObject({ mode: 'unavailable', reason: 'ENVIRONMENT_MISMATCH' });
  });
});

describe('resolveWithdrawalAvailability — sandbox', () => {
  it('clé sk_test_ + activation explicite hors production : mode test', () => {
    expect(resolve(ENABLED)).toEqual({ mode: 'sandbox', warnings: [] });
    expect(resolve(ENABLED, 'test')).toMatchObject({ mode: 'sandbox' });
  });

  it('notification locale en sandbox : autorisé, mais signalé', () => {
    expect(
      resolve({
        ...ENABLED,
        CINETPAY_TRANSFER_NOTIFY_URL: 'http://localhost:3000/api/withdrawals/cinetpay/notify',
      }),
    ).toEqual({ mode: 'sandbox', warnings: ['TRANSFER_NOTIFY_URL_NOT_PUBLIC'] });
  });

  it('clé sk_test_ sur un serveur de production : refusé (jetons réels, transfert simulé)', () => {
    expect(resolve(ENABLED, 'production')).toMatchObject({
      mode: 'unavailable',
      reason: 'SANDBOX_IN_PRODUCTION',
    });
  });
});

describe('resolveWithdrawalAvailability — production', () => {
  it('désactivée : clé live et activation sans attestation des prérequis', () => {
    expect(resolve(LIVE, 'production')).toMatchObject({
      mode: 'unavailable',
      reason: 'LIVE_NOT_CONFIRMED',
    });
  });

  it('clé live hors NODE_ENV=production : refusé même attesté', () => {
    const confirmed = { ...LIVE, CINETPAY_TRANSFERS_LIVE_CONFIRMED: 'true' };
    // Refusée dès le démarrage (D-170) ; le contrôle des retraits reste une seconde barrière.
    expect(() => resolve(confirmed, 'development')).toThrow(/sk_live_/);
    const env = readEnv({ ...PRODUCTION_BASE, ...confirmed, NODE_ENV: 'production' });
    expect(
      resolveWithdrawalAvailability({ nodeEnv: 'development', cinetpay: env.cinetpay, schemaReady: true }),
    ).toMatchObject({ mode: 'unavailable', reason: 'LIVE_OUTSIDE_PRODUCTION' });
  });

  it('notification non publique : refusé même attesté', () => {
    // HTTPS exigé en production par readEnv ; un hôte privé passe ce contrôle, pas celui-ci.
    expect(
      resolve(
        {
          ...LIVE,
          CINETPAY_TRANSFERS_LIVE_CONFIRMED: 'true',
          CINETPAY_TRANSFER_NOTIFY_URL: 'https://192.168.1.10/api/withdrawals/cinetpay/notify',
        },
        'production',
      ),
    ).toMatchObject({ mode: 'unavailable', reason: 'NOTIFY_URL_NOT_PUBLIC' });
  });

  it('activée : prérequis vérifiables satisfaits ET attestation explicite', () => {
    expect(
      resolve({ ...LIVE, CINETPAY_TRANSFERS_LIVE_CONFIRMED: 'true' }, 'production'),
    ).toEqual({ mode: 'live', warnings: [] });
  });

  it('attestation sans activation : toujours indisponible', () => {
    expect(
      resolve(
        { ...CINETPAY, CINETPAY_API_KEY: 'sk_live_FAKE', CINETPAY_TRANSFERS_LIVE_CONFIRMED: 'true' },
        'production',
      ),
    ).toMatchObject({ mode: 'unavailable', reason: 'TRANSFERS_DISABLED' });
  });
});

describe('isPublicHttpsUrl', () => {
  it.each([
    ['https://api.example.com/notify', true],
    ['https://fdroid.example.com/notify', true],
    ['http://api.example.com/notify', false],
    ['https://localhost/notify', false],
    ['https://127.0.0.1/notify', false],
    ['https://10.0.0.5/notify', false],
    ['https://172.20.1.1/notify', false],
    ['https://[::1]/notify', false],
    ['https://[fd12::1]/notify', false],
    ['pas une url', false],
  ])('%s → %s', (url, expected) => {
    expect(isPublicHttpsUrl(url)).toBe(expected);
  });
});

describe('createWithdrawalServices — la passerelle suit l’état décidé', () => {
  const logger = createLogger({}, () => undefined);
  const calls: string[] = [];
  const client = {
    createTransfer: () => {
      calls.push('createTransfer');
      return Promise.reject(new Error('aucun transfert ne doit partir'));
    },
    getTransferStatus: () => Promise.resolve({ found: false as const }),
  } as unknown as CinetPayClient;
  // Aucune requête SQL n'est émise à la construction.
  const sql = {} as SqlClient;

  it('transferts activés mais production non attestée : aucune demande, relecture conservée', async () => {
    const env = readEnv({ ...PRODUCTION_BASE, ...LIVE, NODE_ENV: 'production' });
    const availability = resolveWithdrawalAvailability({
      nodeEnv: 'production',
      cinetpay: env.cinetpay,
      schemaReady: true,
    });
    const { withdrawals, reconciler } = createWithdrawalServices({
      sql,
      logger,
      cinetpay: env.cinetpay,
      client,
      availability,
    });
    expect(withdrawals.available).toBe(false);
    expect(withdrawals.availability).toMatchObject({ reason: 'LIVE_NOT_CONFIRMED' });
    expect(withdrawals.canLookup).toBe(true);
    expect(reconciler).toBeDefined();
    expect(calls).toEqual([]);
  });

  it('sandbox : nouvelles demandes acceptées, mode test annoncé', () => {
    const env = readEnv(ENABLED);
    const { withdrawals } = createWithdrawalServices({
      sql,
      logger,
      cinetpay: env.cinetpay,
      client,
      availability: { mode: 'sandbox', warnings: [] },
    });
    expect(withdrawals.available).toBe(true);
    expect(withdrawals.availability.mode).toBe('sandbox');
  });

  it('état « disponible » mais passerelle incapable d’envoyer : indisponible', () => {
    const { withdrawals } = createWithdrawalServices({
      sql,
      logger,
      availability: { mode: 'live', warnings: [] },
    });
    expect(withdrawals.available).toBe(false);
    expect(withdrawals.availability).toMatchObject({
      mode: 'unavailable',
      reason: 'PROVIDER_NOT_CONFIGURED',
    });
  });
});
