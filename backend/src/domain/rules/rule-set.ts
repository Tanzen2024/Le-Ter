import type { Card } from '../cards/card';
import type { RandomSource } from '../cards/random-source';
import type { PlayerId } from '../game/game-id';
import type { WinCondition } from './win-conditions';

/**
 * Règles CERTAINES (documents concordants), codées en dur dans le moteur.
 * Voir docs/game-domain.md, matrice des règles.
 */
export const HAND_SIZE = 5; // spec §2.2
export const TRICKS_PER_GAME = 5; // spec §2.4 « Le jeu se déroule en 5 tours »
export const MAX_FLEES_PER_GAME = 1; // spec §2.5

/** Deux cartes sont-elles « de même couleur » ? Sens non tranché (R-08). */
export type ColorEquivalence = (a: Card, b: Card) => boolean;

/** Ordre de distribution ; le premier de la liste est le premier servi (R-17). */
export type DealOrderPolicy = (playerIds: readonly PlayerId[], random: RandomSource) => PlayerId[];

/**
 * Ordre de jeu d'un tour à partir de son meneur, parmi les joueurs encore en jeu
 * (`activeDealOrder`, dans l'ordre de distribution). Sens non défini (R-28).
 */
export type PlayOrderPolicy = (
  activeDealOrder: readonly PlayerId[],
  leaderId: PlayerId,
) => PlayerId[];

export interface CardPlayContext {
  card: Card;
  hand: readonly Card[];
  /** Première carte du tour en cours (absente si le joueur ouvre le tour). */
  leadCard?: Card;
  /** Carte qui détient le contrôle dans le tour en cours. */
  controlCard?: Card;
  sameColor: ColorEquivalence;
}

/** Une carte de la main est-elle jouable ? Obligation de suivre non définie (R-03). */
export type CardPlayabilityPolicy = (context: CardPlayContext) => boolean;

export interface PlayerProgress {
  /** Nombre de cartes déjà jouées par le joueur dans la partie. */
  cardsPlayed: number;
  /** Numéro du tour en cours (1 à 5). */
  trickNumber: number;
}

/** Le joueur peut-il déclarer une main gagnante maintenant ? (R-07) */
export type WinDeclarationWindow = (progress: PlayerProgress) => boolean;

/** Le joueur peut-il encore fuir ? Deux formulations contradictoires (R-05). */
export type FleeEligibility = (progress: PlayerProgress) => boolean;

/**
 * Jeu de règles d'une partie. Chaque champ correspond à une règle AMBIGUË des
 * documents : aucune valeur par défaut n'est fournie. Des interprétations
 * candidates existent dans rule-candidates.ts, mais choisir l'une d'elles est une
 * décision métier à consigner dans docs/decisions.md.
 */
export interface TerRuleSet {
  sameColor: ColorEquivalence;
  dealOrder: DealOrderPolicy;
  playOrder: PlayOrderPolicy;
  cardPlayability: CardPlayabilityPolicy;
  winDeclarationWindow: WinDeclarationWindow;
  instantWinConditions: readonly WinCondition[];
  fleeEligibility: FleeEligibility;
}
