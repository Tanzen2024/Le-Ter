import type { GameView, PlayerInGame } from '../../types/game';

const SUIT_SYMBOLS: Record<string, string> = {
  COEUR: '♥',
  PIQUE: '♠',
  TREFLE: '♣',
  ETOILE: '⭐',
  // GARAM TIA (D-119).
  CARREAU: '♦',
};

/** « COEUR-7 » → « 7 ♥ ». Affichage seulement : le serveur valide toute carte jouée. */
export function cardLabel(cardId: string): string {
  const [suit = '', value = ''] = cardId.split('-');
  // GARAM TIA : l'As porte la valeur 11.
  return `${value === '11' ? 'A' : value} ${SUIT_SYMBOLS[suit] ?? suit}`;
}

/**
 * Siège d'un joueur à la table : son siège FIXE de session (D-034), à défaut son rang
 * d'arrivée dans la partie. C'est le même numéro que sur l'écran de la session.
 */
export function tableSeat(player: PlayerInGame): number {
  return player.tablePosition ?? player.seat;
}

/** Libellés neutres quand le serveur n'a pas fourni de pseudo : jamais un faux pseudo. */
export const UNKNOWN_SELF_LABEL = 'Vous';
export const UNKNOWN_PLAYER_LABEL = 'Adversaire';

/**
 * Nom affiché d'un joueur : son pseudo réel, fourni par le serveur avec la partie (D-064),
 * y compris pour le joueur connecté. Pseudo absent : « Vous » ou « Adversaire », jamais un
 * identifiant technique ni un numéro de siège.
 */
export function playerLabel(game: GameView, playerId: string): string {
  const username = game.players.find((p) => p.playerId === playerId)?.username?.trim();
  if (username) {
    return username;
  }
  return playerId === game.viewerId ? UNKNOWN_SELF_LABEL : UNKNOWN_PLAYER_LABEL;
}

/** Libellés des combinaisons de victoire instantanée (rang 1 = le plus fort). */
export const INSTANT_WIN_LABELS: Record<string, string> = {
  THREE_SEVENS: 'Trois 7',
  SUM_AT_MOST_21: 'Somme ≤ 21',
  FIVE_SAME_SUIT: 'Cinq cartes de la même famille',
  FOUR_OF_A_VALUE: 'Quatre cartes de même valeur',
  THREE_AND_TWO: 'Trois + deux',
  COMPOSITION_OF_SEVEN: 'Composition de 7',
  THREE_THREES: 'Trois 3',
};
