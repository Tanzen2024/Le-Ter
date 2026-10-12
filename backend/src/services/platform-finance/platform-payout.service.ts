import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { AuditAction, AuditEntry } from '../../domain/admin/admin';
import {
  canTransition,
  computeWithdrawable,
  estimatePayoutFee,
  finalPayoutOutcome,
  isFinalPayoutStatus,
  LOOKUP_STATUSES,
  maskMsisdn,
  normalizeCameroonMobile,
  PayoutBeneficiaryNotFoundError,
  PLATFORM_PAYOUT_CURRENCY,
  PLATFORM_PAYOUT_OPERATOR,
  PlatformPayoutNotFoundError,
  PlatformPayoutNotificationRejectedError,
  PlatformPayoutRefusedError,
  PlatformPayoutsDisabledError,
  SUBMISSION_STALE_MS,
  TreasuryProviderUnavailableError,
  UNCERTAIN_ESCALATION_MS,
  type PayoutFeeSchedule,
  type PlatformPayout,
  type PlatformPayoutStatus,
  type Withdrawable,
} from '../../domain/platform-finance/platform-finance';
import type { UserId } from '../../domain/users/user';
import { isPgError, PG_UNIQUE_VIOLATION } from '../../database/sql-client';
import type {
  PayoutChanges,
  PlatformFinanceRepository,
  PlatformFinanceStore,
  PlatformPayoutListQuery,
  PlatformPayoutRow,
} from '../../repositories/platform-finance.repository';
import type { Logger } from '../../utils/logger';
import { ValidationError } from '../../validators/validation-error';
import type { TransferGateway, TransferSubmission } from '../withdrawals/transfer.gateway';
import type { PlatformRevenueService } from './platform-revenue.service';
import type { TreasuryReconciliationService } from './treasury-reconciliation.service';

/**
 * Exécution des transferts : décidée au démarrage, jamais par l'interface. Désactivée par
 * défaut (`PLATFORM_PAYOUTS_ENABLED` absent ou faux, ou transferts CinetPay indisponibles au
 * sens de D-077) : aucune mise en exécution, aucun envoi.
 */
export interface PayoutExecutionState {
  enabled: boolean;
  /** Motif stable quand l'exécution est désactivée. */
  reason?: string;
  mode: 'disabled' | 'sandbox' | 'live';
}

export type CheckOutcome =
  | 'settled'
  | 'processing'
  | 'not_found'
  | 'reconciliation_required'
  | 'already_final'
  | 'not_checkable';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const iso = (d: Date | undefined | null) => d?.toISOString() ?? null;

/** Ce que l'administration voit d'un retrait : numéro masqué, jamais de jeton ni de secret. */
export function payoutView(p: PlatformPayoutRow) {
  return {
    id: p.id,
    reference: p.merchantTransactionId,
    providerReference: p.providerReference ?? null,
    beneficiary: { id: p.beneficiaryId, label: p.beneficiaryLabel, msisdn: p.msisdnMasked },
    operator: p.operator,
    amount: p.amount,
    currency: p.currency,
    estimatedFee: p.estimatedFee,
    finalAmount: p.finalAmount ?? null,
    finalFee: p.finalFee ?? null,
    purpose: p.purpose,
    status: p.status,
    providerStatus: p.providerStatus ?? null,
    initiatedBy: { id: p.initiatedBy, username: p.initiatedByUsername },
    approvedBy: p.approvedBy ? { id: p.approvedBy, username: p.approvedByUsername } : null,
    releasedBy: p.releasedBy ? { id: p.releasedBy, username: p.releasedByUsername } : null,
    decidedBy: p.decidedBy ? { id: p.decidedBy, username: p.decidedByUsername } : null,
    decisionNote: p.decisionNote ?? null,
    lastErrorCode: p.lastErrorCode ?? null,
    lastErrorAt: iso(p.lastErrorAt),
    reconciliationResult: p.reconciliationResult ?? null,
    submissionAttempts: p.submissionAttempts,
    notFoundChecks: p.notFoundChecks,
    lastCheckedAt: iso(p.lastCheckedAt),
    createdAt: p.createdAt.toISOString(),
    approvedAt: iso(p.approvedAt),
    releasedAt: iso(p.releasedAt),
    updatedAt: p.updatedAt.toISOString(),
    completedAt: iso(p.completedAt),
  };
}

/**
 * Retraits des revenus de la plateforme (D-078). Indépendant des retraits des joueurs : ses
 * droits viennent du revenu distribuable et de la trésorerie confirmée, jamais d'un compte de
 * jeu. Toute écriture qui engage des fonds passe par `withFundsLock` (sérialisée).
 *
 * Garanties :
 * - l'initiateur n'approuve ni ne rejette jamais sa demande (contrainte en base) ;
 * - approbation = réservation, dans la même transaction, après recalcul du retirable ;
 * - UN SEUL envoi par retrait (contrainte en base `submission_attempts ≤ 1`) : une réponse
 *   ambiguë n'est jamais suivie d'un second envoi ;
 * - le statut final vient d'une RELECTURE chez CinetPay ; ni l'acceptation, ni la référence,
 *   ni une notification ne suffisent ; NOT_FOUND ne prouve jamais un échec.
 */
export class PlatformPayoutService {
  private readonly clock: () => Date;

  constructor(
    private readonly deps: {
      repository: PlatformFinanceRepository;
      revenue: PlatformRevenueService;
      treasury: TreasuryReconciliationService;
      transfers: TransferGateway;
      execution: PayoutExecutionState;
      fees: PayoutFeeSchedule | null;
      logger: Logger;
      clock?: () => Date;
    },
  ) {
    this.clock = deps.clock ?? (() => new Date());
  }

  get execution(): PayoutExecutionState {
    return this.deps.execution;
  }

  get canLookup(): boolean {
    return this.deps.transfers.canLookup;
  }

  /** Nouveaux envois possibles : exécution activée ET passerelle autorisée à envoyer. */
  private get canSubmit(): boolean {
    return this.deps.execution.enabled && this.deps.transfers.canSubmit;
  }

  // --- Indicateurs -----------------------------------------------------------------------------

  async withdrawable(store: PlatformFinanceStore = this.deps.repository) {
    const revenue = await this.deps.revenue.summary(store);
    const treasury = await this.deps.treasury.summary(store, revenue.reserved);
    const withdrawable = computeWithdrawable({ revenue, treasury, fees: this.deps.fees });
    return { revenue, treasury, withdrawable };
  }

  async overview() {
    const { revenue, treasury, withdrawable } = await this.withdrawable();
    const open = await this.deps.repository.listPayouts({
      page: 1,
      limit: 1,
      status: 'RECONCILIATION_REQUIRED',
    });
    return {
      currency: PLATFORM_PAYOUT_CURRENCY,
      generatedAt: this.clock().toISOString(),
      revenue,
      treasury: {
        ...treasury,
        providerConfigured: this.deps.treasury.configured,
      },
      fees: this.deps.fees
        ? {
            configured: true,
            bps: this.deps.fees.bps,
            fixed: this.deps.fees.fixed,
            estimateForWithdrawable:
              withdrawable.amount !== null
                ? estimatePayoutFee(withdrawable.amount, this.deps.fees)
                : null,
          }
        : { configured: false, bps: null, fixed: null, estimateForWithdrawable: null },
      withdrawable,
      execution: this.deps.execution,
      reconciliationRequired: open.total,
    };
  }

  // --- Bénéficiaires -------------------------------------------------------------------------

  async listBeneficiaries() {
    const items = await this.deps.repository.listBeneficiaries();
    return items.map((b) => ({
      id: b.id,
      label: b.label,
      operator: b.operator,
      msisdn: b.msisdnMasked,
      status: b.status,
      createdBy: { id: b.createdBy, username: b.createdByUsername },
      createdAt: b.createdAt.toISOString(),
      verifiedBy: b.verifiedBy ? { id: b.verifiedBy, username: b.verifiedByUsername } : null,
      verifiedAt: iso(b.verifiedAt),
      verificationNote: b.verificationNote ?? null,
      disabledAt: iso(b.disabledAt),
    }));
  }

  /** Enregistre un numéro MTN Mobile Money Cameroun, en attente de vérification. */
  async createBeneficiary(actorId: UserId, input: { label: string; msisdn: string }) {
    const msisdn = normalizeCameroonMobile(input.msisdn);
    if (!msisdn) {
      throw new ValidationError({
        msisdn: 'Numéro mobile camerounais attendu (+237 6XX XX XX XX).',
      });
    }
    const now = this.clock();
    const id = randomUUID();
    try {
      await this.deps.repository.withFundsLock(async (store) => {
        await store.insertBeneficiary({
          id,
          label: input.label,
          operator: PLATFORM_PAYOUT_OPERATOR,
          msisdn,
          msisdnMasked: maskMsisdn(msisdn),
          status: 'PENDING_VERIFICATION',
          createdBy: actorId,
          createdAt: now,
        });
        await store.insertAudit(
          this.audit(actorId, 'PAYOUT_BENEFICIARY_CREATED', 'PAYOUT_BENEFICIARY', id, {
            operator: PLATFORM_PAYOUT_OPERATOR,
            msisdn: maskMsisdn(msisdn),
          }),
        );
      });
    } catch (err) {
      if (isPgError(err, PG_UNIQUE_VIOLATION)) {
        throw new PlatformPayoutRefusedError('BENEFICIARY_ALREADY_EXISTS');
      }
      throw err;
    }
    this.deps.logger.info('payout beneficiary created', { beneficiaryId: id, actorId });
    return { id, status: 'PENDING_VERIFICATION' as const, msisdn: maskMsisdn(msisdn) };
  }

  /**
   * Un AUTRE administrateur atteste avoir vérifié, hors système, que le numéro est un compte
   * MTN Mobile Money appartenant au bénéficiaire autorisé (la syntaxe ne le prouve pas).
   */
  async verifyBeneficiary(actorId: UserId, id: string, note: string) {
    return this.deps.repository.withFundsLock(async (store) => {
      const b = await store.findBeneficiary(id);
      if (!b) throw new PayoutBeneficiaryNotFoundError();
      if (b.status !== 'PENDING_VERIFICATION')
        throw new PlatformPayoutRefusedError('BENEFICIARY_NOT_PENDING');
      if (b.createdBy === actorId) throw new PlatformPayoutRefusedError('SAME_ADMIN');
      const now = this.clock();
      const ok = await store.updateBeneficiary(id, 'PENDING_VERIFICATION', {
        status: 'ACTIVE',
        verifiedBy: actorId,
        verifiedAt: now,
        verificationNote: note,
      });
      if (!ok) throw new PlatformPayoutRefusedError('CONCURRENT_UPDATE');
      await store.insertAudit(
        this.audit(actorId, 'PAYOUT_BENEFICIARY_VERIFIED', 'PAYOUT_BENEFICIARY', id, { note }),
      );
      return { id, status: 'ACTIVE' as const };
    });
  }

  /** Désactivation (toujours possible) : les retraits non envoyés vers ce numéro sont bloqués. */
  async disableBeneficiary(actorId: UserId, id: string) {
    return this.deps.repository.withFundsLock(async (store) => {
      const b = await store.findBeneficiary(id);
      if (!b) throw new PayoutBeneficiaryNotFoundError();
      if (b.status === 'DISABLED') return { id, status: 'DISABLED' as const };
      const ok = await store.updateBeneficiary(id, b.status, {
        status: 'DISABLED',
        disabledBy: actorId,
        disabledAt: this.clock(),
      });
      if (!ok) throw new PlatformPayoutRefusedError('CONCURRENT_UPDATE');
      await store.insertAudit(
        this.audit(actorId, 'PAYOUT_BENEFICIARY_DISABLED', 'PAYOUT_BENEFICIARY', id, {}),
      );
      return { id, status: 'DISABLED' as const };
    });
  }

  // --- Demandes ------------------------------------------------------------------------------

  async list(query: PlatformPayoutListQuery) {
    const { total, items } = await this.deps.repository.listPayouts(query);
    return { page: query.page, limit: query.limit, total, items: items.map(payoutView) };
  }

  async get(id: string, actorId: UserId) {
    const payout = await this.deps.repository.findPayout(id);
    if (!payout) throw new PlatformPayoutNotFoundError();
    await this.deps.repository.insertAudit(
      this.audit(actorId, 'PLATFORM_PAYOUT_VIEWED', 'PLATFORM_PAYOUT', id, {}),
    );
    const events = await this.deps.repository.listEvents(id);
    return {
      ...payoutView(payout),
      actions: this.actionsFor(payout, actorId),
      events: events.map((e) => ({
        id: e.id,
        event: e.event,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actor: e.actorId ? { id: e.actorId, username: e.actorUsername ?? null } : null,
        details: e.details,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /** Actions permises à CET administrateur (l'interface les affiche ; le serveur les revérifie). */
  private actionsFor(p: PlatformPayout, actorId: UserId) {
    const own = p.initiatedBy === actorId;
    return {
      approve: {
        allowed: p.status === 'PENDING_APPROVAL' && !own,
        reason: own ? 'SAME_ADMIN' : null,
      },
      reject: {
        allowed: p.status === 'PENDING_APPROVAL' && !own,
        reason: own ? 'SAME_ADMIN' : null,
      },
      cancel: {
        allowed: canTransition(p.status, 'CANCELLED') && p.submissionAttempts === 0,
        reason: null,
      },
      release: {
        allowed: p.status === 'RESERVED' && this.canSubmit,
        reason: this.canSubmit ? null : (this.deps.execution.reason ?? 'EXECUTION_DISABLED'),
      },
      check: { allowed: LOOKUP_STATUSES.includes(p.status) && this.canLookup, reason: null },
    };
  }

  /**
   * Création : montant ≤ retirable au moment de la demande (rien n'est encore réservé). Une
   * Idempotency-Key rejouée renvoie la même demande ; réutilisée pour une autre demande : refus.
   */
  async create(
    actorId: UserId,
    input: { beneficiaryId: string; amount: number; purpose: string },
    creationKey: string,
  ) {
    const existing = await this.deps.repository.findPayoutByCreationKey(actorId, creationKey);
    if (existing) return this.replay(existing, input);
    try {
      return await this.deps.repository.withFundsLock(async (store) => {
        const b = await store.findBeneficiary(input.beneficiaryId);
        if (!b) throw new PayoutBeneficiaryNotFoundError();
        if (b.status !== 'ACTIVE') throw new PlatformPayoutRefusedError('BENEFICIARY_NOT_ACTIVE');
        const { withdrawable } = await this.withdrawable(store);
        this.requireWithinWithdrawable(withdrawable, input.amount);
        const now = this.clock();
        const payout: PlatformPayout = {
          id: randomUUID(),
          merchantTransactionId: `LP${randomBytes(13).toString('hex')}`,
          beneficiaryId: b.id,
          operator: PLATFORM_PAYOUT_OPERATOR,
          msisdnMasked: b.msisdnMasked,
          amount: input.amount,
          currency: PLATFORM_PAYOUT_CURRENCY,
          estimatedFee: estimatePayoutFee(input.amount, this.deps.fees)!,
          purpose: input.purpose,
          status: 'PENDING_APPROVAL',
          initiatedBy: actorId,
          createdAt: now,
          updatedAt: now,
          submissionAttempts: 0,
          notFoundChecks: 0,
          version: 1,
          creationKey,
        };
        await store.insertPayout(payout);
        await this.event(store, payout.id, actorId, 'CREATED', null, 'PENDING_APPROVAL', {
          amount: payout.amount,
          estimatedFee: payout.estimatedFee,
          withdrawableAtCreation: withdrawable.amount,
        });
        await store.insertAudit(
          this.audit(actorId, 'PLATFORM_PAYOUT_CREATED', 'PLATFORM_PAYOUT', payout.id, {
            reference: payout.merchantTransactionId,
            amount: payout.amount,
            estimatedFee: payout.estimatedFee,
          }),
        );
        this.deps.logger.info('platform payout created', {
          payoutId: payout.id,
          actorId,
          amount: payout.amount,
        });
        return { payout: payoutView((await store.findPayout(payout.id))!), replayed: false };
      });
    } catch (err) {
      // Double envoi simultané avec la même clé : la demande déjà créée fait foi.
      if (isPgError(err, PG_UNIQUE_VIOLATION)) {
        const winner = await this.deps.repository.findPayoutByCreationKey(actorId, creationKey);
        if (winner) return this.replay(winner, input);
      }
      throw err;
    }
  }

  private replay(existing: PlatformPayoutRow, input: { beneficiaryId: string; amount: number }) {
    if (existing.amount !== input.amount || existing.beneficiaryId !== input.beneficiaryId) {
      throw new PlatformPayoutRefusedError('IDEMPOTENCY_KEY_REUSED');
    }
    return { payout: payoutView(existing), replayed: true };
  }

  private requireWithinWithdrawable(withdrawable: Withdrawable, amount: number) {
    const blocker = withdrawable.blockers[0];
    if (blocker)
      throw new PlatformPayoutRefusedError(blocker, { withdrawable: withdrawable.amount });
    if (withdrawable.amount === null || amount > withdrawable.amount) {
      throw new PlatformPayoutRefusedError('AMOUNT_EXCEEDS_WITHDRAWABLE', {
        withdrawable: withdrawable.amount,
      });
    }
  }

  /** Approbation par un AUTRE administrateur : recalcul du retirable, puis réservation. */
  async approve(actorId: UserId, id: string, note?: string) {
    return this.deps.repository.withFundsLock(async (store) => {
      const payout = await this.requirePayout(store, id);
      this.requireTransition(payout, 'RESERVED');
      if (payout.initiatedBy === actorId) throw new PlatformPayoutRefusedError('SAME_ADMIN');
      const b = await store.findBeneficiary(payout.beneficiaryId);
      if (b?.status !== 'ACTIVE') throw new PlatformPayoutRefusedError('BENEFICIARY_NOT_ACTIVE');
      // Le retrait n'est pas encore réservé : il n'est pas compté dans le calcul.
      const { withdrawable } = await this.withdrawable(store);
      this.requireWithinWithdrawable(withdrawable, payout.amount);
      const now = this.clock();
      const updated = await this.transition(
        store,
        payout,
        'RESERVED',
        actorId,
        'APPROVED_AND_RESERVED',
        {
          approvedBy: actorId,
          approvedAt: now,
          ...(note && { decisionNote: note }),
        },
        { reserved: payout.amount + payout.estimatedFee, withdrawableBefore: withdrawable.amount },
      );
      await store.insertAudit(
        this.audit(actorId, 'PLATFORM_PAYOUT_APPROVED', 'PLATFORM_PAYOUT', id, {
          amount: payout.amount,
          reserved: payout.amount + payout.estimatedFee,
          ...(note && { note }),
        }),
      );
      return { id, status: updated.status };
    });
  }

  async reject(actorId: UserId, id: string, note: string) {
    return this.deps.repository.withFundsLock(async (store) => {
      const payout = await this.requirePayout(store, id);
      this.requireTransition(payout, 'REJECTED');
      if (payout.initiatedBy === actorId) throw new PlatformPayoutRefusedError('SAME_ADMIN');
      const updated = await this.transition(
        store,
        payout,
        'REJECTED',
        actorId,
        'REJECTED',
        {
          decidedBy: actorId,
          decisionNote: note,
          completedAt: this.clock(),
        },
        { note },
      );
      await store.insertAudit(
        this.audit(actorId, 'PLATFORM_PAYOUT_REJECTED', 'PLATFORM_PAYOUT', id, { note }),
      );
      return { id, status: updated.status };
    });
  }

  /** Annulation AVANT tout envoi (la réservation est libérée). */
  async cancel(actorId: UserId, id: string, note: string) {
    return this.deps.repository.withFundsLock(async (store) => {
      const payout = await this.requirePayout(store, id);
      this.requireTransition(payout, 'CANCELLED');
      if (payout.submissionAttempts > 0) throw new PlatformPayoutRefusedError('INVALID_TRANSITION');
      const updated = await this.transition(
        store,
        payout,
        'CANCELLED',
        actorId,
        'CANCELLED',
        {
          decidedBy: actorId,
          decisionNote: note,
          completedAt: this.clock(),
        },
        {
          note,
          released: payout.status === 'PENDING_APPROVAL' ? 0 : payout.amount + payout.estimatedFee,
        },
      );
      await store.insertAudit(
        this.audit(actorId, 'PLATFORM_PAYOUT_CANCELLED', 'PLATFORM_PAYOUT', id, {
          note,
          fromStatus: payout.status,
        }),
      );
      return { id, status: updated.status };
    });
  }

  /**
   * Mise en exécution d'un retrait réservé. Refusée (503, rien n'est écrit) tant que
   * l'exécution est désactivée ; sinon trésorerie confirmée et soldes positifs exigés.
   */
  async release(actorId: UserId, id: string) {
    if (!this.canSubmit) {
      throw new PlatformPayoutsDisabledError(this.deps.execution.reason ?? 'EXECUTION_DISABLED');
    }
    return this.deps.repository.withFundsLock(async (store) => {
      const payout = await this.requirePayout(store, id);
      this.requireTransition(payout, 'READY');
      await this.requireFundsStillCovered(store);
      const updated = await this.transition(
        store,
        payout,
        'READY',
        actorId,
        'RELEASED_FOR_EXECUTION',
        {
          releasedBy: actorId,
          releasedAt: this.clock(),
        },
      );
      await store.insertAudit(
        this.audit(actorId, 'PLATFORM_PAYOUT_RELEASED', 'PLATFORM_PAYOUT', id, {}),
      );
      return { id, status: updated.status };
    });
  }

  /** Engagements déjà comptés : trésorerie confirmée, ni revenu ni trésorerie libre négatifs. */
  private async requireFundsStillCovered(store: PlatformFinanceStore) {
    const { revenue, treasury } = await this.withdrawable(store);
    if (treasury.state !== 'CONFIRMED' || treasury.rawFree === null) {
      throw new PlatformPayoutRefusedError('TREASURY_NOT_CONFIRMED');
    }
    if (revenue.rawDistributable < 0 || treasury.rawFree < 0 || treasury.free === null) {
      throw new PlatformPayoutRefusedError('INCONSISTENT_DATA', {
        distributable: revenue.rawDistributable,
        free: treasury.rawFree,
      });
    }
  }

  // --- Exécution (exécuteur) ---------------------------------------------------------------

  /**
   * Envoie au plus `limit` retraits prêts. Désactivé : ne fait RIEN. Chaque retrait est
   * revendiqué par un UPDATE conditionnel (un seul exécuteur l'envoie, sur toutes les
   * instances), puis contrôlé AVANT l'envoi (trésorerie relue à l'instant, bénéficiaire actif).
   */
  async executeReady(limit = 5): Promise<{ submitted: number; deferred: number }> {
    const report = { submitted: 0, deferred: 0 };
    if (!this.canSubmit) return report;
    for (const candidate of await this.deps.repository.findReady(limit)) {
      const claimed = await this.deps.repository.withFundsLock(async (store) => {
        const now = this.clock();
        const updated = await store.updatePayout(
          candidate.id,
          { status: 'READY', version: candidate.version },
          { status: 'SUBMITTING', submissionAttempts: 1, submissionClaimedAt: now },
          now,
        );
        if (updated)
          await this.event(
            store,
            candidate.id,
            null,
            'SUBMISSION_CLAIMED',
            'READY',
            'SUBMITTING',
            {},
          );
        return updated;
      });
      if (!claimed) continue; // Un autre exécuteur l'a pris.
      if ((await this.submitClaimed(claimed)) === 'deferred') report.deferred += 1;
      else report.submitted += 1;
    }
    return report;
  }

  private async submitClaimed(payout: PlatformPayout): Promise<'sent' | 'deferred'> {
    // Contrôle préalable, rien n'est encore parti : en cas d'échec, retour à READY.
    const preflight = await this.preflight(payout);
    if (preflight) {
      await this.revertToReady(payout, preflight);
      return 'deferred';
    }
    const beneficiary = await this.deps.repository.findBeneficiary(payout.beneficiaryId);
    if (beneficiary?.status !== 'ACTIVE' || beneficiary.msisdnMasked !== payout.msisdnMasked) {
      await this.revertToReady(payout, 'BENEFICIARY_NOT_ACTIVE');
      return 'deferred';
    }
    let submission: TransferSubmission;
    try {
      submission = await this.deps.transfers.submit({
        merchantTransactionId: payout.merchantTransactionId,
        phoneNumber: beneficiary.msisdn,
        amount: payout.amount,
        currency: PLATFORM_PAYOUT_CURRENCY,
        operator: PLATFORM_PAYOUT_OPERATOR,
      });
    } catch (err) {
      submission = { kind: 'uncertain', errorCode: err instanceof Error ? err.name : 'UNKNOWN' };
    }
    await this.recordSubmission(payout, submission);
    if (submission.kind === 'not_sent') return 'deferred';
    // Relecture immédiate : l'acceptation n'est jamais un succès.
    await this.check(payout.id).catch(() => undefined);
    return 'sent';
  }

  /** Motif de report, ou null si l'envoi peut partir. Relit la trésorerie à l'instant. */
  private async preflight(payout: PlatformPayout): Promise<string | null> {
    if (!this.canSubmit) return 'EXECUTION_DISABLED';
    if (!this.deps.treasury.configured) return 'TREASURY_NOT_CONFIGURED';
    const observation = await this.deps.treasury.observe();
    if (observation.status !== 'VALID') return `TREASURY_${observation.status}`;
    try {
      await this.requireFundsStillCovered(this.deps.repository);
    } catch (err) {
      return err instanceof PlatformPayoutRefusedError ? err.reason : 'PREFLIGHT_FAILED';
    }
    return payout.status === 'SUBMITTING' ? null : 'NOT_CLAIMED';
  }

  private async revertToReady(payout: PlatformPayout, reason: string) {
    await this.deps.repository.withFundsLock(async (store) => {
      const current = await this.requirePayout(store, payout.id);
      if (current.status !== 'SUBMITTING') return;
      await this.transition(
        store,
        current,
        'READY',
        null,
        'SUBMISSION_DEFERRED',
        {
          submissionAttempts: 0,
          submissionClaimedAt: undefined,
          lastErrorCode: reason,
          lastErrorAt: this.clock(),
        },
        { reason },
      );
    });
    this.deps.logger.warn('platform payout deferred', { payoutId: payout.id, reason });
  }

  private async recordSubmission(payout: PlatformPayout, s: TransferSubmission) {
    await this.deps.repository.withFundsLock(async (store) => {
      const current = await this.requirePayout(store, payout.id);
      if (current.status !== 'SUBMITTING') return;
      const now = this.clock();
      if (s.kind === 'accepted') {
        await this.transition(
          store,
          current,
          'PROCESSING',
          null,
          'PROVIDER_ACCEPTED',
          {
            providerReference: s.providerReference,
            providerStatus: s.providerStatus,
            ...(s.notifyToken && { notifyTokenHash: sha256(s.notifyToken) }),
          },
          {
            providerStatus: s.providerStatus,
            ...(s.feeAmount !== undefined && { announcedFee: s.feeAmount }),
          },
        );
      } else if (s.kind === 'not_sent') {
        // Fait local certain : aucune requête de transfert n'est partie.
        await this.transition(
          store,
          current,
          'READY',
          null,
          'NOT_SENT',
          {
            submissionAttempts: 0,
            submissionClaimedAt: undefined,
            lastErrorCode: s.errorCode,
            lastErrorAt: now,
          },
          { errorCode: s.errorCode },
        );
      } else {
        const code =
          s.kind === 'rejected'
            ? `PROVIDER_REJECTED_${s.providerStatus}`.slice(0, 80)
            : s.kind === 'already_exists'
              ? 'TRANSACTION_EXIST'
              : s.errorCode.slice(0, 80);
        // Refus annoncé, doublon ou issue inconnue : rien n'est décidé, le transfert sera relu.
        await this.transition(
          store,
          current,
          'UNCERTAIN',
          null,
          'SUBMISSION_OUTCOME_UNKNOWN',
          {
            lastErrorCode: code,
            lastErrorAt: now,
          },
          { kind: s.kind, code },
        );
      }
    });
  }

  /** Envoi revendiqué sans résultat (arrêt pendant l'appel) : issue inconnue, jamais renvoyé. */
  async recoverStaleSubmissions(): Promise<number> {
    const before = new Date(this.clock().getTime() - SUBMISSION_STALE_MS);
    let count = 0;
    for (const payout of await this.deps.repository.findStaleSubmitting(before)) {
      await this.deps.repository.withFundsLock(async (store) => {
        const current = await this.requirePayout(store, payout.id);
        if (current.status !== 'SUBMITTING') return;
        await this.transition(store, current, 'UNCERTAIN', null, 'SUBMISSION_INTERRUPTED', {
          lastErrorCode: 'SUBMISSION_INTERRUPTED',
          lastErrorAt: this.clock(),
        });
        count += 1;
      });
    }
    return count;
  }

  // --- Relecture et réconciliation ---------------------------------------------------------

  /**
   * Relit le transfert chez CinetPay par NOTRE référence et applique son statut. Le seul
   * chemin vers SUCCEEDED / FAILED (notification, exécuteur, administration).
   */
  async check(id: string): Promise<{ outcome: CheckOutcome; status: PlatformPayoutStatus }> {
    const before = await this.deps.repository.findPayout(id);
    if (!before) throw new PlatformPayoutNotFoundError();
    if (isFinalPayoutStatus(before.status))
      return { outcome: 'already_final', status: before.status };
    if (!LOOKUP_STATUSES.includes(before.status))
      return { outcome: 'not_checkable', status: before.status };
    if (!this.deps.transfers.canLookup) throw new TreasuryProviderUnavailableError();

    let lookup: Awaited<ReturnType<TransferGateway['lookup']>>;
    try {
      lookup = await this.deps.transfers.lookup(before.merchantTransactionId);
    } catch (err) {
      await this.deps.repository.withFundsLock(async (store) => {
        const current = await this.requirePayout(store, id);
        if (!LOOKUP_STATUSES.includes(current.status)) return;
        await store.updatePayout(
          id,
          current,
          {
            lastCheckedAt: this.clock(),
            lastErrorCode: 'LOOKUP_FAILED',
            lastErrorAt: this.clock(),
          },
          this.clock(),
        );
      });
      throw err;
    }

    return this.deps.repository.withFundsLock(async (store) => {
      const p = await this.requirePayout(store, id);
      if (isFinalPayoutStatus(p.status))
        return { outcome: 'already_final' as const, status: p.status };
      if (!LOOKUP_STATUSES.includes(p.status))
        return { outcome: 'not_checkable' as const, status: p.status };
      const now = this.clock();

      if (!lookup.found) {
        // NOT_FOUND n'est jamais une preuve de non-exécution : le retrait reste ouvert, fonds
        // réservés ; après 24 h sans preuve, un rapprochement est requis.
        const aged =
          now.getTime() - (p.submissionClaimedAt ?? p.createdAt).getTime() >=
          UNCERTAIN_ESCALATION_MS;
        if (aged && p.status !== 'RECONCILIATION_REQUIRED') {
          const result =
            p.status === 'PROCESSING' ? 'ACCEPTED_THEN_NOT_FOUND' : 'NOT_FOUND_UNPROVEN';
          await this.transition(
            store,
            p,
            'RECONCILIATION_REQUIRED',
            null,
            'RECONCILIATION_REQUIRED',
            {
              lastCheckedAt: now,
              notFoundChecks: p.notFoundChecks + 1,
              reconciliationResult: result,
            },
            { result },
          );
          return {
            outcome: 'reconciliation_required' as const,
            status: 'RECONCILIATION_REQUIRED' as const,
          };
        }
        await store.updatePayout(
          id,
          p,
          { lastCheckedAt: now, notFoundChecks: p.notFoundChecks + 1 },
          now,
        );
        return { outcome: 'not_found' as const, status: p.status };
      }

      const mismatch =
        lookup.merchantTransactionId !== p.merchantTransactionId ||
        (p.providerReference !== undefined && lookup.providerReference !== p.providerReference) ||
        (lookup.amount !== undefined && lookup.amount !== p.amount) ||
        (lookup.currency !== undefined && lookup.currency !== PLATFORM_PAYOUT_CURRENCY);
      if (mismatch) {
        if (p.status !== 'RECONCILIATION_REQUIRED') {
          await this.transition(
            store,
            p,
            'RECONCILIATION_REQUIRED',
            null,
            'PROVIDER_MISMATCH',
            {
              lastCheckedAt: now,
              providerStatus: lookup.providerStatus,
              reconciliationResult: 'PROVIDER_MISMATCH',
            },
            { providerStatus: lookup.providerStatus },
          );
        }
        return {
          outcome: 'reconciliation_required' as const,
          status: 'RECONCILIATION_REQUIRED' as const,
        };
      }

      const outcome = finalPayoutOutcome(lookup.providerStatus);
      const common: PayoutChanges = {
        lastCheckedAt: now,
        providerStatus: lookup.providerStatus,
        ...(p.providerReference === undefined && { providerReference: lookup.providerReference }),
      };
      if (outcome) {
        const fee = lookup.feeAmount === undefined ? undefined : Math.ceil(lookup.feeAmount);
        await this.transition(
          store,
          p,
          outcome,
          null,
          outcome === 'SUCCEEDED' ? 'PROVIDER_CONFIRMED_SUCCESS' : 'PROVIDER_CONFIRMED_FAILURE',
          {
            ...common,
            completedAt: now,
            reconciliationResult:
              outcome === 'SUCCEEDED' ? 'CONFIRMED_SUCCESS' : `CONFIRMED_${lookup.providerStatus}`,
            ...(outcome === 'SUCCEEDED' && { finalAmount: lookup.amount ?? p.amount }),
            ...(fee !== undefined && Number.isSafeInteger(fee) && { finalFee: fee }),
          },
          { providerStatus: lookup.providerStatus, ...(fee !== undefined && { fee }) },
        );
        this.deps.logger.info('platform payout settled', { payoutId: id, status: outcome });
        return { outcome: 'settled' as const, status: outcome };
      }
      if (p.status !== 'PROCESSING') {
        await this.transition(store, p, 'PROCESSING', null, 'PROVIDER_PROCESSING', common, {
          providerStatus: lookup.providerStatus,
        });
      } else {
        await store.updatePayout(id, p, common, now);
      }
      return { outcome: 'processing' as const, status: 'PROCESSING' as const };
    });
  }

  /**
   * Rapprochement demandé par un administrateur : relecture de la trésorerie et des retraits
   * ouverts, reprise des envois interrompus. N'ENVOIE JAMAIS de transfert.
   */
  async reconcile(actorId: UserId) {
    const recovered = await this.recoverStaleSubmissions();
    const treasury = this.deps.treasury.configured
      ? await this.deps.treasury.observe(actorId)
      : null;
    const results: { id: string; outcome: string; status: string }[] = [];
    if (this.canLookup) {
      const open = await this.deps.repository.findForLookup({
        limit: 50,
        checkedBefore: this.clock(),
      });
      for (const p of open) {
        try {
          results.push({ id: p.id, ...(await this.check(p.id)) });
        } catch {
          results.push({ id: p.id, outcome: 'error', status: p.status });
        }
      }
    }
    const runId = randomUUID();
    const summary = {
      runId,
      treasury: treasury
        ? { id: treasury.id, status: treasury.status, errorCode: treasury.errorCode ?? null }
        : null,
      treasuryProviderConfigured: this.deps.treasury.configured,
      transferLookupConfigured: this.canLookup,
      recoveredSubmissions: recovered,
      checked: results.length,
      results,
    };
    await this.deps.repository.insertAudit(
      this.audit(actorId, 'PLATFORM_PAYOUT_RECONCILED', 'TREASURY', runId, {
        treasuryStatus: treasury?.status ?? 'NOT_CONFIGURED',
        checked: results.length,
        recoveredSubmissions: recovered,
      }),
    );
    return summary;
  }

  /** Relecture du solde demandée par un administrateur (auditée), sans autre effet. */
  async observeTreasury(actorId: UserId) {
    const observation = await this.deps.treasury.observe(actorId);
    await this.deps.repository.insertAudit(
      this.audit(actorId, 'TREASURY_OBSERVED', 'TREASURY', observation.id, {
        status: observation.status,
        ...(observation.errorCode && { errorCode: observation.errorCode }),
      }),
    );
    return observation;
  }

  /**
   * Notification CinetPay : jeton comparé à son empreinte (temps constant), puis statut RELU.
   * Le corps n'est jamais cru : il ne fait que déclencher une relecture.
   */
  async handleNotification(body: unknown) {
    const field = (key: string) =>
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)[key]
        : undefined;
    const token = field('notify_token');
    const reference = field('merchant_transaction_id');
    if (
      typeof token !== 'string' ||
      typeof reference !== 'string' ||
      !/^LP[0-9a-f]{26}$/.test(reference)
    ) {
      throw new PlatformPayoutNotificationRejectedError('MALFORMED');
    }
    const payout = await this.deps.repository.findPayoutByReference(reference);
    if (!payout?.notifyTokenHash) throw new PlatformPayoutNotificationRejectedError('UNKNOWN');
    const expected = Buffer.from(payout.notifyTokenHash, 'hex');
    const actual = Buffer.from(sha256(token), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new PlatformPayoutNotificationRejectedError('TOKEN_MISMATCH');
    }
    const result = await this.check(payout.id);
    return { status: result.status };
  }

  // --- Utilitaires ---------------------------------------------------------------------------

  private async requirePayout(store: PlatformFinanceStore, id: string) {
    const payout = await store.findPayout(id);
    if (!payout) throw new PlatformPayoutNotFoundError();
    return payout;
  }

  private requireTransition(payout: PlatformPayout, to: PlatformPayoutStatus) {
    if (!canTransition(payout.status, to)) {
      throw new PlatformPayoutRefusedError('INVALID_TRANSITION', { from: payout.status, to });
    }
  }

  /** Transition validée + écriture conditionnelle (version) + événement d'historique. */
  private async transition(
    store: PlatformFinanceStore,
    payout: PlatformPayout,
    to: PlatformPayoutStatus,
    actorId: UserId | null,
    event: string,
    changes: PayoutChanges,
    details: Record<string, unknown> = {},
  ): Promise<PlatformPayout> {
    this.requireTransition(payout, to);
    const updated = await store.updatePayout(
      payout.id,
      { status: payout.status, version: payout.version },
      { ...changes, status: to },
      this.clock(),
    );
    if (!updated) throw new PlatformPayoutRefusedError('CONCURRENT_UPDATE');
    await this.event(store, payout.id, actorId, event, payout.status, to, details);
    return updated;
  }

  private event(
    store: PlatformFinanceStore,
    payoutId: string,
    actorId: UserId | null,
    event: string,
    fromStatus: PlatformPayoutStatus | null,
    toStatus: PlatformPayoutStatus | null,
    details: Record<string, unknown>,
  ) {
    return store.insertEvent({
      id: randomUUID(),
      payoutId,
      actorId,
      event,
      fromStatus,
      toStatus,
      details,
      createdAt: this.clock(),
    });
  }

  private audit(
    actorId: UserId,
    action: AuditAction,
    targetType: AuditEntry['targetType'],
    targetId: string,
    details: Record<string, unknown>,
  ): AuditEntry {
    return {
      id: randomUUID(),
      actorId,
      action,
      targetType,
      targetId,
      outcome: 'SUCCESS',
      details,
      createdAt: this.clock(),
    };
  }
}
