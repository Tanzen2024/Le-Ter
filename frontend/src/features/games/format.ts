import type { GameStatus, GameView, PlayerInGame } from '../../types/game';

const SUIT_SYMBOLS: Record<string, string> = {
  COEUR: '♥',
  PIQUE: '♠',
  TREFLE: '♣',
  ETOILE: '⭐',
};

/** « COEUR-7 » → « 7 ♥ ». Affichage seulement : le serveur valide toute carte jouée. */
export function cardLabel(cardId: string): string {
  const [suit = '', value = ''] = cardId.split('-');
  return `${value} ${SUIT_SYMBOLS[suit] ?? suit}`;
}

export const STATUS_LABELS: Record<GameStatus, string> = {
  waiting: 'En attente de joueurs',
  in_progress: 'En cours',
  finished: 'Terminée',
};

/**
 * Siège d'un joueur à la table : son siège FIXE de session (D-034), à défaut son rang
 * d'arrivée dans la partie. C'est le même numéro que sur l'écran de la session.
 */
export function tableSeat(player: PlayerInGame): number {
  return player.tablePosition ?? player.seat;
}

/**
 * Nom affiché d'un joueur : « Vous » ou sa place à la table. Les pseudos des autres
 * joueurs ne sont pas encore exposés (option « noms cryptés » à clarifier : R-12).
 */
export function playerLabel(game: GameView, playerId: string): string {
  if (playerId === game.viewerId) {
    return 'Vous';
  }
  const player = game.players.find((p) => p.playerId === playerId);
  return player === undefined ? 'Joueur' : `Joueur ${tableSeat(player) + 1}`;
}

/** Libellés des combinaisons de victoire instantanée (rang 1 = le plus fort). */
export const INSTANT_WIN_LABELS: Record<string, string> = {
  THREE_SEVENS: 'Trois 7',
  SUM_AT_MOST_21: 'Somme ≤ 21',
  FIVE_SAME_SUIT: 'Cinq cartes de la même famille',
  FOUR_OF_A_VALUE: 'Quatre cartes de même valeur',
  THREE_AND_TWO: 'Trois + deux',
  THREE_THREES: 'Trois 3',
};
