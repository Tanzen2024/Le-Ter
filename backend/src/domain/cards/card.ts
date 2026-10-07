/**
 * Cartes du Ter — composition définie par la spécification fonctionnelle §2.1.
 *
 * La spec emploie le mot « couleur » pour comparer des cartes (§2.4, §4). Son sens
 * (famille ou rouge/noir) n'est pas tranché (docs/TODO.md R-08) : ce module ne parle
 * donc que de FAMILLE (`Suit`), et la notion de « même couleur » est une règle
 * configurable (`ColorEquivalence`, domain/rules/rule-set.ts).
 */
export const SUITS = ['COEUR', 'PIQUE', 'TREFLE', 'ETOILE'] as const;
export type Suit = (typeof SUITS)[number];

export const CARD_VALUES = [3, 4, 5, 6, 7, 8, 9, 10] as const;
export type CardValue = (typeof CARD_VALUES)[number];

/** Valeurs présentes par famille (spec §2.1). Pas de 10 de pique. */
export const DECK_COMPOSITION: Readonly<Record<Suit, readonly CardValue[]>> = {
  COEUR: [3, 4, 5, 6, 7, 8, 9, 10],
  PIQUE: [3, 4, 5, 6, 7, 8, 9],
  TREFLE: [3, 4, 5, 6, 7, 8, 9, 10],
  ETOILE: [3, 4, 5, 6, 7, 8, 9, 10],
};

export const DECK_SIZE = 31;

/** Identifiant stable et sérialisable d'une carte, ex. "PIQUE-7". */
export type CardId = `${Suit}-${CardValue}`;

export interface Card {
  readonly id: CardId;
  readonly suit: Suit;
  readonly value: CardValue;
}

export function toCardId(suit: Suit, value: CardValue): CardId {
  return `${suit}-${value}`;
}

export function existsInDeck(suit: Suit, value: CardValue): boolean {
  return DECK_COMPOSITION[suit].includes(value);
}

export class InvalidCardError extends Error {
  constructor(value: unknown) {
    super(`Carte invalide : ${JSON.stringify(value)}`);
    this.name = 'InvalidCardError';
  }
}

/** Valide une carte venant de l'extérieur (commande client) et la renvoie. */
export function parseCardId(value: unknown): Card {
  if (typeof value !== 'string') {
    throw new InvalidCardError(value);
  }
  const match = /^([A-Z]+)-(\d+)$/.exec(value);
  const suit = match?.[1] as Suit | undefined;
  const cardValue = Number(match?.[2]) as CardValue;
  if (!suit || !SUITS.includes(suit) || !existsInDeck(suit, cardValue)) {
    throw new InvalidCardError(value);
  }
  return { id: toCardId(suit, cardValue), suit, value: cardValue };
}

export function cardFromId(id: CardId): Card {
  return parseCardId(id);
}
