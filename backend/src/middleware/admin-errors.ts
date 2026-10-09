import { STATUS_CODES } from 'node:http';

import {
  AdminIdempotencyConflictError,
  AdminResourceNotFoundError,
  AdminSessionExpiredError,
  AdminSessionRequiredError,
  PaymentProviderUnavailableError,
} from '../domain/admin/admin';
import type { ApiError } from './api-errors';

const NOT_FOUND_MESSAGES = {
  USER: 'Joueur introuvable.',
  GAME: 'Partie introuvable.',
  PAYMENT: 'Paiement introuvable.',
} as const;

function apiError(status: number, code: string, message: string): ApiError {
  return { status, body: { error: STATUS_CODES[status] ?? 'Error', code, message } };
}

/** Erreurs de l'administration (D-061) : code stable, message fixe en français. */
export function toAdminApiError(err: unknown): ApiError | undefined {
  if (err instanceof AdminSessionExpiredError) {
    return apiError(
      401,
      'ADMIN_SESSION_EXPIRED',
      err.reason === 'IDLE_TIMEOUT'
        ? "Session d'administration expirée après 30 minutes d'inactivité. Reconnectez-vous."
        : "Session d'administration expirée (8 heures au maximum). Reconnectez-vous.",
    );
  }
  if (err instanceof AdminSessionRequiredError) {
    return apiError(
      401,
      'ADMIN_SESSION_REQUIRED',
      "Connectez-vous à l'administration pour accéder à cette ressource.",
    );
  }
  if (err instanceof AdminResourceNotFoundError) {
    return apiError(404, `${err.resource}_NOT_FOUND`, NOT_FOUND_MESSAGES[err.resource]);
  }
  if (err instanceof PaymentProviderUnavailableError) {
    return apiError(
      503,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      "CinetPay n'est pas configuré sur ce serveur : aucune vérification n'est possible.",
    );
  }
  if (err instanceof AdminIdempotencyConflictError) {
    return apiError(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'Cette clé a déjà servi pour une autre opération.',
    );
  }
  return undefined;
}
