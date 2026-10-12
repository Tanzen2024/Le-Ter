import type { SqlExecutor } from '../database/sql-client';
import type { AuditEntry } from '../domain/admin/admin';
import type {
  BeneficiaryStatus,
  PayoutBeneficiary,
  PlatformPayout,
  PlatformPayoutStatus,
  PlayerObligations,
  RevenueFacts,
  TreasuryObservation,
} from '../domain/platform-finance/platform-finance';
import type { UserId } from '../domain/users/user';

export interface PlatformPayoutEvent {
  id: string;
  payoutId: string;
  actorId: UserId | null;
  actorUsername?: string | null;
  event: string;
  fromStatus: PlatformPayoutStatus | null;
  toStatus: PlatformPayoutStatus | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface PlatformPayoutListQuery {
  page: number;
  limit: number;
  status?: PlatformPayoutStatus;
}

export interface PlatformPayoutRow extends PlatformPayout {
  beneficiaryLabel: string;
  initiatedByUsername: string | null;
  approvedByUsername: string | null;
  decidedByUsername: string | null;
  releasedByUsername: string | null;
}

/** Changements d'un retrait : seuls les champs listés sont écrits (version contrôlée). */
export type PayoutChanges = Partial<
  Pick<
    PlatformPayout,
    | 'status'
    | 'approvedBy'
    | 'approvedAt'
    | 'releasedBy'
    | 'releasedAt'
    | 'decidedBy'
    | 'decisionNote'
    | 'providerReference'
    | 'providerStatus'
    | 'notifyTokenHash'
    | 'submissionAttempts'
    | 'submissionClaimedAt'
    | 'lastCheckedAt'
    | 'notFoundChecks'
    | 'lastErrorCode'
    | 'lastErrorAt'
    | 'reconciliationResult'
    | 'finalAmount'
    | 'finalFee'
    | 'completedAt'
  >
>;

/** Accès aux données de D-078, dans une transaction (`tx`) quand l'appelant en ouvre une. */
export interface PlatformFinanceStore {
  // Faits financiers (lecture seule, aucune table existante n'est modifiée).
  revenueFacts(): Promise<RevenueFacts>;
  playerObligations(): Promise<PlayerObligations>;

  // Trésorerie.
  insertObservation(observation: TreasuryObservation): Promise<void>;
  lastObservation(): Promise<TreasuryObservation | null>;
  lastValidObservation(): Promise<TreasuryObservation | null>;
  listObservations(limit: number): Promise<TreasuryObservation[]>;

  // Bénéficiaires.
  insertBeneficiary(b: PayoutBeneficiary & { msisdn: string }): Promise<void>;
  findBeneficiary(id: string): Promise<(PayoutBeneficiary & { msisdn: string }) | null>;
  listBeneficiaries(): Promise<
    (PayoutBeneficiary & { createdByUsername: string | null; verifiedByUsername: string | null })[]
  >;
  /** Changement conditionnel (statut attendu) ; faux si la ligne a changé entre-temps. */
  updateBeneficiary(
    id: string,
    expected: BeneficiaryStatus,
    changes: Partial<
      Pick<
        PayoutBeneficiary,
        'status' | 'verifiedBy' | 'verifiedAt' | 'verificationNote' | 'disabledBy' | 'disabledAt'
      >
    >,
  ): Promise<boolean>;

  // Retraits.
  insertPayout(payout: PlatformPayout): Promise<void>;
  findPayout(id: string): Promise<PlatformPayoutRow | null>;
  findPayoutByReference(merchantTransactionId: string): Promise<PlatformPayout | null>;
  findPayoutByCreationKey(
    initiatedBy: string,
    creationKey: string,
  ): Promise<PlatformPayoutRow | null>;
  /** Journal d'audit, dans la même transaction que l'action. */
  insertAudit(entry: AuditEntry): Promise<void>;
  listPayouts(
    query: PlatformPayoutListQuery,
  ): Promise<{ total: number; items: PlatformPayoutRow[] }>;
  /**
   * Écrit `changes` si le retrait a encore `expected.status` et `expected.version` ; renvoie
   * le retrait mis à jour, ou null (concurrence : rien n'est écrit).
   */
  updatePayout(
    id: string,
    expected: { status: PlatformPayoutStatus; version: number },
    changes: PayoutChanges,
    now: Date,
  ): Promise<PlatformPayout | null>;
  insertEvent(event: PlatformPayoutEvent): Promise<void>;
  listEvents(payoutId: string): Promise<PlatformPayoutEvent[]>;
  findReady(limit: number): Promise<PlatformPayout[]>;
  findForLookup(input: { limit: number; checkedBefore: Date }): Promise<PlatformPayout[]>;
  findStaleSubmitting(claimedBefore: Date): Promise<PlatformPayout[]>;
}

export interface PlatformFinanceRepository extends PlatformFinanceStore {
  /** Lecture/écriture hors transaction. */
  readonly executor: SqlExecutor;
  /**
   * Transaction SÉRIALISÉE avec toutes les autres opérations qui engagent des fonds
   * (création, approbation, mise en exécution) : deux demandes concurrentes ne peuvent pas
   * réserver plus que le disponible.
   */
  withFundsLock<T>(work: (store: PlatformFinanceStore) => Promise<T>): Promise<T>;
}
