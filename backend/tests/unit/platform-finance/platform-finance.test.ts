import { readPlatformPayoutEnv } from '../../../src/config/platform-payout-env';
import {
  canTransition,
  computeRevenue,
  computeTreasury,
  computeWithdrawable,
  estimatePayoutFee,
  maskMsisdn,
  maxAmountWithinCeiling,
  moneyFromSql,
  MoneyOverflowError,
  normalizeCameroonMobile,
  PLATFORM_PAYOUT_MAX_AMOUNT,
  PLATFORM_PAYOUT_STATUSES,
  sumMoney,
  TREASURY_FRESHNESS_MS,
  type RevenueFacts,
  type TreasuryObservation,
} from '../../../src/domain/platform-finance/platform-finance';
import { resolvePayoutExecution } from '../../../src/services/platform-finance/create-platform-finance-services';
import { parseXafAmount } from '../../../src/services/platform-finance/treasury.gateway';
import {
  parseBeneficiaryInput,
  parsePayoutInput,
} from '../../../src/validators/platform-finance.validators';
import { ValidationError } from '../../../src/validators/validation-error';

/**
 * Retraits des revenus de la plateforme (D-078) : calculs déterministes, entiers exacts,
 * « inconnu » distinct de zéro, configuration désactivée par défaut.
 */
const NOW = new Date('2026-10-11T10:00:00Z');
const FEES = { bps: 100, fixed: 0 }; // 1 % (barème de test, pas un tarif CinetPay)

function facts(over: Partial<RevenueFacts> = {}): RevenueFacts {
  return {
    ledgerByKind: [
      { kind: 'GAME_COMMISSION', amount: 80_000, entries: 40 },
      { kind: 'TOURNAMENT_PLATFORM_FEE', amount: 20_000, entries: 2 },
    ],
    playerTransferFees: 0,
    executedPayouts: { amount: 0, fees: 0, count: 0 },
    reservedPayouts: { amount: 0, count: 0 },
    lastLedgerEntryAt: NOW,
    ...over,
  };
}

const observation = (over: Partial<TreasuryObservation> = {}): TreasuryObservation => ({
  id: 'o1',
  source: 'CINETPAY_API',
  environment: 'test',
  status: 'VALID',
  availableAmount: 500_000,
  currency: 'XAF',
  observedAt: new Date(NOW.getTime() - 60_000),
  ...over,
});

const obligations = { walletBalances: 300_000, openWithdrawals: 0, tournamentFundsHeld: 0 };

function treasury(over: Partial<Parameters<typeof computeTreasury>[0]> = {}) {
  const last = 'lastObservation' in over ? over.lastObservation! : observation();
  return computeTreasury({
    lastObservation: last,
    lastValidObservation: last?.status === 'VALID' ? last : null,
    obligations,
    reservedPayouts: 0,
    now: NOW,
    ...over,
  });
}

describe('revenus distribuables', () => {
  it('recettes − frais à la charge de la plateforme − retraits exécutés et engagés', () => {
    const r = computeRevenue(
      facts({
        playerTransferFees: 1_500,
        executedPayouts: { amount: 30_000, fees: 300, count: 1 },
        reservedPayouts: { amount: 10_100, count: 1 },
      }),
    );
    expect(r.validatedRevenue).toBe(100_000);
    expect(r.distributable).toBe(100_000 - 1_500 - 30_000 - 300 - 10_100);
    expect(r.anomalies).toEqual(['COLLECTION_FEES_NOT_RECORDED']);
  });

  it('revenu négatif : anomalie, distribuable borné à 0', () => {
    const r = computeRevenue(facts({ executedPayouts: { amount: 150_000, fees: 0, count: 3 } }));
    expect(r.rawDistributable).toBe(-50_000);
    expect(r.distributable).toBe(0);
    expect(r.anomalies).toContain('NEGATIVE_DISTRIBUTABLE');
  });

  it('montants hors des entiers sûrs : erreur, jamais un arrondi flottant', () => {
    expect(() => sumMoney([Number.MAX_SAFE_INTEGER, 1], 'x')).toThrow(MoneyOverflowError);
    expect(() => moneyFromSql('99999999999999999999', 'x')).toThrow(MoneyOverflowError);
    expect(() => moneyFromSql('12.5', 'x')).toThrow(MoneyOverflowError);
    expect(moneyFromSql('123', 'x')).toBe(123);
  });
});

describe('trésorerie', () => {
  it('aucune relecture : inconnue (null), jamais 0', () => {
    const t = treasury({ lastObservation: null });
    expect(t.state).toBe('UNKNOWN');
    expect(t.confirmedAvailable).toBeNull();
    expect(t.free).toBeNull();
  });

  it('relecture en erreur : indisponible ; relecture périmée : bloquée', () => {
    expect(
      treasury({
        lastObservation: observation({
          status: 'ERROR',
          availableAmount: undefined,
          errorCode: 'CINETPAY_TIMEOUT',
        }),
      }).state,
    ).toBe('UNAVAILABLE');
    const stale = treasury({
      lastObservation: observation({
        observedAt: new Date(NOW.getTime() - TREASURY_FRESHNESS_MS - 1),
      }),
    });
    expect(stale.state).toBe('STALE');
    expect(stale.free).toBeNull();
  });

  it('trésorerie libre = solde confirmé − obligations envers les joueurs − retraits engagés', () => {
    const t = treasury({
      obligations: {
        walletBalances: 300_000,
        openWithdrawals: 25_000,
        tournamentFundsHeld: 15_000,
      },
      reservedPayouts: 10_000,
    });
    expect(t.state).toBe('CONFIRMED');
    expect(t.obligations.total).toBe(340_000);
    expect(t.free).toBe(500_000 - 340_000 - 10_000);
  });

  it('solde inférieur aux obligations : anomalie, trésorerie libre nulle', () => {
    const t = treasury({ lastObservation: observation({ availableAmount: 200_000 }) });
    expect(t.anomalies).toContain('TREASURY_BELOW_PLAYER_OBLIGATIONS');
    expect(t.free).toBe(0);
  });

  it('fonds de tournoi négatifs : données incohérentes, aucun montant libre affirmé', () => {
    const t = treasury({ obligations: { ...obligations, tournamentFundsHeld: -10 } });
    expect(t.anomalies).toContain('TOURNAMENT_FUNDS_NEGATIVE');
    expect(t.free).toBeNull();
  });
});

describe('montant retirable', () => {
  it('trésorerie inférieure aux revenus : la trésorerie libre borne, frais compris', () => {
    const w = computeWithdrawable({
      revenue: computeRevenue(facts()), // 100 000
      treasury: treasury({ lastObservation: observation({ availableAmount: 350_500 }) }), // libre 50 500
      fees: FEES,
    });
    expect(w.ceiling).toBe(50_500);
    expect(w.amount).toBe(50_000); // 50 000 + 500 de frais = 50 500
    expect(w.blockers).toEqual([]);
  });

  it('revenus inférieurs à la trésorerie : les revenus bornent', () => {
    const w = computeWithdrawable({
      revenue: computeRevenue(
        facts({ ledgerByKind: [{ kind: 'GAME_COMMISSION', amount: 10_100, entries: 1 }] }),
      ),
      treasury: treasury(),
      fees: FEES,
    });
    expect(w.ceiling).toBe(10_100);
    expect(w.amount).toBe(10_000);
  });

  it('trésorerie non confirmée, frais inconnus ou données incohérentes : bloqué, montant inconnu', () => {
    expect(
      computeWithdrawable({
        revenue: computeRevenue(facts()),
        treasury: treasury({ lastObservation: null }),
        fees: FEES,
      }),
    ).toEqual({ amount: null, ceiling: null, blockers: ['TREASURY_NOT_CONFIRMED'] });
    expect(
      computeWithdrawable({ revenue: computeRevenue(facts()), treasury: treasury(), fees: null })
        .blockers,
    ).toEqual(['FEE_SCHEDULE_UNKNOWN']);
    expect(
      computeWithdrawable({
        revenue: computeRevenue(facts({ executedPayouts: { amount: 200_000, fees: 0, count: 1 } })),
        treasury: treasury(),
        fees: FEES,
      }).blockers,
    ).toEqual(['INCONSISTENT_DATA']);
  });

  it('moins que le minimum d’un transfert : rien de retirable (0 réel, pas inconnu)', () => {
    const w = computeWithdrawable({
      revenue: computeRevenue(
        facts({ ledgerByKind: [{ kind: 'GAME_COMMISSION', amount: 99, entries: 1 }] }),
      ),
      treasury: treasury(),
      fees: FEES,
    });
    expect(w).toEqual({ amount: 0, ceiling: 99, blockers: ['NOTHING_AVAILABLE'] });
  });

  it('plafonné par le maximum d’un transfert CinetPay', () => {
    const w = computeWithdrawable({
      revenue: computeRevenue(
        facts({ ledgerByKind: [{ kind: 'GAME_COMMISSION', amount: 9_000_000, entries: 1 }] }),
      ),
      treasury: treasury({ lastObservation: observation({ availableAmount: 20_000_000 }) }),
      fees: FEES,
    });
    expect(w.amount).toBe(PLATFORM_PAYOUT_MAX_AMOUNT);
  });

  it('frais arrondis au franc supérieur ; M + frais(M) ≤ plafond, M + 1 dépasse', () => {
    expect(estimatePayoutFee(1_001, FEES)).toBe(11);
    expect(estimatePayoutFee(1_000, { bps: 150, fixed: 25 })).toBe(40);
    for (const ceiling of [0, 99, 1_010, 12_345, 987_654]) {
      const m = maxAmountWithinCeiling(ceiling, { bps: 150, fixed: 25 });
      // 0 = rien de retirable (la part fixe seule dépasse déjà le plafond).
      if (m > 0)
        expect(m + estimatePayoutFee(m, { bps: 150, fixed: 25 })!).toBeLessThanOrEqual(ceiling);
      expect(m + 1 + estimatePayoutFee(m + 1, { bps: 150, fixed: 25 })!).toBeGreaterThan(ceiling);
    }
  });
});

describe('bénéficiaire MTN Mobile Money Cameroun', () => {
  it('format E.164 normalisé ; aucun préfixe opérateur supposé ; masquage', () => {
    expect(normalizeCameroonMobile('+237 677 12 34 56')).toBe('+237677123456');
    expect(normalizeCameroonMobile('677123456')).toBe('+237677123456');
    expect(normalizeCameroonMobile('237677123456')).toBe('+237677123456');
    expect(normalizeCameroonMobile('+237 233 12 34 56')).toBeNull(); // fixe
    expect(normalizeCameroonMobile('+225 07 12 34 56')).toBeNull();
    expect(normalizeCameroonMobile('67712345')).toBeNull();
    expect(maskMsisdn('+237677123456')).toBe('+2376** *** *56');
    expect(maskMsisdn('+237677123456')).not.toContain('771234');
  });

  it('validation des entrées : montant entier, champs étrangers ignorés', () => {
    const ok = parsePayoutInput({
      beneficiaryId: '11111111-1111-4111-8111-111111111111',
      amount: 5_000,
      purpose: 'Versement mensuel',
      status: 'SUCCEEDED',
      approvedBy: 'x',
      estimatedFee: 0,
    });
    expect(ok).toEqual({
      beneficiaryId: '11111111-1111-4111-8111-111111111111',
      amount: 5_000,
      purpose: 'Versement mensuel',
    });
    for (const amount of ['5000', 5000.5, -100, 0, 99, 1_500_001, Number.NaN, Infinity, null]) {
      expect(() =>
        parsePayoutInput({
          beneficiaryId: '11111111-1111-4111-8111-111111111111',
          amount,
          purpose: 'Versement',
        }),
      ).toThrow(ValidationError);
    }
    expect(() => parseBeneficiaryInput({ label: 'Compte', msisdn: '12345' })).toThrow(
      ValidationError,
    );
    expect(() =>
      parsePayoutInput({
        beneficiaryId: '11111111-1111-4111-8111-111111111111',
        amount: 500,
        purpose: 'Payer 677123456',
      }),
    ).toThrow(ValidationError);
  });
});

describe('statuts', () => {
  it('transitions serveur : aucun retour arrière depuis un statut final', () => {
    for (const s of ['SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED'] as const) {
      for (const to of PLATFORM_PAYOUT_STATUSES) expect(canTransition(s, to)).toBe(false);
    }
    expect(canTransition('PENDING_APPROVAL', 'SUBMITTING')).toBe(false);
    expect(canTransition('UNCERTAIN', 'READY')).toBe(false); // jamais renvoyé
    expect(canTransition('UNCERTAIN', 'FAILED')).toBe(true); // seulement sur statut relu
    expect(canTransition('PROCESSING', 'CANCELLED')).toBe(false);
  });
});

describe('trésorerie CinetPay : montant renvoyé', () => {
  it('entier XAF seulement ; jamais arrondi ni tronqué', () => {
    expect(parseXafAmount('125000')).toBe(125_000);
    expect(parseXafAmount('125000.00')).toBe(125_000);
    expect(parseXafAmount('125000.50')).toBeNull();
    expect(parseXafAmount('-5')).toBeNull();
    expect(parseXafAmount('abc')).toBeNull();
    expect(parseXafAmount('')).toBeNull();
  });
});

describe('configuration', () => {
  it('par défaut : exécution désactivée, frais inconnus', () => {
    expect(readPlatformPayoutEnv({})).toEqual({ enabled: false, fees: null });
  });

  it('activée sans URL de notification : refusée au démarrage', () => {
    expect(() => readPlatformPayoutEnv({ PLATFORM_PAYOUTS_ENABLED: 'true' })).toThrow(
      'PLATFORM_PAYOUT_NOTIFY_URL est requis',
    );
    expect(() => readPlatformPayoutEnv({ PLATFORM_PAYOUTS_ENABLED: 'oui' })).toThrow('invalide');
    expect(() => readPlatformPayoutEnv({ PLATFORM_PAYOUT_FEE_BPS: '1.5' })).toThrow('invalide');
  });

  it('trois verrous : drapeau, transferts D-077, URL ; tous requis', () => {
    const sandbox = { mode: 'sandbox' as const, warnings: [] };
    expect(
      resolvePayoutExecution({
        env: { enabled: false, fees: null },
        transferAvailability: sandbox,
      }),
    ).toMatchObject({ enabled: false, reason: 'PLATFORM_PAYOUTS_DISABLED' });
    expect(
      resolvePayoutExecution({
        env: { enabled: true, notifyUrl: 'https://api.example.org/n', fees: null },
        transferAvailability: { mode: 'unavailable', reason: 'TRANSFERS_DISABLED', warnings: [] },
      }),
    ).toMatchObject({ enabled: false, reason: 'TRANSFERS_TRANSFERS_DISABLED' });
    expect(
      resolvePayoutExecution({
        env: { enabled: true, notifyUrl: 'https://api.example.org/n', fees: null },
        transferAvailability: sandbox,
      }),
    ).toEqual({ enabled: true, mode: 'sandbox' });
  });
});
