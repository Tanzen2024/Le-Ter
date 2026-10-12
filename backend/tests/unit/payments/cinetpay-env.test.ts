import { readDirectPayMethods, readEnv, readPagePreselectMethods } from '../../../src/config/env';

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
      environment: 'test',
      baseUrl: 'https://api.cinetpay.net',
      notifyUrl: BASE.CINETPAY_NOTIFY_URL,
      returnUrl: BASE.CINETPAY_RETURN_URL,
      appReturnUrl: 'leter://payment/return',
      timeoutMs: 15_000,
      reconcileIntervalMs: 30_000,
      directPayMethods: [],
      pagePreselectMethods: [],
    });
  });

  it('intervalle de réconciliation configurable', () => {
    expect(
      readEnv({ ...BASE, CINETPAY_RECONCILE_INTERVAL_MS: '60000' }).cinetpay?.reconcileIntervalMs,
    ).toBe(60_000);
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
    [{ CINETPAY_RECONCILE_INTERVAL_MS: '100' }, /CINETPAY_RECONCILE_INTERVAL_MS/],
    [{ CINETPAY_RECONCILE_INTERVAL_MS: 'abc' }, /CINETPAY_RECONCILE_INTERVAL_MS/],
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

describe('readEnv — transferts CinetPay (retraits, D-075)', () => {
  const NOTIFY = 'https://api.example.com/api/withdrawals/cinetpay/notify';

  it('désactivés par défaut, même avec CinetPay configuré', () => {
    expect(readEnv(BASE).cinetpay?.transfers).toBeUndefined();
    expect(
      readEnv({ ...BASE, CINETPAY_TRANSFERS_ENABLED: 'false', CINETPAY_TRANSFER_NOTIFY_URL: NOTIFY })
        .cinetpay?.transfers,
    ).toBeUndefined();
  });

  it('activés explicitement avec une URL de notification', () => {
    expect(
      readEnv({ ...BASE, CINETPAY_TRANSFERS_ENABLED: 'true', CINETPAY_TRANSFER_NOTIFY_URL: NOTIFY })
        .cinetpay?.transfers,
    ).toEqual({ notifyUrl: NOTIFY, maxSubmissions: 1, liveConfirmed: false });
    expect(
      readEnv({
        ...BASE,
        CINETPAY_TRANSFERS_ENABLED: 'true',
        CINETPAY_TRANSFER_NOTIFY_URL: NOTIFY,
        CINETPAY_TRANSFER_MAX_SUBMISSIONS: '3',
      }).cinetpay?.transfers?.maxSubmissions,
    ).toBe(3);
  });

  it('attestation de production : explicite, false par défaut, valeur stricte', () => {
    const enabled = { ...BASE, CINETPAY_TRANSFERS_ENABLED: 'true', CINETPAY_TRANSFER_NOTIFY_URL: NOTIFY };
    expect(readEnv({ ...enabled, CINETPAY_API_KEY: 'sk_live_FAKE' }).cinetpay).toMatchObject({
      environment: 'live',
      transfers: { liveConfirmed: false },
    });
    expect(
      readEnv({ ...enabled, CINETPAY_TRANSFERS_LIVE_CONFIRMED: 'true' }).cinetpay?.transfers
        ?.liveConfirmed,
    ).toBe(true);
    expect(() => readEnv({ ...enabled, CINETPAY_TRANSFERS_LIVE_CONFIRMED: 'oui' })).toThrow(
      /CINETPAY_TRANSFERS_LIVE_CONFIRMED/,
    );
  });

  it('activés sans URL, ou valeur invalide : démarrage refusé', () => {
    expect(() => readEnv({ ...BASE, CINETPAY_TRANSFERS_ENABLED: 'true' })).toThrow(
      /CINETPAY_TRANSFER_NOTIFY_URL/,
    );
    expect(() => readEnv({ ...BASE, CINETPAY_TRANSFERS_ENABLED: 'oui' })).toThrow(
      /CINETPAY_TRANSFERS_ENABLED/,
    );
    for (const value of ['0', '4', '1.5', 'x']) {
      expect(() =>
        readEnv({
          ...BASE,
          CINETPAY_TRANSFERS_ENABLED: 'true',
          CINETPAY_TRANSFER_NOTIFY_URL: NOTIFY,
          CINETPAY_TRANSFER_MAX_SUBMISSIONS: value,
        }),
      ).toThrow(/CINETPAY_TRANSFER_MAX_SUBMISSIONS/);
    }
  });
});

/** Paiement direct (D-083) : désactivé par défaut, MTN_CM seul, OM_CM (OTP) refusé. */
describe('readEnv — CINETPAY_DIRECT_PAY_METHODS', () => {
  it('vide ou absent : paiement direct désactivé', () => {
    expect(readEnv(BASE).cinetpay?.directPayMethods).toEqual([]);
    expect(readDirectPayMethods('')).toEqual([]);
    expect(readDirectPayMethods(' , ')).toEqual([]);
  });

  it('MTN_CM activé (casse et espaces tolérés, doublons ignorés)', () => {
    expect(readEnv({ ...BASE, CINETPAY_DIRECT_PAY_METHODS: 'MTN_CM' }).cinetpay?.directPayMethods).toEqual([
      'MTN_CM',
    ]);
    expect(readDirectPayMethods(' mtn_cm , MTN_CM ')).toEqual(['MTN_CM']);
  });

  it('OM_CM refusé : le paiement direct Orange Money exige un code OTP, non collecté', () => {
    expect(() => readDirectPayMethods('MTN_CM,OM_CM')).toThrow(/OM_CM exige un code OTP/);
  });

  it('opérateur inconnu ou d’un autre pays refusé', () => {
    for (const value of ['WAVE_SN', 'MTN_CI', 'ORANGE', 'mtn']) {
      expect(() => readDirectPayMethods(value)).toThrow(/CINETPAY_DIRECT_PAY_METHODS invalide/);
    }
  });
});

/**
 * Orange Money Cameroun (OM_CM) : code reconnu par l'API v1 (SDK officiels), mais le paiement
 * DIRECT Orange Money exige un OTP saisi par le payeur (`otp_code`, SDK `cinetpay-js` et
 * `cinetpay-go`). Sa collecte n'étant pas autorisée, OM_CM n'est jamais activable en direct ;
 * il reste payable par la page CinetPay (toutes les méthodes du pays y sont proposées).
 */
describe('readEnv — Orange Money Cameroun (OM_CM)', () => {
  it.each(['OM_CM', 'om_cm', ' OM_CM ', 'OM_CM,MTN_CM', 'MTN_CM,OM_CM'])(
    '%p refusé au démarrage, sans valeur secrète dans le message',
    (value) => {
      expect(() => readEnv({ ...BASE, CINETPAY_DIRECT_PAY_METHODS: value })).toThrow(
        /OM_CM exige un code OTP/,
      );
      try {
        readEnv({ ...BASE, CINETPAY_DIRECT_PAY_METHODS: value });
      } catch (err) {
        expect(String(err)).not.toContain(BASE.CINETPAY_API_KEY);
        expect(String(err)).not.toContain(BASE.CINETPAY_API_PASSWORD);
      }
    },
  );

  it('configuration actuelle (MTN_CM seul) inchangée', () => {
    expect(readEnv({ ...BASE, CINETPAY_DIRECT_PAY_METHODS: 'MTN_CM' }).cinetpay?.directPayMethods).toEqual([
      'MTN_CM',
    ]);
  });
});

describe('readEnv — CINETPAY_PAGE_PRESELECT_METHODS (D-087)', () => {
  it('vide par défaut : page générique', () => {
    expect(readEnv(BASE).cinetpay?.pagePreselectMethods).toEqual([]);
  });

  it('OM_CM et MTN_CM acceptés (aucun OTP sur la page hébergée)', () => {
    expect(readPagePreselectMethods(' om_cm, MTN_CM ,OM_CM')).toEqual(['OM_CM', 'MTN_CM']);
  });

  it('opérateur inconnu refusé', () => {
    expect(() => readPagePreselectMethods('WAVE_SN')).toThrow(/CINETPAY_PAGE_PRESELECT_METHODS invalide/);
  });

  it('n’active jamais le paiement direct Orange Money', () => {
    const config = readEnv({ ...BASE, CINETPAY_PAGE_PRESELECT_METHODS: 'OM_CM' }).cinetpay;
    expect(config?.directPayMethods).toEqual([]);
  });
});
