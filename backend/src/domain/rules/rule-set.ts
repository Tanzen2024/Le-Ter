import type { Card } from '../cards/card';

/**
 * Règles du Ter codées en dur dans le moteur (D-035, socle de vérité). Les règles qui se
 * jouent coup par coup sont regroupées dans un TerRuleSet (OFFICIAL_TER_RULES en
 * production, official-rules.ts) pour rester testables isolément.
 */
export const HAND_SIZE = 5; // décision 26

/**
 * Distribution en deux passages (décisions 27-28) : chaque joueur reçoit d'abord un lot de
 * 3 cartes, l'un après l'autre dans l'ordre antihoraire à partir de J1, puis un lot de 2
 * cartes dans le même ordre. Total = HAND_SIZE. Aucune pioche ensuite (décisions 29-31).
 */
export const DEAL_PASSES: readonly number[] = [3, 2];
export const TRICKS_PER_GAME = 5; // décision 35
export const MAX_FLEES_PER_GAME = 1; // un seul joueur peut fuir par partie

/**
 * Le 5e tour se joue AUTOMATIQUEMENT : chaque joueur actif n'a plus qu'une carte, elle est
 * jouée par le système dès la fin du 4e tour, sans action ni timer.
 */
export const AUTOMATIC_TRICK_NUMBER = 5;

/** Temps maximal du joueur attendu pour jouer sa carte (D-034 ; 10 s depuis D-092). */
export const TURN_DURATION_MS = 10_000;

/** Deux cartes sont-elles « de même couleur » ? Officiellement : même famille (D-035). */
export type ColorEquivalence = (a: Card, b: Card) => boolean;

export interface CardPlayContext {
  card: Card;
  hand: readonly Card[];
  /**
   * Première carte du tour en cours, posée par le meneur (absente s'il ouvre le tour) :
   * c'est la carte de contrôle du DÉBUT du tour, dont la famille s'impose (décision 46).
   */
  leadCard?: Card;
  /** Carte qui détient le contrôle à cet instant du tour. */
  controlCard?: Card;
  sameColor: ColorEquivalence;
}

/** Une carte de la main est-elle jouable ? (décisions 46-47, 50) */
export type CardPlayabilityPolicy = (context: CardPlayContext) => boolean;

export interface PlayerProgress {
  /** Nombre de cartes déjà jouées par le joueur dans la partie. */
  cardsPlayed: number;
  /** Numéro du tour en cours (1 à 5). */
  trickNumber: number;
}

/** Le joueur peut-il déclarer sa main gagnante maintenant ? */
export type WinDeclarationWindow = (progress: PlayerProgress) => boolean;

/** Le joueur peut-il encore fuir ? */
export type FleeEligibility = (progress: PlayerProgress) => boolean;

/** Règles coup par coup d'une partie. Production : OFFICIAL_TER_RULES. */
export interface TerRuleSet {
  sameColor: ColorEquivalence;
  cardPlayability: CardPlayabilityPolicy;
  winDeclarationWindow: WinDeclarationWindow;
  fleeEligibility: FleeEligibility;
}
