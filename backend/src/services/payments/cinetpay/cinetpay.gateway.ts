import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  amountForTokens,
  isAllowedDepositAmount,
  PAYMENT_CURRENCY,
  PaymentProfileIncompleteError,
} from '../../../domain/payments/payment';
import type { PaymentRepository } from '../../../repositories/payment.repository';
import type { Logger } from '../../../utils/logger';
import {
  MobileMoneyNotConfiguredError,
  type MobileMoneyCustomer,
  type MobileMoneyGateway,
  type MobileMoneyRequest,
  type MobileMoneyRequestResult,
} from '../../wallet/mobile-money.gateway';
import type { CinetPayClient } from './cinetpay-client';

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
  clock?: () => Date;
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
  readonly disbursementAvailable = false;
  private readonly clock: () => Date;

  constructor(private readonly options: CinetPayGatewayOptions) {
    this.clock = options.clock ?? (() => new Date());
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
    ];
    if (fields.length > 0) throw new PaymentProfileIncompleteError(fields);
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
    });
    const log = logger.child({ action: 'CINETPAY_INIT', paymentId });

    try {
      const returnUrl = this.returnUrlOf(paymentId);
      const created = await client.createPayment({
        merchantTransactionId,
        amount,
        currency: PAYMENT_CURRENCY,
        lang: this.options.lang ?? 'fr',
        designation: `Achat de ${request.tokens} jetons Le Ter`,
        clientEmail: request.customer.email,
        clientFirstName: request.customer.firstName.trim(),
        clientLastName: request.customer.lastName.trim(),
        successUrl: returnUrl,
        failedUrl: returnUrl,
        notifyUrl: this.options.notifyUrl,
        channel: 'PUSH',
      });
      await payments.recordInitialization(
        paymentId,
        {
          providerReference: created.transactionId,
          paymentUrl: created.paymentUrl,
          notifyTokenHash: hashNotifyToken(created.notifyToken),
          ...(created.initialStatus && { providerStatus: created.initialStatus }),
        },
        this.clock(),
      );
      log.info('cinetpay payment initialized', { amount });
      return {
        providerReference: created.transactionId,
        paymentId,
        paymentUrl: created.paymentUrl,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'UnknownError';
      log.warn('cinetpay payment initialization failed', { reason });
      await payments.markInitializationFailed(paymentId, reason, this.clock()).catch(() => {
        // Le paiement reste PENDING sans référence : jamais crédité (aucune notification
        // ne peut être vérifiée sans référence ni empreinte).
      });
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
