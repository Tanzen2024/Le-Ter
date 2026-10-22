import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  amountForTokens,
  DirectPaymentUnavailableError,
  isAllowedDepositAmount,
  PAYMENT_CURRENCY,
  PaymentInitializationUncertainError,
  isPayerPhoneNumber,
  PaymentProfileIncompleteError,
  type DirectPayOperator,
} from '../../../domain/payments/payment';
import { isSupportedWithdrawalPhone } from '../../../domain/wallet/withdrawal';
import type { PaymentRepository } from '../../../repositories/payment.repository';
import type { Logger } from '../../../utils/logger';
import {
  MobileMoneyNotConfiguredError,
  type MobileMoneyCustomer,
  type MobileMoneyGateway,
  type MobileMoneyRequest,
  type MobileMoneyRequestResult,
} from '../../wallet/mobile-money.gateway';
import {
  CinetPayError,
  CinetPayPaymentNotSentError,
  type CinetPayClient,
} from './cinetpay-client';
import { classifyPaymentFailure, type PaymentFailureInfo } from '../payment-failure';

/** Limite CinetPay des URL `success_url`, `failed_url` et `notify_url` (SDK officiel). */
export const CINETPAY_MAX_URL_LENGTH = 120;
/** Préfixe de `merchant_transaction_id` (30 caractères max chez CinetPay ; ici 28). */
const MERCHANT_ID_PREFIX = 'LT';

export interface CinetPayGatewayOptions {
  client: Pick<CinetPayClient, 'createPayment'>;
  payments: PaymentRepository;
  logger: Logger;
  /** URL publique HTTPS de POST /api/payments/cinetpay/notify. */
  notifyUrl: string;
  /** URL publique HTTPS de GET /api/payments/cinetpay/return ; l'identifiant y est ajouté. */
  returnUrl: string;
  lang?: 'fr' | 'en';
  /** Opérateurs activés en paiement direct (`CINETPAY_DIRECT_PAY_METHODS`), vide par défaut. */
  directPayOperators?: readonly DirectPayOperator[];
  /** Opérateurs présélectionnés sur la page (`CINETPAY_PAGE_PRESELECT_METHODS`), vide par défaut. */
  pagePreselectOperators?: readonly DirectPayOperator[];
  clock?: () => Date;
  /** Surveillance (D-100) : échecs d'initialisation classés. */
  onInitializationFailure?: (info: PaymentFailureInfo) => void;
}

/**
 * Refus CERTAIN de l'initialisation : CinetPay a répondu par un code d'erreur (paramètres,
 * opérateur non autorisé…) ou la demande n'est jamais partie. Tout le reste (délai, réseau,
 * réponse illisible, erreur HTTP sans code) laisse l'issue inconnue.
 */
/**
 * Motif d'échec enregistré (`payments.metadata.failure`) et journalisé : nom de l'erreur, puis
 * type et code CinetPay de la cause (ex. `CinetPayPaymentNotSentError:authentication:2011:NOT_ALLOWED`
 * = adresse IP du serveur non autorisée par le compte). Jamais de secret ni de message brut.
 */
export function failureReasonOf(err: unknown): string {
  if (!(err instanceof Error)) return 'UnknownError';
  const source = err instanceof CinetPayPaymentNotSentError ? err.cause : err;
  if (!(source instanceof CinetPayError)) return err.name;
  const { apiCode, apiStatus, httpStatus } = source.details;
  const code = apiCode ?? httpStatus;
  return [err.name, source.kind, ...(code !== undefined ? [code] : []), ...(apiStatus ? [apiStatus] : [])]
    .join(':')
    .slice(0, 120);
}

function isCertainRefusal(err: unknown): boolean {
  if (err instanceof CinetPayPaymentNotSentError) return true;
  if (!(err instanceof CinetPayError) || err.details.apiCode === undefined) return false;
  // Code CinetPay dans une réponse 200 (`api`) ou 4xx (`http`, CinetPay répond 422) ; un 5xx
  // ne prouve pas que le paiement n'a pas été créé.
  const status = err.details.httpStatus;
  return err.kind === 'api' || (err.kind === 'http' && status !== undefined && status < 500);
}

/** Longueurs exigées par CinetPay v1 pour `client_first_name` / `client_last_name` (SDK). */
export const CINETPAY_NAME_MIN_LENGTH = 2;
export const CINETPAY_NAME_MAX_LENGTH = 255;

/** SHA-256 hexadécimal d'un `notify_token` : seule forme stockée. */
export function hashNotifyToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Identifiant marchand unique, ≤ 30 caractères, sans donnée personnelle. */
function newMerchantTransactionId(): string {
  return `${MERCHANT_ID_PREFIX}${randomBytes(13).toString('hex')}`;
}

/**
 * Fournisseur CinetPay du port `MobileMoneyGateway` (D-050). ACHAT seulement : le retrait
 * reste hors périmètre et refusé proprement (jamais de fausse réussite).
 *
 * Achat : jetons → montant XAF (1:1, montants autorisés), paiement `PENDING` enregistré AVANT
 * l'appel, initialisation CinetPay, puis référence, URL de paiement et empreinte du
 * `notify_token` enregistrées. Le joueur n'est crédité qu'après une notification vérifiée
 * auprès de CinetPay (`PaymentService`).
 */
export class CinetPayGateway implements MobileMoneyGateway {
  readonly available = true;
  /**
   * Port de COLLECTE seulement : les retraits ne passent jamais par ici mais par
   * `CinetPayTransferGateway` (D-075), dont l'état est décidé par
   * `resolveWithdrawalAvailability` (D-077). Ce champ n'est pas lu pour les retraits.
   */
  readonly disbursementAvailable = false;
  readonly directPayOperators: readonly DirectPayOperator[];
  readonly pagePreselectOperators: readonly DirectPayOperator[];
  private readonly clock: () => Date;

  constructor(private readonly options: CinetPayGatewayOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.directPayOperators = options.directPayOperators ?? [];
    this.pagePreselectOperators = options.pagePreselectOperators ?? [];
    for (const [name, url] of [
      ['notifyUrl', options.notifyUrl],
      ['returnUrl', this.returnUrlOf(randomUUID())],
    ] as const) {
      if (url.length > CINETPAY_MAX_URL_LENGTH) {
        throw new Error(`CinetPay : ${name} dépasse ${CINETPAY_MAX_URL_LENGTH} caractères`);
      }
    }
  }

  /**
   * Prénom et nom acceptés par CinetPay (2 à 255 caractères, espaces de bord exclus). Un
   * compte Le Ter peut avoir un prénom d'une lettre : il ne peut pas payer par CinetPay, et
   * rien n'est complété à sa place.
   */
  assertCollectionEligible(customer: MobileMoneyCustomer): void {
    const invalid = (value: string) => {
      const length = [...value.trim()].length;
      return length < CINETPAY_NAME_MIN_LENGTH || length > CINETPAY_NAME_MAX_LENGTH;
    };
    const fields = [
      ...(invalid(customer.firstName) ? (['firstName'] as const) : []),
      ...(invalid(customer.lastName) ? (['lastName'] as const) : []),
      // Numéro d'inscription transmis à CinetPay (D-088) : format international exigé.
      ...(customer.phone === undefined || !isPayerPhoneNumber(customer.phone)
        ? (['phone'] as const)
        : []),
    ];
    if (fields.length > 0) throw new PaymentProfileIncompleteError(fields);
  }

  /**
   * Paiement direct : opérateur activé pour le compte CinetPay ET numéro d'inscription
   * camerounais (+237, XAF). Vérifié avant toute écriture.
   */
  assertDirectPayEligible(operator: DirectPayOperator, msisdn: string): void {
    if (!this.directPayOperators.includes(operator)) {
      throw new DirectPaymentUnavailableError('METHOD_NOT_ENABLED');
    }
    if (!isSupportedWithdrawalPhone(msisdn)) {
      throw new DirectPaymentUnavailableError('PHONE_UNSUPPORTED');
    }
  }

  async requestCollection(request: MobileMoneyRequest): Promise<MobileMoneyRequestResult> {
    const amount = amountForTokens(request.tokens);
    if (!isAllowedDepositAmount(amount)) {
      // Garde-fou : WalletService valide déjà les montants autorisés.
      throw new Error('Montant d’achat non autorisé');
    }
    if (!request.customer) {
      throw new Error('Identité du payeur absente');
    }
    this.assertCollectionEligible(request.customer);
    const direct = request.directOperator;
    if (direct) this.assertDirectPayEligible(direct, request.msisdn);
    // Page hébergée : opérateur présélectionné seulement si le compte l'accepte (configuration).
    const preselected =
      !direct && request.pageOperator && this.pagePreselectOperators.includes(request.pageOperator)
        ? request.pageOperator
        : undefined;
    const { payments, client, logger } = this.options;
    const now = this.clock();
    const paymentId = randomUUID();
    const merchantTransactionId = newMerchantTransactionId();
    await payments.create({
      id: paymentId,
      walletTransactionId: request.transactionId,
      provider: 'cinetpay',
      merchantTransactionId,
      amount,
      currency: PAYMENT_CURRENCY,
      createdAt: now,
      ...((direct ?? preselected) && { paymentMethod: direct ?? preselected }),
      // Direct : la demande peut atteindre le téléphone dès l'appel (D-091).
      ...(direct && { initializationUncertain: true }),
    });
    const log = logger.child({ action: 'CINETPAY_INIT', paymentId, ...(direct && { direct }) });
    // Durée réelle de l'appel au fournisseur, pour le diagnostic (jamais une donnée métier).
    const startedAt = Date.now();

    try {
      const returnUrl = this.returnUrlOf(paymentId);
      const created = await client.createPayment({
        merchantTransactionId,
        amount,
        currency: PAYMENT_CURRENCY,
        lang: this.options.lang ?? 'fr',
        designation: `Achat de ${request.tokens} jetons Le Ter`,
        ...(request.customer.email && { clientEmail: request.customer.email }),
        clientFirstName: request.customer.firstName.trim(),
        clientLastName: request.customer.lastName.trim(),
        successUrl: returnUrl,
        failedUrl: returnUrl,
        notifyUrl: this.options.notifyUrl,
        channel: 'PUSH',
        // Numéro d'inscription (D-088), pour la page hébergée comme pour le paiement direct.
        clientPhoneNumber: request.customer.phone ?? request.msisdn,
        ...(direct && { direct: { paymentMethod: direct, phoneNumber: request.msisdn } }),
        ...(preselected && { pagePaymentMethod: preselected }),
      });
      // Paiement direct lancé sur le téléphone : aucune page à ouvrir. Si CinetPay exige une
      // redirection, la page est proposée comme telle (jamais présentée comme directe).
      const paymentUrl = created.mustBeRedirected ? created.paymentUrl : undefined;
      await payments.recordInitialization(
        paymentId,
        {
          providerReference: created.transactionId,
          ...(paymentUrl && { paymentUrl }),
          notifyTokenHash: hashNotifyToken(created.notifyToken),
          // Statut annoncé à la création (même SUCCESS) : noté, jamais une preuve.
          ...(created.initialStatus && {
            providerStatus: created.initialStatus,
            initialStatus: created.initialStatus,
          }),
          mustBeRedirected: created.mustBeRedirected,
        },
        this.clock(),
      );
      log.info('cinetpay payment initialized', {
        amount,
        merchantTransactionId,
        providerReference: created.transactionId,
        durationMs: Date.now() - startedAt,
        mustBeRedirected: created.mustBeRedirected,
        ...(created.initialStatus && { initialStatus: created.initialStatus }),
      });
      return {
        providerReference: created.transactionId,
        paymentId,
        ...(paymentUrl && { paymentUrl }),
      };
    } catch (err) {
      const reason = failureReasonOf(err);
      const failure = classifyPaymentFailure(err);
      try {
        this.options.onInitializationFailure?.(failure);
      } catch {
        // La surveillance ne doit jamais changer l'issue d'un paiement.
      }
      if (direct && !isCertainRefusal(err)) {
        // La demande a pu atteindre le téléphone : ni échec déclaré ni crédit ; la
        // réconciliation recherche le paiement chez CinetPay par merchant_transaction_id.
        log.warn('cinetpay direct payment initialization uncertain', {
          reason,
          category: 'OUTCOME_UNKNOWN',
          merchantTransactionId,
          durationMs: Date.now() - startedAt,
          pageFallback: false,
        });
        await payments.markInitializationUncertain(paymentId, reason, this.clock());
        throw new PaymentInitializationUncertainError(paymentId);
      }
      log.warn('cinetpay payment initialization failed', {
        reason,
        category: failure.category,
        retryable: failure.retryable,
        sent: failure.sent,
        merchantTransactionId,
        durationMs: Date.now() - startedAt,
        // Repli vers la page CinetPay : seulement après un refus CERTAIN d'un paiement direct
        // (D-090) ; une demande jamais partie (fournisseur injoignable) n'est pas repliée.
        pageFallback: Boolean(
          direct && isCertainRefusal(err) && !(err instanceof CinetPayPaymentNotSentError),
        ),
        ...(err instanceof CinetPayError &&
          err.details.apiCode !== undefined && { apiCode: err.details.apiCode }),
      });
      await payments.markInitializationFailed(paymentId, reason, this.clock()).catch(() => {
        // Le paiement reste PENDING sans référence : jamais crédité (aucune notification
        // ne peut être vérifiée sans référence ni empreinte).
      });
      // Refus explicite d'un paiement direct (opérateur non autorisé…) : le joueur peut payer
      // par la page CinetPay.
      // (Demande jamais partie — authentification refusée… — : service indisponible, 503.)
      if (direct && isCertainRefusal(err) && !(err instanceof CinetPayPaymentNotSentError)) {
        throw new DirectPaymentUnavailableError('PROVIDER_REFUSED');
      }
      throw err;
    }
  }

  requestDisbursement(): Promise<MobileMoneyRequestResult> {
    return Promise.reject(new MobileMoneyNotConfiguredError());
  }

  private returnUrlOf(paymentId: string): string {
    return `${this.options.returnUrl.replace(/\/+$/, '')}/${paymentId}`;
  }
}
