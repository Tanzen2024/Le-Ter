import type { GameId, PlayerId } from '../domain/game/game-id';

/**
 * Bilan financier d'UN joueur pour une partie réglée (D-074), tel que le règlement l'a
 * enregistré : variation nette de son compte de jeu (perdant −M ou −2M, gagnant + gain net,
 * fuyard ou partie sans gagnant 0). Lecture seule : rien n'est recalculé ici.
 */
export interface PlayerSettlement {
  /** Variation nette signée, en jetons. */
  delta: number;
}

/**
 * Lecture du règlement d'une partie (port). GameService l'ajoute à la vue du joueur une
 * fois la partie terminée ; il ne dépend jamais de PostgreSQL directement.
 */
export interface GameSettlementReader {
  /**
   * Bilan de `playerId` pour `gameId`, ou null si la partie n'a pas de règlement (table de
   * tournoi, partie sans mise) ou n'est pas encore réglée.
   */
  findPlayerSettlement(gameId: GameId, playerId: PlayerId): Promise<PlayerSettlement | null>;
}
