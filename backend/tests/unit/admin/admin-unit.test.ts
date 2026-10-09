import { readTrustProxy } from '../../../src/config/env';
import {
  FallbackRateLimitStore,
  MemoryRateLimitStore,
  RedisRateLimitStore,
} from '../../../src/middleware/shared-rate-limit';
import type { TournamentLedgerFacts } from '../../../src/repositories/admin-query.repository';
import { maskPhone, toCsv } from '../../../src/services/admin/admin-query.service';
import {
  paymentAnomalies,
  tournamentAnomalies,
} from '../../../src/services/admin/admin-reconciliation';
import { computePool, computePrizes } from '../../../src/domain/tournaments/tournament';
import { silentLogger } from '../../../src/utils/logger';

/** Tournoi terminé, cohérent en tout point (calculé avec les fonctions du serveur). */
function consistent(overrides: Partial<TournamentLedgerFacts> = {}): TournamentLedgerFacts {
  const entryFee = 1000;
  const participants = 23;
  const feeBps = 1250;
  const rules = [
    { rank: 1, shareBps: 6000 },
    { rank: 2, shareBps: 4000 },
  ];
  const pool = computePool(entryFee, participants, feeBps);
  const prizes = computePrizes(pool.prizePool, rules, participants);
  return {
    id: 't-1',
    name: 'Coupe',
    status: 'COMPLETED',
    startedAt: new Date('2026-10-08T10:00:00Z'),
    entryFee,
    participants,
    platformFeeBps: feeBps,
    grossPool: pool.grossPool,
    platformFee: pool.platformFee,
    prizePool: pool.prizePool,
    unallocatedPrize: prizes.unallocated,
    capturedReservations: participants,
    capturedEntryTokens: pool.grossPool,
    capturedEntryTransactions: participants,
    feeEntryAmount: pool.platformFee,
    unallocatedEntryAmount: prizes.unallocated > 0 ? prizes.unallocated : null,
    resultsCount: participants,
    resultsPrizeTotal: prizes.prizes.reduce((s, p) => s + p.amount, 0),
    unpaidPrizes: 0,
    prizeRules: rules,
    ...overrides,
  };
}

const types = (facts: TournamentLedgerFacts) => tournamentAnomalies([facts]).map((a) => a.type);

describe('rapprochement du compte financier de la plateforme (six contrôles)', () => {
  it('tournoi cohérent : aucune anomalie (commission arrondie à l’entier inférieur)', () => {
    const facts = consistent();
    // 23 000 × 12,5 % = 2 875 exactement ; vérifions aussi un arrondi réel.
    expect(types(facts)).toEqual([]);
    const odd = consistent({ participants: 21 });
    const pool = computePool(1000, 21, 1250); // 2 625
    const prizes = computePrizes(pool.prizePool, odd.prizeRules, 21);
    expect(
      types({
        ...odd,
        grossPool: pool.grossPool,
        platformFee: pool.platformFee,
        prizePool: pool.prizePool,
        capturedEntryTokens: pool.grossPool,
        capturedEntryTransactions: 21,
        capturedReservations: 21,
        feeEntryAmount: pool.platformFee,
        resultsCount: 21,
        resultsPrizeTotal: prizes.prizes.reduce((s, p) => s + p.amount, 0),
      }),
    ).toEqual([]);
    expect(computePool(999, 3, 1000).platformFee).toBe(299); // floor(299,7)
  });

  it('1. écriture de commission absente ou différente', () => {
    expect(types(consistent({ feeEntryAmount: null }))).toEqual(['TOURNAMENT_FEE_ENTRY_MISSING']);
    expect(types(consistent({ feeEntryAmount: 1 }))).toEqual(['TOURNAMENT_FEE_ENTRY_MISMATCH']);
  });

  it('2. commission différente de la formule du serveur', () => {
    const facts = consistent();
    const wrong = (facts.platformFee ?? 0) + 1;
    expect(
      types({
        ...facts,
        platformFee: wrong,
        feeEntryAmount: wrong,
        prizePool: (facts.prizePool ?? 0) - 1,
      }),
    ).toContain('TOURNAMENT_FEE_FORMULA');
  });

  it('3. entrées capturées différentes de la cagnotte brute', () => {
    expect(
      types(consistent({ capturedEntryTokens: 22_000, capturedEntryTransactions: 22 })),
    ).toEqual(['TOURNAMENT_ENTRIES_MISMATCH']);
  });

  it('4. cagnotte brute ≠ commission + cagnotte des gains', () => {
    const facts = consistent();
    expect(types({ ...facts, prizePool: (facts.prizePool ?? 0) + 5 })).toContain(
      'TOURNAMENT_POOL_SPLIT',
    );
  });

  it('5. gains attribués + part non attribuée ≠ cagnotte des gains ; écriture UNALLOCATED_PRIZE', () => {
    expect(types(consistent({ resultsPrizeTotal: 10 }))).toEqual(['TOURNAMENT_PRIZES_MISMATCH']);
    // 1 seul classé pour 2 rangs payés : part non attribuée attendue en écriture.
    const facts = consistent({ resultsCount: 1 });
    const prizes = computePrizes(facts.prizePool!, facts.prizeRules, 1);
    expect(
      types({
        ...facts,
        resultsPrizeTotal: prizes.prizes.reduce((s, p) => s + p.amount, 0),
        unallocatedPrize: prizes.unallocated,
        unallocatedEntryAmount: null,
      }),
    ).toEqual(['TOURNAMENT_UNALLOCATED_ENTRY']);
  });

  it('6. tournoi terminé avec des gains non versés', () => {
    expect(types(consistent({ unpaidPrizes: 2 }))).toEqual(['TOURNAMENT_PRIZES_UNPAID']);
    // En cours de versement : normal, pas d'anomalie.
    expect(types(consistent({ unpaidPrizes: 2, status: 'DISTRIBUTING_PRIZES' }))).toEqual([]);
  });

  it('écriture au journal pour un tournoi non démarré', () => {
    expect(types(consistent({ startedAt: null, participants: null, feeEntryAmount: 100 }))).toEqual(
      ['LEDGER_ENTRY_WITHOUT_START'],
    );
  });
});

describe('rapprochement des paiements', () => {
  const base = {
    paymentId: 'p',
    merchantTransactionId: 'LT1',
    providerReference: 'cp-1',
    userId: 'u',
    username: 'awa',
    amount: 1000,
    currency: 'XAF',
    walletTransactionId: 'w',
    tokens: 1000,
    createdAt: new Date('2026-10-09T08:00:00Z'),
  };
  const now = new Date('2026-10-09T08:10:00Z');

  it('paiement réussi mais achat non crédité : CRITIQUE', () => {
    const [a] = paymentAnomalies(
      [{ ...base, status: 'SUCCESS', walletTransactionStatus: 'pending' }],
      now,
    );
    expect(a).toMatchObject({ type: 'PAYMENT_STATUS_MISMATCH', severity: 'CRITICAL' });
  });

  it('paiement cohérent récent : aucune anomalie', () => {
    expect(
      paymentAnomalies([{ ...base, status: 'PENDING', walletTransactionStatus: 'pending' }], now),
    ).toEqual([]);
  });
});

describe('limitation de débit de la connexion admin', () => {
  it('Redis en panne : repli contrôlé sur le compteur local, la limite reste appliquée', async () => {
    const failing = new RedisRateLimitStore(() => Promise.reject(new Error('ECONNREFUSED')));
    const store = new FallbackRateLimitStore(failing, new MemoryRateLimitStore(), silentLogger);
    const counts = [];
    for (let i = 0; i < 3; i += 1) counts.push((await store.hit('k', 60_000)).count);
    expect(counts).toEqual([1, 2, 3]);
  });

  it('Redis disponible : compteur partagé', async () => {
    let value = 0;
    const store = new RedisRateLimitStore(
      () => Promise.resolve([++value, 59_000]),
      () => 0,
    );
    await store.hit('k', 60_000);
    expect(await store.hit('k', 60_000)).toEqual({ count: 2, resetAt: 59_000 });
  });
});

describe('TRUST_PROXY', () => {
  it('désactivé par défaut ; `true` refusé (adresse client falsifiable)', () => {
    expect(readTrustProxy(undefined)).toBeUndefined();
    expect(readTrustProxy('')).toBeUndefined();
    expect(readTrustProxy('false')).toBeUndefined();
    expect(() => readTrustProxy('true')).toThrow(/TRUST_PROXY invalide/);
    expect(() => readTrustProxy('0')).toThrow();
  });

  it('sauts, noms prédéfinis ou adresses explicites', () => {
    expect(readTrustProxy('1')).toBe(1);
    expect(readTrustProxy('loopback')).toBe('loopback');
    expect(readTrustProxy('10.0.0.0/8, 127.0.0.1')).toBe('10.0.0.0/8,127.0.0.1');
    expect(() => readTrustProxy('evil.example.com')).toThrow();
  });
});

describe('exports et données personnelles', () => {
  it('CSV : formules de tableur neutralisées, guillemets échappés', () => {
    const csv = toCsv(['a', 'b'], [{ a: '=HYPERLINK("x")', b: 'Le "Ter", 1' }]);
    expect(csv).toBe('a,b\r\n"\'=HYPERLINK(""x"")","Le ""Ter"", 1"');
  });

  it('téléphone masqué dans les listes', () => {
    expect(maskPhone('+237612345678')).toBe('+237••••78');
  });
});
