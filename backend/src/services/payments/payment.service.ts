import { timingSafeEqual } from 'node:crypto';

import {
  PaymentNotFoundError,
  PaymentNotificationRejectedError,
  PaymentVerificationError,
  type Payment,
  type PaymentStatus,
} from '../../domain/payments/payment';
import { isUserId, type UserId } from '../../domain/users/user';
import type {
  PaymentRepository,
  PaymentSettlementSource,
} from '../../repositories/payment.repository';
import type { Logger } from '../../utils/logger';
import { ValidationError } from '../../validators/validation-error';
import { CinetPayError, type CinetPayPaymentStatus } from './cinetpay/cinetpay-client';
import { hashNotifyToken } from './cinetpay/cinetpay.gateway';

/** Lecture du statut réel chez CinetPay (serveur à serveur). */
export interface CinetPayStatusReader {
  getPaymentStatus(identifier: string): Promise<CinetPayPaymentStatus>;
}

export interface PaymentServiceDependencies {
  payments: PaymentRepository;
  /** Absent : CinetPay non configuré (aucune vérification possible, donc aucun règlement). */
  cinetpay?: CinetPayStatusReader;
  logger: Logger;
  clock?: () => Date;
  /** Délai minimal entre deux vérifications d'un même paiement lors d'une lecture. */
  reconcileIntervalMs?: number;
}

/** Notification CinetPay v1 : JSON { notify_token, merchant_transaction_id, transaction_id, user }. */
export interface CinetPayNotification {
  notifyToken: string;
  merchantTransactionId: string;
  transactionId: string;
}

export type NotificationOutcome = 'settled' | 'already_processed' | 'pending';

export interface NotificationResult {
  outcome: NotificationOutcome;
  status: PaymentStatus;
}

export interface ReconcileResult {
  outcome: NotificationOutcome | 'already_final';
  status: PaymentStatus;
}

/** Statuts finaux CinetPay → statut du paiement. Les autres laissent le paiement en attente. */
const FINAL_STATUSES: Readonly<Record<string, Exclude<PaymentStatus, 'PENDING'>>> = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  INSUFFICIENT_BALANCE: 'FAILED',
  EXPIRED: 'EXPIRED',
};

const DEFAULT_RECONCILE_INTERVAL_MS = 10_000;
/**
 * Paiement direct à l'initialisation incertaine, toujours INTROUVABLE chez CinetPay après ce
 * délai : la création n'a pas abouti, l'achat est clos sans crédit (D-083).
 */
export const UNCERTAIN_INITIALIZATION_GIVE_UP_MS = 30 * 60_000;

/** NOT_FOUND (code 404) : le paiement n'existe pas chez CinetPay. */
function isProviderNotFound(err: unknown): boolean {
  return (
    err instanceof CinetPayError &&
    (err.details.apiCode === 404 || err.details.apiStatus === 'NOT_FOUND')
  );
}
const MAX_NOTIFICATION_FIELD_LENGTH = 256;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Paiements CinetPay (D-050). Le compte de jeu reste la source de vérité : un paiement n'est
 * réglé (crédit UNE fois, via le règlement idempotent du compte de jeu) qu'après :
 *
 *   notification → paiement retrouvé → `notify_token` comparé en temps constant à son
 *   empreinte → référence identique → statut RELU chez CinetPay (serveur à serveur) →
 *   références, montant et devise vérifiés → statut final → règlement atomique.
 *
 * Le contenu d'une notification n'est JAMAIS une preuve de paiement. Le `notify_token` n'est
 * jamais journalisé.
 */
export class PaymentService {
  private readonly clock: () => Date;
  private readonly lastChecks = new Map<string, number>();

  constructor(private readonly deps: PaymentServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
  }

  /**
   * Paiement du joueur authentifié uniquement : celui d'un autre joueur répond comme un
   * paiement inconnu. Un paiement en attente est revérifié auprès de CinetPay (au plus une
   * fois par intervalle), au cas où la notification ne serait pas (encore) arrivée.
   */
  async getForUser(userId: UserId, paymentId: string): Promise<Payment> {
    if (!UUID.test(paymentId) || !isUserId(userId)) throw new PaymentNotFoundError();
    const payment = await this.deps.payments.findByIdForUser(paymentId, userId);
    if (!payment) throw new PaymentNotFoundError();
    if (payment.status !== 'PENDING' || !this.shouldReconcile(payment)) return payment;
    try {
      await this.verifyAndSettle(payment, 'player_read');
    } catch (err) {
      // La lecture n'échoue jamais à cause du fournisseur : l'état enregistré fait foi.
      this.deps.logger.warn('payment reconcile failed', {
        paymentId,
        errorName: err instanceof Error ? err.name : typeof err,
      });
    }
    return (await this.deps.payments.findByIdForUser(paymentId, userId)) ?? payment;
  }

  /**
   * Revérification demandée par l'administration (D-061) : MÊME contrôle serveur à serveur
   * que la notification et la lecture joueur (`verifyAndSettle`), donc même règlement
   * idempotent. Un paiement déjà final n'est pas revérifié. Le navigateur ne fournit aucun
   * statut : seul CinetPay, relu par le serveur, fait foi.
   */
  async verifyForAdmin(paymentId: string): Promise<ReconcileResult> {
    if (!UUID.test(paymentId)) throw new PaymentNotFoundError();
    return this.reconcile(paymentId, 'admin');
  }

  /**
   * Revérification d'un paiement en attente (réconciliation automatique, administration) :
   * MÊME contrôle serveur à serveur et même règlement idempotent que la notification
   * (`verifyAndSettle`). Le paiement est relu : déjà final, il n'est pas revérifié. Les
   * erreurs du fournisseur sont propagées sans rien écrire (nouvelle tentative possible).
   */
  async reconcile(
    paymentId: string,
    source: PaymentSettlementSource = 'reconciliation',
  ): Promise<ReconcileResult> {
    const payment = await this.deps.payments.findById(paymentId);
    if (!payment) throw new PaymentNotFoundError();
    if (payment.status !== 'PENDING') return { outcome: 'already_final', status: payment.status };
    return this.verifyAndSettle(payment, source);
  }

  /** Vrai si un fournisseur est configuré (sinon aucune vérification n'est possible). */
  get providerConfigured(): boolean {
    return this.deps.cinetpay !== undefined;
  }

  /** POST /api/payments/cinetpay/notify. */
  async handleCinetPayNotification(body: unknown): Promise<NotificationResult> {
    const notification = parseNotification(body);
    const log = this.deps.logger.child({ action: 'CINETPAY_NOTIFY' });
    const payment = await this.deps.payments.findByMerchantTransactionId(
      'cinetpay',
      notification.merchantTransactionId,
    );
    if (!payment) {
      log.warn('cinetpay notification for unknown payment');
      throw new PaymentNotFoundError();
    }
    if (!payment.notifyTokenHash || !payment.providerReference) {
      log.warn('cinetpay notification for uninitialized payment', { paymentId: payment.id });
      throw new PaymentNotificationRejectedError('not_initialized');
    }
    if (!sameHash(hashNotifyToken(notification.notifyToken), payment.notifyTokenHash)) {
      log.warn('cinetpay notification rejected', { paymentId: payment.id, reason: 'token' });
      throw new PaymentNotificationRejectedError('invalid_token');
    }
    if (notification.transactionId !== payment.providerReference) {
      log.warn('cinetpay notification rejected', { paymentId: payment.id, reason: 'reference' });
      throw new PaymentNotificationRejectedError('reference_mismatch');
    }
    // Authentique (jeton et référence vérifiés) : seuls identifiants et statuts sont journalisés.
    log.info('cinetpay notification received', { paymentId: payment.id, status: payment.status });
    if (payment.status !== 'PENDING') {
      log.info('cinetpay notification already processed', { paymentId: payment.id });
      return { outcome: 'already_processed', status: payment.status };
    }
    return this.verifyAndSettle(payment, 'notification');
  }

  /** Statut relu chez CinetPay, contrôlé, puis règlement atomique s'il est final. */
  private async verifyAndSettle(
    payment: Payment,
    source: PaymentSettlementSource,
  ): Promise<NotificationResult> {
    const { cinetpay, payments, logger } = this.deps;
    if (cinetpay && !payment.providerReference && payment.initializationUncertain) {
      return this.recoverUncertainInitialization(payment, source);
    }
    if (!cinetpay || !payment.providerReference) {
      throw new PaymentVerificationError('provider_unavailable');
    }
    this.lastChecks.set(payment.id, this.clock().getTime());
    const log = logger.child({
      action: 'CINETPAY_VERIFY',
      paymentId: payment.id,
      source,
      ...(payment.paymentMethod && { paymentMethod: payment.paymentMethod }),
    });

    const remote = await cinetpay.getPaymentStatus(payment.providerReference);
    const mismatch =
      remote.transactionId !== payment.providerReference ||
      remote.merchantTransactionId !== payment.merchantTransactionId
        ? 'reference_mismatch'
        : remote.amount !== undefined && remote.amount !== payment.amount
          ? 'amount_mismatch'
          : remote.currency !== undefined && remote.currency !== payment.currency
            ? 'currency_mismatch'
            : undefined;
    if (mismatch) {
      log.error('cinetpay verification mismatch: nothing credited', { reason: mismatch });
      throw new PaymentVerificationError(mismatch);
    }

    log.info('cinetpay payment verified', {
      providerStatus: remote.status,
      amountReturned: remote.amount !== undefined,
      currencyReturned: remote.currency !== undefined,
    });

    const final = FINAL_STATUSES[remote.status];
    if (!final) {
      await payments.recordProviderStatus(payment.id, remote.status, this.clock());
      log.info('cinetpay payment still pending', { providerStatus: remote.status });
      return { outcome: 'pending', status: 'PENDING' };
    }
    const result = await payments.settle(
      payment.id,
      { status: final, providerStatus: remote.status, settledBy: source },
      this.clock(),
    );
    this.lastChecks.delete(payment.id);
    log.info('cinetpay payment settled', {
      // Délai création → règlement : un paiement direct réglé en quelques secondes n'a pas pu
      // être validé par un joueur sur son téléphone (issue simulée en sandbox).
      secondsSinceCreation: Math.round((this.clock().getTime() - payment.createdAt.getTime()) / 1000),
      status: result.payment.status,
      walletTransactionStatus: result.transaction.status,
      changed: result.changed,
    });
    return {
      outcome: result.changed ? 'settled' : 'already_processed',
      status: result.payment.status,
    };
  }

  /**
   * Paiement direct dont la création est partie sans réponse (D-083) : recherché chez CinetPay
   * par NOTRE `merchant_transaction_id` (serveur à serveur). Trouvé : sa référence est posée,
   * puis le contrôle normal (`verifyAndSettle`) s'applique. Introuvable : il reste en attente,
   * puis est clos sans crédit au-delà de `UNCERTAIN_INITIALIZATION_GIVE_UP_MS`. Toute autre
   * erreur est propagée sans rien écrire.
   */
  private async recoverUncertainInitialization(
    payment: Payment,
    source: PaymentSettlementSource,
  ): Promise<NotificationResult> {
    const { cinetpay, payments, logger } = this.deps;
    if (!cinetpay) throw new PaymentVerificationError('provider_unavailable');
    const now = this.clock();
    this.lastChecks.set(payment.id, now.getTime());
    const log = logger.child({ action: 'CINETPAY_RECOVER', paymentId: payment.id });
    let remote: CinetPayPaymentStatus;
    try {
      remote = await cinetpay.getPaymentStatus(payment.merchantTransactionId);
    } catch (err) {
      if (!isProviderNotFound(err)) throw err;
      if (now.getTime() - payment.createdAt.getTime() < UNCERTAIN_INITIALIZATION_GIVE_UP_MS) {
        await payments.recordProviderStatus(payment.id, 'NOT_FOUND', now);
        log.info('direct payment not found yet');
        return { outcome: 'pending', status: 'PENDING' };
      }
      const result = await payments.settle(
        payment.id,
        { status: 'FAILED', providerStatus: 'NOT_FOUND', settledBy: source },
        now,
      );
      this.lastChecks.delete(payment.id);
      log.warn('direct payment never created: closed without credit');
      return {
        outcome: result.changed ? 'settled' : 'already_processed',
        status: result.payment.status,
      };
    }
    if (remote.merchantTransactionId !== payment.merchantTransactionId) {
      log.error('cinetpay verification mismatch: nothing credited', { reason: 'reference_mismatch' });
      throw new PaymentVerificationError('reference_mismatch');
    }
    await payments.recordRecoveredReference(payment.id, remote.transactionId, now);
    log.info('direct payment reference recovered');
    const recovered = await payments.findById(payment.id);
    if (!recovered?.providerReference || recovered.status !== 'PENDING') {
      return { outcome: 'already_processed', status: recovered?.status ?? payment.status };
    }
    // Même contrôle et même règlement que tout paiement (statut relu par sa référence).
    return this.verifyAndSettle(recovered, source);
  }

  private shouldReconcile(payment: Payment): boolean {
    if (!this.deps.cinetpay) return false;
    if (!payment.providerReference && !payment.initializationUncertain) return false;
    const now = this.clock().getTime();
    const interval = this.deps.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    const last = this.lastChecks.get(payment.id);
    if (last !== undefined && now - last < interval) return false;
    if (this.lastChecks.size > 10_000) this.lastChecks.clear();
    return true;
  }
}

/** Comparaison en temps constant de deux empreintes SHA-256 hexadécimales. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

function parseNotification(body: unknown): CinetPayNotification {
  const data =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined;
  const field = (name: string): string | undefined => {
    const value = data?.[name];
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
    throw new ValidationError({ notification: 'Notification CinetPay incomplète.' });
  }
  return { notifyToken, merchantTransactionId, transactionId };
}
