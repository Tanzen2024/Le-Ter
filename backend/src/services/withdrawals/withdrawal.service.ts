import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { UserId } from '../../domain/users/user';
import {
  IdempotencyKeyReusedError,
  maskPhone,
  MobileMoneyUnavailableError,
} from '../../domain/wallet/wallet';
import {
  amountForWithdrawal,
  finalOutcomeOfTransferStatus,
  isFinalWithdrawalStatus,
  isSupportedWithdrawalPhone,
  MANUAL_REFUND_MIN_AGE_MS,
  MAX_WITHDRAWAL_TOKENS,
  MIN_WITHDRAWAL_TOKENS,
  PAID_AFTER_REFUND,
  WITHDRAWAL_CURRENCY,
  WITHDRAWAL_OPERATOR_LABELS,
  WITHDRAWAL_OPERATORS,
  WithdrawalAccountBlockedError,
  WithdrawalNotFoundError,
  WithdrawalNotificationRejectedError,
  WithdrawalPhoneUnsupportedError,
  WithdrawalProviderUnavailableError,
  WithdrawalRefundRefusedError,
  WithdrawalVerificationError,
  type Withdrawal,
  type WithdrawalLimit,
  type WithdrawalOperator,
  type WithdrawalRefundRequest,
  type WithdrawalStatus,
} from '../../domain/wallet/withdrawal';
import type { UserRepository } from '../../repositories/user.repository';
import {
  DuplicateIdempotencyKeyError,
  type WalletRepository,
} from '../../repositories/wallet.repository';
import type {
  AdminWithdrawalQuery,
  WithdrawalRepository,
} from '../../repositories/withdrawal.repository';
import type { Logger } from '../../utils/logger';
import { ValidationError } from '../../validators/validation-error';
import { hashNotifyToken } from '../payments/cinetpay/cinetpay.gateway';
import type { TransferGateway, TransferLookup } from './transfer.gateway';
import type {
  WithdrawalAvailability,
  WithdrawalMode,
  WithdrawalUnavailableReason,
} from './withdrawal-availability';

/** Codes d'échec définitif enregistrés sur le retrait (et sa transaction du compte de jeu). */
export const WITHDRAWAL_FAILURE = {
  /** Statut final d'échec relu chez le fournisseur. */
  FAILED: 'PROVIDER_FAILED',
} as const;

/** Erreurs techniques notées sur un retrait resté ouvert (jamais un échec, jamais remboursé). */
export const WITHDRAWAL_CHECK_ERROR = {
  /** Transfert introuvable chez le fournisseur alors qu'un envoi a été tenté. */
  NOT_FOUND: 'PROVIDER_NOT_FOUND',
  /**
   * Refus annoncé par le fournisseur à la création : PAS une preuve de non-exécution. Le
   * retrait reste ouvert jusqu'à un statut final relu ou un rapprochement (D-076).
   */
  REJECTED: 'PROVIDER_REJECTED',
  /** Numéro d'inscription différent de celui du retrait : envoi différé refusé. */
  RECIPIENT_CHANGED: 'RECIPIENT_CHANGED',
  /** Nouveaux transferts désactivés : un retrait jamais envoyé attend leur réactivation. */
  TRANSFERS_DISABLED: 'TRANSFERS_DISABLED',
  /** Statut relu incohérent (référence, montant ou devise). */
  MISMATCH: 'PROVIDER_MISMATCH',
  /** Fournisseur injoignable ou réponse illisible pendant une relecture. */
  LOOKUP_FAILED: 'PROVIDER_LOOKUP_FAILED',
} as const;

export interface WithdrawalServiceOptions {
  /**
   * Délai après un envoi d'issue inconnue avant de le renvoyer, si — et seulement si — la
   * relecture officielle répond que le transfert n'existe pas. Le renvoi réutilise la MÊME
   * référence marchande : un doublon est refusé par CinetPay (TRANSACTION_EXIST).
   */
  resubmitAfterMs?: number;
  /**
   * Envois au plus par retrait (1 par défaut : AUCUN renvoi automatique). Au-delà,
   * rapprochement administratif. À relever (2 ou 3) seulement après confirmation en sandbox
   * que `NOT_FOUND` est fiable et qu'une référence réutilisée est refusée (TRANSACTION_EXIST).
   */
  maxSubmissionAttempts?: number;
  /** Lecture joueur : relecture fournisseur au plus une fois par intervalle. */
  readRecheckMs?: number;
}

export const DEFAULT_RESUBMIT_AFTER_MS = 10 * 60_000;
export const DEFAULT_MAX_SUBMISSION_ATTEMPTS = 1;
const DEFAULT_READ_RECHECK_MS = 15_000;
const HISTORY_LIMIT = 50;
const MERCHANT_ID_PREFIX = 'LW';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_NOTIFICATION_FIELD_LENGTH = 256;

/** Référence marchande et référence affichée au joueur : 28 caractères, aucune donnée personnelle. */
const newMerchantTransactionId = () => `${MERCHANT_ID_PREFIX}${randomBytes(13).toString('hex')}`;

/** Ce que le joueur voit d'un retrait : numéro masqué, jamais de référence fournisseur. */
export interface WithdrawalView {
  id: string;
  reference: string;
  status: WithdrawalStatus;
  tokens: number;
  amount: number;
  currency: typeof WITHDRAWAL_CURRENCY;
  operator: WithdrawalOperator;
  operatorLabel: string;
  msisdn: string;
  /** Retrait ouvert dont l'issue est en cours de vérification (jetons toujours réservés). */
  underReview: boolean;
  failureCode?: string;
  createdAt: string;
  completedAt?: string;
}

export function toWithdrawalView(w: Withdrawal): WithdrawalView {
  return {
    id: w.id,
    reference: w.merchantTransactionId,
    status: w.status,
    tokens: w.tokens,
    amount: w.amount,
    currency: w.currency,
    operator: w.operator,
    operatorLabel: WITHDRAWAL_OPERATOR_LABELS[w.operator],
    msisdn: w.msisdnMasked,
    underReview: !isFinalWithdrawalStatus(w.status) && w.lastErrorCode !== undefined,
    ...(w.failureCode && { failureCode: w.failureCode }),
    createdAt: w.createdAt.toISOString(),
    ...(w.completedAt && { completedAt: w.completedAt.toISOString() }),
  };
}

export interface WithdrawalPolicyView {
  available: boolean;
  /** `sandbox` : transferts simulés par CinetPay, aucun fonds réel (D-077). */
  mode: WithdrawalMode;
  /** Motif stable quand `mode` vaut `unavailable`. */
  unavailableReason?: WithdrawalUnavailableReason;
  minTokens: number;
  maxTokens: number;
  currency: typeof WITHDRAWAL_CURRENCY;
  /** 1 jeton = 1 FCFA (D-075). */
  tokensPerUnit: 1;
  /** Aucuns frais Le Ter configurés ; les frais du fournisseur ne sont pas prélevés sur le joueur. */
  platformFeeTokens: 0;
  operators: { code: WithdrawalOperator; label: string }[];
  /** Numéro d'inscription masqué : seul destinataire possible. */
  msisdn: string;
  /** Faux si le numéro d'inscription n'est pas un numéro camerounais (+237). */
  msisdnSupported: boolean;
  limit: WithdrawalLimit & {
    used: number;
    /** Retraits encore possibles maintenant ; `null` = illimité. */
    remaining: number | null;
    /** Date à laquelle une place se libère (fenêtre glissante), si le quota est atteint. */
    nextAvailableAt: string | null;
  };
}

export interface WithdrawalResult {
  withdrawal: WithdrawalView;
  balance: { balance: number; reserved: number; available: number };
  replayed: boolean;
}

export type CheckOutcome = 'settled' | 'processing' | 'unresolved' | 'already_final';

/** Résultat d'une proposition de remboursement (D-076). */
export type RefundProposalResult =
  | { outcome: 'proposed'; request: WithdrawalRefundRequest }
  /** CinetPay a confirmé un échec final : remboursé par le règlement normal, sans demande. */
  | { outcome: 'settled_by_provider'; status: WithdrawalStatus };

/**
 * Retraits Mobile Money (D-075, D-076). Invariants :
 *
 * - le serveur décide seul : montant (entier, ≥ 1 000 jetons), destinataire (numéro
 *   d'inscription), quota, solde, compte actif ; rien n'est lu du client hormis le montant et
 *   l'opérateur ;
 * - création atomique (verrou du portefeuille → quota → solde → débit → retrait) ;
 * - un retrait n'est réglé AUTOMATIQUEMENT que par un statut FINAL relu chez le fournisseur
 *   (notification, réconciliation, lecture, administration : MÊME `verify`). Un message
 *   d'erreur à la création n'est jamais une preuve : aucun remboursement automatique ;
 * - une issue inconnue reste ouverte (jetons réservés) ; elle n'en sort que par un statut final
 *   relu, ou par un remboursement à DOUBLE VALIDATION appuyé sur une confirmation écrite du
 *   fournisseur et une relecture « introuvable » (D-076) ;
 * - nouveaux transferts (`canSubmit`) et relecture des transferts existants (`canLookup`) sont
 *   séparés : désactiver les premiers n'interrompt jamais la réconciliation et n'en envoie
 *   aucun.
 *
 * Jamais journalisés : numéro de téléphone, `notify_token`, identifiants CinetPay.
 */
export class WithdrawalService {
  private readonly clock: () => Date;
  private readonly options: Required<WithdrawalServiceOptions>;
  private readonly lastReads = new Map<string, number>();

  constructor(
    private readonly deps: {
      withdrawals: WithdrawalRepository;
      wallets: Pick<WalletRepository, 'findByIdempotencyKey' | 'getBalances'>;
      users: Pick<UserRepository, 'findById'>;
      gateway: TransferGateway;
      logger: Logger;
      /**
       * État décidé au démarrage (`resolveWithdrawalAvailability`, D-077). Absent : `sandbox`
       * si la passerelle peut envoyer (tests, transferts simulés), sinon indisponible.
       */
      availability?: WithdrawalAvailability;
      clock?: () => Date;
      options?: WithdrawalServiceOptions;
    },
  ) {
    this.clock = deps.clock ?? (() => new Date());
    this.options = {
      resubmitAfterMs: deps.options?.resubmitAfterMs ?? DEFAULT_RESUBMIT_AFTER_MS,
      maxSubmissionAttempts: deps.options?.maxSubmissionAttempts ?? DEFAULT_MAX_SUBMISSION_ATTEMPTS,
      readRecheckMs: deps.options?.readRecheckMs ?? DEFAULT_READ_RECHECK_MS,
    };
  }

  /**
   * État des nouveaux retraits. Une passerelle qui ne peut pas envoyer l'emporte toujours :
   * jamais « disponible » sans envoi possible.
   */
  get availability(): WithdrawalAvailability {
    const configured = this.deps.availability;
    const warnings = configured?.warnings ?? [];
    if (!this.deps.gateway.canSubmit || configured?.mode === 'unavailable') {
      const reason: WithdrawalUnavailableReason =
        configured?.reason ??
        (this.deps.gateway.canLookup ? 'TRANSFERS_DISABLED' : 'PROVIDER_NOT_CONFIGURED');
      return { mode: 'unavailable', reason, warnings };
    }
    return configured ?? { mode: 'sandbox', warnings };
  }

  /** Nouvelles demandes de retrait acceptées (sandbox ou production validée). */
  get available(): boolean {
    return this.availability.mode !== 'unavailable';
  }

  /** Relecture des transferts existants possible (même transferts désactivés). */
  get canLookup(): boolean {
    return this.deps.gateway.canLookup;
  }

  // --- Joueur ----------------------------------------------------------------------------------

  async policy(userId: UserId): Promise<WithdrawalPolicyView> {
    const now = this.clock();
    const [user, usage] = await Promise.all([
      this.deps.users.findById(userId),
      this.deps.withdrawals.quotaUsage(userId, now),
    ]);
    const { limit, used, oldestCountedAt } = usage;
    const remaining = limit.count === null ? null : Math.max(limit.count - used, 0);
    const nextAvailableAt =
      remaining === 0 && limit.periodMinutes !== null && oldestCountedAt
        ? new Date(oldestCountedAt.getTime() + limit.periodMinutes * 60_000).toISOString()
        : null;
    const { mode, reason } = this.availability;
    return {
      available: mode !== 'unavailable',
      mode,
      ...(reason && { unavailableReason: reason }),
      minTokens: MIN_WITHDRAWAL_TOKENS,
      maxTokens: MAX_WITHDRAWAL_TOKENS,
      currency: WITHDRAWAL_CURRENCY,
      tokensPerUnit: 1,
      platformFeeTokens: 0,
      operators: WITHDRAWAL_OPERATORS.map((code) => ({
        code,
        label: WITHDRAWAL_OPERATOR_LABELS[code],
      })),
      msisdn: user ? maskPhone(user.phone) : '',
      msisdnSupported: user ? isSupportedWithdrawalPhone(user.phone) : false,
      limit: { ...limit, used, remaining, nextAvailableAt },
    };
  }

  /**
   * Demande de retrait. Précondition : `tokens` et `operator` validés par le contrôleur
   * (`parseWithdrawalInput`). Même Idempotency-Key : même retrait, aucune nouvelle écriture.
   */
  async request(
    userId: UserId,
    input: { tokens: number; operator: WithdrawalOperator },
    idempotencyKey: string,
  ): Promise<WithdrawalResult> {
    const replayed = await this.replay(userId, input, idempotencyKey);
    if (replayed) return replayed;
    // Toutes les conditions sont vérifiées AVANT toute écriture.
    if (!this.available) throw new MobileMoneyUnavailableError();
    const user = await this.deps.users.findById(userId);
    if (!user || user.status !== 'active') throw new WithdrawalAccountBlockedError();
    if (!isSupportedWithdrawalPhone(user.phone)) throw new WithdrawalPhoneUnsupportedError();

    const now = this.clock();
    const withdrawal: Withdrawal = {
      id: randomUUID(),
      userId,
      walletTransactionId: randomUUID(),
      provider: 'cinetpay',
      operator: input.operator,
      msisdnMasked: maskPhone(user.phone),
      tokens: input.tokens,
      amount: amountForWithdrawal(input.tokens),
      currency: WITHDRAWAL_CURRENCY,
      status: 'CREATED',
      merchantTransactionId: newMerchantTransactionId(),
      submissionAttempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    try {
      // Lève WithdrawalLimitReachedError ou InsufficientBalanceError : rien n'est écrit.
      await this.deps.withdrawals.create({ withdrawal, idempotencyKey });
    } catch (err) {
      if (err instanceof DuplicateIdempotencyKeyError) {
        // Double soumission simultanée : l'autre requête a créé le retrait.
        const existing = await this.replay(userId, input, idempotencyKey);
        if (existing) return existing;
        throw new IdempotencyKeyReusedError();
      }
      throw err;
    }
    this.deps.logger.info('withdrawal created', {
      withdrawalId: withdrawal.id,
      userId,
      tokens: withdrawal.tokens,
      operator: withdrawal.operator,
    });
    // L'envoi n'échoue jamais la requête : une issue inconnue laisse le retrait ouvert.
    const current = await this.submit(withdrawal, user.phone);
    return {
      withdrawal: toWithdrawalView(current),
      balance: await this.deps.wallets.getBalances(userId),
      replayed: false,
    };
  }

  async listForUser(userId: UserId): Promise<WithdrawalView[]> {
    return (await this.deps.withdrawals.listForUser(userId, HISTORY_LIMIT)).map(toWithdrawalView);
  }

  /**
   * Retrait du joueur seulement (sinon 404 identique). Un retrait ouvert est relu chez le
   * fournisseur au plus une fois par intervalle ; une erreur fournisseur ne fait pas échouer
   * la lecture : l'état enregistré fait foi.
   */
  async getForUser(userId: UserId, id: string): Promise<WithdrawalView> {
    if (!UUID.test(id)) throw new WithdrawalNotFoundError();
    const found = await this.deps.withdrawals.findByIdForUser(id, userId);
    if (!found) throw new WithdrawalNotFoundError();
    if (isFinalWithdrawalStatus(found.status) || !this.canLookup || !this.readDue(id)) {
      return toWithdrawalView(found);
    }
    try {
      await this.check(id);
    } catch (err) {
      this.deps.logger.warn('withdrawal read check failed', {
        withdrawalId: id,
        errorName: err instanceof Error ? err.name : typeof err,
      });
    }
    return toWithdrawalView((await this.deps.withdrawals.findByIdForUser(id, userId)) ?? found);
  }

  // --- Fournisseur -----------------------------------------------------------------------------

  /**
   * POST /api/withdrawals/cinetpay/notify. La notification n'est JAMAIS une preuve : jeton
   * comparé en temps constant à son empreinte, référence vérifiée, puis statut RELU chez
   * CinetPay et règlement idempotent (une notification répétée ne change rien). Fonctionne
   * aussi quand les nouveaux transferts sont désactivés (relecture seulement).
   */
  async handleNotification(
    body: unknown,
  ): Promise<{ outcome: CheckOutcome; status: WithdrawalStatus }> {
    const notification = parseNotification(body);
    const withdrawal = await this.deps.withdrawals.findByMerchantTransactionId(
      notification.merchantTransactionId,
    );
    if (!withdrawal) throw new WithdrawalNotFoundError();
    const log = this.deps.logger.child({
      action: 'CINETPAY_TRANSFER_NOTIFY',
      withdrawalId: withdrawal.id,
    });
    if (
      !withdrawal.notifyTokenHash ||
      !sameHash(withdrawal.notifyTokenHash, notification.notifyToken)
    ) {
      log.warn('transfer notification rejected', { reason: 'notify_token' });
      throw new WithdrawalNotificationRejectedError('notify_token');
    }
    if (
      withdrawal.providerReference &&
      withdrawal.providerReference !== notification.transactionId
    ) {
      log.warn('transfer notification rejected', { reason: 'transaction_id' });
      throw new WithdrawalNotificationRejectedError('transaction_id');
    }
    log.info('transfer notification received', { status: withdrawal.status });
    if (isFinalWithdrawalStatus(withdrawal.status)) {
      await this.detectPaidAfterRefund(withdrawal);
      return { outcome: 'already_final', status: withdrawal.status };
    }
    return this.verify(withdrawal);
  }

  /**
   * Relecture d'un retrait (réconciliation, lecture, administration) : MÊME chemin que la
   * notification. Erreurs du fournisseur propagées sans rien décider. Un retrait jamais envoyé
   * n'est envoyé que si les nouveaux transferts sont activés.
   */
  async check(id: string): Promise<{ outcome: CheckOutcome; status: WithdrawalStatus }> {
    const withdrawal = await this.deps.withdrawals.findById(id);
    if (!withdrawal) throw new WithdrawalNotFoundError();
    if (isFinalWithdrawalStatus(withdrawal.status)) {
      await this.detectPaidAfterRefund(withdrawal);
      return { outcome: 'already_final', status: withdrawal.status };
    }
    // Retrait jamais envoyé (arrêt du serveur entre la création et l'envoi, ou demande non
    // partie) : envoi seulement si les nouveaux transferts sont activés.
    if (withdrawal.status === 'CREATED' && withdrawal.submissionAttempts === 0) {
      if (!this.available) {
        await this.deps.withdrawals.recordCheck(
          id,
          { errorCode: WITHDRAWAL_CHECK_ERROR.TRANSFERS_DISABLED },
          this.clock(),
        );
        return { outcome: 'unresolved', status: withdrawal.status };
      }
      const user = await this.deps.users.findById(withdrawal.userId);
      if (!user) throw new WithdrawalNotFoundError();
      const submitted = await this.submit(withdrawal, user.phone);
      return { outcome: outcomeOf(submitted), status: submitted.status };
    }
    return this.verify(withdrawal);
  }

  // --- Rapprochement administratif (D-076) ----------------------------------------------------

  listRefundRequests(withdrawalId: string) {
    return this.deps.withdrawals.listRefundRequests(withdrawalId);
  }

  /**
   * Date à partir de laquelle un remboursement manuel peut être proposé : 24 h après la
   * création ou le dernier envoi.
   */
  refundEligibleFrom(w: Withdrawal): Date {
    const reference = Math.max(w.createdAt.getTime(), w.submissionAttemptedAt?.getTime() ?? 0);
    return new Date(reference + MANUAL_REFUND_MIN_AGE_MS);
  }

  /**
   * Proposition de remboursement d'un retrait bloqué. Exige : retrait ouvert, délai écoulé,
   * référence de la confirmation écrite du fournisseur, et une relecture fraîche chez CinetPay.
   * - transfert réussi → réglé SUCCEEDED, remboursement refusé ;
   * - échec final → réglé par le chemin normal (aucune demande nécessaire) ;
   * - transfert existant non final → refus (escalade) ;
   * - introuvable → la demande est enregistrée, en attente d'un SECOND administrateur.
   */
  async proposeRefund(
    id: string,
    actorId: UserId,
    input: { providerTicket: string; justification: string },
  ): Promise<RefundProposalResult> {
    const withdrawal = await this.openForReview(id);
    const evidence = await this.refundEvidence(withdrawal);
    if (evidence.kind === 'settled') {
      return { outcome: 'settled_by_provider', status: evidence.status };
    }
    const request = await this.deps.withdrawals.createRefundRequest({
      id: randomUUID(),
      withdrawalId: id,
      providerTicket: input.providerTicket,
      justification: input.justification,
      providerStatus: evidence.providerStatus,
      actorId,
      auditId: randomUUID(),
      now: this.clock(),
    });
    this.deps.logger.warn('withdrawal refund proposed', {
      withdrawalId: id,
      requestId: request.id,
      actorId,
    });
    return { outcome: 'proposed', request };
  }

  /**
   * Décision d'un SECOND administrateur. Approbation : relecture fraîche de nouveau
   * (introuvable exigé), puis remboursement UNE fois dans la même transaction que la décision
   * et son audit. Rejet : rien ne bouge, le retrait reste ouvert.
   */
  async decideRefund(
    id: string,
    requestId: string,
    actorId: UserId,
    input: { approve: boolean; note?: string },
  ) {
    if (!UUID.test(requestId)) throw new WithdrawalNotFoundError();
    if (!input.approve) {
      return this.deps.withdrawals.decideRefundRequest({
        requestId,
        withdrawalId: id,
        approve: false,
        ...(input.note && { note: input.note }),
        actorId,
        auditId: randomUUID(),
        now: this.clock(),
      });
    }
    const pending = (await this.deps.withdrawals.listRefundRequests(id)).find(
      (r) => r.id === requestId,
    );
    if (!pending) throw new WithdrawalNotFoundError();
    if (pending.status !== 'PENDING') throw new WithdrawalRefundRefusedError('REQUEST_NOT_PENDING');
    // Contrôle anticipé (le dépôt le revérifie sous verrou) : aucune relecture inutile.
    if (pending.proposedBy === actorId) throw new WithdrawalRefundRefusedError('SAME_ADMIN');
    const withdrawal = await this.openForReview(id);
    const evidence = await this.refundEvidence(withdrawal);
    if (evidence.kind === 'settled') {
      // Échec final confirmé entre-temps : déjà remboursé par le chemin normal.
      return this.deps.withdrawals.decideRefundRequest({
        requestId,
        withdrawalId: id,
        approve: false,
        note: 'Clôturée : statut final confirmé par CinetPay.',
        providerStatus: 'FAILED',
        actorId,
        auditId: randomUUID(),
        now: this.clock(),
      });
    }
    const decided = await this.deps.withdrawals.decideRefundRequest({
      requestId,
      withdrawalId: id,
      approve: true,
      providerStatus: evidence.providerStatus,
      ...(input.note && { note: input.note }),
      actorId,
      auditId: randomUUID(),
      now: this.clock(),
    });
    this.deps.logger.warn('withdrawal refund approved', { withdrawalId: id, requestId, actorId });
    return decided;
  }

  // --- Administration --------------------------------------------------------------------------

  listForAdmin(query: AdminWithdrawalQuery) {
    return this.deps.withdrawals.listForAdmin(query);
  }

  findForAdmin(id: string) {
    return this.deps.withdrawals.findForAdmin(id);
  }

  getLimit() {
    return this.deps.withdrawals.getLimit();
  }

  /** Précondition : quota validé (`parseWithdrawalLimitChange`). Audité dans la même transaction. */
  async setLimit(limit: WithdrawalLimit, actorId: UserId) {
    const result = await this.deps.withdrawals.setLimit({
      limit,
      actorId,
      auditId: randomUUID(),
      now: this.clock(),
    });
    if (result.changed) this.deps.logger.info('withdrawal limit changed', { actorId, ...limit });
    return result;
  }

  // --- Interne ---------------------------------------------------------------------------------

  /** Même Idempotency-Key : même retrait ; autre opération ou autres paramètres : refus. */
  private async replay(
    userId: UserId,
    input: { tokens: number; operator: WithdrawalOperator },
    idempotencyKey: string,
  ): Promise<WithdrawalResult | undefined> {
    const transaction = await this.deps.wallets.findByIdempotencyKey(userId, idempotencyKey);
    if (!transaction) return undefined;
    const existing = await this.deps.withdrawals.findByIdempotencyKey(userId, idempotencyKey);
    if (!existing || existing.tokens !== input.tokens || existing.operator !== input.operator) {
      throw new IdempotencyKeyReusedError();
    }
    return {
      withdrawal: toWithdrawalView(existing),
      balance: await this.deps.wallets.getBalances(userId),
      replayed: true,
    };
  }

  /**
   * Un envoi : revendiqué d'abord (un seul processus envoie), toujours avec la même
   * référence marchande. Ne lève jamais pour une erreur du fournisseur. Ne rembourse JAMAIS :
   * seul un statut final relu (ou le rapprochement à double validation) règle un échec.
   */
  private async submit(withdrawal: Withdrawal, phone: string): Promise<Withdrawal> {
    const now = this.clock();
    const reload = async () => (await this.deps.withdrawals.findById(withdrawal.id)) ?? withdrawal;
    // Garde-fou : nouveaux transferts désactivés, aucun envoi.
    if (!this.available) return reload();
    // Envoi différé (reprise, renvoi) : le destinataire doit rester celui enregistré à la
    // création. Sinon rien n'est envoyé ; rapprochement administratif.
    if (maskPhone(phone) !== withdrawal.msisdnMasked || !isSupportedWithdrawalPhone(phone)) {
      this.deps.logger.error('withdrawal recipient changed', { withdrawalId: withdrawal.id });
      await this.deps.withdrawals.recordCheck(
        withdrawal.id,
        { errorCode: WITHDRAWAL_CHECK_ERROR.RECIPIENT_CHANGED },
        now,
      );
      return reload();
    }
    const claimed = await this.deps.withdrawals.claimSubmission(
      withdrawal.id,
      withdrawal.submissionAttempts,
      now,
    );
    if (!claimed) return reload();
    const log = this.deps.logger.child({
      action: 'WITHDRAWAL_SUBMIT',
      withdrawalId: withdrawal.id,
    });
    const result = await this.deps.gateway.submit({
      merchantTransactionId: claimed.merchantTransactionId,
      phoneNumber: phone,
      amount: claimed.amount,
      currency: claimed.currency,
      operator: claimed.operator,
    });
    switch (result.kind) {
      case 'accepted': {
        log.info('transfer accepted', {
          providerStatus: result.providerStatus,
          attempt: claimed.submissionAttempts,
        });
        // Même un SUCCESS initial n'est pas une preuve : le statut final sera RELU.
        return this.deps.withdrawals.recordAcceptance(
          claimed.id,
          {
            providerReference: result.providerReference,
            providerStatus: result.providerStatus,
            ...(result.notifyToken && { notifyTokenHash: hashNotifyToken(result.notifyToken) }),
            ...(result.feeAmount !== undefined && { feeAmount: result.feeAmount }),
          },
          this.clock(),
        );
      }
      case 'not_sent': {
        // Aucune requête de transfert n'est partie (fait local) : l'envoi n'est pas compté,
        // il sera retenté par la réconciliation avec la même référence.
        log.warn('transfer not sent', { errorCode: result.errorCode });
        await this.deps.withdrawals.releaseSubmission(
          claimed.id,
          claimed.submissionAttempts,
          this.clock(),
        );
        await this.deps.withdrawals.recordCheck(
          claimed.id,
          { errorCode: result.errorCode },
          this.clock(),
        );
        return reload();
      }
      case 'rejected': {
        // Refus ANNONCÉ : jamais une preuve de non-exécution. Rien n'est remboursé ; le
        // transfert est relu, et seul un statut final relu (ou le rapprochement) décide.
        log.warn('transfer rejected at creation', { providerStatus: result.providerStatus });
        await this.deps.withdrawals.recordCheck(
          claimed.id,
          { providerStatus: result.providerStatus, errorCode: WITHDRAWAL_CHECK_ERROR.REJECTED },
          this.clock(),
        );
        await this.lookupQuietly(claimed, log);
        return reload();
      }
      case 'already_exists': {
        log.info('transfer already exists');
        await this.lookupQuietly(claimed, log);
        return reload();
      }
      case 'uncertain': {
        log.warn('transfer submission uncertain', { errorCode: result.errorCode });
        await this.deps.withdrawals.recordCheck(
          claimed.id,
          { errorCode: result.errorCode },
          this.clock(),
        );
        return reload();
      }
    }
  }

  /**
   * Relecture sans effet si le transfert est introuvable ou le fournisseur injoignable (le
   * retrait reste ouvert, la réconciliation le reprendra). Un transfert TROUVÉ est appliqué.
   */
  private async lookupQuietly(
    withdrawal: Withdrawal,
    log: Pick<Logger, 'warn'>,
  ): Promise<void> {
    try {
      const lookup = await this.deps.gateway.lookup(withdrawal.merchantTransactionId);
      if (lookup.found) await this.applyLookup(withdrawal, lookup);
    } catch (err) {
      log.warn('transfer lookup after submission failed', {
        errorName: err instanceof Error ? err.name : typeof err,
      });
    }
  }

  /** Statut RELU par notre référence marchande, puis décision (ou rien). */
  private async verify(
    withdrawal: Withdrawal,
  ): Promise<{ outcome: CheckOutcome; status: WithdrawalStatus }> {
    const lookup = await this.lookup(withdrawal);
    if (!lookup.found) return this.handleNotFound(withdrawal);
    return this.applyLookup(withdrawal, lookup);
  }

  /** Relecture ; une erreur est notée sur le retrait puis propagée (rien n'est décidé). */
  private async lookup(withdrawal: Withdrawal): Promise<TransferLookup> {
    if (!this.canLookup) throw new WithdrawalProviderUnavailableError();
    try {
      return await this.deps.gateway.lookup(withdrawal.merchantTransactionId);
    } catch (err) {
      await this.deps.withdrawals.recordCheck(
        withdrawal.id,
        { errorCode: WITHDRAWAL_CHECK_ERROR.LOOKUP_FAILED },
        this.clock(),
      );
      throw err;
    }
  }

  /**
   * Applique un statut TROUVÉ chez le fournisseur : incohérent → rien (409) ; final → règlement
   * idempotent (succès ou échec, remboursement unique) ; sinon → en traitement.
   */
  private async applyLookup(
    withdrawal: Withdrawal,
    lookup: Extract<TransferLookup, { found: true }>,
  ): Promise<{ outcome: CheckOutcome; status: WithdrawalStatus }> {
    const log = this.deps.logger.child({
      action: 'WITHDRAWAL_VERIFY',
      withdrawalId: withdrawal.id,
    });
    const mismatch = mismatchOf(withdrawal, lookup);
    if (mismatch) {
      log.error('transfer verification mismatch', { reason: mismatch });
      await this.deps.withdrawals.recordCheck(
        withdrawal.id,
        { errorCode: WITHDRAWAL_CHECK_ERROR.MISMATCH },
        this.clock(),
      );
      throw new WithdrawalVerificationError(mismatch);
    }

    const final = finalOutcomeOfTransferStatus(lookup.providerStatus);
    if (!final) {
      const updated = await this.deps.withdrawals.recordAcceptance(
        withdrawal.id,
        { providerReference: lookup.providerReference, providerStatus: lookup.providerStatus },
        this.clock(),
      );
      return { outcome: 'processing', status: updated.status };
    }
    const { withdrawal: settled, changed } = await this.deps.withdrawals.settle(
      withdrawal.id,
      final === 'SUCCEEDED'
        ? {
            status: 'SUCCEEDED',
            providerReference: lookup.providerReference,
            providerStatus: lookup.providerStatus,
            ...(lookup.feeAmount !== undefined && { feeAmount: lookup.feeAmount }),
          }
        : {
            status: 'FAILED',
            failureCode: WITHDRAWAL_FAILURE.FAILED,
            providerReference: lookup.providerReference,
            providerStatus: lookup.providerStatus,
          },
      this.clock(),
    );
    log.info('withdrawal settled', {
      status: settled.status,
      providerStatus: lookup.providerStatus,
      changed,
    });
    if (!changed) await this.detectPaidAfterRefund(settled, lookup);
    return { outcome: changed ? 'settled' : 'already_final', status: settled.status };
  }

  /**
   * Transfert introuvable chez le fournisseur : jamais une preuve. PROCESSING (référence
   * reçue) : anomalie, rien n'est décidé. CREATED : renvoi avec la MÊME référence marchande
   * seulement si les transferts sont activés, après le délai et dans la limite des envois
   * (1 par défaut : aucun renvoi) ; sinon, rapprochement administratif.
   */
  private async handleNotFound(
    withdrawal: Withdrawal,
  ): Promise<{ outcome: CheckOutcome; status: WithdrawalStatus }> {
    const now = this.clock();
    const attemptedAt = withdrawal.submissionAttemptedAt?.getTime() ?? 0;
    const resubmittable =
      this.available &&
      withdrawal.status === 'CREATED' &&
      withdrawal.submissionAttempts < this.options.maxSubmissionAttempts &&
      now.getTime() - attemptedAt >= this.options.resubmitAfterMs;
    if (resubmittable) {
      const user = await this.deps.users.findById(withdrawal.userId);
      if (user) {
        this.deps.logger.warn('withdrawal resubmitted after not found', {
          withdrawalId: withdrawal.id,
          attempt: withdrawal.submissionAttempts + 1,
        });
        const submitted = await this.submit(withdrawal, user.phone);
        return { outcome: outcomeOf(submitted), status: submitted.status };
      }
    }
    // Un refus annoncé à la création reste visible tel quel (motif plus précis).
    if (withdrawal.lastErrorCode !== WITHDRAWAL_CHECK_ERROR.REJECTED) {
      await this.deps.withdrawals.recordCheck(
        withdrawal.id,
        { errorCode: WITHDRAWAL_CHECK_ERROR.NOT_FOUND },
        now,
      );
    } else {
      await this.deps.withdrawals.recordCheck(withdrawal.id, {}, now);
    }
    return { outcome: 'unresolved', status: withdrawal.status };
  }

  /**
   * Un retrait FAILED (remboursé) annoncé réussi par CinetPay : anomalie grave (argent
   * envoyé ET jetons rendus). Rien n'est modifié automatiquement (aucun débit rétroactif) ;
   * l'anomalie est notée et journalisée pour un rapprochement.
   */
  private async detectPaidAfterRefund(
    withdrawal: Withdrawal,
    known?: Extract<TransferLookup, { found: true }>,
  ): Promise<void> {
    if (withdrawal.status !== 'FAILED' || withdrawal.lastErrorCode === PAID_AFTER_REFUND) return;
    let lookup: TransferLookup | undefined = known;
    if (!lookup) {
      if (!this.canLookup) return;
      try {
        lookup = await this.deps.gateway.lookup(withdrawal.merchantTransactionId);
      } catch {
        return;
      }
    }
    if (lookup.found && finalOutcomeOfTransferStatus(lookup.providerStatus) === 'SUCCEEDED') {
      this.deps.logger.error('withdrawal paid after refund', { withdrawalId: withdrawal.id });
      await this.deps.withdrawals.recordAnomaly(withdrawal.id, PAID_AFTER_REFUND, this.clock());
    }
  }

  /** Retrait ouvert et délai de rapprochement écoulé, sinon refus explicite. */
  private async openForReview(id: string): Promise<Withdrawal> {
    const withdrawal = await this.deps.withdrawals.findById(id);
    if (!withdrawal) throw new WithdrawalNotFoundError();
    if (isFinalWithdrawalStatus(withdrawal.status)) {
      throw new WithdrawalRefundRefusedError('NOT_OPEN');
    }
    if (this.clock() < this.refundEligibleFrom(withdrawal)) {
      throw new WithdrawalRefundRefusedError('TOO_RECENT');
    }
    return withdrawal;
  }

  /**
   * Preuve fournisseur exigée pour un remboursement manuel : relecture FRAÎCHE. Introuvable →
   * `NOT_FOUND` (nécessaire, jamais suffisant seul : la confirmation écrite et la double
   * validation complètent la preuve). Trouvé → appliqué normalement, jamais remboursé à la main.
   */
  private async refundEvidence(
    withdrawal: Withdrawal,
  ): Promise<{ kind: 'not_found'; providerStatus: 'NOT_FOUND' } | { kind: 'settled'; status: WithdrawalStatus }> {
    let lookup: TransferLookup;
    try {
      lookup = await this.lookup(withdrawal);
    } catch (err) {
      if (err instanceof WithdrawalProviderUnavailableError) throw err;
      throw new WithdrawalProviderUnavailableError();
    }
    if (!lookup.found) return { kind: 'not_found', providerStatus: 'NOT_FOUND' };
    const { status } = await this.applyLookup(withdrawal, lookup);
    if (status === 'SUCCEEDED') throw new WithdrawalRefundRefusedError('TRANSFER_SUCCEEDED');
    if (status === 'FAILED') return { kind: 'settled', status };
    throw new WithdrawalRefundRefusedError('TRANSFER_EXISTS');
  }

  private readDue(id: string): boolean {
    const now = this.clock().getTime();
    const last = this.lastReads.get(id);
    if (last !== undefined && now - last < this.options.readRecheckMs) return false;
    if (this.lastReads.size > 10_000) this.lastReads.clear();
    this.lastReads.set(id, now);
    return true;
  }
}

function outcomeOf(w: Withdrawal): CheckOutcome {
  if (isFinalWithdrawalStatus(w.status)) return 'settled';
  return w.status === 'PROCESSING' ? 'processing' : 'unresolved';
}

/** Statut relu cohérent avec le retrait enregistré ? Montant et devise comparés s'ils sont renvoyés. */
function mismatchOf(w: Withdrawal, lookup: Extract<TransferLookup, { found: true }>) {
  if (lookup.merchantTransactionId !== w.merchantTransactionId) return 'merchant_transaction_id';
  if (w.providerReference && lookup.providerReference !== w.providerReference) {
    return 'transaction_id';
  }
  if (lookup.amount !== undefined && lookup.amount !== w.amount) return 'amount';
  if (lookup.currency !== undefined && lookup.currency !== w.currency) return 'currency';
  return undefined;
}

function sameHash(expectedHash: string, token: string): boolean {
  const received = Buffer.from(hashNotifyToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Notification CinetPay : `{ notify_token, merchant_transaction_id, transaction_id, user? }`. */
function parseNotification(body: unknown) {
  const field = (key: string) => {
    const value =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)[key]
        : undefined;
    return typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_NOTIFICATION_FIELD_LENGTH
      ? value
      : undefined;
  };
  const notifyToken = field('notify_token');
  const merchantTransactionId = field('merchant_transaction_id');
  const transactionId = field('transaction_id');
  if (!notifyToken || !merchantTransactionId || !transactionId) {
    throw new ValidationError({ notification: 'Notification incomplète.' });
  }
  return { notifyToken, merchantTransactionId, transactionId };
}
