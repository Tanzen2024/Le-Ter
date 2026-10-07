import type { Card, CardValue } from '../cards/card';
import type { ColorEquivalence } from './rule-set';
import { UnresolvedRuleError } from './unresolved-rule';

/** Conditions de gain instantané listées par la spécification fonctionnelle §4. */
export type WinConditionId =
  | 'THREE_THREES'
  | 'FOUR_OF_A_VALUE'
  | 'FIVE_SAME_COLOR'
  | 'SUM_THRESHOLD'
  | 'TWO_SEVENS_FOUR_THREE'
  | 'THREE_AND_TWO'
  | 'THREE_SEVENS';

export interface WinCondition {
  readonly id: WinConditionId;
  isSatisfiedBy(hand: readonly Card[]): boolean;
}

function countByValue(hand: readonly Card[]): Map<CardValue, number> {
  const counts = new Map<CardValue, number>();
  for (const card of hand) {
    counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  }
  return counts;
}

function countOf(hand: readonly Card[], value: CardValue): number {
  return hand.filter((c) => c.value === value).length;
}

/** « Avoir 3 cartes de valeur 3 ». */
export function threeThrees(): WinCondition {
  return { id: 'THREE_THREES', isSatisfiedBy: (hand) => countOf(hand, 3) >= 3 };
}

/**
 * « Avoir 4 cartes de même valeur ». Impossible pour la valeur 10 (pas de 10 de
 * pique dans le paquet) : aucune exception n'est nécessaire, le paquet l'empêche.
 */
export function fourOfAValue(): WinCondition {
  return {
    id: 'FOUR_OF_A_VALUE',
    isSatisfiedBy: (hand) => [...countByValue(hand).values()].some((n) => n >= 4),
  };
}

/** « Avoir 5 cartes de même couleur ». Le sens de « couleur » est injecté (R-08). */
export function fiveSameColor(sameColor: ColorEquivalence): WinCondition {
  return {
    id: 'FIVE_SAME_COLOR',
    isSatisfiedBy: (hand) => {
      const [first] = hand;
      return hand.length >= 5 && first !== undefined && hand.every((c) => sameColor(first, c));
    },
  };
}

export interface SumThresholdOptions {
  operator: '<=' | '>=';
  threshold: number;
}

/**
 * Condition sur la somme des valeurs. Les documents se contredisent (spec §4 :
 * « ≤ 21 » ; note checkWinCondition : « ≥ 30 points ») : opérateur et seuil sont
 * donc obligatoires, sans valeur par défaut (R-01).
 */
export function sumThreshold(options: SumThresholdOptions): WinCondition {
  return {
    id: 'SUM_THRESHOLD',
    isSatisfiedBy: (hand) => {
      const sum = hand.reduce((total, c) => total + c.value, 0);
      return options.operator === '<=' ? sum <= options.threshold : sum >= options.threshold;
    },
  };
}

/**
 * « 2 cartes de valeur 7 avec 1 carte de valeur 4 et 1 carte de valeur 3 » ne décrit
 * que 4 cartes d'une main de 5 (R-04). Aucune interprétation n'est implémentée :
 * activer cette condition est refusé tant que la règle n'est pas clarifiée.
 */
export function twoSevensFourThree(): never {
  throw new UnresolvedRuleError(
    'R-04',
    'la combinaison 7 + 7 + 4 + 3 ne précise pas la 5e carte de la main',
  );
}

/** « 3 cartes d'une même valeur et deux autres d'une même autre valeur ». */
export function threeAndTwo(): WinCondition {
  return {
    id: 'THREE_AND_TWO',
    isSatisfiedBy: (hand) => {
      const counts = [...countByValue(hand).values()].sort((a, b) => b - a);
      return hand.length === 5 && counts[0] === 3 && counts[1] === 2;
    },
  };
}

/** « Avoir 3 cartes de valeur 7 ». */
export function threeSevens(): WinCondition {
  return { id: 'THREE_SEVENS', isSatisfiedBy: (hand) => countOf(hand, 7) >= 3 };
}

/** Toutes les conditions satisfaites, dans l'ordre de configuration (aucune priorité n'est définie). */
export function matchingWinConditions(
  hand: readonly Card[],
  conditions: readonly WinCondition[],
): WinConditionId[] {
  return conditions.filter((c) => c.isSatisfiedBy(hand)).map((c) => c.id);
}
