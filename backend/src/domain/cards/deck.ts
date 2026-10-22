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
export function shuffleDeck<C extends string = CardId>(cards: readonly C[], random: RandomSource): C[] {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = random.nextInt(i + 1);
    [deck[i], deck[j]] = [deck[j] as C, deck[i] as C];
  }
  return deck;
}

/**
 * Un lot de la distribution : `count` cartes remises SIMULTANÉMENT à un joueur, pendant
 * le passage `pass` (1 ou 2). Les lots se suivent dans l'ordre de la table.
 */
export interface DealBatch<P extends string = string> {
  pass: number;
  playerId: P;
  count: number;
}

export interface Deal<P extends string> {
  /**
   * Main de chaque joueur, dans l'ordre de réception : le lot du 1er passage, puis celui
   * du 2e. Les joueurs ne piochent jamais : cette main est tout leur jeu.
   */
  hands: Record<P, CardId[]>;
  /** Cartes non distribuées : ni pioche, ni accessibles, jamais utilisées (D-032). */
  stock: CardId[];
  /** Ordre exact des lots distribués. */
  sequence: DealBatch<P>[];
}

export class NotEnoughCardsError extends Error {
  constructor(needed: number, available: number) {
    super(`Distribution impossible : ${needed} cartes nécessaires, ${available} disponibles`);
    this.name = 'NotEnoughCardsError';
  }
}

/**
 * Séquence des lots : pour chaque passage, chaque joueur dans l'ordre de la table reçoit
 * son lot avant le suivant. Avec les passages [3, 2] et J1 → J2 → J3 :
 * J1←3, J2←3, J3←3, puis J1←2, J2←2, J3←2. Elle ne contient aucune carte (publique).
 */
export function dealSequence<P extends string>(
  dealOrder: readonly P[],
  passes: readonly number[],
): DealBatch<P>[] {
  return passes.flatMap((count, index) =>
    dealOrder.map((playerId) => ({ pass: index + 1, playerId, count })),
  );
}

/**
 * Distribution PAR LOTS (D-032) : `passes` donne la taille du lot de chaque passage
 * ([3, 2] pour le Ter). Chaque lot est pris d'un bloc sur le dessus du paquet mélangé et
 * remis à un seul joueur ; l'ordre `dealOrder` est le même pour tous les passages. Il n'y
 * a jamais de distribution carte par carte à l'intérieur d'un lot.
 */
export function dealInPasses<P extends string>(
  deck: readonly CardId[],
  dealOrder: readonly P[],
  passes: readonly number[],
): Deal<P> {
  const handSize = passes.reduce((total, count) => total + count, 0);
  const needed = dealOrder.length * handSize;
  if (needed > deck.length) {
    throw new NotEnoughCardsError(needed, deck.length);
  }

  const hands = Object.fromEntries(dealOrder.map((p) => [p, [] as CardId[]])) as Record<
    P,
    CardId[]
  >;
  const sequence = dealSequence(dealOrder, passes);
  let next = 0;
  for (const batch of sequence) {
    hands[batch.playerId].push(...deck.slice(next, next + batch.count));
    next += batch.count;
  }
  return { hands, stock: deck.slice(next), sequence };
}
