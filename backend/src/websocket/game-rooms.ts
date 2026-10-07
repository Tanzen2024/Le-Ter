import type { GameId } from '../domain/game/game-id';

/**
 * Convention de nommage des canaux temps réel. Toute diffusion passe par ces
 * fonctions : aucun nom de salle n'est construit à la main ailleurs.
 */
export function gameRoom(gameId: GameId): string {
  return `game:${gameId}`;
}

export function gameChatRoom(gameId: GameId): string {
  return `game:${gameId}:chat`;
}

/**
 * Canal inter-instances (Redis Pub/Sub) des événements d'une partie. Une
 * instance ne s'y abonne que si au moins une de ses connexions suit la partie.
 */
export function gameEventChannel(gameId: GameId): string {
  return `le-ter:game:${gameId}:events`;
}
