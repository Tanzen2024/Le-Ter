import type { CardId } from '../cards/card';
import { dealSequence, type DealBatch } from '../cards/deck';
import { OFFICIAL_TER_RULES } from '../rules/official-rules';
import { AUTOMATIC_TRICK_NUMBER, DEAL_PASSES, type TerRuleSet } from '../rules/rule-set';
import type { InstantWinRank, WinConditionId } from '../rules/win-conditions';
import type {
  CompletedTrick,
  Game,
  GameEndReason,
  GameResult,
  GameStatus,
  PlayerInGame,
  TrickPlay,
} from './game';
import type { GameId, PlayerId } from './game-id';
import { canDeclareInstantWin, canFlee, playableCards } from './ter-engine';

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
 * Ce que le spectateur de la vue peut faire MAINTENANT, calculé par le serveur (D-035) :
 * l'interface affiche ou masque ses boutons d'après ces drapeaux, sans jamais décider
 * elle-même de la légalité d'une carte, du droit de fuir ou de la victoire instantanée.
 */
export interface PlayerActions {
  /** C'est son tour (tours 1 à 4 ; le 5e tour est automatique) et le temps n'est pas écoulé. */
  canPlayCard: boolean;
  /** Cartes de sa main qu'il a le droit de jouer (obligation de suivre la famille). */
  playableCardIds: CardId[];
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
}

export function toPlayerView(
  game: Game,
  viewerId: PlayerId,
  rules: TerRuleSet = OFFICIAL_TER_RULES,
): PlayerGameView {
  const myTurn =
    game.status === 'in_progress' &&
    game.play?.nextPlayerId === viewerId &&
    game.play.trickNumber < AUTOMATIC_TRICK_NUMBER &&
    !game.turnTimedOutAt &&
    !game.players.some((p) => p.playerId === viewerId && p.fledAt);
  const myInstantWin =
    game.status === 'in_progress' ? game.play?.instantWins?.[viewerId] : undefined;
  const view: PlayerGameView = {
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
    ...(game.status === 'in_progress' &&
      game.play?.nextPlayerId && { activePlayerId: game.play.nextPlayerId }),
    turnStartedAt: game.turnStartedAt,
    turnDeadlineAt: game.turnDeadlineAt,
    turnTimedOutAt: game.turnTimedOutAt,
    ...(game.endReason && { endReason: game.endReason }),
    ...(game.instantWinTie && { instantWinTie: structuredClone(game.instantWinTie) }),
    ...(game.replayOfGameId && { replayOfGameId: game.replayOfGameId }),
    ...(myInstantWin && { myInstantWin: { ...myInstantWin } }),
    myActions: {
      canPlayCard: myTurn,
      playableCardIds: myTurn ? playableCards(game, viewerId, rules) : [],
      canFlee: canFlee(game, viewerId, rules),
      canDeclareInstantWin: canDeclareInstantWin(game, viewerId, rules),
    },
    viewerId,
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
