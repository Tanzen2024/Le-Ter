import { randomInt } from 'node:crypto';

import type { RandomSource } from '../domain/cards/random-source';

/**
 * Source de hasard de production : générateur cryptographique de Node, sans biais
 * de modulo. Le mélange des cartes engage de l'argent réel : Math.random() est exclu.
 */
export const cryptoRandomSource: RandomSource = {
  nextInt: (maxExclusive) => randomInt(maxExclusive),
};
