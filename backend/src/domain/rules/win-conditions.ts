import type { Card, CardValue } from '../cards/card';

/**
 * VICTOIRE INSTANTANÉE (D-035, complétée par D-118) : sept combinaisons RANGÉES, évaluées
 * uniquement sur les 5 cartes initialement distribuées. Plus le rang est PETIT, plus la
 * priorité est FORTE.
 *
 *   1  THREE_SEVENS    trois cartes de valeur 7 (quelle que soit la famille)
 *   2  SUM_AT_MOST_21  somme des 5 cartes ≤ 21
 *   3  FIVE_SAME_SUIT  5 cartes de la même famille
 *   4  FOUR_OF_A_VALUE 4 cartes de même valeur
 *   5  THREE_AND_TWO   3 cartes d'une valeur + 2 cartes d'une autre valeur
 *   6  COMPOSITION_OF_SEVEN  « Composition de 7 » : deux 7, un 4 et un 3 (familles
 *                            indifférentes ; la 5ᵉ carte est libre) — réintroduite par D-118
 *   7  THREE_THREES    3 cartes de valeur 3
 *
 * Une main qui satisfait plusieurs combinaisons retient la MEILLEURE (rang le plus petit).
 * L'ancienne candidate « somme ≥ 30 » ne fait pas partie du socle.
 */
export type WinConditionId =
  | 'THREE_SEVENS'
  | 'SUM_AT_MOST_21'
  | 'FIVE_SAME_SUIT'
  | 'FOUR_OF_A_VALUE'
  | 'THREE_AND_TWO'
  | 'COMPOSITION_OF_SEVEN'
  | 'THREE_THREES';

export type InstantWinRank = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WinCondition {
  readonly id: WinConditionId;
  readonly rank: InstantWinRank;
  isSatisfiedBy(hand: readonly Card[]): boolean;
}

/** Nombre de cartes d'une main initiale. */
export const INITIAL_HAND_SIZE = 5;

function countByValue(hand: readonly Card[]): Map<CardValue, number> {
  const counts = new Map<CardValue, number>();
  for (const card of hand) {
    counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  }
  return counts;
}

const countOf = (hand: readonly Card[], value: CardValue) =>
  hand.filter((c) => c.value === value).length;

/** Les combinaisons, de la plus forte (rang 1) à la plus faible (rang 7). */
export const INSTANT_WIN_CONDITIONS: readonly WinCondition[] = [
  { id: 'THREE_SEVENS', rank: 1, isSatisfiedBy: (hand) => countOf(hand, 7) >= 3 },
  {
    id: 'SUM_AT_MOST_21',
    rank: 2,
    isSatisfiedBy: (hand) => hand.reduce((total, c) => total + c.value, 0) <= 21,
  },
  {
    id: 'FIVE_SAME_SUIT',
    rank: 3,
    isSatisfiedBy: (hand) => new Set(hand.map((c) => c.suit)).size === 1,
  },
  {
    id: 'FOUR_OF_A_VALUE',
    rank: 4,
    isSatisfiedBy: (hand) => [...countByValue(hand).values()].some((n) => n >= 4),
  },
  {
    id: 'THREE_AND_TWO',
    rank: 5,
    isSatisfiedBy: (hand) => {
      const counts = [...countByValue(hand).values()].sort((a, b) => b - a);
      return counts[0] === 3 && counts[1] === 2;
    },
  },
  {
    // « Composition de 7 » (D-118) : valeurs seulement, aucune condition de famille.
    id: 'COMPOSITION_OF_SEVEN',
    rank: 6,
    isSatisfiedBy: (hand) =>
      countOf(hand, 7) >= 2 && countOf(hand, 4) >= 1 && countOf(hand, 3) >= 1,
  },
  { id: 'THREE_THREES', rank: 7, isSatisfiedBy: (hand) => countOf(hand, 3) >= 3 },
];

export interface InstantWinMatch {
  /** Meilleur rang de la main (le plus petit). */
  rank: InstantWinRank;
  /** Combinaison retenue (celle du meilleur rang). */
  combination: WinConditionId;
  /** Toutes les combinaisons satisfaites, du meilleur rang au moins bon. */
  matches: WinConditionId[];
}

/**
 * Meilleure combinaison d'une main INITIALE de 5 cartes, ou null si elle n'est pas
 * gagnante. Une main de taille différente n'est jamais évaluée.
 */
export function bestInstantWin(hand: readonly Card[]): InstantWinMatch | null {
  if (hand.length !== INITIAL_HAND_SIZE) {
    return null;
  }
  const satisfied = INSTANT_WIN_CONDITIONS.filter((c) => c.isSatisfiedBy(hand));
  const [best] = satisfied;
  return best
    ? { rank: best.rank, combination: best.id, matches: satisfied.map((c) => c.id) }
    : null;
}

export type InstantWinResolution<P> =
  /** Aucune main gagnante : la partie se joue normalement. */
  | { kind: 'none' }
  /** Une seule main gagnante : son détenteur PEUT déclarer, ou jouer normalement. */
  | { kind: 'optional'; playerId: P; rank: InstantWinRank }
  /** Plusieurs mains gagnantes, un seul meilleur rang : victoire AUTOMATIQUE. */
  | { kind: 'automatic'; playerId: P; rank: InstantWinRank }
  /** Plusieurs mains gagnantes au même meilleur rang : aucun gagnant, reprise immédiate. */
  | { kind: 'tie'; playerIds: P[]; rank: InstantWinRank };

/**
 * Issue de l'analyse des mains initiales (D-035) :
 * - aucune main gagnante → partie normale ;
 * - une seule → déclaration facultative ;
 * - plusieurs, le meilleur rang détenu par UN joueur → il gagne automatiquement ;
 * - plusieurs, le meilleur rang partagé → égalité de priorité, reprise immédiate.
 */
export function resolveInstantWins<P>(
  ranks: ReadonlyArray<{ playerId: P; rank: InstantWinRank }>,
): InstantWinResolution<P> {
  if (ranks.length === 0) {
    return { kind: 'none' };
  }
  if (ranks.length === 1) {
    const [only] = ranks as [{ playerId: P; rank: InstantWinRank }];
    return { kind: 'optional', playerId: only.playerId, rank: only.rank };
  }
  const best = Math.min(...ranks.map((r) => r.rank)) as InstantWinRank;
  const holders = ranks.filter((r) => r.rank === best).map((r) => r.playerId);
  return holders.length === 1
    ? { kind: 'automatic', playerId: holders[0] as P, rank: best }
    : { kind: 'tie', playerIds: holders, rank: best };
}
