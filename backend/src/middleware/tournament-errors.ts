import { STATUS_CODES } from 'node:http';

import {
  AlreadyRegisteredError,
  InvalidTournamentError,
  InvalidTournamentIdError,
  InvalidTournamentTransitionError,
  NotRegisteredError,
  NotTournamentCreatorError,
  TooManyPendingTournamentsError,
  TooManyWaitingTournamentsError,
  TOURNAMENT_LIMITS,
  TournamentAccessDeniedError,
  TournamentBusyError,
  TournamentCancelledError,
  TournamentCompletedError,
  TournamentFullError,
  TournamentGameInProgressError,
  TournamentLockedError,
  TournamentNotFoundError,
  TournamentNotStartedError,
  TournamentOutOfTokensError,
  TournamentOverlapError,
  TournamentRegistrationClosedError,
  TournamentResultsUnavailableError,
  TournamentStartedError,
} from '../domain/tournaments/tournament';
import { ReservationNotActiveError } from '../repositories/wallet-reservations';
import type { ApiError } from './api-errors';

function apiError(
  status: number,
  code: string,
  message: string,
  extra: { fields?: Record<string, string>; details?: Record<string, unknown> } = {},
): ApiError {
  return { status, body: { error: STATUS_CODES[status] ?? 'Error', code, message, ...extra } };
}

/** [type d'erreur, statut, code stable, message FIXE en français]. */
const SIMPLE: readonly [abstract new (...args: never[]) => Error, number, string, string][] = [
  [TournamentNotFoundError, 404, 'TOURNAMENT_NOT_FOUND', 'Tournoi introuvable.'],
  [AlreadyRegisteredError, 409, 'ALREADY_REGISTERED', 'Vous êtes déjà inscrit à ce tournoi.'],
  // Message convivial (D-057) : capacité atteinte, rien de grave pour le joueur.
  [
    TournamentFullError,
    409,
    'TOURNAMENT_FULL',
    'Tournoi complet 🎉 Ce tournoi a atteint son nombre maximum de participants. Merci pour ton intérêt !',
  ],
  [
    TournamentRegistrationClosedError,
    409,
    'REGISTRATION_CLOSED',
    'Les inscriptions à ce tournoi sont fermées.',
  ],
  [TournamentStartedError, 409, 'TOURNAMENT_STARTED', 'Ce tournoi a déjà démarré.'],
  [TournamentNotStartedError, 409, 'TOURNAMENT_NOT_STARTED', "Ce tournoi n'a pas encore commencé."],
  [TournamentCompletedError, 409, 'TOURNAMENT_COMPLETED', 'Ce tournoi est terminé.'],
  [TournamentCancelledError, 409, 'TOURNAMENT_CANCELLED', 'Ce tournoi a été annulé.'],
  [
    TournamentOverlapError,
    409,
    'TOURNAMENT_OVERLAP',
    'Un autre tournoi est déjà programmé sur ce créneau.',
  ],
  [
    TooManyPendingTournamentsError,
    409,
    'TOO_MANY_PENDING_TOURNAMENTS',
    'Vous avez déjà un tournoi en attente : attendez sa validation ou retirez-le.',
  ],
  [
    TooManyWaitingTournamentsError,
    409,
    'TOO_MANY_WAITING_TOURNAMENTS',
    `Limite atteinte : ${TOURNAMENT_LIMITS.maxWaitingTournaments} tournois sont déjà en attente de démarrage. Réessaie dès que l’un d’eux aura commencé.`,
  ],
  [
    TournamentLockedError,
    409,
    'TOURNAMENT_LOCKED',
    'Ce tournoi ne peut plus être modifié de cette façon.',
  ],
  [
    InvalidTournamentTransitionError,
    409,
    'TOURNAMENT_TRANSITION_NOT_ALLOWED',
    'Cette action n’est pas possible dans l’état actuel du tournoi.',
  ],
  [
    TournamentOutOfTokensError,
    409,
    'TOURNAMENT_OUT_OF_TOKENS',
    'Vous n’avez plus assez de jetons de tournoi pour une nouvelle partie.',
  ],
  [
    TournamentGameInProgressError,
    409,
    'TOURNAMENT_GAME_IN_PROGRESS',
    'Une partie est en cours à votre table : vous jouerez la suivante.',
  ],
  [
    TournamentResultsUnavailableError,
    409,
    'TOURNAMENT_RESULTS_UNAVAILABLE',
    'Les résultats de ce tournoi ne sont pas encore disponibles.',
  ],
  [
    NotRegisteredError,
    403,
    'NOT_REGISTERED',
    'Vous n’êtes pas inscrit à ce tournoi : les inscriptions sont fermées.',
  ],
  [
    NotTournamentCreatorError,
    403,
    'NOT_TOURNAMENT_CREATOR',
    'Seul le créateur de ce tournoi peut faire cette action.',
  ],
  [
    TournamentAccessDeniedError,
    403,
    'TOURNAMENT_ACCESS_DENIED',
    'Cette table est réservée aux participants du tournoi en cours.',
  ],
  [
    TournamentBusyError,
    409,
    'TOURNAMENT_BUSY',
    'Beaucoup de joueurs rejoignent le tournoi en même temps : réessayez dans un instant.',
  ],
  [
    ReservationNotActiveError,
    409,
    'RESERVATION_NOT_ACTIVE',
    'La réservation de cette inscription n’est plus active.',
  ],
];

/**
 * Erreurs des tournois (D-051, D-054) → réponses HTTP : `code` stable, message FIXE, jamais
 * le message interne (identifiants). Appelée par `toApiError`.
 */
export function toTournamentApiError(err: unknown): ApiError | undefined {
  if (err instanceof InvalidTournamentIdError) {
    return apiError(400, 'VALIDATION_ERROR', 'Identifiant de tournoi invalide.', {
      fields: { tournamentId: 'Identifiant de tournoi invalide.' },
    });
  }
  if (err instanceof InvalidTournamentError) {
    return apiError(400, 'VALIDATION_ERROR', 'Certaines informations sont invalides.', {
      fields: err.fields,
    });
  }
  for (const [type, status, code, message] of SIMPLE) {
    if (err instanceof type) return apiError(status, code, message);
  }
  return undefined;
}
