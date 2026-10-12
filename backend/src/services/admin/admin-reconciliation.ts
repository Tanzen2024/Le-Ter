import { ADMIN_THRESHOLDS } from '../../domain/admin/admin';
import {
  DEPOSIT_LIMITS_XAF,
  isAllowedDepositAmount,
  TOKENS_PER_XAF,
} from '../../domain/payments/payment';
import { computePool, computePrizes } from '../../domain/tournaments/tournament';
import type {
  OrphanDepositRow,
  PaymentReconciliationRow,
  TournamentLedgerFacts,
} from '../../repositories/admin-query.repository';

/**
 * Rapprochement financier (D-060, audit §8.5 et §9) : LECTURE SEULE. Chaque anomalie dit ce
 * qui a été comparé ; rien n'est corrigé. L'état « OPEN » est calculé : une anomalie
 * disparaît d'elle-même quand la condition n'est plus vraie.
 *
 * Les règles de calcul ne sont PAS recopiées : la commission et la répartition attendues
 * sont recalculées par `computePool` et `computePrizes`, les fonctions mêmes du serveur.
 */
export type AnomalyType =
  | 'PAYMENT_STATUS_MISMATCH'
  | 'PAYMENT_AMOUNT_MISMATCH'
  | 'PAYMENT_AMOUNT_OUT_OF_RANGE'
  | 'PAYMENT_STALE_PENDING'
  | 'PAYMENT_MISSING_PROVIDER_REFERENCE'
  | 'DEPOSIT_WITHOUT_PAYMENT'
  | 'TOURNAMENT_FEE_ENTRY_MISSING'
  | 'TOURNAMENT_FEE_ENTRY_MISMATCH'
  | 'TOURNAMENT_FEE_FORMULA'
  | 'TOURNAMENT_ENTRIES_MISMATCH'
  | 'TOURNAMENT_POOL_SPLIT'
  | 'TOURNAMENT_PRIZES_MISMATCH'
  | 'TOURNAMENT_UNALLOCATED_ENTRY'
  | 'TOURNAMENT_PRIZES_UNPAID'
  | 'LEDGER_ENTRY_WITHOUT_START';

export type AnomalySeverity = 'CRITICAL' | 'WARNING';

export interface Anomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  domain: 'PAYMENT' | 'TOURNAMENT';
  reference: { kind: 'PAYMENT' | 'WALLET_TRANSACTION' | 'TOURNAMENT'; id: string; label: string };
  date: string;
  amount: number | null;
  currency: 'XAF';
  compared: { label: string; expected: string | number | null; actual: string | number | null }[];
  explanation: string;
  state: 'OPEN';
}

/** Contrôles garantis par la base (contraintes) : affichés comme tels, jamais recalculés. */
export const DATABASE_GUARANTEES = [
  {
    control: 'Devise des paiements',
    guarantee: "CHECK currency = 'XAF' sur payments, wallet_reservations, platform_ledger",
  },
  {
    control: 'Références en doublon',
    guarantee:
      'UNIQUE (provider, merchant_transaction_id) et UNIQUE (provider, provider_reference) sur payments',
  },
  {
    control: 'Paiement réussi sans référence fournisseur',
    guarantee: "CHECK status <> 'SUCCESS' OR provider_reference IS NOT NULL",
  },
  {
    control: 'Écriture plateforme en double',
    guarantee: 'UNIQUE (tournament_id, kind) et UNIQUE (game_id, kind) sur platform_ledger',
  },
  {
    // D-074 : une partie n'est réglée qu'une fois, et ses montants sont cohérents.
    control: 'Règlement d’une partie',
    guarantee:
      "game_settlements.game_id PRIMARY KEY ; CHECK gross_amount = unit_amount × (participants − 1) = commission_amount + net_gain ; UNIQUE (user_id, idempotency_key) 'game-stake:' / 'game-winnings:' sur wallet_transactions",
  },
] as const;

const EXPECTED_WALLET_STATUS = {
  SUCCESS: 'succeeded',
  FAILED: 'failed',
  EXPIRED: 'failed',
  PENDING: 'pending',
} as const;

export function paymentAnomalies(rows: PaymentReconciliationRow[], now: Date): Anomaly[] {
  const out: Anomaly[] = [];
  const staleMs = ADMIN_THRESHOLDS.stalePendingPaymentMinutes * 60_000;
  for (const p of rows) {
    const base = {
      domain: 'PAYMENT' as const,
      reference: { kind: 'PAYMENT' as const, id: p.paymentId, label: p.merchantTransactionId },
      date: p.createdAt.toISOString(),
      amount: p.amount,
      currency: 'XAF' as const,
      state: 'OPEN' as const,
    };
    const expected = EXPECTED_WALLET_STATUS[p.status];
    if (p.walletTransactionStatus !== expected) {
      out.push({
        ...base,
        type: 'PAYMENT_STATUS_MISMATCH',
        severity: 'CRITICAL',
        compared: [
          { label: 'Statut du paiement', expected: p.status, actual: p.status },
          {
            label: "Statut de l'achat (compte de jeu)",
            expected,
            actual: p.walletTransactionStatus,
          },
        ],
        explanation:
          "Le statut du paiement CinetPay et celui de l'achat du compte de jeu ne concordent pas. Ils sont normalement réglés dans la même transaction.",
      });
    }
    if (p.amount * TOKENS_PER_XAF !== p.tokens) {
      out.push({
        ...base,
        type: 'PAYMENT_AMOUNT_MISMATCH',
        severity: 'CRITICAL',
        compared: [
          {
            label: 'Jetons attendus (1 FCFA = 1 jeton)',
            expected: p.amount * TOKENS_PER_XAF,
            actual: p.tokens,
          },
        ],
        explanation: "Le montant payé ne correspond pas au nombre de jetons de l'achat.",
      });
    }
    if (!isAllowedDepositAmount(p.amount)) {
      out.push({
        ...base,
        type: 'PAYMENT_AMOUNT_OUT_OF_RANGE',
        severity: 'WARNING',
        compared: [
          {
            label: 'Montant (FCFA)',
            expected: `${DEPOSIT_LIMITS_XAF.min} à ${DEPOSIT_LIMITS_XAF.max}`,
            actual: p.amount,
          },
        ],
        explanation: "Le montant est hors des limites d'achat (D-085).",
      });
    }
    if (p.status === 'PENDING' && now.getTime() - p.createdAt.getTime() >= staleMs) {
      out.push({
        ...base,
        type: p.providerReference ? 'PAYMENT_STALE_PENDING' : 'PAYMENT_MISSING_PROVIDER_REFERENCE',
        severity: 'WARNING',
        compared: [
          {
            label: 'Âge du paiement en attente (minutes)',
            expected: `< ${ADMIN_THRESHOLDS.stalePendingPaymentMinutes}`,
            actual: Math.floor((now.getTime() - p.createdAt.getTime()) / 60_000),
          },
          {
            label: 'Référence CinetPay',
            expected: 'présente',
            actual: p.providerReference ?? 'absente',
          },
        ],
        explanation: p.providerReference
          ? 'Aucune notification finale reçue. Une revérification auprès de CinetPay est possible.'
          : "L'initialisation n'a jamais abouti : aucune référence CinetPay. Revérification impossible.",
      });
    }
  }
  return out;
}

export function orphanDepositAnomalies(rows: OrphanDepositRow[]): Anomaly[] {
  return rows.map((row) => ({
    type: 'DEPOSIT_WITHOUT_PAYMENT',
    severity: row.status === 'succeeded' ? 'CRITICAL' : 'WARNING',
    domain: 'PAYMENT',
    reference: { kind: 'WALLET_TRANSACTION', id: row.walletTransactionId, label: row.username },
    date: row.createdAt.toISOString(),
    amount: row.tokens,
    currency: 'XAF',
    compared: [{ label: 'Paiement fournisseur rattaché', expected: 'présent', actual: 'absent' }],
    explanation: "Un achat du compte de jeu n'a aucun paiement CinetPay rattaché.",
    state: 'OPEN',
  }));
}

/** Les six contrôles du compte financier de la plateforme (audit §8.5). */
export function tournamentAnomalies(facts: TournamentLedgerFacts[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const t of facts) {
    const base = {
      domain: 'TOURNAMENT' as const,
      reference: { kind: 'TOURNAMENT' as const, id: t.id, label: t.name },
      date: (t.startedAt ?? new Date(0)).toISOString(),
      currency: 'XAF' as const,
      state: 'OPEN' as const,
    };
    if (t.startedAt === null || t.participants === null || t.platformFeeBps === null) {
      if (t.feeEntryAmount !== null || t.unallocatedEntryAmount !== null) {
        out.push({
          ...base,
          type: 'LEDGER_ENTRY_WITHOUT_START',
          severity: 'CRITICAL',
          amount: (t.feeEntryAmount ?? 0) + (t.unallocatedEntryAmount ?? 0),
          compared: [{ label: 'Tournoi démarré', expected: 'oui', actual: 'non' }],
          explanation:
            "Le journal de la plateforme contient une écriture pour un tournoi qui n'a pas démarré.",
        });
      }
      continue;
    }
    const pool = computePool(t.entryFee, t.participants, t.platformFeeBps);

    // 1. Commission enregistrée = écriture TOURNAMENT_PLATFORM_FEE.
    if (t.feeEntryAmount === null) {
      out.push({
        ...base,
        type: 'TOURNAMENT_FEE_ENTRY_MISSING',
        severity: 'CRITICAL',
        amount: t.platformFee,
        compared: [
          { label: 'Écriture TOURNAMENT_PLATFORM_FEE', expected: t.platformFee, actual: null },
        ],
        explanation:
          "La commission du tournoi n'a pas d'écriture dans le compte financier de la plateforme.",
      });
    } else if (t.feeEntryAmount !== t.platformFee) {
      out.push({
        ...base,
        type: 'TOURNAMENT_FEE_ENTRY_MISMATCH',
        severity: 'CRITICAL',
        amount: t.feeEntryAmount,
        compared: [
          { label: 'Commission du tournoi', expected: t.platformFee, actual: t.feeEntryAmount },
        ],
        explanation:
          "L'écriture de commission diffère de la commission enregistrée sur le tournoi.",
      });
    }
    // 2. Commission = floor(cagnotte brute × taux) (computePool).
    if (t.platformFee !== pool.platformFee) {
      out.push({
        ...base,
        type: 'TOURNAMENT_FEE_FORMULA',
        severity: 'CRITICAL',
        amount: t.platformFee,
        compared: [
          {
            label: `Commission attendue (${t.platformFeeBps / 100} % de ${pool.grossPool}, arrondi inférieur)`,
            expected: pool.platformFee,
            actual: t.platformFee,
          },
        ],
        explanation: 'La commission enregistrée ne correspond pas à la formule du serveur.',
      });
    }
    // 3. Cagnotte brute = entrées capturées = prix × participants.
    if (
      t.grossPool !== pool.grossPool ||
      t.capturedEntryTokens !== pool.grossPool ||
      t.capturedEntryTransactions !== t.participants
    ) {
      out.push({
        ...base,
        type: 'TOURNAMENT_ENTRIES_MISMATCH',
        severity: 'CRITICAL',
        amount: t.grossPool,
        compared: [
          {
            label: 'Cagnotte brute (prix × participants)',
            expected: pool.grossPool,
            actual: t.grossPool,
          },
          {
            label: 'Entrées capturées (jetons)',
            expected: pool.grossPool,
            actual: t.capturedEntryTokens,
          },
          {
            label: "Transactions d'entrée capturées",
            expected: t.participants,
            actual: t.capturedEntryTransactions,
          },
        ],
        explanation:
          'La cagnotte brute ne correspond pas aux prix d’entrée réellement capturés sur les comptes de jeu.',
      });
    }
    // 4. Cagnotte brute = commission + cagnotte des gains.
    if (t.grossPool !== (t.platformFee ?? 0) + (t.prizePool ?? 0)) {
      out.push({
        ...base,
        type: 'TOURNAMENT_POOL_SPLIT',
        severity: 'CRITICAL',
        amount: t.grossPool,
        compared: [
          {
            label: 'Commission + cagnotte des gains',
            expected: t.grossPool,
            actual: (t.platformFee ?? 0) + (t.prizePool ?? 0),
          },
        ],
        explanation:
          'La cagnotte brute n’est pas égale à la commission plus la cagnotte des gains.',
      });
    }
    // 5. Cagnotte des gains = gains attribués + part non attribuée (= écriture UNALLOCATED_PRIZE).
    if (t.resultsCount > 0 && t.prizePool !== null) {
      const expected = computePrizes(t.prizePool, t.prizeRules, t.resultsCount);
      const unallocated = t.unallocatedPrize ?? 0;
      if (
        t.resultsPrizeTotal + unallocated !== t.prizePool ||
        unallocated !== expected.unallocated
      ) {
        out.push({
          ...base,
          type: 'TOURNAMENT_PRIZES_MISMATCH',
          severity: 'CRITICAL',
          amount: t.prizePool,
          compared: [
            {
              label: 'Gains attribués + part non attribuée',
              expected: t.prizePool,
              actual: t.resultsPrizeTotal + unallocated,
            },
            {
              label: 'Part non attribuée (calculée)',
              expected: expected.unallocated,
              actual: unallocated,
            },
          ],
          explanation: 'La répartition des gains ne correspond pas à la cagnotte des gains.',
        });
      }
      if ((unallocated > 0 ? unallocated : null) !== t.unallocatedEntryAmount) {
        out.push({
          ...base,
          type: 'TOURNAMENT_UNALLOCATED_ENTRY',
          severity: 'CRITICAL',
          amount: unallocated,
          compared: [
            {
              label: 'Écriture UNALLOCATED_PRIZE',
              expected: unallocated > 0 ? unallocated : null,
              actual: t.unallocatedEntryAmount,
            },
          ],
          explanation:
            'La part de gains non attribuée et son écriture au compte de la plateforme ne concordent pas.',
        });
      }
    }
    // 6. Tournoi terminé : chaque gain a sa transaction réussie du même montant.
    if (t.status === 'COMPLETED' && t.unpaidPrizes > 0) {
      out.push({
        ...base,
        type: 'TOURNAMENT_PRIZES_UNPAID',
        severity: 'CRITICAL',
        amount: null,
        compared: [{ label: 'Gains sans versement réussi', expected: 0, actual: t.unpaidPrizes }],
        explanation:
          'Le tournoi est terminé mais certains gains n’ont pas de versement réussi du même montant.',
      });
    }
  }
  return out;
}
