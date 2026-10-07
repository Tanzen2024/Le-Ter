/**
 * Interprétations CANDIDATES des règles ambiguës, pour les tests et pour faciliter
 * la décision. AUCUNE n'est la règle officielle du Ter : les documents ne
 * permettent pas de trancher (docs/TODO.md). Le moteur n'en utilise aucune par défaut.
 */
import type {
  CardPlayabilityPolicy,
  ColorEquivalence,
  DealOrderPolicy,
  FleeEligibility,
  PlayOrderPolicy,
  WinDeclarationWindow,
} from './rule-set';

// --- « Même couleur » (R-08) --------------------------------------------------

/** « Couleur » = famille (cœur, pique, trèfle, étoile). */
export const sameSuit: ColorEquivalence = (a, b) => a.suit === b.suit;
// L'interprétation rouge/noir n'est pas fournie : la couleur des étoiles n'est
// définie nulle part, elle n'est donc pas calculable.

// --- Ordre de distribution / premier servi (R-17) ----------------------------

/** Ordre d'arrivée à la table (siège). */
export const dealOrderBySeat: DealOrderPolicy = (playerIds) => [...playerIds];

/** Ordre tiré au sort. */
export const dealOrderRandom: DealOrderPolicy = (playerIds, random) => {
  const order = [...playerIds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = random.nextInt(i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
};

// --- Ordre de jeu dans un tour (R-28) ----------------------------------------

/** Suit l'ordre de distribution, en commençant par le meneur. */
export const playOrderFollowingDealOrder: PlayOrderPolicy = (activeDealOrder, leaderId) => {
  const start = activeDealOrder.indexOf(leaderId);
  return [...activeDealOrder.slice(start), ...activeDealOrder.slice(0, start)];
};

// --- Obligation de suivre (R-03) ---------------------------------------------

/** Toute carte de la main est jouable. */
export const anyCardFromHand: CardPlayabilityPolicy = () => true;

/** Il faut jouer la couleur de la première carte du tour si on en possède. */
export const mustFollowLeadColorWhenPossible: CardPlayabilityPolicy = ({
  card,
  hand,
  leadCard,
  sameColor,
}) => !leadCard || sameColor(card, leadCard) || !hand.some((c) => sameColor(c, leadCard));

// --- Moment de la déclaration de main gagnante (R-07) ------------------------

/** Seulement avec la main complète, avant d'avoir joué une carte. */
export const declareBeforeFirstCard: WinDeclarationWindow = ({ cardsPlayed }) => cardsPlayed === 0;

/** À tout moment de la partie. */
export const declareAnyTime: WinDeclarationWindow = () => true;

// --- Fuite (R-05) -------------------------------------------------------------

/** Spec §2.5 : « s'il n'a pas joué plus d'une carte ». */
export const fleeIfAtMostOneCardPlayed: FleeEligibility = ({ cardsPlayed }) => cardsPlayed <= 1;

/** Diagramme de séquence : « avant le 2ème tour ». */
export const fleeBeforeSecondTrick: FleeEligibility = ({ trickNumber }) => trickNumber < 2;
