import type { UserId } from '../users/user';

/**
 * Revenus, trésorerie et retraits des revenus de la PLATEFORME (D-078).
 *
 * Trois notions qui ne se confondent jamais :
 * - les revenus COMPTABLES (`platform_ledger`, recettes) : un droit de la plateforme, pas de
 *   l'argent disponible ;
 * - la TRÉSORERIE : le solde disponible relu chez CinetPay (`GET /v1/balances`), seule preuve
 *   de fonds ; il contient aussi l'argent des joueurs ;
 * - le montant RETIRABLE : min(revenu distribuable, trésorerie libre confirmée), après les
 *   obligations envers les joueurs et les retraits déjà engagés.
 *
 * Montants : entiers XAF (1 jeton = 1 FCFA, D-075). Toute opération passe par
 * `requireSafeInteger` : jamais de nombre flottant, jamais de dépassement silencieux.
 * « Inconnu » est `null`, jamais 0.
 */

export const PLATFORM_PAYOUT_CURRENCY = 'XAF' as const;
/** Bornes d'un transfert CinetPay v1 (SDK officiel `cinetpay-js` : 100 à 1 500 000). */
export const PLATFORM_PAYOUT_MIN_AMOUNT = 100;
export const PLATFORM_PAYOUT_MAX_AMOUNT = 1_500_000;
/** Seul opérateur du périmètre D-078. */
export const PLATFORM_PAYOUT_OPERATOR = 'MTN_CM' as const;
export type PlatformPayoutOperator = typeof PLATFORM_PAYOUT_OPERATOR;

/** Au-delà, une relecture de la trésorerie est périmée : rien n'est réservé ni exécuté. */
export const TREASURY_FRESHNESS_MS = 15 * 60_000;
/** Envoi revendiqué sans résultat enregistré (arrêt du serveur) : issue inconnue après ce délai. */
export const SUBMISSION_STALE_MS = 5 * 60_000;
/** Retrait incertain depuis ce délai : rapprochement requis (jamais un échec présumé). */
export const UNCERTAIN_ESCALATION_MS = 24 * 60 * 60_000;

// --- Montants -----------------------------------------------------------------------------------

export class MoneyOverflowError extends Error {
  constructor(readonly label: string) {
    super(`Montant hors des entiers sûrs : ${label}`);
    this.name = 'MoneyOverflowError';
  }
}

export function requireSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new MoneyOverflowError(label);
  return value;
}

/** Somme exacte d'entiers ; lève si un terme ou le résultat sort des entiers sûrs. */
export function sumMoney(values: readonly number[], label: string): number {
  let total = 0n;
  for (const v of values) total += BigInt(requireSafeInteger(v, label));
  const result = Number(total);
  return requireSafeInteger(result, label);
}

/** Montant XAF renvoyé par SQL (bigint en texte) : entier sûr exigé. */
export function moneyFromSql(value: unknown, label: string): number {
  if (value === null || value === undefined) return 0;
  const text = String(value);
  if (!/^-?\d+$/.test(text)) throw new MoneyOverflowError(label);
  const big = BigInt(text);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyOverflowError(label);
  }
  return Number(big);
}

/**
 * Frais de transfert estimés : barème CONFIGURÉ (contrat CinetPay, à confirmer), arrondi au
 * franc supérieur. Sans barème configuré : inconnu (`null`), et le retrait est bloqué.
 */
export interface PayoutFeeSchedule {
  /** Points de base (150 = 1,5 %). */
  bps: number;
  /** Part fixe par transfert, XAF. */
  fixed: number;
}

export function estimatePayoutFee(
  amount: number,
  schedule: PayoutFeeSchedule | null,
): number | null {
  if (!schedule) return null;
  requireSafeInteger(amount, 'montant');
  const proportional = (BigInt(amount) * BigInt(schedule.bps) + 9_999n) / 10_000n;
  return requireSafeInteger(Number(proportional) + schedule.fixed, 'frais estimés');
}

// --- Bénéficiaire -----------------------------------------------------------------------------

/**
 * Numéro mobile camerounais au format E.164 : +237 suivi de 9 chiffres commençant par 6. Les
 * préfixes par opérateur ne sont PAS vérifiés : sources divergentes et portabilité des numéros
 * (D-078). La syntaxe ne prouve ni l'opérateur ni le titulaire : un autre administrateur atteste
 * la vérification hors système avant toute utilisation.
 */
export function normalizeCameroonMobile(input: string): string | null {
  const compact = input.replace(/[\s.-]/g, '');
  const national = /^(?:\+?237)?(6\d{8})$/.exec(compact);
  return national ? `+237${national[1]}` : null;
}

/** +237 6** *** *12 : indicatif, premier chiffre et deux derniers seulement. */
export function maskMsisdn(msisdn: string): string {
  return `${msisdn.slice(0, 5)}** *** *${msisdn.slice(-2)}`;
}

export type BeneficiaryStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'DISABLED';

export interface PayoutBeneficiary {
  id: string;
  label: string;
  operator: PlatformPayoutOperator;
  msisdnMasked: string;
  status: BeneficiaryStatus;
  createdBy: UserId;
  createdAt: Date;
  verifiedBy?: UserId;
  verifiedAt?: Date;
  verificationNote?: string;
  disabledBy?: UserId;
  disabledAt?: Date;
}

// --- Retraits -----------------------------------------------------------------------------------

/**
 * Cycle de vie (serveur seulement, jamais imposé par l'interface) :
 *
 *   PENDING_APPROVAL ─┬─ approbation (autre admin) + réservation ─▶ RESERVED
 *                     ├─ rejet (autre admin) ─▶ REJECTED
 *                     └─ annulation ─▶ CANCELLED
 *   RESERVED ─ mise en exécution (prérequis vérifiés) ─▶ READY ; ou annulation
 *   READY ─ envoi revendiqué par UN exécuteur ─▶ SUBMITTING ; ou annulation
 *   SUBMITTING ─▶ PROCESSING (accepté) | UNCERTAIN (issue inconnue) | READY (non envoyé, certain)
 *   PROCESSING / UNCERTAIN / RECONCILIATION_REQUIRED ─ statut relu ─▶ SUCCEEDED | FAILED
 *   UNCERTAIN ─ 24 h sans preuve ─▶ RECONCILIATION_REQUIRED (fonds toujours réservés)
 *
 * « Brouillon », « demande créée » et « en attente d'approbation » sont un seul état
 * (PENDING_APPROVAL) ; « approuvée » et « fonds réservés » aussi (RESERVED) : l'approbation
 * réserve les fonds dans la même transaction, il n'existe aucun état approuvé non réservé.
 */
export type PlatformPayoutStatus =
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'CANCELLED'
  | 'RESERVED'
  | 'READY'
  | 'SUBMITTING'
  | 'PROCESSING'
  | 'UNCERTAIN'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'RECONCILIATION_REQUIRED';

export const PLATFORM_PAYOUT_STATUSES: readonly PlatformPayoutStatus[] = [
  'PENDING_APPROVAL',
  'REJECTED',
  'CANCELLED',
  'RESERVED',
  'READY',
  'SUBMITTING',
  'PROCESSING',
  'UNCERTAIN',
  'SUCCEEDED',
  'FAILED',
  'RECONCILIATION_REQUIRED',
];

const TRANSITIONS: Readonly<Record<PlatformPayoutStatus, readonly PlatformPayoutStatus[]>> = {
  PENDING_APPROVAL: ['RESERVED', 'REJECTED', 'CANCELLED'],
  RESERVED: ['READY', 'CANCELLED'],
  READY: ['SUBMITTING', 'CANCELLED'],
  SUBMITTING: ['PROCESSING', 'UNCERTAIN', 'READY'],
  PROCESSING: ['SUCCEEDED', 'FAILED', 'UNCERTAIN', 'RECONCILIATION_REQUIRED'],
  UNCERTAIN: ['PROCESSING', 'SUCCEEDED', 'FAILED', 'RECONCILIATION_REQUIRED'],
  RECONCILIATION_REQUIRED: ['PROCESSING', 'SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransition(from: PlatformPayoutStatus, to: PlatformPayoutStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const isFinalPayoutStatus = (s: PlatformPayoutStatus): boolean =>
  s === 'SUCCEEDED' || s === 'FAILED' || s === 'REJECTED' || s === 'CANCELLED';

/** Fonds engagés : réservés à l'approbation, libérés seulement par un statut final. */
export const RESERVING_STATUSES: readonly PlatformPayoutStatus[] = [
  'RESERVED',
  'READY',
  'SUBMITTING',
  'PROCESSING',
  'UNCERTAIN',
  'RECONCILIATION_REQUIRED',
];

/** Statuts relus chez CinetPay (envoi parti ou issue inconnue). */
export const LOOKUP_STATUSES: readonly PlatformPayoutStatus[] = [
  'PROCESSING',
  'UNCERTAIN',
  'RECONCILIATION_REQUIRED',
];

export interface PlatformPayout {
  id: string;
  merchantTransactionId: string;
  beneficiaryId: string;
  operator: PlatformPayoutOperator;
  msisdnMasked: string;
  amount: number;
  currency: typeof PLATFORM_PAYOUT_CURRENCY;
  estimatedFee: number;
  finalAmount?: number;
  finalFee?: number;
  purpose: string;
  status: PlatformPayoutStatus;
  initiatedBy: UserId;
  createdAt: Date;
  updatedAt: Date;
  approvedBy?: UserId;
  approvedAt?: Date;
  releasedBy?: UserId;
  releasedAt?: Date;
  decidedBy?: UserId;
  decisionNote?: string;
  providerReference?: string;
  providerStatus?: string;
  notifyTokenHash?: string;
  submissionAttempts: number;
  submissionClaimedAt?: Date;
  lastCheckedAt?: Date;
  notFoundChecks: number;
  lastErrorCode?: string;
  lastErrorAt?: Date;
  reconciliationResult?: string;
  completedAt?: Date;
  version: number;
  /** Idempotency-Key de la création (jamais exposée). */
  creationKey: string;
}

/** Statut CinetPay final d'un transfert → issue. Les autres laissent le retrait ouvert. */
export function finalPayoutOutcome(providerStatus: string): 'SUCCEEDED' | 'FAILED' | undefined {
  if (providerStatus === 'SUCCESS') return 'SUCCEEDED';
  if (providerStatus === 'FAILED' || providerStatus === 'INSUFFICIENT_BALANCE') return 'FAILED';
  return undefined;
}

// --- Revenus distribuables ----------------------------------------------------------------------

/** Faits comptables lus dans PostgreSQL (montants XAF entiers). */
export interface RevenueFacts {
  /** Somme de `platform_ledger` par type (recettes de la plateforme). */
  ledgerByKind: { kind: string; amount: number; entries: number }[];
  /** Frais des transferts des JOUEURS réussis, à la charge du compte marchand (D-075). */
  playerTransferFees: number;
  /** Retraits de la plateforme réussis : montant et frais définitifs (ou estimés à défaut). */
  executedPayouts: { amount: number; fees: number; count: number };
  /** Retraits engagés (statuts réservants) : montant + frais estimés. */
  reservedPayouts: { amount: number; count: number };
  lastLedgerEntryAt: Date | null;
}

export type RevenueAnomaly = 'NEGATIVE_DISTRIBUTABLE' | 'COLLECTION_FEES_NOT_RECORDED';

export interface RevenueSummary {
  validatedRevenue: number;
  charges: { playerTransferFees: number; executedPayouts: number; executedPayoutFees: number };
  reserved: number;
  /** Revenu distribuable (≥ 0) ; `rawDistributable` peut être négatif (anomalie). */
  distributable: number;
  rawDistributable: number;
  lastUpdatedAt: Date | null;
  anomalies: RevenueAnomaly[];
}

/**
 * Revenu distribuable = recettes validées − frais de transfert à la charge de la plateforme −
 * retraits déjà exécutés (montant + frais) − retraits engagés. Les frais de COLLECTION des
 * achats ne sont pas enregistrés par Le Ter : ils ne sont pas déduits (limite signalée) ; la
 * trésorerie relue, nette de ces frais, borne de toute façon le montant retirable.
 */
export function computeRevenue(facts: RevenueFacts): RevenueSummary {
  const validatedRevenue = sumMoney(
    facts.ledgerByKind.map((k) => k.amount),
    'recettes',
  );
  const deductions = sumMoney(
    [
      facts.playerTransferFees,
      facts.executedPayouts.amount,
      facts.executedPayouts.fees,
      facts.reservedPayouts.amount,
    ],
    'déductions',
  );
  const rawDistributable = requireSafeInteger(validatedRevenue - deductions, 'distribuable');
  const anomalies: RevenueAnomaly[] = ['COLLECTION_FEES_NOT_RECORDED'];
  if (rawDistributable < 0) anomalies.unshift('NEGATIVE_DISTRIBUTABLE');
  return {
    validatedRevenue,
    charges: {
      playerTransferFees: facts.playerTransferFees,
      executedPayouts: facts.executedPayouts.amount,
      executedPayoutFees: facts.executedPayouts.fees,
    },
    reserved: facts.reservedPayouts.amount,
    distributable: Math.max(0, rawDistributable),
    rawDistributable,
    lastUpdatedAt: facts.lastLedgerEntryAt,
    anomalies,
  };
}

// --- Trésorerie -----------------------------------------------------------------------------

export interface TreasuryObservation {
  id: string;
  source: 'CINETPAY_API';
  environment: 'test' | 'live';
  status: 'VALID' | 'INVALID' | 'ERROR';
  availableAmount?: number;
  currency?: string;
  errorCode?: string;
  requestedBy?: UserId;
  observedAt: Date;
}

/** Obligations envers les JOUEURS, couvertes en priorité par la trésorerie. */
export interface PlayerObligations {
  /** Soldes des comptes de jeu (réservé compris : mises et inscriptions en séquestre). */
  walletBalances: number;
  /** Retraits des joueurs débités mais pas encore réglés (CREATED, PROCESSING). */
  openWithdrawals: number;
  /** Inscriptions de tournoi capturées, ni redistribuées ni acquises à la plateforme. */
  tournamentFundsHeld: number;
}

export type TreasuryState =
  /** Aucune relecture enregistrée. */
  | 'UNKNOWN'
  /** Dernière relecture en erreur ou inexploitable. */
  | 'UNAVAILABLE'
  /** Dernière relecture valide trop ancienne. */
  | 'STALE'
  /** Relecture valide et récente. */
  | 'CONFIRMED';

export type TreasuryAnomaly =
  | 'TREASURY_UNKNOWN'
  | 'TREASURY_UNAVAILABLE'
  | 'TREASURY_STALE'
  | 'TREASURY_BELOW_PLAYER_OBLIGATIONS'
  | 'TOURNAMENT_FUNDS_NEGATIVE';

export interface TreasurySummary {
  state: TreasuryState;
  /** Dernière relecture (quelle que soit sa validité). */
  lastObservation: TreasuryObservation | null;
  /** Dernière relecture VALIDE (peut être périmée). */
  lastValidObservation: TreasuryObservation | null;
  /** Solde disponible confirmé ; null si non confirmé (jamais 0 par défaut). */
  confirmedAvailable: number | null;
  obligations: PlayerObligations & { total: number };
  reservedPayouts: number;
  /** Trésorerie libre confirmée ; null si la trésorerie n'est pas confirmée. */
  free: number | null;
  rawFree: number | null;
  freshUntil: Date | null;
  anomalies: TreasuryAnomaly[];
}

export function computeTreasury(input: {
  lastObservation: TreasuryObservation | null;
  lastValidObservation: TreasuryObservation | null;
  obligations: PlayerObligations;
  reservedPayouts: number;
  now: Date;
}): TreasurySummary {
  const { lastObservation, lastValidObservation, obligations, now } = input;
  const anomalies: TreasuryAnomaly[] = [];
  if (obligations.tournamentFundsHeld < 0) anomalies.push('TOURNAMENT_FUNDS_NEGATIVE');
  const total = sumMoney(
    [
      obligations.walletBalances,
      obligations.openWithdrawals,
      Math.max(0, obligations.tournamentFundsHeld),
    ],
    'obligations',
  );

  let state: TreasuryState;
  if (!lastObservation) state = 'UNKNOWN';
  else if (lastObservation.status !== 'VALID') state = 'UNAVAILABLE';
  else if (now.getTime() - lastObservation.observedAt.getTime() > TREASURY_FRESHNESS_MS) {
    state = 'STALE';
  } else state = 'CONFIRMED';
  if (state === 'UNKNOWN') anomalies.push('TREASURY_UNKNOWN');
  if (state === 'UNAVAILABLE') anomalies.push('TREASURY_UNAVAILABLE');
  if (state === 'STALE') anomalies.push('TREASURY_STALE');

  const confirmedAvailable =
    state === 'CONFIRMED' ? (lastObservation!.availableAmount ?? null) : null;
  let rawFree: number | null = null;
  if (confirmedAvailable !== null) {
    rawFree = requireSafeInteger(
      confirmedAvailable - total - input.reservedPayouts,
      'trésorerie libre',
    );
    if (confirmedAvailable < total) anomalies.push('TREASURY_BELOW_PLAYER_OBLIGATIONS');
  }
  // Données incohérentes : aucun montant libre n'est affirmé.
  const consistent = !anomalies.includes('TOURNAMENT_FUNDS_NEGATIVE');
  return {
    state,
    lastObservation,
    lastValidObservation,
    confirmedAvailable,
    obligations: { ...obligations, total },
    reservedPayouts: input.reservedPayouts,
    free: rawFree === null || !consistent ? null : Math.max(0, rawFree),
    rawFree,
    freshUntil:
      state === 'CONFIRMED'
        ? new Date(lastObservation!.observedAt.getTime() + TREASURY_FRESHNESS_MS)
        : null,
    anomalies,
  };
}

// --- Montant retirable ----------------------------------------------------------------------

export type WithdrawableBlocker =
  'TREASURY_NOT_CONFIRMED' | 'INCONSISTENT_DATA' | 'FEE_SCHEDULE_UNKNOWN' | 'NOTHING_AVAILABLE';

export interface Withdrawable {
  /** Plus grand montant demandable (frais estimés compris dans la limite) ; null si inconnu. */
  amount: number | null;
  /** Limite avant frais : min(distribuable, trésorerie libre). */
  ceiling: number | null;
  blockers: WithdrawableBlocker[];
}

/**
 * montantRetirable : plus grand montant M tel que M + frais(M) ≤ min(distribuable, libre).
 * Toute donnée inconnue ou incohérente bloque (aucun montant affirmé).
 */
export function computeWithdrawable(input: {
  revenue: RevenueSummary;
  treasury: TreasurySummary;
  fees: PayoutFeeSchedule | null;
}): Withdrawable {
  const blockers: WithdrawableBlocker[] = [];
  if (input.treasury.state !== 'CONFIRMED') blockers.push('TREASURY_NOT_CONFIRMED');
  if (
    input.revenue.anomalies.includes('NEGATIVE_DISTRIBUTABLE') ||
    input.treasury.anomalies.includes('TOURNAMENT_FUNDS_NEGATIVE')
  ) {
    blockers.push('INCONSISTENT_DATA');
  }
  if (!input.fees) blockers.push('FEE_SCHEDULE_UNKNOWN');
  if (blockers.length > 0 || input.treasury.free === null) {
    return { amount: null, ceiling: null, blockers };
  }
  const ceiling = Math.min(input.revenue.distributable, input.treasury.free);
  const amount = Math.min(maxAmountWithinCeiling(ceiling, input.fees!), PLATFORM_PAYOUT_MAX_AMOUNT);
  if (amount < PLATFORM_PAYOUT_MIN_AMOUNT) {
    return { amount: 0, ceiling, blockers: ['NOTHING_AVAILABLE'] };
  }
  return { amount, ceiling, blockers: [] };
}

/** Plus grand M ≥ 0 avec M + frais(M) ≤ plafond (recherche dichotomique, entiers exacts). */
export function maxAmountWithinCeiling(ceiling: number, fees: PayoutFeeSchedule): number {
  let low = 0;
  let high = Math.max(0, ceiling);
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (mid + estimatePayoutFee(mid, fees)! <= ceiling) low = mid;
    else high = mid - 1;
  }
  return low;
}

// --- Erreurs métier ---------------------------------------------------------------------------

export class PlatformPayoutNotFoundError extends Error {
  constructor() {
    super('Retrait de la plateforme introuvable');
    this.name = 'PlatformPayoutNotFoundError';
  }
}

export class PayoutBeneficiaryNotFoundError extends Error {
  constructor() {
    super('Bénéficiaire introuvable');
    this.name = 'PayoutBeneficiaryNotFoundError';
  }
}

export type PayoutRefusalReason =
  | 'SAME_ADMIN'
  | 'INVALID_TRANSITION'
  | 'BENEFICIARY_NOT_ACTIVE'
  | 'BENEFICIARY_ALREADY_EXISTS'
  | 'BENEFICIARY_NOT_PENDING'
  | 'AMOUNT_EXCEEDS_WITHDRAWABLE'
  | 'TREASURY_NOT_CONFIRMED'
  | 'INCONSISTENT_DATA'
  | 'FEE_SCHEDULE_UNKNOWN'
  | 'NOTHING_AVAILABLE'
  | 'CONCURRENT_UPDATE'
  | 'IDEMPOTENCY_KEY_REUSED';

/** Opération refusée : la condition métier n'est pas remplie (rien n'est écrit). */
export class PlatformPayoutRefusedError extends Error {
  constructor(
    readonly reason: PayoutRefusalReason,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`Retrait de la plateforme refusé : ${reason}`);
    this.name = 'PlatformPayoutRefusedError';
  }
}

/**
 * Exécution des transferts désactivée (`PLATFORM_PAYOUTS_ENABLED` absent ou faux, transferts
 * CinetPay indisponibles au sens de D-077) : aucune mise en exécution, aucun envoi.
 */
export class PlatformPayoutsDisabledError extends Error {
  constructor(readonly reason: string) {
    super('Exécution des retraits de la plateforme désactivée');
    this.name = 'PlatformPayoutsDisabledError';
  }
}

/** Trésorerie non relisible (CinetPay non configuré) : aucune décision possible. */
export class TreasuryProviderUnavailableError extends Error {
  constructor() {
    super('Relecture de la trésorerie impossible');
    this.name = 'TreasuryProviderUnavailableError';
  }
}

/** Notification de transfert de la plateforme refusée (jeton ou référence invalide). */
export class PlatformPayoutNotificationRejectedError extends Error {
  constructor(readonly reason: string) {
    super('Notification refusée');
    this.name = 'PlatformPayoutNotificationRejectedError';
  }
}
