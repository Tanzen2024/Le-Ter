import { STATUS_CODES } from 'node:http';

import {
  MoneyOverflowError,
  PayoutBeneficiaryNotFoundError,
  PlatformPayoutNotFoundError,
  PlatformPayoutNotificationRejectedError,
  PlatformPayoutRefusedError,
  PlatformPayoutsDisabledError,
  TreasuryProviderUnavailableError,
  type PayoutRefusalReason,
} from '../domain/platform-finance/platform-finance';
import type { ApiError } from './api-errors';

const REFUSALS: Record<PayoutRefusalReason, [number, string]> = {
  SAME_ADMIN: [
    403,
    'Un autre administrateur doit prendre cette décision (séparation des responsabilités).',
  ],
  INVALID_TRANSITION: [409, 'Cette action n’est pas possible dans l’état actuel du retrait.'],
  BENEFICIARY_NOT_ACTIVE: [409, 'Le bénéficiaire n’est pas vérifié et actif.'],
  BENEFICIARY_ALREADY_EXISTS: [409, 'Ce numéro est déjà enregistré comme bénéficiaire.'],
  BENEFICIARY_NOT_PENDING: [409, 'Ce bénéficiaire n’est pas en attente de vérification.'],
  AMOUNT_EXCEEDS_WITHDRAWABLE: [
    409,
    'Le montant dépasse le montant retirable actuel (frais compris).',
  ],
  TREASURY_NOT_CONFIRMED: [
    409,
    'La trésorerie CinetPay n’est pas confirmée (relecture absente, en erreur ou de plus de 15 minutes).',
  ],
  INCONSISTENT_DATA: [
    409,
    'Les données financières sont incohérentes : aucun montant n’est engagé.',
  ],
  FEE_SCHEDULE_UNKNOWN: [409, 'Le barème des frais de transfert n’est pas configuré.'],
  NOTHING_AVAILABLE: [409, 'Aucun montant n’est retirable actuellement.'],
  CONCURRENT_UPDATE: [409, 'Ce retrait a été modifié entre-temps : rechargez-le.'],
  IDEMPOTENCY_KEY_REUSED: [409, 'Cette demande a déjà été utilisée pour une autre opération.'],
};

function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return {
    status,
    body: { error: STATUS_CODES[status] ?? 'Error', code, message, ...(details && { details }) },
  };
}

/** Erreurs des finances de la plateforme (D-078) : messages fixes, aucun secret ni numéro. */
export function toPlatformFinanceApiError(err: unknown): ApiError | undefined {
  if (err instanceof PlatformPayoutRefusedError) {
    const [status, message] = REFUSALS[err.reason];
    return apiError(status, 'PLATFORM_PAYOUT_REFUSED', message, {
      reason: err.reason,
      ...err.details,
    });
  }
  if (err instanceof PlatformPayoutsDisabledError) {
    return apiError(
      503,
      'PLATFORM_PAYOUTS_DISABLED',
      'L’exécution des retraits de la plateforme est désactivée sur ce serveur : aucun transfert n’a été initié.',
      { reason: err.reason },
    );
  }
  if (err instanceof PlatformPayoutNotFoundError) {
    return apiError(404, 'PLATFORM_PAYOUT_NOT_FOUND', 'Retrait de la plateforme introuvable.');
  }
  if (err instanceof PayoutBeneficiaryNotFoundError) {
    return apiError(404, 'PAYOUT_BENEFICIARY_NOT_FOUND', 'Bénéficiaire introuvable.');
  }
  if (err instanceof TreasuryProviderUnavailableError) {
    return apiError(
      503,
      'TREASURY_PROVIDER_UNAVAILABLE',
      'CinetPay n’est pas configuré : aucune relecture possible.',
    );
  }
  if (err instanceof PlatformPayoutNotificationRejectedError) {
    return apiError(401, 'NOTIFICATION_REJECTED', 'Notification refusée.');
  }
  if (err instanceof MoneyOverflowError) {
    return apiError(
      409,
      'INCONSISTENT_FINANCIAL_DATA',
      'Montant hors limites : aucune décision n’est prise.',
    );
  }
  return undefined;
}
