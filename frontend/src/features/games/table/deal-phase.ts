import { useState } from 'react';

import type { GameView } from '../../../types/game';

/**
 * Distribution en cours SELON LE SERVEUR (D-102) : partie démarrée, distribution pas encore
 * confirmée (`dealEndsAt`). Aucune échéance de tour n'existe alors.
 */
export function serverDealing(game: GameView): boolean {
  return game.status === 'in_progress' && Boolean(game.dealEndsAt);
}

/**
 * La table est-elle « en distribution » (animation des lots, roulette et barres masquées) ?
 *
 * - L'animation ne DÉMARRE que si le serveur est encore en phase de distribution : une
 *   reconnexion ou un écran ouvert après la confirmation affiche directement le tour en
 *   cours et son temps restant réel, sans rejouer la distribution.
 * - Une fois démarrée sur cet appareil, elle se termine même si la confirmation du serveur
 *   arrive entre-temps (pas de cartes qui sautent) ; le temps du tour reste celui du serveur.
 * - Elle n'est jouée qu'une fois par partie (`dealAnimated`). Animation finie mais
 *   distribution pas encore confirmée : plus d'animation, et toujours ni roulette ni barres
 *   (`turnPhaseOf` et `turnKeyOf` attendent la confirmation du serveur).
 */
export function useTableDealing(game: GameView, dealAnimated: boolean): boolean {
  const dealingNow = serverDealing(game);
  const [started, setStarted] = useState<string | null>(dealingNow ? game.gameId : null);
  // Motif React « état dérivé » : mémorise le début de l'animation sans effet en cascade.
  if (dealingNow && !dealAnimated && started !== game.gameId) {
    setStarted(game.gameId);
  }
  if (dealAnimated || game.status !== 'in_progress') return false;
  return dealingNow || started === game.gameId;
}
