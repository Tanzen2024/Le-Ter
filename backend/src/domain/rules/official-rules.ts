/**
 * RÈGLES OFFICIELLES du Ter (D-035, socle de vérité des 52 décisions).
 *
 * Ce fichier contenait des interprétations « candidates » des règles ambiguës. Elles sont
 * désormais TRANCHÉES ; les candidates écartées (rouge/noir, toute carte jouable, déclarer
 * à tout moment, « pas plus d'une carte jouée » pour fuir) sont supprimées.
 */
import type {
  CardPlayabilityPolicy,
  ColorEquivalence,
  FleeEligibility,
  TerRuleSet,
  WinDeclarationWindow,
} from './rule-set';

/** Décisions 44-45 : « même couleur » = même FAMILLE (♥, ♠, ♣, ⭐). */
export const sameSuit: ColorEquivalence = (a, b) => a.suit === b.suit;

/**
 * Décisions 46-47, 50 : la carte de contrôle du tour est la carte posée par le meneur (le
 * joueur qui a le contrôle) ; un joueur qui possède au moins une carte de sa famille DOIT
 * jouer cette famille (même une valeur inférieure) ; sinon, il joue n'importe quelle
 * carte. Le meneur joue librement.
 */
export const mustFollowLeadColorWhenPossible: CardPlayabilityPolicy = ({
  card,
  hand,
  leadCard,
  sameColor,
}) => !leadCard || sameColor(card, leadCard) || !hand.some((c) => sameColor(c, leadCard));

/**
 * Victoire instantanée : déclarable seulement pendant le tour 1, avant que le joueur ait
 * joué sa première carte ; le droit est ensuite définitivement perdu.
 */
export const declareBeforeFirstCard: WinDeclarationWindow = ({ trickNumber, cardsPlayed }) =>
  trickNumber === 1 && cardsPlayed === 0;

/**
 * Fuir (se coucher) : tant que le joueur n'a pas joué sa DEUXIÈME carte, c'est-à-dire aux
 * tours 1 et 2 (D-089, révise D-035 qui limitait la fuite au tour 1).
 */
export const fleeBeforeSecondCard: FleeEligibility = ({ trickNumber, cardsPlayed }) =>
  trickNumber <= 2 && cardsPlayed < 2;

/** Le jeu de règles OFFICIEL, utilisé en production. */
export const OFFICIAL_TER_RULES: TerRuleSet = {
  sameColor: sameSuit,
  cardPlayability: mustFollowLeadColorWhenPossible,
  winDeclarationWindow: declareBeforeFirstCard,
  fleeEligibility: fleeBeforeSecondCard,
};
