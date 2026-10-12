import { randomUUID } from 'node:crypto';

import { AdminIdempotencyConflictError, type AuditEntry } from '../../domain/admin/admin';
import type { UserId } from '../../domain/users/user';
import {
  isFinalWithdrawalStatus,
  WITHDRAWAL_OPERATOR_LABELS,
  WithdrawalNotFoundError,
  WithdrawalVerificationError,
} from '../../domain/wallet/withdrawal';
import type { AdminAuditRepository } from '../../repositories/admin-audit.repository';
import type {
  AdminWithdrawalQuery,
  AdminWithdrawalRow,
} from '../../repositories/withdrawal.repository';
import type { Logger } from '../../utils/logger';
import type { WithdrawalService } from './withdrawal.service';

const iso = (d: Date | undefined) => d?.toISOString() ?? null;

const RECONCILIATION_ACTIONS: ReadonlySet<string> = new Set([
  'WITHDRAWAL_VERIFICATION_REQUESTED',
  'WITHDRAWAL_ESCALATED',
  'WITHDRAWAL_REFUND_PROPOSED',
  'WITHDRAWAL_REFUND_APPROVED',
  'WITHDRAWAL_REFUND_REJECTED',
]);

/** Ce que l'administration voit d'un retrait : numéro masqué, codes d'erreur sans secret. */
function adminView(w: AdminWithdrawalRow) {
  return {
    id: w.id,
    reference: w.merchantTransactionId,
    providerReference: w.providerReference ?? null,
    user: { id: w.userId, username: w.username },
    operator: w.operator,
    operatorLabel: WITHDRAWAL_OPERATOR_LABELS[w.operator],
    msisdn: w.msisdnMasked,
    tokens: w.tokens,
    amount: w.amount,
    currency: w.currency,
    /** Frais annoncés par CinetPay (compte marchand), s'ils ont été renvoyés. */
    providerFee: w.feeAmount ?? null,
    status: w.status,
    providerStatus: w.providerStatus ?? null,
    failureCode: w.failureCode ?? null,
    lastErrorCode: w.lastErrorCode ?? null,
    lastErrorAt: iso(w.lastErrorAt),
    createdAt: iso(w.createdAt),
    completedAt: iso(w.completedAt),
  };
}

/**
 * Administration des retraits (D-075, D-061) : consultation (auditée) et revérification
 * CONTRÔLÉE auprès de CinetPay (même `WithdrawalService.check` que la réconciliation,
 * auditée, idempotente). Aucune action ne permet de déclarer un retrait réussi ou échoué :
 * seul le statut relu chez le fournisseur fait foi.
 */
export class WithdrawalAdminService {
  private readonly clock: () => Date;

  constructor(
    private readonly deps: {
      withdrawals: WithdrawalService;
      audit: AdminAuditRepository;
      logger: Logger;
      clock?: () => Date;
    },
  ) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async list(query: AdminWithdrawalQuery) {
    const { total, items } = await this.deps.withdrawals.listForAdmin(query);
    return { page: query.page, limit: query.limit, total, items: items.map(adminView) };
  }

  async get(id: string, actorId: UserId) {
    const withdrawal = await this.deps.withdrawals.findForAdmin(id);
    if (!withdrawal) throw new WithdrawalNotFoundError();
    await this.deps.audit.insert({
      id: randomUUID(),
      actorId,
      action: 'WITHDRAWAL_VIEWED',
      targetType: 'WITHDRAWAL',
      targetId: id,
      outcome: 'SUCCESS',
      details: {},
      createdAt: this.clock(),
    });
    const verifications = await this.deps.audit.list({
      page: 1,
      limit: 20,
      action: 'WITHDRAWAL_VERIFICATION_REQUESTED',
      targetId: id,
    });
    return {
      ...adminView(withdrawal),
      walletTransaction: {
        id: withdrawal.walletTransactionId,
        status: withdrawal.walletTransactionStatus,
      },
      submission: {
        attempts: withdrawal.submissionAttempts,
        lastAttemptAt: iso(withdrawal.submissionAttemptedAt),
        lastCheckedAt: iso(withdrawal.lastCheckedAt),
      },
      verification: {
        available: !isFinalWithdrawalStatus(withdrawal.status) && this.deps.withdrawals.canLookup,
        providerConfigured: this.deps.withdrawals.canLookup,
        history: verifications.items.map((e) => ({
          id: e.id,
          action: e.action,
          outcome: e.outcome,
          target: { type: e.targetType, id: e.targetId },
          actor: e.actorId ? { id: e.actorId, username: e.actorUsername } : null,
          details: e.details,
          createdAt: e.createdAt.toISOString(),
        })),
      },
      reconciliation: await this.reconciliationView(withdrawal),
    };
  }

  /**
   * Rapprochement (D-076) : demandes de remboursement, escalades et décisions. Aucune action
   * ne permet de déclarer un retrait réussi ; un remboursement exige deux administrateurs.
   */
  private async reconciliationView(withdrawal: AdminWithdrawalRow) {
    const [requests, events] = await Promise.all([
      this.deps.withdrawals.listRefundRequests(withdrawal.id),
      this.deps.audit.list({ page: 1, limit: 100, targetType: 'WITHDRAWAL', targetId: withdrawal.id }),
    ]);
    const usernames = new Map(
      events.items.filter((e) => e.actorId).map((e) => [e.actorId!, e.actorUsername]),
    );
    const open = !isFinalWithdrawalStatus(withdrawal.status);
    const eligibleFrom = this.deps.withdrawals.refundEligibleFrom(withdrawal);
    return {
      open,
      /** Remboursement manuel proposable à partir de cette date (24 h après le dernier envoi). */
      refundEligibleFrom: eligibleFrom.toISOString(),
      canProposeRefund:
        open &&
        this.clock() >= eligibleFrom &&
        this.deps.withdrawals.canLookup &&
        !requests.some((r) => r.status === 'PENDING'),
      newTransfersEnabled: this.deps.withdrawals.available,
      refundRequests: requests.map((r) => ({
        id: r.id,
        status: r.status,
        providerTicket: r.providerTicket,
        justification: r.justification,
        proposedBy: { id: r.proposedBy, username: usernames.get(r.proposedBy) ?? null },
        proposedAt: r.proposedAt.toISOString(),
        providerStatusAtProposal: r.providerStatusAtProposal,
        decidedBy: r.decidedBy
          ? { id: r.decidedBy, username: usernames.get(r.decidedBy) ?? null }
          : null,
        decidedAt: iso(r.decidedAt),
        decisionNote: r.decisionNote ?? null,
        providerStatusAtDecision: r.providerStatusAtDecision ?? null,
      })),
      events: events.items
        .filter((e) => RECONCILIATION_ACTIONS.has(e.action))
        .map((e) => ({
          id: e.id,
          action: e.action,
          outcome: e.outcome,
          target: { type: e.targetType, id: e.targetId },
          actor: e.actorId ? { id: e.actorId, username: e.actorUsername } : null,
          details: e.details,
          createdAt: e.createdAt.toISOString(),
        })),
    };
  }

  /**
   * Escalade vers le fournisseur : trace auditée (référence du ticket CinetPay, note). Ne
   * change ni le retrait ni le solde.
   */
  async escalate(id: string, actorId: UserId, input: { providerTicket?: string; note: string }) {
    if (!(await this.deps.withdrawals.findForAdmin(id))) throw new WithdrawalNotFoundError();
    await this.deps.audit.insert({
      id: randomUUID(),
      actorId,
      action: 'WITHDRAWAL_ESCALATED',
      targetType: 'WITHDRAWAL',
      targetId: id,
      outcome: 'SUCCESS',
      details: { ...(input.providerTicket && { providerTicket: input.providerTicket }), note: input.note },
      createdAt: this.clock(),
    });
    this.deps.logger.info('withdrawal escalated', { withdrawalId: id, actorId });
    return { escalated: true };
  }

  /** Proposition de remboursement (1er administrateur), après relecture fraîche. */
  async proposeRefund(
    id: string,
    actorId: UserId,
    input: { providerTicket: string; justification: string },
  ) {
    const result = await this.deps.withdrawals.proposeRefund(id, actorId, input);
    return result.outcome === 'proposed'
      ? { outcome: result.outcome, requestId: result.request.id, status: result.request.status }
      : result;
  }

  /** Approbation (2e administrateur, relecture fraîche, remboursement unique) ou rejet. */
  async decideRefund(
    id: string,
    requestId: string,
    actorId: UserId,
    input: { approve: boolean; note?: string },
  ) {
    const { request, withdrawal } = await this.deps.withdrawals.decideRefund(
      id,
      requestId,
      actorId,
      input,
    );
    return { requestId: request.id, requestStatus: request.status, withdrawalStatus: withdrawal.status };
  }

  /**
   * Revérification auprès de CinetPay (serveur à serveur), auditée. La même Idempotency-Key
   * rejouée renvoie le résultat déjà obtenu, sans nouvel appel.
   */
  async verify(id: string, idempotencyKey: string, actorId: UserId) {
    const previous = await this.deps.audit.findVerification(
      idempotencyKey,
      'WITHDRAWAL_VERIFICATION_REQUESTED',
    );
    if (previous) {
      if (previous.targetId !== id) throw new AdminIdempotencyConflictError();
      return { replayed: true, ...(previous.details.result as Record<string, unknown>) };
    }
    if (!(await this.deps.withdrawals.findForAdmin(id))) throw new WithdrawalNotFoundError();
    let result: Record<string, unknown>;
    let outcome: AuditEntry['outcome'] = 'SUCCESS';
    if (!this.deps.withdrawals.canLookup) {
      outcome = 'FAILURE';
      result = { outcome: 'error', reason: 'provider_not_configured' };
    } else {
      try {
        const checked = await this.deps.withdrawals.check(id);
        result = { outcome: checked.outcome, status: checked.status };
      } catch (err) {
        outcome = 'FAILURE';
        result = {
          outcome: 'error',
          reason: err instanceof WithdrawalVerificationError ? err.reason : 'provider_error',
        };
      }
    }
    await this.deps.audit.insert({
      id: randomUUID(),
      actorId,
      action: 'WITHDRAWAL_VERIFICATION_REQUESTED',
      targetType: 'WITHDRAWAL',
      targetId: id,
      outcome,
      details: { idempotencyKey, result },
      createdAt: this.clock(),
    });
    this.deps.logger.info('admin withdrawal verification', { withdrawalId: id, actorId, ...result });
    return { replayed: false, ...result };
  }
}
