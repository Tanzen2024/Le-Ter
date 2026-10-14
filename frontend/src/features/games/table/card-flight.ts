/**
 * Trajet de MA carte lâchée sur la table (module pur) : entre le lâcher et la carte jouée du
 * serveur, la carte n'existe qu'à UN endroit à la fois, et ne revient jamais dans la main sauf
 * refus du serveur.
 */

/** Carte lâchée sur la table : sa place dans la main et son arrivée sur la table. */
export interface CardFlight {
  cardId: string;
  index: number;
  landed: boolean;
}

/**
 * - `flightCard` : carte lâchée encore attendue sur la table (envoi en cours ou coup accepté) ;
 *   absente si le serveur a refusé ce coup (elle revient alors dans la main).
 * - `inHand` : coup accepté (carte retirée de `myHand` par le serveur) mais trajet pas fini :
 *   la carte reste dessinée par la main, à sa place d'origine, et la carte jouée du serveur ne
 *   s'affiche pas encore — jamais deux fois à l'écran.
 */
export function flightState(
  flight: CardFlight | null,
  rejected: boolean,
  myHand: readonly string[],
): { flightCard?: string; inHand: CardFlight | null } {
  if (!flight || rejected) return { inHand: null };
  const inHand = !flight.landed && !myHand.includes(flight.cardId) ? flight : null;
  return { flightCard: flight.cardId, inHand };
}

/** Ma main affichée : la carte encore en route y garde sa place (aucun décalage des autres). */
export function handWithFlight(cards: readonly string[], inHand: CardFlight | null): string[] {
  const hand = [...cards];
  if (inHand && !hand.includes(inHand.cardId)) {
    hand.splice(Math.min(inHand.index, hand.length), 0, inHand.cardId);
  }
  return hand;
}
