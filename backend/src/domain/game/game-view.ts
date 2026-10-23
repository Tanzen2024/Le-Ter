import type { CardId } from '../cards/card';
import { dealSequence, type DealBatch } from '../cards/deck';
import type { GaramCardId, GaramSuit } from '../garam/garam-cards';
import {
  canDrawGaram,
  garamDealSequence,
  garamKeptTotal,
  garamPlayableCards,
} from '../garam/garam-engine';
import type {
  GaramPhase,
  GaramPlayedCard,
  GaramSpecialCondition,
  GaramTie,
  GaramVariant,
} from '../garam/garam-rules';
import { OFFICIAL_TER_RULES } from '../rules/official-rules';
import { AUTOMATIC_TRICK_NUMBER, DEAL_PASSES, type TerRuleSet } from '../rules/rule-set';
import type { InstantWinRank, WinConditionId } from '../rules/win-conditions';
import {
  expectedPlayerOf,
  type CompletedTrick,
  type Game,
  type GameEndReason,
  type GameResult,
  type GameStatus,
  type GameType,
  type PlayerInGame,
  type TrickPlay,
} from './game';
import type { GameId, PlayerId } from './game-id';
import { canDeclareInstantWin, canFlee, isDealing, playableCards } from './ter-engine';

/** Partie de l'état de jeu visible par un joueur. */
export interface PlayerPlayView {
  trickNumber: number;
  dealOrder: PlayerId[];
  /**
   * Lots de la distribution, dans l'ordre (passage 1 : 3 cartes par joueur, puis passage 2 :
   * 2 cartes), pour l'animation. Publique : aucune valeur de carte.
   */
  dealSequence: DealBatch<PlayerId>[];
  controllerId: PlayerId;
  controlCardId?: CardId;
  nextPlayerId?: PlayerId;
  /** Ordre de jeu du tour en cours (antihoraire depuis le meneur, fuyards exclus). */
  trickOrder: PlayerId[];
  /** Cartes jouées : visibles par tous (spec §2.3). */
  currentTrick: TrickPlay[];
  completedTricks: CompletedTrick[];
  /** Main de `viewerId` UNIQUEMENT. */
  myHand: CardId[];
  /** Nombre de cartes en main de chaque joueur (sans leur identité). */
  handCounts: Record<string, number>;
  stockCount: number;
}

/**
 * GARAM TIA (D-119) : ce qu'un joueur voit d'une manche. Publiques : terre, premières cartes
 * jouées, cartes tirées du terre. Secrètes : les mains (seule `myHand`), le reste du paquet.
 * Les mains ne sont révélées qu'en fin de manche, par le résultat.
 */
export interface GaramPlayerView {
  phase: GaramPhase;
  dealerId: PlayerId;
  order: PlayerId[];
  /** 3 cartes par joueur, une passe ; publique (aucune carte). */
  dealSequence: { pass: number; playerId: PlayerId; count: number }[];
  /** Terre, tête en premier. */
  terre: GaramCardId[];
  firstCards: GaramPlayedCard[];
  leadSuit?: GaramSuit;
  controllerId?: PlayerId;
  drawOrder: PlayerId[];
  drawn: Record<string, GaramCardId[]>;
  drawDone: PlayerId[];
  /** `passed` : le joueur a annoncé « Je passe » (D-145), pas « Impossible ». */
  lastRefusal?: { playerId: PlayerId; cardId?: GaramCardId; passed?: true };
  /** Public (D-145) : le joueur qui a la main annonce « Je passe » ; elle passe à l'échéance. */
  passingPlayerId?: PlayerId;
  nextPlayerId?: PlayerId;
  /** Main de `viewerId` UNIQUEMENT. */
  myHand: GaramCardId[];
  /** Mon total de cartes conservées (main + tirages, sans la première carte jouée). */
  myTotal?: number;
  handCounts: Record<string, number>;
  /** Peut-il tirer maintenant (son tour de tirage, une carte prenable) ? */
  canDraw: boolean;
  /** Main spéciale que je détiens (D-129) : à moi seul, jamais aux autres joueurs. */
  mySpecial?: GaramSpecialCondition;
  /**
   * Public (D-137) : une main spéciale unique va être déclarée par le serveur (court délai
   * après la distribution). Ni son détenteur ni sa nature ne sont révélés avant la victoire.
   */
  specialPending?: boolean;
}

/** GARAM TIA : proposition de doubler la mise, vue par un joueur (§3.15). */
export interface GaramStakeVoteView {
  previousStake: number;
  proposedStake: number;
  deadlineAt: Date;
  /** Joueurs qui ont répondu (pas leur réponse). */
  answeredPlayerIds: PlayerId[];
  /** Ma réponse, si j'ai répondu. */
  myVote?: boolean;
  /** Puis-je encore répondre ? */
  canVote: boolean;
}

/**
 * Ce que le spectateur de la vue peut faire MAINTENANT, calculé par le serveur (D-035) :
 * l'interface affiche ou masque ses boutons d'après ces drapeaux, sans jamais décider
 * elle-même de la légalité d'une carte, du droit de fuir ou de la victoire instantanée.
 */
export interface PlayerActions {
  /** C'est son tour (tours 1 à 4 ; le 5e tour est automatique) et le temps n'est pas écoulé. */
  canPlayCard: boolean;
  /** Cartes de sa main qu'il a le droit de jouer (obligation de suivre la famille). */
  playableCardIds: (CardId | GaramCardId)[];
  /** Tour 1, avant sa première carte, personne n'a encore fui (bouton « Fuir »). */
  canFlee: boolean;
  /** Main initiale gagnante, tour 1, avant sa première carte (bouton « Gagner instantanément »). */
  canDeclareInstantWin: boolean;
}

/**
 * Ce qu'un joueur a le droit de voir d'une partie : le SEUL format d'état envoyé
 * à un client. Les mains adverses et le talon ne quittent jamais le serveur ; ils
 * ne sont révélés que par le résultat d'un gain instantané (spec §2.3).
 */
export interface PlayerGameView {
  gameId: GameId;
  /** Jeu de la partie (D-119) ; absent : Le Ter. */
  gameType?: GameType;
  /** GARAM TIA : variante de la partie, affichée pendant toute la partie (D-127). */
  garamVariant?: GaramVariant;
  /** Session de la partie (D-033). */
  sessionId?: string;
  /** J1 : premier servi, premier à jouer, contrôle initial (D-033). */
  firstPlayerId: PlayerId;
  version: number;
  status: GameStatus;
  creatorId: PlayerId;
  maxPlayers: number;
  stakeAmount?: number;
  players: PlayerInGame[];
  play?: PlayerPlayView;
  /** GARAM TIA : la manche vue par ce joueur. */
  garam?: GaramPlayerView;
  /** GARAM TIA : manche nulle, rejouée aussitôt dans la même partie. */
  garamTie?: GaramTie;
  /** GARAM TIA : proposition de doubler la mise, sur la manche en attente qui rejoue. */
  garamStakeVote?: GaramStakeVoteView;
  result?: GameResult;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  /**
   * Timer de tour (D-034) : joueur attendu, début et échéance fixés par le serveur.
   * `turnTimedOutAt` : l'échéance est dépassée (TURN_TIMEOUT) et le coup automatique
   * attendu. Le client n'affiche qu'un compte à rebours ; il ne décide jamais du timeout.
   */
  activePlayerId?: PlayerId;
  turnStartedAt?: Date;
  turnDeadlineAt?: Date;
  turnTimedOutAt?: Date;
  /**
   * Phase de distribution (D-102) : présent tant que le serveur n'a pas confirmé la
   * distribution. Aucune échéance de tour n'existe alors : roulette et barres restent
   * inactives. À la confirmation, il disparaît et `turnDeadlineAt` apparaît.
   */
  dealEndsAt?: Date;
  /**
   * Table de tournoi (D-065) : `autoStart` signale le démarrage automatique ; `startDeadlineAt`
   * est l'échéance fixée par le serveur dès 2 joueurs (le créateur peut démarrer avant). Le
   * client n'affiche qu'un compte à rebours ; seul le serveur démarre.
   */
  autoStart?: boolean;
  startDeadlineAt?: Date;
  /** Tournoi de la table (D-106) ; absent pour une partie ordinaire. */
  tournamentId?: string;
  /** Raison de la fin de partie (victoire, égalité de priorité, arrêt administratif). */
  endReason?: GameEndReason;
  /** Égalité de priorité des mains instantanées : la partie est rejouée (D-035). */
  instantWinTie?: { rank: InstantWinRank; playerIds: PlayerId[] };
  /** Partie annulée que celle-ci rejoue (reprise immédiate après égalité). */
  replayOfGameId?: GameId;
  /** SA main initiale gagnante, s'il en a une (jamais celle des autres). */
  myInstantWin?: { rank: InstantWinRank; combination: WinConditionId };
  myActions: PlayerActions;
  viewerId: PlayerId;
  /**
   * SON bilan, une fois la partie terminée et réglée : variation nette enregistrée par le
   * règlement, et le compte réglé (D-111) : `WALLET` = compte de jeu réel (partie ordinaire,
   * D-074), `TOURNAMENT` = compte FICTIF du tournoi (jamais d'argent réel). Absent pour une
   * partie sans mise ou pas encore réglée.
   */
  mySettlement?: { delta: number; account: 'WALLET' | 'TOURNAMENT' };
}

export function toPlayerView(
  game: Game,
  viewerId: PlayerId,
  rules: TerRuleSet = OFFICIAL_TER_RULES,
): PlayerGameView {
  if (game.gameType === 'GARAM') {
    return toGaramPlayerView(game, viewerId);
  }
  const myTurn =
    game.status === 'in_progress' &&
    game.play?.nextPlayerId === viewerId &&
    game.play.trickNumber < AUTOMATIC_TRICK_NUMBER &&
    !game.turnTimedOutAt &&
    !isDealing(game) &&
    !game.players.some((p) => p.playerId === viewerId && p.fledAt);
  const myInstantWin =
    game.status === 'in_progress' ? game.play?.instantWins?.[viewerId] : undefined;
  const view: PlayerGameView = {
    ...commonView(game, viewerId),
    ...(myInstantWin && { myInstantWin: { ...myInstantWin } }),
    myActions: {
      canPlayCard: myTurn,
      playableCardIds: myTurn ? playableCards(game, viewerId, rules) : [],
      canFlee: canFlee(game, viewerId, rules),
      canDeclareInstantWin: canDeclareInstantWin(game, viewerId, rules),
    },
  };

  const { play } = game;
  if (play) {
    view.play = {
      trickNumber: play.trickNumber,
      dealOrder: [...play.dealOrder],
      dealSequence: dealSequence(play.dealOrder, DEAL_PASSES),
      controllerId: play.control.playerId,
      controlCardId: play.control.cardId,
      nextPlayerId: play.nextPlayerId,
      trickOrder: [...play.trickOrder],
      currentTrick: structuredClone(play.currentTrick),
      completedTricks: structuredClone(play.completedTricks),
      myHand: [...(play.hands[viewerId] ?? [])],
      handCounts: Object.fromEntries(
        Object.entries(play.hands).map(([id, cards]) => [id, cards.length]),
      ),
      stockCount: play.stock.length,
    };
  }
  return view;
}

/** Champs communs aux deux jeux (identité, cycle de vie, timers, contexte de la table). */
function commonView(
  game: Game,
  viewerId: PlayerId,
): Omit<PlayerGameView, 'myActions' | 'play' | 'garam'> {
  const expected = expectedPlayerOf(game);
  return {
    gameId: game.id,
    ...(game.sessionId && { sessionId: game.sessionId }),
    firstPlayerId: game.firstPlayerId,
    version: game.version,
    status: game.status,
    creatorId: game.creatorId,
    maxPlayers: game.maxPlayers,
    stakeAmount: game.stakeAmount,
    players: game.players.map((p) => ({ ...p })),
    result: game.result && structuredClone(game.result),
    createdAt: game.createdAt,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    ...(game.status === 'in_progress' && expected && { activePlayerId: expected }),
    turnStartedAt: game.turnStartedAt,
    turnDeadlineAt: game.turnDeadlineAt,
    turnTimedOutAt: game.turnTimedOutAt,
    ...(isDealing(game) && { dealEndsAt: game.dealEndsAt }),
    ...(game.autoStartDelayMs !== undefined && { autoStart: true }),
    // Contexte financier EXPLICITE de la table (D-106) : jetons de CE tournoi, jamais le
    // compte de jeu. Absent : partie ordinaire.
    ...(game.tournamentId && { tournamentId: game.tournamentId }),
    ...(game.status === 'waiting' &&
      game.startDeadlineAt && { startDeadlineAt: game.startDeadlineAt }),
    ...(game.endReason && { endReason: game.endReason }),
    ...(game.instantWinTie && { instantWinTie: structuredClone(game.instantWinTie) }),
    ...(game.replayOfGameId && { replayOfGameId: game.replayOfGameId }),
    viewerId,
  };
}

/**
 * Vue d'une manche de GARAM TIA (D-119). Même enveloppe que Le Ter ; les mains adverses et
 * le reste du paquet ne quittent jamais le serveur. Les actions sont calculées par le
 * serveur : l'interface ne décide jamais de la légalité d'une carte ni du tirage.
 */
function toGaramPlayerView(game: Game, viewerId: PlayerId): PlayerGameView {
  const myTurn =
    game.status === 'in_progress' &&
    game.garam?.phase === 'FIRST_ROUND' &&
    game.garam.nextPlayerId === viewerId &&
    !game.garam.special &&
    !game.turnTimedOutAt &&
    !isDealing(game);
  const view: PlayerGameView = {
    ...commonView(game, viewerId),
    gameType: 'GARAM',
    ...(game.garamVariant !== undefined && { garamVariant: game.garamVariant }),
    ...(game.garamTie && { garamTie: structuredClone(game.garamTie) }),
    myActions: {
      canPlayCard: myTurn,
      playableCardIds: myTurn ? garamPlayableCards(game, viewerId) : [],
      canFlee: false,
      // Main spéciale déclarée par le serveur (D-137) : aucun bouton à proposer.
      canDeclareInstantWin: false,
    },
  };
  const vote = game.garamStakeVote;
  if (vote && game.status === 'waiting') {
    const mine = vote.votes[viewerId];
    view.garamStakeVote = {
      previousStake: vote.previousStake,
      proposedStake: vote.proposedStake,
      deadlineAt: vote.deadlineAt,
      answeredPlayerIds: Object.keys(vote.votes) as PlayerId[],
      ...(mine !== undefined && { myVote: mine }),
      canVote: mine === undefined && game.players.some((p) => p.playerId === viewerId),
    };
  }
  const play = game.garam;
  if (play) {
    const member = play.order.includes(viewerId);
    view.garam = {
      phase: play.phase,
      dealerId: play.dealerId,
      order: [...play.order],
      dealSequence: garamDealSequence(play.order),
      terre: [...play.terre],
      firstCards: structuredClone(play.firstCards),
      ...(play.leadSuit && { leadSuit: play.leadSuit }),
      ...(play.controllerId && { controllerId: play.controllerId }),
      drawOrder: [...play.drawOrder],
      drawn: structuredClone(play.drawn),
      drawDone: [...play.drawDone],
      ...(play.lastRefusal && { lastRefusal: { ...play.lastRefusal } }),
      ...(play.passing && { passingPlayerId: play.passing.playerId }),
      ...(play.nextPlayerId && { nextPlayerId: play.nextPlayerId }),
      myHand: [...(play.hands[viewerId] ?? [])],
      ...(member && { myTotal: garamKeptTotal(play, viewerId) }),
      handCounts: Object.fromEntries(
        Object.entries(play.hands).map(([id, cards]) => [id, cards.length]),
      ),
      canDraw: canDrawGaram(game, viewerId),
      // Main spéciale en attente : connue de son seul détenteur (secrète pour les autres).
      ...(play.special?.playerId === viewerId && { mySpecial: play.special.condition }),
      ...(play.special && game.status === 'in_progress' && { specialPending: true }),
    };
  }
  return view;
}
