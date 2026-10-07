import type { CardId } from '../cards/card';
import type { CompletedTrick, Game, GameResult, GameStatus, PlayerInGame, TrickPlay } from './game';
import type { GameId, PlayerId } from './game-id';

/** Partie de l'état de jeu visible par un joueur. */
export interface PlayerPlayView {
  trickNumber: number;
  dealOrder: PlayerId[];
  controllerId: PlayerId;
  controlCardId?: CardId;
  nextPlayerId?: PlayerId;
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
 * Ce qu'un joueur a le droit de voir d'une partie : le SEUL format d'état envoyé
 * à un client. Les mains adverses et le talon ne quittent jamais le serveur ; ils
 * ne sont révélés que par le résultat d'un gain instantané (spec §2.3).
 */
export interface PlayerGameView {
  gameId: GameId;
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
  turnDeadlineAt?: Date;
  viewerId: PlayerId;
}

export function toPlayerView(game: Game, viewerId: PlayerId): PlayerGameView {
  const view: PlayerGameView = {
    gameId: game.id,
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
    turnDeadlineAt: game.turnDeadlineAt,
    viewerId,
  };

  const { play } = game;
  if (play) {
    view.play = {
      trickNumber: play.trickNumber,
      dealOrder: [...play.dealOrder],
      controllerId: play.control.playerId,
      controlCardId: play.control.cardId,
      nextPlayerId: play.nextPlayerId,
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
