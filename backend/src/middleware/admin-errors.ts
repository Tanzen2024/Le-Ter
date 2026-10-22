import { STATUS_CODES } from 'node:http';

import {
  AdminIdempotencyConflictError,
  AdminResourceNotFoundError,
  AdminSessionExpiredError,
  AdminSessionRequiredError,
  PaymentProviderUnavailableError,
} from '../domain/admin/admin';
import {
  AdminNoteNotFoundError,
  ModerationConflictError,
  ModerationForbiddenError,
} from '../domain/admin/moderation';
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
  if (err instanceof ModerationForbiddenError) {
    return err.reason === 'SELF_ACTION'
      ? apiError(
          403,
          'SELF_ACTION_FORBIDDEN',
          'Cette action est interdite sur votre propre compte.',
        )
      : apiError(
          409,
          'LAST_ADMIN',
          'Impossible : c’est le dernier super administrateur encore actif.',
        );
  }
  if (err instanceof ModerationConflictError) {
    return apiError(409, err.code, MODERATION_CONFLICT_MESSAGES[err.code]);
  }
  if (err instanceof AdminNoteNotFoundError) {
    return apiError(404, 'NOTE_NOT_FOUND', 'Note introuvable.');
  }
  return undefined;
}

const MODERATION_CONFLICT_MESSAGES: Record<ModerationConflictError['code'], string> = {
  ALREADY_SUSPENDED: 'Ce joueur est déjà suspendu.',
  ALREADY_CHAT_RESTRICTED: 'Le chat de ce joueur est déjà restreint.',
  NOT_SUSPENDED: 'Ce joueur n’a aucune suspension en cours.',
  NOT_CHAT_RESTRICTED: 'Le chat de ce joueur n’est pas restreint.',
  NOTE_ALREADY_DELETED: 'Cette note est déjà supprimée.',
  RECOVERY_PLAYERS_ONLY:
    'La récupération par code est réservée aux joueurs ; un administrateur garde son accès par email.',
  ACCOUNT_NOT_ACTIVE: 'Ce compte n’est pas actif : réactivez-le avant de réinitialiser son accès.',
};
