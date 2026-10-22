import type { CardId } from '../cards/card';
import type { GaramCardId } from '../garam/garam-cards';
import type { GameId, PlayerId } from './game-id';

export class GameNotFoundError extends Error {
  constructor(readonly gameId: GameId) {
    super(`Partie introuvable : ${gameId}`);
    this.name = 'GameNotFoundError';
  }
}

/** L'acteur n'est pas membre de la partie qu'il tente de lire ou de modifier. */
export class GameAccessDeniedError extends Error {
  constructor(
    readonly gameId: GameId,
    readonly playerId: PlayerId,
  ) {
    super(`Le joueur ${playerId} n'a pas accès à la partie ${gameId}`);
    this.name = 'GameAccessDeniedError';
  }
}

/** L'état a changé depuis la version connue de l'appelant. */
export class GameVersionConflictError extends Error {
  constructor(
    readonly gameId: GameId,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `Conflit de version sur la partie ${gameId} : attendue ${expectedVersion}, actuelle ${actualVersion}`,
    );
    this.name = 'GameVersionConflictError';
  }
}

export class GameFullError extends Error {
  constructor(readonly gameId: GameId) {
    super(`La partie ${gameId} est complète`);
    this.name = 'GameFullError';
  }
}

export class GameNotJoinableError extends Error {
  constructor(readonly gameId: GameId) {
    super(`La partie ${gameId} n'accepte plus de joueurs`);
    this.name = 'GameNotJoinableError';
  }
}

export class GameFinishedError extends Error {
  constructor(readonly gameId: GameId) {
    super(`La partie ${gameId} est terminée`);
    this.name = 'GameFinishedError';
  }
}

export class InvalidPlayerCountError extends Error {
  constructor(readonly maxPlayers: number) {
    super(`Nombre de joueurs invalide : ${maxPlayers}`);
    this.name = 'InvalidPlayerCountError';
  }
}

/** Refus de la politique de participation (règle métier encore à clarifier). */
export class ParticipationRefusedError extends Error {
  constructor(
    readonly gameId: GameId,
    readonly playerId: PlayerId,
  ) {
    super(`Le joueur ${playerId} ne peut pas rejoindre la partie ${gameId}`);
    this.name = 'ParticipationRefusedError';
  }
}

// --- Violations des règles du jeu (refus d'une commande, état inchangé) ---------

export class GameRuleViolationError extends Error {
  constructor(
    readonly gameId: GameId,
    message: string,
  ) {
    super(message);
    this.name = 'GameRuleViolationError';
  }
}

/**
 * Démarrage refusé : moins de 2 joueurs (R-23). La capacité maximale (2, 3 ou 4) n'est
 * PAS une condition de démarrage.
 */
export class GameNotEnoughPlayersError extends GameRuleViolationError {
  constructor(gameId: GameId) {
    super(gameId, `La partie ${gameId} n'a pas assez de joueurs pour démarrer`);
    this.name = 'GameNotEnoughPlayersError';
  }
}

/**
 * J1 (fixé à la création par la session) n'a pas rejoint la partie : il ne peut pas être
 * servi en premier. Aucune règle ne prévoit de remplacement : démarrage refusé (D-033).
 */
export class FirstPlayerNotInGameError extends Error {
  constructor(
    readonly gameId: GameId,
    readonly firstPlayerId: PlayerId,
  ) {
    super(`Le premier joueur ${firstPlayerId} n'a pas rejoint la partie ${gameId}`);
    this.name = 'FirstPlayerNotInGameError';
  }
}

/** Seul le créateur démarre la partie (R-23). */
export class GameStartForbiddenError extends Error {
  constructor(
    readonly gameId: GameId,
    readonly playerId: PlayerId,
  ) {
    super(`Le joueur ${playerId} n'est pas le créateur de la partie ${gameId}`);
    this.name = 'GameStartForbiddenError';
  }
}

/** Clé d'idempotence déjà utilisée par ce créateur pour une création différente. */
export class IdempotencyKeyReuseError extends Error {
  constructor(readonly gameId: GameId) {
    super(`Clé d'idempotence déjà utilisée pour une autre création (partie ${gameId})`);
    this.name = 'IdempotencyKeyReuseError';
  }
}

/** Transition de statut interdite : waiting → in_progress → finished, sans retour. */
export class InvalidStatusTransitionError extends Error {
  constructor(
    readonly gameId: GameId,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Transition de statut interdite pour la partie ${gameId} : ${from} → ${to}`);
    this.name = 'InvalidStatusTransitionError';
  }
}

export class GameNotInProgressError extends GameRuleViolationError {
  constructor(gameId: GameId) {
    super(gameId, `La partie ${gameId} n'est pas en cours`);
    this.name = 'GameNotInProgressError';
  }
}

export class GameAlreadyStartedError extends GameRuleViolationError {
  constructor(gameId: GameId) {
    super(gameId, `La partie ${gameId} a déjà démarré`);
    this.name = 'GameAlreadyStartedError';
  }
}

/**
 * Démarrage refusé : la partie appartient à un tournoi dont l'échéance est atteinte (D-106).
 * Aucune nouvelle partie de tournoi ne commence après la fin ; la partie reste en attente et
 * sa table est fermée par la clôture du tournoi.
 */
export class GameStartClosedError extends GameRuleViolationError {
  constructor(gameId: GameId) {
    super(gameId, `La partie ${gameId} ne peut plus démarrer : tournoi terminé`);
    this.name = 'GameStartClosedError';
  }
}

/**
 * Le temps du tour est écoulé (D-034) : le serveur seul décide de l'expiration, à partir
 * de l'échéance persistée. Le coup du joueur arrive trop tard ; c'est le coup automatique
 * déclenché par TURN_TIMEOUT qui doit être joué.
 */
export class TurnExpiredError extends GameRuleViolationError {
  constructor(gameId: GameId, playerId: PlayerId) {
    super(gameId, `Le temps du tour de ${playerId} est écoulé`);
    this.name = 'TurnExpiredError';
  }
}

export class NotYourTurnError extends GameRuleViolationError {
  constructor(gameId: GameId, playerId: PlayerId) {
    super(gameId, `Ce n'est pas au tour du joueur ${playerId}`);
    this.name = 'NotYourTurnError';
  }
}

export class CardNotInHandError extends GameRuleViolationError {
  constructor(gameId: GameId, cardId: CardId | GaramCardId) {
    super(gameId, `La carte ${cardId} n'est pas dans la main du joueur`);
    this.name = 'CardNotInHandError';
  }
}

/** « Carte non jouable » (scénario §5). */
export class CardNotPlayableError extends GameRuleViolationError {
  constructor(gameId: GameId, cardId: CardId | GaramCardId) {
    super(gameId, `Carte non jouable : ${cardId}`);
    this.name = 'CardNotPlayableError';
  }
}

export class PlayerHasFledError extends GameRuleViolationError {
  constructor(gameId: GameId, playerId: PlayerId) {
    super(gameId, `Le joueur ${playerId} a fui la partie`);
    this.name = 'PlayerHasFledError';
  }
}

/** « Main non gagnante » (séquence « déroulement ») : la partie continue. */
export class NotAWinningHandError extends GameRuleViolationError {
  constructor(gameId: GameId) {
    super(gameId, 'Main non gagnante');
    this.name = 'NotAWinningHandError';
  }
}

export class WinDeclarationNotAllowedError extends GameRuleViolationError {
  constructor(gameId: GameId) {
    super(gameId, 'Déclaration de main gagnante non autorisée à ce moment');
    this.name = 'WinDeclarationNotAllowedError';
  }
}

/**
 * Distribution pas encore confirmée par le serveur (D-102) : aucune décision de joueur
 * (carte, fuite, déclaration) n'est acceptée avant la transition COMPLETE_DEAL.
 */
export class DealInProgressError extends GameRuleViolationError {
  constructor(gameId: GameId) {
    super(gameId, `La distribution de la partie ${gameId} n'est pas terminée`);
    this.name = 'DealInProgressError';
  }
}

/**
 * Action qui n'existe pas dans le JEU de la partie (D-126) : déclarer une main gagnante ou fuir
 * dans une manche GARAM TIA, tirer ou voter la mise dans une partie de Fap-Fap. Refusée avant
 * tout appel à un moteur : un jeu n'exécute jamais la logique de l'autre.
 */
export class ActionNotAvailableForGameError extends GameRuleViolationError {
  constructor(gameId: GameId, action: string, gameType: string) {
    super(gameId, `Action ${action} inexistante dans le jeu ${gameType} (partie ${gameId})`);
    this.name = 'ActionNotAvailableForGameError';
  }
}

/**
 * GARAM TIA (D-127) : variante absente ou invalide (15, 16, 17 ou 18 seulement), ou variante
 * fournie pour un autre jeu. Jamais remplacée par une valeur par défaut.
 */
export class InvalidGaramVariantError extends Error {
  constructor(readonly value: unknown) {
    super(`Variante GARAM TIA invalide : ${String(value)}`);
    this.name = 'InvalidGaramVariantError';
  }
}

/** GARAM TIA : action qui n'existe pas dans la phase en cours (ex. tirer au premier tour). */
export class GaramActionNotAllowedError extends GameRuleViolationError {
  constructor(gameId: GameId, reason: string) {
    super(gameId, `Action GARAM TIA refusée : ${reason}`);
    this.name = 'GaramActionNotAllowedError';
  }
}

/** GARAM TIA : la proposition de doubler la mise est en cours (§3.15), la manche attend. */
export class StakeVoteInProgressError extends GameRuleViolationError {
  constructor(gameId: GameId) {
    super(gameId, `La proposition de doubler la mise de la partie ${gameId} est en cours`);
    this.name = 'StakeVoteInProgressError';
  }
}

export class FleeNotAllowedError extends GameRuleViolationError {
  constructor(gameId: GameId, reason: string) {
    super(gameId, `Fuite impossible : ${reason}`);
    this.name = 'FleeNotAllowedError';
  }
}
