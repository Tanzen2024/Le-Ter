/**
 * Cartes de GARAM TIA (docs/garam, cahier des charges §2) — module de jeu distinct du Ter
 * (D-119) : son paquet ne partage ni familles ni valeurs avec celui du Ter.
 *
 * 35 cartes : cœur 3-10 + As ; trèfle 3-10 + As ; carreau 3-10 + As ; pique 3-10 sans As.
 * 3 à 10 gardent leur valeur ; l'As vaut 11, jamais 1 (§2.2, §4.1). L'As est donc la valeur
 * 11 de l'identifiant (« COEUR-11 »).
 */
import { InvalidCardError } from '../cards/card';

export const GARAM_SUITS = ['COEUR', 'TREFLE', 'CARREAU', 'PIQUE'] as const;
export type GaramSuit = (typeof GARAM_SUITS)[number];

/** Valeur de l'As (§2.2) : 11, jamais 1. */
export const GARAM_ACE_VALUE = 11;

export const GARAM_CARD_VALUES = [3, 4, 5, 6, 7, 8, 9, 10, GARAM_ACE_VALUE] as const;
export type GaramCardValue = (typeof GARAM_CARD_VALUES)[number];

const NUMBERS = [3, 4, 5, 6, 7, 8, 9, 10] as const;

/** Valeurs présentes par famille (§2.1). Aucun As de pique. */
export const GARAM_DECK_COMPOSITION: Readonly<Record<GaramSuit, readonly GaramCardValue[]>> = {
  COEUR: [...NUMBERS, GARAM_ACE_VALUE],
  TREFLE: [...NUMBERS, GARAM_ACE_VALUE],
  CARREAU: [...NUMBERS, GARAM_ACE_VALUE],
  PIQUE: [...NUMBERS],
};

export const GARAM_DECK_SIZE = 35;

/** Identifiant stable et sérialisable d'une carte, ex. « CARREAU-11 » (As de carreau). */
export type GaramCardId = `${GaramSuit}-${GaramCardValue}`;

export interface GaramCard {
  readonly id: GaramCardId;
  readonly suit: GaramSuit;
  readonly value: GaramCardValue;
}

/** Paquet complet et ordonné de 35 cartes (§2.1), avant mélange. */
export function createGaramDeck(): GaramCardId[] {
  return GARAM_SUITS.flatMap((suit) =>
    GARAM_DECK_COMPOSITION[suit].map((value) => `${suit}-${value}` as GaramCardId),
  );
}

/** Valide une carte venant de l'extérieur (commande client) et la renvoie. */
export function parseGaramCardId(value: unknown): GaramCard {
  if (typeof value !== 'string') {
    throw new InvalidCardError(value);
  }
  const match = /^([A-Z]+)-(\d+)$/.exec(value);
  const suit = match?.[1] as GaramSuit | undefined;
  const cardValue = Number(match?.[2]) as GaramCardValue;
  if (!suit || !GARAM_SUITS.includes(suit) || !GARAM_DECK_COMPOSITION[suit].includes(cardValue)) {
    throw new InvalidCardError(value);
  }
  return { id: `${suit}-${cardValue}`, suit, value: cardValue };
}

export function garamCard(id: GaramCardId): GaramCard {
  return parseGaramCardId(id);
}

/** Somme des valeurs de cartes (As = 11). */
export function garamTotal(cards: readonly GaramCardId[]): number {
  return cards.reduce((total, id) => total + garamCard(id).value, 0);
}
