import type { GameEvent } from '../domain/game/game-events';
import type { GameId, PlayerId } from '../domain/game/game-id';

/**
 * Port de diffusion temps réel, indépendant du transport (Socket.IO, ws,
 * Firebase… : choix encore ouvert, docs/TODO.md T-01).
 */
export interface GameEventPublisher {
  /** Diffuse un événement public à tous les abonnés de la salle `game:{event.gameId}`. */
  publishToGame(event: GameEvent): void;

  /**
   * Envoie un événement privé (ex. la main d'un joueur) au seul joueur visé,
   * et seulement sur sa connexion à cette partie.
   */
  publishToPlayer(playerId: PlayerId, event: GameEvent): void;
}

export type GameEventListener = (event: GameEvent) => void;

export interface GameEventSubscriber {
  /**
   * Abonne la connexion d'un joueur à une partie. N'effectue AUCUN contrôle
   * d'accès : il doit passer par GameService.subscribe, qui vérifie l'appartenance.
   */
  subscribe(gameId: GameId, playerId: PlayerId, listener: GameEventListener): () => void;
}
