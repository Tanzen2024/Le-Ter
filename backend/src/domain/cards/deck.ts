import { DECK_COMPOSITION, SUITS, toCardId, type CardId } from './card';
import type { RandomSource } from './random-source';

/** Paquet complet et ordonné de 31 cartes (spec §2.1). */
export function createDeck(): CardId[] {
  return SUITS.flatMap((suit) => DECK_COMPOSITION[suit].map((value) => toCardId(suit, value)));
}

/**
 * Mélange de Fisher-Yates (document « Melanger cartes ») : parcours de la fin vers
 * le début, échange avec un index aléatoire dans [0, i]. Renvoie un nouveau tableau.
 */
export function shuffleDeck(cards: readonly CardId[], random: RandomSource): CardId[] {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = random.nextInt(i + 1);
    [deck[i], deck[j]] = [deck[j] as CardId, deck[i] as CardId];
  }
  return deck;
}

export interface Deal<P extends string> {
  /** Main de chaque joueur, dans l'ordre de réception. */
  hands: Record<P, CardId[]>;
  /** Cartes non distribuées. Leur usage n'est pas défini (docs/TODO.md R-26). */
  stock: CardId[];
}

export class NotEnoughCardsError extends Error {
  constructor(needed: number, available: number) {
    super(`Distribution impossible : ${needed} cartes nécessaires, ${available} disponibles`);
    this.name = 'NotEnoughCardsError';
  }
}

/**
 * Distribue `handSize` cartes à chaque joueur, une à la fois, dans l'ordre de
 * `dealOrder` (le premier de la liste est le premier servi). Distribuer une carte
 * à la fois plutôt que par paquets est un choix technique : sur un paquet mélangé
 * uniformément, les deux méthodes donnent des mains équiprobables.
 */
export function dealCards<P extends string>(
  deck: readonly CardId[],
  dealOrder: readonly P[],
  handSize: number,
): Deal<P> {
  const needed = dealOrder.length * handSize;
  if (needed > deck.length) {
    throw new NotEnoughCardsError(needed, deck.length);
  }

  const hands = Object.fromEntries(dealOrder.map((p) => [p, [] as CardId[]])) as Record<
    P,
    CardId[]
  >;
  let next = 0;
  for (let round = 0; round < handSize; round++) {
    for (const player of dealOrder) {
      hands[player].push(deck[next++] as CardId);
    }
  }
  return { hands, stock: deck.slice(next) };
}
