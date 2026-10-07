/**
 * Source de hasard injectable. Le domaine n'appelle jamais Math.random() :
 * la production fournit une source cryptographique (utils/crypto-random-source.ts),
 * les tests une source déterministe.
 */
export interface RandomSource {
  /** Entier uniforme dans [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}
