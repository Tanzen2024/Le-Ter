import type { RandomSource } from '../../src/domain/cards/random-source';

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
