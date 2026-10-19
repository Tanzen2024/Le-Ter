/**
 * Vue d'une partie telle que l'API l'envoie au joueur connecté (backend : PlayerGameView).
 * Types d'affichage uniquement : le serveur est l'autorité sur l'état et les règles (D-008).
 */
export type GameStatus = 'waiting' | 'in_progress' | 'finished';

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
  | 'ADMIN_STOP';

export interface GameResult {
  winnerId: string;
  method: 'INSTANT_WIN' | 'CONTROL_AFTER_LAST_TRICK' | 'OPPONENT_FLED';
  /** Victoire instantanée : rang retenu (1 = le plus fort) et combinaison. */
  instantWinRank?: number;
  instantWinCombination?: InstantWinCombination;
  /** Attribuée automatiquement par le serveur (plusieurs mains, rangs différents). */
  automatic?: boolean;
  victoryType?: 'SIMPLE';
  remainingOpponentIds: string[];
  fledPlayerIds: string[];
}

export interface GameView {
  gameId: string;
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
  { type: 'PLAY_CARD'; cardId: string } | { type: 'DECLARE_WIN' } | { type: 'FLEE' };
