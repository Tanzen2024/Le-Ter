import {
  anyCardFromHand,
  dealOrderBySeat,
  declareAnyTime,
  fleeIfAtMostOneCardPlayed,
  playOrderFollowingDealOrder,
  sameSuit,
} from '../../src/domain/rules/rule-candidates';
import type { TerRuleSet } from '../../src/domain/rules/rule-set';
import {
  fiveSameColor,
  fourOfAValue,
  threeAndTwo,
  threeSevens,
  threeThrees,
} from '../../src/domain/rules/win-conditions';

/**
 * HYPOTHÈSES DE TEST — ce ne sont PAS des décisions métier.
 *
 * Le moteur exige un jeu de règles complet pour fonctionner. Ces choix servent
 * uniquement à exercer ses mécanismes (tours, contrôle, fin, isolation). Les tests
 * qui portent sur une règle ambiguë la fournissent explicitement.
 * La condition de somme (R-01) et la combinaison 7+7+4+3 (R-04) sont exclues.
 */
export const testRules: TerRuleSet = {
  sameColor: sameSuit,
  dealOrder: dealOrderBySeat,
  playOrder: playOrderFollowingDealOrder,
  cardPlayability: anyCardFromHand,
  winDeclarationWindow: declareAnyTime,
  instantWinConditions: [
    threeThrees(),
    fourOfAValue(),
    fiveSameColor(sameSuit),
    threeAndTwo(),
    threeSevens(),
  ],
  fleeEligibility: fleeIfAtMostOneCardPlayed,
};

export function withRules(overrides: Partial<TerRuleSet>): TerRuleSet {
  return { ...testRules, ...overrides };
}
