/**
 * Vue d'une partie telle que l'API l'envoie au joueur connecté (backend : PlayerGameView).
 * Types d'affichage uniquement : le serveur est l'autorité sur l'état et les règles (D-008).
 */
export type GameStatus = 'waiting' | 'in_progress' | 'finished';

/** Jeu d'une partie (D-119) : Le Ter (absent ou 'TER') ou GARAM TIA. */
export type GameType = 'TER' | 'GARAM';

/**
 * GARAM TIA : variante choisie à la création (D-127). Elle fixe seulement le seuil de la
 * pénalité « moins de X » ; la limite de 21 est commune. Décidée et appliquée par le serveur.
 */
export const GARAM_VARIANTS = [15, 16, 17, 18] as const;
export type GaramVariant = (typeof GARAM_VARIANTS)[number];

export function garamVariantLabel(variant: GaramVariant | undefined): string {
  return variant === undefined ? 'GARAM TIA' : `GARAM ${variant}`;
}

/** GARAM TIA : conditions spéciales de victoire automatique (§3.12, §3.13). */
export type GaramSpecialCondition =
  | 'THREE_SEVENS'
  | 'THREE_OF_A_KIND'
  | 'SUM_TEN'
  | 'SAME_SUIT'
  | 'SUM_TWENTY_ONE'
  // Manches jouées avant D-130 (historique seulement) : deux As ne sont plus une main
  // spéciale, ils se jugent à la fin normale de la manche.
  | 'TWO_ACES'
  | 'LOW_SUM'
  | 'SAME_SUIT_TERRE';

/**
 * GARAM TIA : la manche vue par le joueur connecté (backend : GaramPlayerView). Publiques :
 * terre, premières cartes, cartes tirées. `myHand` : MA main seulement.
 */
export interface GaramView {
  phase: 'FIRST_ROUND' | 'DRAW';
  dealerId: string;
  order: string[];
  dealSequence: DealBatch[];
  /** Terre, tête en premier. */
  terre: string[];
  firstCards: TrickPlay[];
  leadSuit?: string;
  controllerId?: string;
  drawOrder: string[];
  drawn: Record<string, string[]>;
  drawDone: string[];
  /** `passed` : le joueur a annoncé « Je passe » (D-145), pas « Impossible ». */
  lastRefusal?: { playerId: string; cardId?: string; passed?: true };
  /**
   * Public (D-145) : le joueur qui a la main ne peut prendre aucune carte et annonce « Je
   * passe » ; le serveur passe la main au joueur suivant à l'échéance de ce tour.
   */
  passingPlayerId?: string;
  nextPlayerId?: string;
  myHand: string[];
  myTotal?: number;
  handCounts: Record<string, number>;
  canDraw: boolean;
  /** Main spéciale que je détiens (D-129) : envoyée à moi seul par le serveur. */
  mySpecial?: GaramSpecialCondition;
  /**
   * Public (D-137) : une main spéciale va être déclarée par le serveur, peu après la
   * distribution. Ni son détenteur ni sa nature ne sont connus avant la victoire.
   */
  specialPending?: boolean;
}

/** GARAM TIA : manche nulle, rejouée aussitôt dans la même partie. */
export interface GaramTie {
  kind: 'SPECIAL' | 'SCORE';
  condition?: GaramSpecialCondition;
  playerIds: string[];
  scores?: Record<string, number>;
  hands?: Record<string, string[]>;
}

/** GARAM TIA : proposition de doubler la mise (§3.15). */
export interface GaramStakeVote {
  previousStake: number;
  proposedStake: number;
  deadlineAt: string;
  answeredPlayerIds: string[];
  myVote?: boolean;
  canVote: boolean;
}

export interface PlayerInGame {
  playerId: string;
  /** Rang d'arrivée dans CETTE partie. */
  seat: number;
  /** Siège FIXE de la session (D-034), le même d'une partie à l'autre. */
  tablePosition?: number;
  joinedAt: string;
  fledAt?: string;
  /** Pseudo du compte, lu par le serveur (D-064) ; absent s'il est inconnu. */
  username?: string;
}

export interface TrickPlay {
  playerId: string;
  cardId: string;
}

/** Un lot de la distribution : `count` cartes remises ensemble à un joueur (D-032). */
export interface DealBatch {
  pass: number;
  playerId: string;
  count: number;
}

export interface PlayerPlayView {
  trickNumber: number;
  /** Ordre de la partie, sens antihoraire à partir de J1 (premier servi, a le contrôle). */
  dealOrder: string[];
  /** Lots dans l'ordre : passage 1 (3 cartes par joueur), puis passage 2 (2 cartes). */
  dealSequence: DealBatch[];
  controllerId: string;
  controlCardId?: string;
  nextPlayerId?: string;
  /** Ordre de jeu du tour en cours (antihoraire depuis le meneur, fuyards exclus). */
  trickOrder: string[];
  currentTrick: TrickPlay[];
  completedTricks: { number: number; plays: TrickPlay[]; controllerId: string }[];
  /** Ma main seulement : les autres mains ne quittent jamais le serveur. */
  myHand: string[];
  handCounts: Record<string, number>;
  stockCount: number;
}

export type InstantWinCombination =
  | 'THREE_SEVENS'
  | 'SUM_AT_MOST_21'
  | 'FIVE_SAME_SUIT'
  | 'FOUR_OF_A_VALUE'
  | 'THREE_AND_TWO'
  /** « Composition de 7 » : deux 7, un 4, un 3 (D-118). */
  | 'COMPOSITION_OF_SEVEN'
  | 'THREE_THREES';

/** `OPPONENT_FLED` : partie à 2, l'adversaire s'est couché, victoire simple (D-086). */
export type GameEndReason =
  | 'INSTANT_WIN'
  | 'CONTROL_AFTER_LAST_TRICK'
  | 'OPPONENT_FLED'
  | 'INSTANT_WIN_TIE'
  | 'GARAM_AUTOMATIC_WIN'
  | 'GARAM_BEST_SCORE'
  | 'GARAM_TIE'
  | 'ADMIN_STOP';

export interface GameResult {
  winnerId: string;
  method:
    | 'INSTANT_WIN'
    | 'CONTROL_AFTER_LAST_TRICK'
    | 'OPPONENT_FLED'
    | 'GARAM_AUTOMATIC_WIN'
    | 'GARAM_BEST_SCORE';
  /** Victoire instantanée : rang retenu (1 = le plus fort) et combinaison. */
  instantWinRank?: number;
  instantWinCombination?: InstantWinCombination;
  /** Attribuée automatiquement par le serveur (plusieurs mains, rangs différents). */
  automatic?: boolean;
  victoryType?: 'SIMPLE';
  remainingOpponentIds: string[];
  fledPlayerIds: string[];
  /**
   * GARAM TIA : condition spéciale gagnante, totaux, perdants sous le seuil de la variante
   * (pénalité « moins de X », D-127) et seuil appliqué, mains révélées.
   */
  garamCondition?: GaramSpecialCondition;
  scores?: Record<string, number>;
  belowThresholdIds?: string[];
  penaltyThreshold?: GaramVariant;
  garamHands?: Record<string, string[]>;
}

export interface GameView {
  gameId: string;
  /** Jeu de la partie (D-119) ; absent : Le Ter. */
  gameType?: GameType;
  /** GARAM TIA : variante de la partie (D-127), affichée pendant toute la partie. */
  garamVariant?: GaramVariant;
  /** GARAM TIA : la manche, la manche nulle, la proposition de doubler la mise. */
  garam?: GaramView;
  garamTie?: GaramTie;
  garamStakeVote?: GaramStakeVote;
  /** Session de la partie (D-033). */
  sessionId?: string;
  /** J1 : premier servi, premier à jouer, contrôle initial (décidé par le serveur). */
  firstPlayerId: string;
  version: number;
  status: GameStatus;
  creatorId: string;
  maxPlayers: number;
  stakeAmount?: number;
  players: PlayerInGame[];
  play?: PlayerPlayView;
  result?: GameResult;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /**
   * Timer de tour (D-034, décidé par le serveur) : joueur attendu, début et échéance du
   * tour ; `turnTimedOutAt` = échéance dépassée, coup automatique attendu.
   */
  activePlayerId?: string;
  turnStartedAt?: string;
  turnDeadlineAt?: string;
  turnTimedOutAt?: string;
  /**
   * Phase de distribution (D-102) : présent tant que le serveur n'a pas confirmé la
   * distribution. Aucune échéance de tour n'existe alors (ni roulette ni barres).
   */
  dealEndsAt?: string;
  /**
   * Table de tournoi (D-065) : démarrage automatique par le serveur. `startDeadlineAt` :
   * échéance fixée dès 2 joueurs (le créateur peut démarrer avant) ; absente sinon.
   */
  autoStart?: boolean;
  startDeadlineAt?: string;
  /**
   * Tournoi de la table (D-106), décidé par le serveur à la création de la partie : la table
   * se joue en jetons de CE tournoi, jamais avec le compte de jeu. Absent : partie ordinaire.
   */
  tournamentId?: string;
  endReason?: GameEndReason;
  /** Égalité de priorité des mains instantanées : la partie est rejouée aussitôt. */
  instantWinTie?: { rank: number; playerIds: string[] };
  /** Partie annulée que celle-ci rejoue. */
  replayOfGameId?: string;
  /** MA main initiale gagnante (jamais celle des autres). */
  myInstantWin?: { rank: number; combination: InstantWinCombination };
  /**
   * Ce que je peux faire maintenant, décidé par le serveur : l'interface n'affiche les
   * boutons et ne permet de glisser que les cartes qu'il autorise.
   */
  myActions: {
    canPlayCard: boolean;
    playableCardIds: string[];
    canFlee: boolean;
    canDeclareInstantWin: boolean;
  };
  viewerId: string;
  /**
   * MON bilan financier une fois la partie terminée et réglée (D-074) : variation nette
   * enregistrée par le serveur. Absent pour une table de tournoi ou une partie sans mise.
   */
  /**
   * Bilan réglé par le serveur ; `account` dit QUEL compte a bougé (D-111) : `WALLET` = compte
   * de jeu réel, `TOURNAMENT` = compte fictif du tournoi (jamais d'argent réel).
   */
  mySettlement?: { delta: number; account: 'WALLET' | 'TOURNAMENT' };
  /** Heure du serveur à la réponse : aligne le compte à rebours sur son horloge. */
  serverNow?: string;
}

/** Actions de jeu exposées par l'API (DECLARE_WIN = « Gagner instantanément »). */
export type GameAction =
  | { type: 'PLAY_CARD'; cardId: string }
  | { type: 'DECLARE_WIN' }
  | { type: 'FLEE' }
  /** GARAM TIA : tirer à la tête du terre ; répondre à « doubler la mise ». */
  | { type: 'DRAW_CARD' }
  | { type: 'STAKE_VOTE'; accept: boolean };
