import type { Game } from './game';
import { GameAccessDeniedError } from './game-errors';
import type { PlayerId } from './game-id';

export function isPlayerInGame(game: Game, playerId: PlayerId): boolean {
  return game.players.some((p) => p.playerId === playerId);
}

/**
 * Contrôle d'accès obligatoire avant toute lecture privée, abonnement temps réel
 * ou commande sur une partie. Il ne dépend jamais du frontend.
 */
export function assertPlayerInGame(game: Game, playerId: PlayerId): void {
  if (!isPlayerInGame(game, playerId)) {
    throw new GameAccessDeniedError(game.id, playerId);
  }
}
