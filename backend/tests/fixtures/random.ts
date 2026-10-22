import type { CardId } from '../../src/domain/cards/card';
import { createDeck } from '../../src/domain/cards/deck';
import type { RandomSource } from '../../src/domain/cards/random-source';
import { createGaramDeck, type GaramCardId } from '../../src/domain/garam/garam-cards';

/** Générateur déterministe (mulberry32) : même graine → même suite. */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { nextInt: (max) => Math.floor(next() * max) };
}

/**
 * Hasard « identité » : Fisher-Yates tire j = i à chaque étape, donc aucun échange.
 * Le paquet reste dans l'ordre de createDeck(), ce qui rend les mains prévisibles.
 */
export const identityRandom: RandomSource = { nextInt: (max) => max - 1 };

/** Renvoie les valeurs fournies dans l'ordre et enregistre les bornes demandées. */
export function scriptedRandom(values: number[]): RandomSource & { bounds: number[] } {
  const bounds: number[] = [];
  let index = 0;
  return {
    bounds,
    nextInt: (max) => {
      bounds.push(max);
      return values[index++ % values.length] ?? 0;
    },
  };
}

/**
 * Hasard qui fait produire à shuffleDeck (Fisher-Yates) EXACTEMENT les paquets donnés,
 * un par mélange, dans l'ordre ; ensuite, ordre identité. Sert à tester, par la VRAIE
 * distribution, des mains choisies (victoire instantanée automatique, égalité, reprises).
 */
export function decksRandom(...decks: CardId[][]): RandomSource {
  const draws: number[] = [];
  for (const target of decks) {
    const deck = [...createDeck()];
    const full = [...target, ...deck.filter((c) => !target.includes(c))];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = deck.indexOf(full[i] as CardId);
      draws.push(j);
      [deck[i], deck[j]] = [deck[j] as CardId, deck[i] as CardId];
    }
  }
  let index = 0;
  return { nextInt: (max) => (index < draws.length ? (draws[index++] as number) : max - 1) };
}

/**
 * Paquet qui, distribué en deux passes (3 puis 2) dans l'ordre `hands`, donne à chaque
 * joueur exactement la main indiquée (5 cartes chacune).
 */
export function deckForHands(hands: CardId[][]): CardId[] {
  const n = hands.length;
  const deck: CardId[] = new Array(5 * n);
  hands.forEach((hand, k) => {
    hand.slice(0, 3).forEach((c, i) => (deck[3 * k + i] = c));
    hand.slice(3, 5).forEach((c, i) => (deck[3 * n + 2 * k + i] = c));
  });
  return deck;
}

/**
 * Hasard PAR DÉFAUT des fixtures de test (quand un test n'impose pas de paquet).
 *
 * Depuis D-035, une donne aléatoire peut terminer la partie dès la distribution (plusieurs
 * mains gagnantes : victoire automatique ou égalité) : ≈ 0,08 % à 2 joueurs, 0,26 % à 3,
 * 0,5 % à 4 (simulation de 200 000 donnes). Un test qui démarre une partie sur une donne
 * cryptographique et attend `in_progress` échouerait donc au hasard. Les tests qui ne
 * portent pas sur la donne reçoivent une suite FIXE (même graine) : chaque exécution
 * produit les mêmes donnes, le test réussit ou échoue toujours de la même façon. La
 * production garde le mélange cryptographique.
 */
export const DEFAULT_TEST_SEED = 20261007;
export function defaultTestRandom(): RandomSource {
  return seededRandom(DEFAULT_TEST_SEED);
}

/**
 * GARAM TIA (D-119) : hasard qui fait produire à shuffleDeck EXACTEMENT les paquets donnés
 * (un par manche démarrée, dans l'ordre), puis l'ordre identité. Un paquet = les 3 cartes de
 * chaque joueur dans l'ordre de la table, puis le terre.
 */
export function garamDecksRandom(...decks: GaramCardId[][]): RandomSource {
  const draws: number[] = [];
  for (const target of decks) {
    const deck = createGaramDeck();
    const full = [...target, ...deck.filter((c) => !target.includes(c))];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = deck.indexOf(full[i] as GaramCardId);
      draws.push(j);
      [deck[i], deck[j]] = [deck[j] as GaramCardId, deck[i] as GaramCardId];
    }
  }
  let index = 0;
  return { nextInt: (max) => (index < draws.length ? (draws[index++] as number) : max - 1) };
}
