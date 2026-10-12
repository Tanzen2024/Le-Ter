import type {
  TransferGateway,
  TransferLookup,
  TransferRequest,
  TransferSubmission,
} from '../../withdrawals/transfer.gateway';
import {
  CINETPAY_TRANSACTION_EXIST,
  CINETPAY_TRANSFER_REJECTION_CODES,
  CinetPayError,
  CinetPayTransferNotSentError,
  type CinetPayClient,
} from './cinetpay-client';
import { CINETPAY_MAX_URL_LENGTH } from './cinetpay.gateway';

/** Motif transmis à CinetPay (1 à 255 caractères, SDK), sans donnée personnelle. */
const TRANSFER_REASON = 'Retrait de jetons Le Ter';

/**
 * Fournisseur de TRANSFERT CinetPay v1 (D-075) : `POST /v1/transfer` et
 * `GET /v1/transfer/{merchant_transaction_id}`, contrats relevés dans le code du SDK officiel
 * `cinetpay-js` (`src/api/transfer.ts`, `src/types/transfer.ts`). Ce n'est PAS l'API de
 * collecte (`/v1/payment`) utilisée pour les achats.
 *
 * Classement : échec avant l'émission de `POST /v1/transfer` → `not_sent` (certain) ; code
 * API de refus connu (`CINETPAY_TRANSFER_REJECTION_CODES`) → `rejected` (annonce du
 * fournisseur, jamais une preuve de non-exécution) ; tout le reste (délai, réseau, HTTP 5xx,
 * réponse illisible, code inconnu) → `uncertain`.
 *
 * Sans `notifyUrl` (`CINETPAY_TRANSFERS_ENABLED=false`) : relecture seulement, aucun envoi.
 */
export class CinetPayTransferGateway implements TransferGateway {
  readonly canSubmit: boolean;
  readonly canLookup = true;

  constructor(
    private readonly options: {
      client: Pick<CinetPayClient, 'createTransfer' | 'getTransferStatus'>;
      /**
       * URL publique HTTPS de POST /api/withdrawals/cinetpay/notify (≤ 120 caractères).
       * Absente : nouveaux transferts désactivés, relecture des transferts existants seulement.
       */
      notifyUrl?: string;
      /** Motif transmis à CinetPay (1 à 255 caractères) ; défaut : retrait de jetons. */
      reason?: string;
    },
  ) {
    if (options.notifyUrl !== undefined && options.notifyUrl.length > CINETPAY_MAX_URL_LENGTH) {
      throw new Error(`CinetPay : notifyUrl dépasse ${CINETPAY_MAX_URL_LENGTH} caractères`);
    }
    this.canSubmit = options.notifyUrl !== undefined;
  }

  async submit(request: TransferRequest): Promise<TransferSubmission> {
    const notifyUrl = this.options.notifyUrl;
    // Garde-fou : transferts désactivés, jamais d'appel à POST /v1/transfer.
    if (!this.canSubmit || notifyUrl === undefined) {
      return { kind: 'not_sent', errorCode: 'TRANSFERS_DISABLED' };
    }
    try {
      const created = await this.options.client.createTransfer({
        merchantTransactionId: request.merchantTransactionId,
        phoneNumber: request.phoneNumber,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: request.operator,
        reason: this.options.reason ?? TRANSFER_REASON,
        notifyUrl,
      });
      return {
        kind: 'accepted',
        providerReference: created.transactionId,
        providerStatus: created.status,
        ...(created.notifyToken && { notifyToken: created.notifyToken }),
        ...(created.feeAmount !== undefined && { feeAmount: created.feeAmount }),
      };
    } catch (err) {
      return classify(err);
    }
  }

  async lookup(merchantTransactionId: string): Promise<TransferLookup> {
    const status = await this.options.client.getTransferStatus(merchantTransactionId);
    if (!status.found) return { found: false };
    return {
      found: true,
      providerReference: status.transactionId,
      merchantTransactionId: status.merchantTransactionId,
      providerStatus: status.status,
      ...(status.amount !== undefined && { amount: status.amount }),
      ...(status.currency !== undefined && { currency: status.currency }),
      ...(status.feeAmount !== undefined && { feeAmount: status.feeAmount }),
    };
  }
}

function classify(err: unknown): TransferSubmission {
  if (err instanceof CinetPayTransferNotSentError) {
    const cause = err.cause;
    return {
      kind: 'not_sent',
      errorCode:
        cause instanceof CinetPayError ? `CINETPAY_${cause.kind.toUpperCase()}` : 'NOT_SENT',
    };
  }
  if (!(err instanceof CinetPayError)) {
    return { kind: 'uncertain', errorCode: err instanceof Error ? err.name : 'UNKNOWN' };
  }
  const { apiCode, apiStatus } = err.details;
  if (apiCode === CINETPAY_TRANSACTION_EXIST || apiStatus === 'TRANSACTION_EXIST') {
    return { kind: 'already_exists' };
  }
  // Authentification refusée APRÈS un premier POST (jeton expiré, renouvellement refusé) :
  // une requête de transfert est partie, l'issue n'est pas connue localement.
  if (err.kind === 'authentication') {
    return { kind: 'uncertain', errorCode: 'CINETPAY_AUTHENTICATION_AFTER_SEND' };
  }
  if (
    (err.kind === 'api' || err.kind === 'http') &&
    apiCode !== undefined &&
    CINETPAY_TRANSFER_REJECTION_CODES.has(apiCode)
  ) {
    return { kind: 'rejected', providerStatus: apiStatus ?? String(apiCode) };
  }
  return {
    kind: 'uncertain',
    errorCode: `CINETPAY_${err.kind.toUpperCase()}${apiCode !== undefined ? `_${apiCode}` : ''}`,
  };
}
