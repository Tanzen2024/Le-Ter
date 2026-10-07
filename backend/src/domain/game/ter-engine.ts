/**
 * Moteur du Ter : fonctions déterministes appliquant une commande à UNE partie.
 *
 * - Aucune dépendance à Express, PostgreSQL, Redis, WebSocket ou React.
 * - Le hasard est injecté (RandomSource), l'heure aussi (`now`).
 * - Chaque fonction modifie la partie reçue, qui doit être une COPIE DE TRAVAIL
 *   (GameService en fournit une à chaque commande) et renvoie les événements produits.
 *   En cas d'erreur, l'appelant jette la copie : l'état stocké reste inchangé.
 * - Les règles ambiguës sont lues dans le TerRuleSet ; les situations non définies
 *   lèvent UnresolvedRuleError plutôt que d'être devinées.
 */
import { cardFromId, parseCardId, type Card, type CardId } from '../cards/card';
import { createDeck, dealCards, shuffleDeck } from '../cards/deck';
import type { RandomSource } from '../cards/random-source';
import {
  HAND_SIZE,
  MAX_FLEES_PER_GAME,
  TRICKS_PER_GAME,
  type PlayerProgress,
  type TerRuleSet,
} from '../rules/rule-set';
import { UnresolvedRuleError } from '../rules/unresolved-rule';
import { matchingWinConditions } from '../rules/win-conditions';
import {
  activePlayerIds,
  type Game,
  type GameEndMethod,
  type GameResult,
  type TerPlay,
} from './game';
import { assertPlayerInGame } from './game-access';
import {
  CardNotInHandError,
  CardNotPlayableError,
  FleeNotAllowedError,
  GameAlreadyStartedError,
  GameFinishedError,
  GameNotFullError,
  GameNotInProgressError,
  NotAWinningHandError,
  NotYourTurnError,
  PlayerHasFledError,
  WinDeclarationNotAllowedError,
} from './game-errors';
import type { GameEventDraft } from './game-events';
import type { PlayerId } from './game-id';

export interface EngineContext {
  rules: TerRuleSet;
  now: Date;
}

export interface StartContext extends EngineContext {
  random: RandomSource;
}

// ---------------------------------------------------------------------------
// Démarrage : distribution (spec §2.2)
// ---------------------------------------------------------------------------

export function startGame(game: Game, ctx: StartContext): GameEventDraft[] {
  if (game.status === 'finished') {
    throw new GameFinishedError(game.id);
  }
  if (game.status !== 'waiting') {
    throw new GameAlreadyStartedError(game.id);
  }
  // La partie attend « (max − 1) joueurs pour démarrer » (séquence « création de partie »).
  if (game.players.length !== game.maxPlayers) {
    throw new GameNotFullError(game.id);
  }

  const playerIds = game.players.map((p) => p.playerId);
  const dealOrder = ctx.rules.dealOrder(playerIds, ctx.random);
  assertSamePlayers(dealOrder, playerIds, 'dealOrder');

  const deck = shuffleDeck(createDeck(), ctx.random);
  const { hands, stock } = dealCards(deck, dealOrder, HAND_SIZE);
  const firstServed = dealOrder[0] as PlayerId;

  const play: TerPlay = {
    dealOrder,
    hands,
    stock,
    trickNumber: 1,
    trickOrder: [],
    currentTrick: [],
    completedTricks: [],
    // « Le premier joueur à recevoir ses cartes commence la partie et a le contrôle. »
    control: { playerId: firstServed },
  };
  game.play = play;
  game.status = 'in_progress';
  game.startedAt = ctx.now;
  openTrick(game, play, ctx.rules);

  return [
    {
      type: 'game:started',
      payload: {
        dealOrder,
        controllerId: firstServed,
        trickNumber: 1,
        nextPlayerId: play.nextPlayerId,
      },
    },
    ...dealOrder.map((playerId) => ({
      type: 'game:hand_dealt' as const,
      recipientId: playerId,
      payload: { cards: [...(hands[playerId] ?? [])] },
    })),
  ];
}

// ---------------------------------------------------------------------------
// Jouer une carte (spec §2.4, scénario §5)
// ---------------------------------------------------------------------------

export function playCard(
  game: Game,
  playerId: PlayerId,
  rawCardId: unknown,
  ctx: EngineContext,
): GameEventDraft[] {
  const play = requireInProgress(game);
  requireActivePlayer(game, playerId);
  if (play.nextPlayerId !== playerId) {
    throw new NotYourTurnError(game.id, playerId);
  }

  const card = parseCardId(rawCardId);
  const hand = handOf(play, playerId);
  if (!hand.includes(card.id)) {
    throw new CardNotInHandError(game.id, card.id);
  }

  const leadCard = play.currentTrick[0] && cardFromId(play.currentTrick[0].cardId);
  const controlCard = play.control.cardId && cardFromId(play.control.cardId);
  const playable = ctx.rules.cardPlayability({
    card,
    hand: hand.map(cardFromId),
    leadCard,
    controlCard,
    sameColor: ctx.rules.sameColor,
  });
  if (!playable) {
    throw new CardNotPlayableError(game.id, card.id);
  }

  hand.splice(hand.indexOf(card.id), 1);
  play.currentTrick.push({ playerId, cardId: card.id });
  const tookControl = applyControl(play, playerId, card, controlCard, ctx.rules);

  return [
    {
      type: 'game:card_played',
      payload: {
        playerId,
        cardId: card.id,
        trickNumber: play.trickNumber,
        tookControl,
        controllerId: play.control.playerId,
      },
    },
    ...advance(game, play, ctx),
  ];
}

/**
 * « Pour prendre le contrôle, un joueur doit jouer une carte supérieure et de même
 * couleur que celle jouée par le joueur ayant le contrôle » (spec §2.4).
 */
function applyControl(
  play: TerPlay,
  playerId: PlayerId,
  card: Card,
  controlCard: Card | undefined,
  rules: TerRuleSet,
): boolean {
  if (playerId === play.control.playerId) {
    play.control.cardId = card.id; // Le contrôleur pose la carte de référence.
    return false;
  }
  if (!controlCard) {
    // Le contrôleur ouvre toujours le tour (voir openTrick) : ce cas ne doit pas survenir.
    throw new UnresolvedRuleError('R-27', "aucune carte de contrôle n'a été posée dans ce tour");
  }
  if (card.value > controlCard.value && rules.sameColor(card, controlCard)) {
    play.control = { playerId, cardId: card.id };
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Gain instantané (spec §4, séquence « déroulement », scénario §6)
// ---------------------------------------------------------------------------

export function declareWin(game: Game, playerId: PlayerId, ctx: EngineContext): GameEventDraft[] {
  const play = requireInProgress(game);
  requireActivePlayer(game, playerId);
  if (!ctx.rules.winDeclarationWindow(progressOf(play, playerId))) {
    throw new WinDeclarationNotAllowedError(game.id);
  }

  const hand = handOf(play, playerId).map(cardFromId);
  const matched = matchingWinConditions(hand, ctx.rules.instantWinConditions);
  if (matched.length === 0) {
    throw new NotAWinningHandError(game.id);
  }

  return finish(game, play, playerId, 'INSTANT_WIN', ctx.now, {
    instantWinConditions: matched,
    // « toutes ses cartes ainsi que celles des autres joueurs deviennent visibles » (§2.3)
    revealedHands: structuredClone(play.hands),
  });
}

// ---------------------------------------------------------------------------
// Fuite (spec §2.5)
// ---------------------------------------------------------------------------

export function flee(game: Game, playerId: PlayerId, ctx: EngineContext): GameEventDraft[] {
  const play = requireInProgress(game);
  requireActivePlayer(game, playerId);

  const fledCount = game.players.filter((p) => p.fledAt).length;
  if (fledCount >= MAX_FLEES_PER_GAME) {
    throw new FleeNotAllowedError(game.id, 'un seul joueur peut fuir par partie');
  }
  if (!ctx.rules.fleeEligibility(progressOf(play, playerId))) {
    throw new FleeNotAllowedError(game.id, 'le moment autorisé est dépassé');
  }
  if (play.control.playerId === playerId) {
    throw new UnresolvedRuleError('R-30', 'le joueur qui a le contrôle veut fuir');
  }
  if (activePlayerIds(game).length - 1 < 2) {
    throw new UnresolvedRuleError('R-30', 'la fuite laisserait un seul joueur dans la partie');
  }

  const player = game.players.find((p) => p.playerId === playerId);
  if (player) {
    player.fledAt = ctx.now;
  }

  const events: GameEventDraft[] = [{ type: 'game:player_fled', payload: { playerId } }];
  if (play.nextPlayerId === playerId) {
    events.push(...advance(game, play, ctx));
  }
  return events;
}

// ---------------------------------------------------------------------------
// Déroulement des tours
// ---------------------------------------------------------------------------

/**
 * Ouvre le tour en cours. Le meneur est le joueur qui a le contrôle : la règle de
 * prise de contrôle se définit par rapport à SA carte (§2.4), ce qui n'est cohérent
 * que s'il joue en premier. Au 1er tour, c'est le premier servi (§2.2).
 * Déduction à confirmer (R-27). L'ordre des suivants est une règle injectée (R-28).
 */
function openTrick(game: Game, play: TerPlay, rules: TerRuleSet): void {
  const leaderId = play.control.playerId;
  const activeDealOrder = play.dealOrder.filter((id) => activePlayerIds(game).includes(id));
  const order = rules.playOrder(activeDealOrder, leaderId);
  assertSamePlayers(order, activeDealOrder, 'playOrder');
  if (order[0] !== leaderId) {
    throw new Error('playOrder doit commencer par le meneur du tour');
  }
  play.trickOrder = order;
  play.nextPlayerId = leaderId;
}

/** Passe au joueur suivant, ou clôt le tour quand tous les joueurs en jeu ont joué. */
function advance(game: Game, play: TerPlay, ctx: EngineContext): GameEventDraft[] {
  const active = activePlayerIds(game);
  const played = new Set(play.currentTrick.map((p) => p.playerId));
  const next = play.trickOrder.find((id) => active.includes(id) && !played.has(id));

  if (next) {
    play.nextPlayerId = next;
    return [turnChanged(play)];
  }
  return completeTrick(game, play, ctx);
}

function completeTrick(game: Game, play: TerPlay, ctx: EngineContext): GameEventDraft[] {
  const controllerId = play.control.playerId;
  play.completedTricks.push({
    number: play.trickNumber,
    plays: [...play.currentTrick],
    controllerId,
  });
  const events: GameEventDraft[] = [
    {
      type: 'game:trick_completed',
      payload: { trickNumber: play.trickNumber, controllerId, plays: play.currentTrick },
    },
  ];

  if (play.trickNumber >= TRICKS_PER_GAME) {
    // « L'objectif est de conserver le contrôle jusqu'au dernier tour » (§1).
    return [...events, ...finish(game, play, controllerId, 'CONTROL_AFTER_LAST_TRICK', ctx.now)];
  }

  play.trickNumber += 1;
  play.currentTrick = [];
  play.control = { playerId: controllerId };
  openTrick(game, play, ctx.rules);
  return [...events, turnChanged(play)];
}

function finish(
  game: Game,
  play: TerPlay,
  winnerId: PlayerId,
  method: GameEndMethod,
  now: Date,
  extra: Pick<GameResult, 'instantWinConditions' | 'revealedHands'> = {},
): GameEventDraft[] {
  const result: GameResult = {
    winnerId,
    method,
    ...extra,
    remainingOpponentIds: activePlayerIds(game).filter((id) => id !== winnerId),
    fledPlayerIds: game.players.filter((p) => p.fledAt).map((p) => p.playerId),
  };
  game.status = 'finished';
  game.finishedAt = now;
  game.result = result;
  game.turnDeadlineAt = undefined;
  play.nextPlayerId = undefined;
  return [{ type: 'game:finished', payload: { result: structuredClone(result) } }];
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function turnChanged(play: TerPlay): GameEventDraft {
  return {
    type: 'game:turn_changed',
    payload: { trickNumber: play.trickNumber, nextPlayerId: play.nextPlayerId },
  };
}

function requireInProgress(game: Game): TerPlay {
  if (game.status !== 'in_progress' || !game.play) {
    throw new GameNotInProgressError(game.id);
  }
  return game.play;
}

function requireActivePlayer(game: Game, playerId: PlayerId): void {
  assertPlayerInGame(game, playerId);
  if (game.players.some((p) => p.playerId === playerId && p.fledAt)) {
    throw new PlayerHasFledError(game.id, playerId);
  }
}

function handOf(play: TerPlay, playerId: PlayerId): CardId[] {
  const hand = play.hands[playerId];
  if (!hand) {
    throw new Error(`Main introuvable pour ${playerId}`);
  }
  return hand;
}

export function progressOf(play: TerPlay, playerId: PlayerId): PlayerProgress {
  const cardsPlayed = [
    ...play.completedTricks.flatMap((t) => t.plays),
    ...play.currentTrick,
  ].filter((p) => p.playerId === playerId).length;
  return { cardsPlayed, trickNumber: play.trickNumber };
}

/** Une politique injectée doit renvoyer exactement les joueurs attendus, sans doublon. */
function assertSamePlayers(
  actual: readonly PlayerId[],
  expected: readonly PlayerId[],
  policy: string,
): void {
  const same =
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((id) => expected.includes(id));
  if (!same) {
    throw new Error(`La règle ${policy} a renvoyé un ordre de joueurs invalide`);
  }
}
