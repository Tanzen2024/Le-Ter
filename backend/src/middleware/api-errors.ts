import {
  IdempotencyKeyReusedError,
  InsufficientBalanceError,
  MobileMoneyUnavailableError,
} from '../domain/wallet/wallet';
import {
  PaymentNotFoundError,
  PaymentNotificationRejectedError,
  PaymentProfileIncompleteError,
  PaymentVerificationError,
} from '../domain/payments/payment';
import { CinetPayError } from '../services/payments/cinetpay/cinetpay-client';
import { STATUS_CODES } from 'node:http';

import { toAdminApiError } from './admin-errors';
import { toTournamentApiError } from './tournament-errors';

import { InvalidCardError } from '../domain/cards/card';
import {
  AlertNotFoundError,
  AlertStatusConflictError,
  AlertTransitionNotAllowedError,
} from '../domain/detection/alert-admin';
import { GeolocationDisabledError } from '../domain/detection/geo';
import { AccessForbiddenError } from './require-role';
import {
  ChatClosedError,
  ChatMessageKeyReusedError,
  ChatRateLimitedError,
} from '../domain/chat/chat';
import {
  CardNotInHandError,
  CardNotPlayableError,
  FleeNotAllowedError,
  GameAccessDeniedError,
  FirstPlayerNotInGameError,
  GameAlreadyStartedError,
  GameFinishedError,
  GameFullError,
  GameNotFoundError,
  GameNotEnoughPlayersError,
  GameNotInProgressError,
  GameNotJoinableError,
  GameRuleViolationError,
  GameStartForbiddenError,
  GameVersionConflictError,
  IdempotencyKeyReuseError,
  InvalidStatusTransitionError,
  InvalidPlayerCountError,
  NotAWinningHandError,
  NotYourTurnError,
  ParticipationRefusedError,
  TurnExpiredError,
  PlayerHasFledError,
  WinDeclarationNotAllowedError,
} from '../domain/game/game-errors';
import { InvalidGameIdError } from '../domain/game/game-id';
import { UnresolvedRuleError } from '../domain/rules/unresolved-rule';
import {
  FirstPlayerUndeterminedError,
  InvalidSessionIdError,
  NoDecisionPendingError,
  NotASessionMemberError,
  PlayerAlreadyInSessionError,
  PlayerInActiveGameError,
  SessionClosedError,
  SessionDecisionInProgressError,
  SessionFullError,
  SessionPasswordInvalidError,
  SessionGameInProgressError,
  SessionMaxPlayersImmutableError,
  SessionNotFoundError,
} from '../domain/sessions/session';
import {
  AccountDisabledError,
  AuthenticationRequiredError,
  CONFLICT_MESSAGES,
  CurrentPasswordIncorrectError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RegistrationConflictError,
} from '../services/auth/auth-errors';
import { ValidationError } from '../validators/validation-error';

/**
 * Traduction des erreurs applicatives connues en réponses HTTP (D-029, D-030).
 *
 * Le client reçoit un `code` stable et un message FIXE, en français : les messages
 * internes des erreurs (qui citent des identifiants ou des cartes) ne sont jamais
 * recopiés. Toute erreur absente d'ici est une panne (500).
 */
export interface ApiError {
  status: number;
  body: {
    error: string;
    code: string;
    message: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  };
}

function apiError(
  status: number,
  code: string,
  message: string,
  extra: { fields?: Record<string, string>; details?: Record<string, unknown> } = {},
): ApiError {
  return { status, body: { error: STATUS_CODES[status] ?? 'Error', code, message, ...extra } };
}

/** Violations des règles du jeu : 422, code par cas (l'état de la partie est inchangé). */
const RULE_VIOLATIONS: readonly [abstract new (...args: never[]) => Error, string, string][] = [
  [NotYourTurnError, 'NOT_YOUR_TURN', "Ce n'est pas votre tour."],
  [CardNotInHandError, 'CARD_NOT_IN_HAND', "Cette carte n'est pas dans votre main."],
  [CardNotPlayableError, 'CARD_NOT_PLAYABLE', 'Cette carte ne peut pas être jouée maintenant.'],
  [PlayerHasFledError, 'PLAYER_HAS_FLED', 'Vous avez quitté cette partie.'],
  [NotAWinningHandError, 'NOT_A_WINNING_HAND', "Votre main n'est pas gagnante."],
  [
    WinDeclarationNotAllowedError,
    'WIN_DECLARATION_NOT_ALLOWED',
    'Vous ne pouvez pas déclarer une main gagnante maintenant.',
  ],
  [FleeNotAllowedError, 'FLEE_NOT_ALLOWED', 'Vous ne pouvez pas fuir maintenant.'],
  [GameNotInProgressError, 'GAME_NOT_IN_PROGRESS', "La partie n'a pas encore commencé."],
  [
    GameNotEnoughPlayersError,
    'NOT_ENOUGH_PLAYERS',
    'Il faut au moins 2 joueurs pour démarrer la partie.',
  ],
];

export function toApiError(err: unknown): ApiError | undefined {
  // --- Tournois (D-051, D-054) --------------------------------------------------
  const tournamentError = toTournamentApiError(err);
  if (tournamentError) {
    return tournamentError;
  }
  // --- Administration de la plateforme (D-061) -----------------------------------
  const adminError = toAdminApiError(err);
  if (adminError) {
    return adminError;
  }
  // --- Détection : géolocalisation (D-046) -------------------------------------
  // --- Administration de la détection (D-049) -----------------------------------
  if (err instanceof AccessForbiddenError) {
    return apiError(403, 'FORBIDDEN', "Vous n'avez pas accès à cette ressource.");
  }
  if (err instanceof AlertNotFoundError) {
    return apiError(404, 'ALERT_NOT_FOUND', 'Alerte introuvable.');
  }
  if (err instanceof AlertTransitionNotAllowedError) {
    return apiError(409, 'ALERT_TRANSITION_NOT_ALLOWED', 'Ce changement de statut est interdit.', {
      details: { from: err.from, to: err.to },
    });
  }
  if (err instanceof AlertStatusConflictError) {
    return apiError(409, 'ALERT_STATUS_CONFLICT', "Le statut de l'alerte a changé entre-temps.", {
      details: { expected: err.expected, current: err.current },
    });
  }
  if (err instanceof GeolocationDisabledError) {
    return apiError(
      409,
      'DETECTION_DISABLED',
      "La détection anti-collusion n'est pas activée pour cette partie.",
    );
  }
  // --- Chat de partie (D-045) -------------------------------------------------
  if (err instanceof ChatClosedError) {
    return apiError(409, 'CHAT_CLOSED', 'La partie est terminée : le chat est en lecture seule.');
  }
  if (err instanceof ChatMessageKeyReusedError) {
    return apiError(
      422,
      'IDEMPOTENCY_KEY_REUSED',
      'Cette clé d’envoi a déjà servi pour un autre message.',
    );
  }
  if (err instanceof ChatRateLimitedError) {
    return apiError(429, 'RATE_LIMITED', 'Trop de messages. Patientez quelques secondes.', {
      details: { retryAfterMs: err.retryAfterMs },
    });
  }

  // --- Compte de jeu (D-040) --------------------------------------------------
  if (err instanceof InsufficientBalanceError) {
    return apiError(409, 'INSUFFICIENT_BALANCE', 'Solde insuffisant.');
  }
  if (err instanceof IdempotencyKeyReusedError) {
    return apiError(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'Cette demande a déjà été utilisée pour une autre opération.',
    );
  }
  if (err instanceof MobileMoneyUnavailableError) {
    return apiError(
      503,
      'MOBILE_MONEY_UNAVAILABLE',
      'Le service de paiement est indisponible : l’opération n’a pas été effectuée.',
    );
  }

  // --- Paiements CinetPay (D-050) -----------------------------------------------
  // Paiement d'un autre joueur ou inconnu : même réponse (aucune fuite d'existence).
  if (err instanceof PaymentNotFoundError) {
    return apiError(404, 'PAYMENT_NOT_FOUND', 'Paiement introuvable.');
  }
  // Prénom ou nom d'une lettre : refus clair, rien n'est créé (aucune modification du compte).
  if (err instanceof PaymentProfileIncompleteError) {
    const message = 'Doit contenir au moins 2 caractères pour un paiement CinetPay.';
    return apiError(
      422,
      'PAYMENT_PROFILE_INCOMPLETE',
      'Votre prénom et votre nom doivent contenir au moins 2 caractères pour payer par CinetPay. Contactez l’assistance pour mettre à jour votre profil.',
      { fields: Object.fromEntries(err.fields.map((field) => [field, message])) },
    );
  }
  if (err instanceof PaymentNotificationRejectedError) {
    return apiError(401, 'NOTIFICATION_REJECTED', 'Notification refusée.');
  }
  if (err instanceof PaymentVerificationError) {
    return apiError(409, 'PAYMENT_VERIFICATION_FAILED', 'Le paiement n’a pas pu être vérifié.');
  }
  // Fournisseur injoignable pendant une vérification : CinetPay renverra la notification.
  if (err instanceof CinetPayError) {
    return apiError(
      502,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Le fournisseur de paiement est injoignable.',
    );
  }

  // --- Entrées et authentification -------------------------------------------
  if (err instanceof ValidationError) {
    return apiError(400, 'VALIDATION_ERROR', err.message, { fields: err.fields });
  }
  if (err instanceof InvalidCredentialsError) {
    return apiError(401, 'INVALID_CREDENTIALS', err.message);
  }
  if (err instanceof CurrentPasswordIncorrectError) {
    return apiError(400, 'INVALID_CURRENT_PASSWORD', err.message, {
      fields: { currentPassword: err.message },
    });
  }
  if (err instanceof InvalidRefreshTokenError) {
    return apiError(401, 'INVALID_REFRESH_TOKEN', err.message);
  }
  if (err instanceof AuthenticationRequiredError) {
    return apiError(401, 'UNAUTHENTICATED', err.message);
  }
  if (err instanceof AccountDisabledError) {
    return apiError(403, 'ACCOUNT_DISABLED', err.message);
  }
  if (err instanceof RegistrationConflictError) {
    const fields = Object.fromEntries(err.fields.map((f) => [f, CONFLICT_MESSAGES[f]]));
    return apiError(409, 'CONFLICT', err.message, { fields });
  }

  // --- Sessions (D-033) ----------------------------------------------------------
  if (err instanceof InvalidSessionIdError) {
    return apiError(400, 'VALIDATION_ERROR', 'Identifiant de session invalide.', {
      fields: { sessionId: 'Identifiant de session invalide.' },
    });
  }
  if (err instanceof SessionNotFoundError) {
    return apiError(404, 'SESSION_NOT_FOUND', 'Session introuvable.');
  }
  if (err instanceof NotASessionMemberError) {
    return apiError(403, 'NOT_A_SESSION_MEMBER', 'Vous n’êtes pas membre de cette session.');
  }
  if (err instanceof SessionClosedError) {
    return apiError(409, 'SESSION_CLOSED', 'Cette session est fermée.');
  }
  if (err instanceof SessionGameInProgressError) {
    return apiError(
      409,
      'SESSION_GAME_IN_PROGRESS',
      'Une partie est déjà en cours dans cette session.',
    );
  }
  if (err instanceof PlayerInActiveGameError) {
    return apiError(
      409,
      'PLAYER_IN_ACTIVE_GAME',
      'Vous participez à une partie de cette session : vous ne pouvez pas la quitter maintenant.',
    );
  }
  if (err instanceof SessionPasswordInvalidError) {
    return apiError(403, 'TABLE_PASSWORD_INVALID', 'Mot de passe incorrect.');
  }
  if (err instanceof SessionFullError) {
    return apiError(409, 'SESSION_FULL', 'Tous les sièges de cette session sont occupés.');
  }
  if (err instanceof PlayerAlreadyInSessionError) {
    return apiError(
      409,
      'ALREADY_IN_SESSION',
      'Vous êtes déjà présent dans une autre session. Quittez-la d’abord.',
    );
  }
  if (err instanceof SessionDecisionInProgressError) {
    return apiError(
      409,
      'SESSION_DECISION_IN_PROGRESS',
      'Les joueurs choisissent de poursuivre ou de quitter : réessayez dans quelques secondes.',
    );
  }
  if (err instanceof NoDecisionPendingError) {
    return apiError(409, 'NO_DECISION_PENDING', 'Aucune décision n’est attendue maintenant.');
  }
  if (err instanceof SessionMaxPlayersImmutableError) {
    return apiError(
      409,
      'SESSION_MAX_PLAYERS_IMMUTABLE',
      'Le nombre de joueurs est fixé à la création de la session.',
      { details: { maxPlayers: err.maxPlayers } },
    );
  }
  if (err instanceof FirstPlayerUndeterminedError) {
    return apiError(
      409,
      'FIRST_PLAYER_UNDETERMINED',
      'Le premier joueur ne peut pas être déterminé : la partie précédente n’a pas de gagnant.',
    );
  }
  if (err instanceof FirstPlayerNotInGameError) {
    return apiError(
      409,
      'FIRST_PLAYER_NOT_IN_GAME',
      'Le premier joueur de cette partie ne l’a pas rejointe : elle ne peut pas démarrer.',
    );
  }

  // --- Parties (multi-game-architecture.md §7) ---------------------------------
  if (err instanceof InvalidGameIdError) {
    return apiError(400, 'VALIDATION_ERROR', 'Identifiant de partie invalide.', {
      fields: { gameId: 'Identifiant de partie invalide.' },
    });
  }
  if (err instanceof InvalidPlayerCountError) {
    return apiError(400, 'VALIDATION_ERROR', 'Nombre de joueurs invalide.', {
      fields: { maxPlayers: 'Nombre de joueurs invalide.' },
    });
  }
  if (err instanceof GameNotFoundError) {
    return apiError(404, 'GAME_NOT_FOUND', 'Partie introuvable.');
  }
  // 403 plutôt que 404 : l'existence d'une partie n'est pas secrète, son contenu l'est.
  if (err instanceof GameAccessDeniedError) {
    return apiError(403, 'NOT_A_MEMBER', "Vous n'êtes pas membre de cette partie.");
  }
  // R-18 : une seule partie active par joueur.
  if (err instanceof ParticipationRefusedError) {
    return apiError(
      409,
      'ALREADY_IN_ACTIVE_GAME',
      'Vous participez déjà à une partie active. Terminez-la avant d’en rejoindre une autre.',
    );
  }
  if (err instanceof GameStartForbiddenError) {
    return apiError(403, 'ONLY_CREATOR_CAN_START', 'Seul le créateur peut démarrer la partie.');
  }
  if (err instanceof GameAlreadyStartedError) {
    return apiError(409, 'GAME_ALREADY_STARTED', 'La partie a déjà commencé.');
  }
  if (err instanceof IdempotencyKeyReuseError) {
    return apiError(
      422,
      'IDEMPOTENCY_KEY_REUSED',
      'Cette clé d’idempotence a déjà servi pour une autre création.',
    );
  }
  if (err instanceof InvalidStatusTransitionError) {
    return apiError(409, 'INVALID_STATUS_TRANSITION', 'Cette transition de partie est interdite.');
  }
  if (err instanceof GameVersionConflictError) {
    return apiError(
      409,
      'VERSION_CONFLICT',
      'La partie a changé entre-temps. Rechargez son état.',
      { details: { currentVersion: err.actualVersion } },
    );
  }
  if (err instanceof GameFullError) {
    return apiError(409, 'GAME_FULL', 'La partie est complète.');
  }
  if (err instanceof GameNotJoinableError) {
    return apiError(409, 'GAME_NOT_JOINABLE', "La partie n'accepte plus de joueurs.");
  }
  if (err instanceof GameFinishedError) {
    return apiError(409, 'GAME_FINISHED', 'La partie est terminée.');
  }
  if (err instanceof TurnExpiredError) {
    return apiError(409, 'TURN_EXPIRED', 'Le temps de votre tour est écoulé.');
  }
  for (const [type, code, message] of RULE_VIOLATIONS) {
    if (err instanceof type) {
      return apiError(422, code, message);
    }
  }
  if (err instanceof GameRuleViolationError) {
    return apiError(422, 'GAME_RULE_VIOLATION', 'Action refusée par les règles du jeu.');
  }
  if (err instanceof InvalidCardError) {
    return apiError(422, 'INVALID_CARD', 'Carte inconnue.');
  }
  // Règle métier non tranchée (docs/TODO.md) : le serveur refuse plutôt que de deviner.
  if (err instanceof UnresolvedRuleError) {
    return apiError(501, 'RULE_NOT_DEFINED', "Cette règle du jeu n'est pas encore définie.", {
      details: { ruleRef: err.ruleRef },
    });
  }
  return undefined;
}
