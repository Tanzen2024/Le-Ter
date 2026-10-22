import { MIN_PLAYERS_TO_START, type Game } from './game';
import {
  FirstPlayerNotInGameError,
  GameAlreadyStartedError,
  GameFinishedError,
  GameNotEnoughPlayersError,
} from './game-errors';
import type { PlayerId } from './game-id';
import { rotateFrom } from '../sessions/table-order';

/**
 * Cycle de vie d'une partie COMMUN aux jeux de la plateforme (D-126) : conditions de
 * démarrage, ordre de la table, phase de distribution, échéance du tour. Aucune règle de
 * jeu ici : les moteurs de Fap-Fap (`ter-engine.ts`) et de GARAM TIA (`garam-engine.ts`)
 * l'utilisent chacun, sans dépendre l'un de l'autre.
 */

/**
 * Conditions de démarrage (R-23) : partie en attente et AU MOINS 2 joueurs. La capacité
 * maximale (2, 3 ou 4) n'est pas une condition. L'autorisation relève de GameService.
 */
export function assertCanStart(game: Game): void {
  if (game.status === 'finished') {
    throw new GameFinishedError(game.id);
  }
  if (game.status !== 'waiting') {
    throw new GameAlreadyStartedError(game.id);
  }
  if (game.players.length < MIN_PLAYERS_TO_START) {
    throw new GameNotEnoughPlayersError(game.id);
  }
  if (game.players.length > game.maxPlayers) {
    throw new Error(`Invariant violé : plus de joueurs que de places dans ${game.id}`);
  }
}

/**
 * Ordre de la partie, sens ANTIHORAIRE (décision 24) : les joueurs dans l'ordre de leur
 * siège fixe de session (`tablePosition`), à partir de J1. Ex. sièges A, B, C, D et
 * J1 = C : C → D → A → B. Les sièges ne bougent jamais (décision 22).
 */
export function tableOrder(game: Game): PlayerId[] {
  const byPlace = [...game.players]
    .sort((a, b) => (a.tablePosition ?? a.seat) - (b.tablePosition ?? b.seat))
    .map((p) => p.playerId);
  if (!byPlace.includes(game.firstPlayerId)) {
    throw new FirstPlayerNotInGameError(game.id, game.firstPlayerId);
  }
  return rotateFrom(byPlace, game.firstPlayerId);
}

/** La partie est-elle encore dans sa phase de distribution non confirmée ? (D-102) */
export function isDealing(game: Pick<Game, 'status' | 'dealEndsAt'>): boolean {
  return game.status === 'in_progress' && game.dealEndsAt !== undefined;
}

/**
 * Nouveau tour du joueur attendu (D-034) : il a `durationMs` pour jouer, échéance fixée
 * par le serveur et persistée avec l'état. Le timer en mémoire n'en est qu'une copie. La
 * durée est celle du jeu (Fap-Fap : TURN_DURATION_MS ; GARAM TIA : GARAM_TURN_DURATION_MS,
 * D-127), toujours fournie par son moteur : ce module ne connaît aucune règle de jeu.
 */
export function beginTurn(game: Game, now: Date, durationMs: number): void {
  game.turnStartedAt = now;
  game.turnDeadlineAt = new Date(now.getTime() + durationMs);
  game.turnTimedOutAt = undefined;
}

export function clearTurn(game: Game): void {
  game.dealEndsAt = undefined;
  game.turnStartedAt = undefined;
  game.turnDeadlineAt = undefined;
  game.turnTimedOutAt = undefined;
}
