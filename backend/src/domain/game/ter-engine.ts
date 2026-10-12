/**
 * Moteur du Ter : fonctions déterministes appliquant une commande à UNE partie.
 *
 * - Aucune dépendance à Express, PostgreSQL, Redis, WebSocket ou React.
 * - Le hasard est injecté (RandomSource), l'heure aussi (`now`).
 * - Chaque fonction modifie la partie reçue, qui doit être une COPIE DE TRAVAIL
 *   (GameService en fournit une à chaque commande) et renvoie les événements produits.
 *   En cas d'erreur, l'appelant jette la copie : l'état stocké reste inchangé.
 * - Les règles sont celles du socle de vérité (D-035, 52 décisions). Une situation que ce
 *   socle ne définit pas lève UnresolvedRuleError plutôt que d'être devinée.
 */
import { cardFromId, parseCardId, type Card, type CardId } from '../cards/card';
import { createDeck, dealInPasses, shuffleDeck } from '../cards/deck';
import type { RandomSource } from '../cards/random-source';
import {
  AUTOMATIC_TRICK_NUMBER,
  DEAL_PASSES,
  MAX_FLEES_PER_GAME,
  TRICKS_PER_GAME,
  TURN_DURATION_MS,
  type PlayerProgress,
  type TerRuleSet,
} from '../rules/rule-set';
import { bestInstantWin, resolveInstantWins } from '../rules/win-conditions';
import {
  MIN_PLAYERS_TO_START,
  activePlayerIds,
  type Game,
  type GameEndMethod,
  type GameResult,
  type TerPlay,
} from './game';
import { getNextPlayer, rotateFrom } from '../sessions/table-order';
import { assertPlayerInGame } from './game-access';
import {
  CardNotInHandError,
  CardNotPlayableError,
  FirstPlayerNotInGameError,
  FleeNotAllowedError,
  GameAlreadyStartedError,
  GameFinishedError,
  GameNotEnoughPlayersError,
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
  /** Durée d'un tour. Par défaut TURN_DURATION_MS (10 s, D-034, D-092). */
  turnDurationMs?: number;
}

/** Le démarrage n'utilise aucune règle coup par coup. */
export interface StartContext {
  rules?: TerRuleSet;
  now: Date;
  random: RandomSource;
  turnDurationMs?: number;
}

// ---------------------------------------------------------------------------
// Démarrage et distribution (décisions 18-34)
// ---------------------------------------------------------------------------

/**
 * Conditions de démarrage (R-23) : partie en attente et AU MOINS 2 joueurs. La capacité
 * maximale (2, 3 ou 4) n'est pas une condition. L'autorisation relève de GameService.
 */
export function assertCanStart(game: Game): void {
  if (game.status === 'finished') {
    throw new GameFinishedError(game.id);
  }
  if (game.status !== 'waiting') {
    throw new GameAlreadyStartedError(game.id);
  }
  if (game.players.length < MIN_PLAYERS_TO_START) {
    throw new GameNotEnoughPlayersError(game.id);
  }
  if (game.players.length > game.maxPlayers) {
    throw new Error(`Invariant violé : plus de joueurs que de places dans ${game.id}`);
  }
}

/**
 * Ordre de la partie, sens ANTIHORAIRE (décision 24) : les joueurs dans l'ordre de leur
 * siège fixe de session (`tablePosition`), à partir de J1. Ex. sièges A, B, C, D et
 * J1 = C : C → D → A → B. Les sièges ne bougent jamais (décision 22).
 */
export function tableOrder(game: Game): PlayerId[] {
  const byPlace = [...game.players]
    .sort((a, b) => (a.tablePosition ?? a.seat) - (b.tablePosition ?? b.seat))
    .map((p) => p.playerId);
  if (!byPlace.includes(game.firstPlayerId)) {
    throw new FirstPlayerNotInGameError(game.id, game.firstPlayerId);
  }
  return rotateFrom(byPlace, game.firstPlayerId);
}

/**
 * Démarrage, distribution et analyse des mains, en UNE transition atomique :
 *
 * 1. paquet de 31 cartes, mélange Fisher-Yates avec le hasard injecté (cryptographique) ;
 * 2. passage 1 : J1 reçoit 3 cartes d'un bloc, puis J2, J3, J4 (antihoraire) ;
 *    passage 2 : 2 cartes d'un bloc, même ordre. Les cartes restantes sont inaccessibles ;
 * 3. J1 joue en premier et détient le contrôle initial ;
 * 4. le serveur analyse les 5 cartes de CHAQUE joueur (victoire instantanée, D-035) :
 *    - une seule main gagnante → déclaration facultative (bouton du joueur) ;
 *    - plusieurs, meilleur rang unique → ce joueur gagne AUTOMATIQUEMENT (victoire simple) ;
 *    - plusieurs, meilleur rang partagé → aucun gagnant : partie annulée pour égalité,
 *      rejouée immédiatement par la session (même J1, mêmes sièges, nouveau mélange) ;
 * 5. sinon, timer du premier tour (D-034).
 */
export function startGame(game: Game, ctx: StartContext): GameEventDraft[] {
  assertCanStart(game);

  const dealOrder = tableOrder(game);
  const deck = shuffleDeck(createDeck(), ctx.random);
  const { hands, stock, sequence } = dealInPasses(deck, dealOrder, DEAL_PASSES);
  const firstServed = dealOrder[0] as PlayerId;

  const play: TerPlay = {
    dealOrder,
    hands,
    stock,
    trickNumber: 1,
    trickOrder: [],
    currentTrick: [],
    completedTricks: [],
    control: { playerId: firstServed },
    nextPlayerId: firstServed,
  };
  game.play = play;
  game.status = 'in_progress';
  game.startedAt = ctx.now;
  // Démarrage (manuel ou automatique) : plus d'échéance de démarrage (D-065).
  game.startDeadlineAt = undefined;
  openTrick(game, play);

  // Analyse serveur des mains initiales.
  const instantWins: NonNullable<TerPlay['instantWins']> = {};
  for (const playerId of dealOrder) {
    const match = bestInstantWin((hands[playerId] ?? []).map(cardFromId));
    if (match) {
      instantWins[playerId] = { rank: match.rank, combination: match.combination };
    }
  }
  play.instantWins = instantWins;
  const resolution = resolveInstantWins(
    Object.entries(instantWins).map(([playerId, w]) => ({
      playerId: playerId as PlayerId,
      rank: w.rank,
    })),
  );

  const events: GameEventDraft[] = [
    {
      type: 'game:started',
      // Public : ordre, J1, contrôle, la séquence des lots (aucune carte).
      payload: {
        dealOrder,
        firstPlayerId: firstServed,
        controllerId: firstServed,
        trickNumber: 1,
        nextPlayerId: firstServed,
        dealSequence: sequence,
      },
    },
    // Privé : chaque joueur reçoit SES cartes, groupées par lot (3 puis 2).
    ...dealOrder.map((playerId) => {
      const cards = [...(hands[playerId] ?? [])];
      return {
        type: 'game:hand_dealt' as const,
        recipientId: playerId,
        payload: { playerId, cards, batches: splitByPasses(cards) },
      };
    }),
  ];

  if (resolution.kind === 'automatic') {
    const winner = instantWins[resolution.playerId];
    return [
      ...events,
      ...finish(game, play, resolution.playerId, 'INSTANT_WIN', ctx.now, {
        instantWinRank: resolution.rank,
        instantWinCombination: winner?.combination,
        automatic: true,
        victoryType: 'SIMPLE',
        revealedHands: structuredClone(play.hands),
      }),
    ];
  }
  if (resolution.kind === 'tie') {
    return [...events, ...cancelForTie(game, play, resolution.playerIds, resolution.rank, ctx.now)];
  }

  beginTurn(game, ctx.now, ctx.turnDurationMs);
  const started = events[0] as GameEventDraft;
  started.payload = {
    ...started.payload,
    turnStartedAt: game.turnStartedAt?.toISOString(),
    turnDeadlineAt: game.turnDeadlineAt?.toISOString(),
  };
  return events;
}

/** [c1…c5] → [[c1, c2, c3], [c4, c5]] selon DEAL_PASSES. */
function splitByPasses(cards: readonly CardId[]): CardId[][] {
  let offset = 0;
  return DEAL_PASSES.map((count) => {
    const batch = cards.slice(offset, offset + count);
    offset += count;
    return batch;
  });
}

/**
 * Égalité de priorité (D-035) : aucun gagnant, la partie s'arrête ; la session la rejoue
 * immédiatement dans une nouvelle partie (sans Poursuivre/Quitter). Les mains ne sont pas
 * révélées ; seuls le rang et les joueurs concernés sont publics.
 */
function cancelForTie(
  game: Game,
  play: TerPlay,
  playerIds: PlayerId[],
  rank: NonNullable<Game['instantWinTie']>['rank'],
  now: Date,
): GameEventDraft[] {
  game.status = 'finished';
  game.finishedAt = now;
  game.endReason = 'INSTANT_WIN_TIE';
  game.instantWinTie = { rank, playerIds };
  clearTurn(game);
  play.nextPlayerId = undefined;
  return [{ type: 'game:instant_win_tie', payload: { rank, playerIds } }];
}

// ---------------------------------------------------------------------------
// Jouer une carte (décisions 36-52)
// ---------------------------------------------------------------------------

/**
 * Cartes que `playerId` peut jouer maintenant (décisions 46-47, 50) : toutes s'il ouvre
 * le tour ; sinon celles de la famille de la carte du meneur s'il en a, toutes sinon.
 */
export function playableCards(game: Game, playerId: PlayerId, rules: TerRuleSet): CardId[] {
  const play = game.play;
  if (game.status !== 'in_progress' || !play || play.nextPlayerId !== playerId) {
    return [];
  }
  const hand = (play.hands[playerId] ?? []).map(cardFromId);
  const leadCard = play.currentTrick[0] && cardFromId(play.currentTrick[0].cardId);
  const controlCard = play.control.cardId && cardFromId(play.control.cardId);
  return hand
    .filter((card) =>
      rules.cardPlayability({ card, hand, leadCard, controlCard, sameColor: rules.sameColor }),
    )
    .map((c) => c.id);
}

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
  if (!playableCards(game, playerId, ctx.rules).includes(card.id)) {
    throw new CardNotPlayableError(game.id, card.id);
  }
  return [...placeCard(play, playerId, card, ctx.rules, false), ...advance(game, play, ctx)];
}

/** Pose la carte dans le tour ; met à jour le contrôle courant (affichage). */
function placeCard(
  play: TerPlay,
  playerId: PlayerId,
  card: Card,
  rules: TerRuleSet,
  automatic: boolean,
): GameEventDraft[] {
  const hand = handOf(play, playerId);
  hand.splice(hand.indexOf(card.id), 1);
  play.currentTrick.push({ playerId, cardId: card.id });
  const tookControl = applyControl(play, playerId, card, rules);
  return [
    {
      type: 'game:card_played',
      payload: {
        playerId,
        cardId: card.id,
        trickNumber: play.trickNumber,
        tookControl,
        controllerId: play.control.playerId,
        ...(automatic && { automatic: true }),
      },
    },
    ...(tookControl
      ? [
          {
            type: 'game:control_changed' as const,
            payload: { controllerId: playerId, cardId: card.id, trickNumber: play.trickNumber },
          },
        ]
      : []),
  ];
}

/**
 * Contrôle COURANT pendant le tour : la carte du meneur fixe la famille ; une carte de
 * cette famille et de valeur strictement supérieure à la carte qui détient le contrôle le
 * prend (décision 51). Une carte d'une autre famille, ou inférieure, ne change rien. Le
 * contrôleur ne rejoue pas dans le tour (décision 42). Le résultat du tour est recalculé
 * à sa fin (décision 52, `trickController`).
 */
function applyControl(play: TerPlay, playerId: PlayerId, card: Card, rules: TerRuleSet): boolean {
  if (play.currentTrick.length === 1) {
    play.control = { playerId, cardId: card.id }; // le meneur pose la carte de contrôle
    return false;
  }
  const controlCard = play.control.cardId && cardFromId(play.control.cardId);
  const leadCard = cardFromId((play.currentTrick[0] as { cardId: CardId }).cardId);
  if (
    controlCard &&
    rules.sameColor(card, leadCard) &&
    card.value > controlCard.value &&
    playerId !== play.control.playerId
  ) {
    play.control = { playerId, cardId: card.id };
    return true;
  }
  return false;
}

/**
 * Contrôleur à la FIN du tour (décision 52) : parmi les cartes jouées de la famille de la
 * carte de contrôle du début du tour (celle du meneur), la plus haute valeur ; les cartes
 * des joueurs qui ont fui sont ignorées. Personne d'autre ne l'emporte : le contrôleur
 * précédent garde le contrôle (décision 41).
 */
function trickController(game: Game, play: TerPlay, previousController: PlayerId): PlayerId {
  const lead = play.currentTrick[0];
  if (!lead) {
    return previousController;
  }
  const leadSuit = cardFromId(lead.cardId).suit;
  const fled = new Set(game.players.filter((p) => p.fledAt).map((p) => p.playerId));
  let best: { playerId: PlayerId; value: number } | undefined;
  for (const { playerId, cardId } of play.currentTrick) {
    const card = cardFromId(cardId);
    if (card.suit === leadSuit && !fled.has(playerId) && (!best || card.value > best.value)) {
      best = { playerId, value: card.value };
    }
  }
  return best?.playerId ?? previousController;
}

// ---------------------------------------------------------------------------
// Victoire instantanée déclarée (D-035)
// ---------------------------------------------------------------------------

/**
 * « Gagner instantanément » : seulement le joueur dont la main initiale est gagnante
 * (analyse serveur), pendant le tour 1, avant d'avoir joué sa première carte. Victoire
 * toujours SIMPLE ; toutes les mains sont révélées (spec §2.3).
 */
export function declareWin(game: Game, playerId: PlayerId, ctx: EngineContext): GameEventDraft[] {
  const play = requireInProgress(game);
  requireActivePlayer(game, playerId);
  if (!ctx.rules.winDeclarationWindow(progressOf(play, playerId))) {
    throw new WinDeclarationNotAllowedError(game.id);
  }
  const win = play.instantWins?.[playerId];
  if (!win) {
    throw new NotAWinningHandError(game.id);
  }
  return finish(game, play, playerId, 'INSTANT_WIN', ctx.now, {
    instantWinRank: win.rank,
    instantWinCombination: win.combination,
    automatic: false,
    victoryType: 'SIMPLE',
    revealedHands: structuredClone(play.hands),
  });
}

/** Le joueur peut-il déclarer sa victoire instantanée maintenant ? (pour la vue) */
export function canDeclareInstantWin(game: Game, playerId: PlayerId, rules: TerRuleSet): boolean {
  const play = game.play;
  return Boolean(
    game.status === 'in_progress' &&
    play?.instantWins?.[playerId] &&
    !hasFled(game, playerId) &&
    rules.winDeclarationWindow(progressOf(play, playerId)),
  );
}

// ---------------------------------------------------------------------------
// Fuite (D-035)
// ---------------------------------------------------------------------------

/** Raison d'un refus de fuite, ou null si la fuite est permise. */
function fleeRefusal(game: Game, playerId: PlayerId, rules: TerRuleSet): string | null {
  const play = game.play;
  if (game.status !== 'in_progress' || !play) {
    return 'la partie n’est pas en cours';
  }
  if (game.players.filter((p) => p.fledAt).length >= MAX_FLEES_PER_GAME) {
    return 'un seul joueur peut fuir par partie';
  }
  if (!rules.fleeEligibility(progressOf(play, playerId))) {
    return 'se coucher n’est possible qu’avant d’avoir joué sa deuxième carte';
  }
  return null;
}

/** Le joueur peut-il fuir maintenant ? (pour la vue) */
export function canFlee(game: Game, playerId: PlayerId, rules: TerRuleSet): boolean {
  return (
    !hasFled(game, playerId) &&
    game.players.some((p) => p.playerId === playerId) &&
    // Partie à 2 comprise : la fuite y termine la partie au profit de l'adversaire (D-086).
    fleeRefusal(game, playerId, rules) === null
  );
}

/**
 * Fuir (D-035, D-089) : avant sa deuxième carte (tours 1 et 2) ; un seul fuyard par partie ;
 * permis même au joueur qui a le contrôle. Le joueur devient inactif pour CETTE partie
 * (il reste dans la session, à son siège) ; ses cartes ne seront jamais jouées ; sa main
 * gagnante éventuelle ne compte plus.
 */
export function flee(game: Game, playerId: PlayerId, ctx: EngineContext): GameEventDraft[] {
  const play = requireInProgress(game);
  requireActivePlayer(game, playerId);

  const refusal = fleeRefusal(game, playerId, ctx.rules);
  if (refusal) {
    throw new FleeNotAllowedError(game.id, refusal);
  }
  const remaining = activePlayerIds(game).filter((id) => id !== playerId);

  const player = game.players.find((p) => p.playerId === playerId);
  if (player) {
    player.fledAt = ctx.now;
  }
  if (play.instantWins) {
    delete play.instantWins[playerId];
  }

  const events: GameEventDraft[] = [{ type: 'game:player_fled', payload: { playerId } }];
  if (remaining.length === 1) {
    // Partie à 2 (R-30, D-086) : celui qui se couche perd, le joueur restant gagne aussitôt
    // (victoire SIMPLE) ; le règlement débite la mise du fuyard comme celle d'un perdant.
    return [
      ...events,
      ...finish(game, play, remaining[0]!, 'OPPONENT_FLED', ctx.now, { victoryType: 'SIMPLE' }),
    ];
  }
  if (play.control.playerId === playerId) {
    // Le contrôleur fuit avant d'avoir joué (le meneur du tour en cours, tour 1 ou 2).
    // Les joueurs ayant fui sont ignorés dans l'ordre (décision 37) : le joueur actif
    // suivant, sens antihoraire, mène le tour et détient donc le contrôle (décision 38).
    const next = getNextPlayer(play.dealOrder, playerId, (id) => !hasFled(game, id));
    if (!next) {
      throw new Error(`Aucun joueur actif après la fuite dans ${game.id}`);
    }
    play.control = { playerId: next };
    openTrick(game, play);
    beginTurn(game, ctx.now, ctx.turnDurationMs);
    events.push(
      {
        type: 'game:control_changed',
        payload: { controllerId: next, trickNumber: play.trickNumber },
      },
      turnChanged(game, play),
    );
  } else if (play.nextPlayerId === playerId) {
    events.push(...advance(game, play, ctx));
  }
  return events;
}

// ---------------------------------------------------------------------------
// Déroulement des tours
// ---------------------------------------------------------------------------

/**
 * Ouvre le tour en cours. Le meneur est le joueur qui a le contrôle (décisions 38, 43) ;
 * l'ordre suit le sens antihoraire à partir de lui, parmi les joueurs encore en jeu
 * (décisions 37, 39-40). Ex. J1..J4 et J3 au contrôle : J3 → J4 → J1 → J2.
 */
function openTrick(game: Game, play: TerPlay): void {
  const leaderId = play.control.playerId;
  const active = activePlayerIds(game);
  const activeDealOrder = play.dealOrder.filter((id) => active.includes(id));
  play.trickOrder = rotateFrom(activeDealOrder, leaderId);
  play.nextPlayerId = leaderId;
}

/** Passe au joueur suivant, ou clôt le tour quand tous les joueurs en jeu ont joué. */
function advance(game: Game, play: TerPlay, ctx: EngineContext): GameEventDraft[] {
  const active = activePlayerIds(game);
  const played = new Set(play.currentTrick.map((p) => p.playerId));
  const next = play.trickOrder.find((id) => active.includes(id) && !played.has(id));

  if (next) {
    play.nextPlayerId = next;
    beginTurn(game, ctx.now, ctx.turnDurationMs);
    return [turnChanged(game, play)];
  }
  return completeTrick(game, play, ctx);
}

function completeTrick(game: Game, play: TerPlay, ctx: EngineContext): GameEventDraft[] {
  const controllerId = trickController(game, play, play.control.playerId);
  const winning = play.currentTrick.find((p) => p.playerId === controllerId);
  play.control = { playerId: controllerId, ...(winning && { cardId: winning.cardId }) };
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
    // Le 5e tour est désormais dans `completedTricks` : il ne reste pas AUSSI le tour en
    // cours (une carte jouée n'a qu'une place dans l'état).
    play.currentTrick = [];
    // À la fin du 5e tour, le contrôleur gagne automatiquement (décision 35).
    return [...events, ...finish(game, play, controllerId, 'CONTROL_AFTER_LAST_TRICK', ctx.now)];
  }

  play.trickNumber += 1;
  play.currentTrick = [];
  play.control = { playerId: controllerId };
  openTrick(game, play);
  if (play.trickNumber === AUTOMATIC_TRICK_NUMBER) {
    return [...events, ...playLastTrickAutomatically(game, play, ctx)];
  }
  beginTurn(game, ctx.now, ctx.turnDurationMs);
  return [...events, turnChanged(game, play)];
}

/**
 * 5e TOUR AUTOMATIQUE (D-035) : chaque joueur actif n'a plus qu'UNE carte ; le système la
 * joue, dans l'ordre antihoraire à partir du contrôleur, sans action ni timer, sans aucun
 * choix (il n'y en a pas). Les joueurs ayant fui sont ignorés. Puis le contrôle est
 * déterminé normalement et le contrôleur final gagne.
 */
function playLastTrickAutomatically(
  game: Game,
  play: TerPlay,
  ctx: EngineContext,
): GameEventDraft[] {
  clearTurn(game);
  const events: GameEventDraft[] = [
    {
      type: 'game:last_trick_automatic',
      payload: { trickNumber: play.trickNumber, order: [...play.trickOrder] },
    },
  ];
  for (const playerId of play.trickOrder) {
    const hand = handOf(play, playerId);
    if (hand.length !== 1) {
      throw new Error(
        `Invariant violé : ${hand.length} carte(s) au 5e tour pour ${playerId} (${game.id})`,
      );
    }
    play.nextPlayerId = playerId;
    events.push(...placeCard(play, playerId, cardFromId(hand[0] as CardId), ctx.rules, true));
  }
  return [...events, ...completeTrick(game, play, ctx)];
}

function finish(
  game: Game,
  play: TerPlay,
  winnerId: PlayerId,
  method: GameEndMethod,
  now: Date,
  extra: Partial<
    Pick<
      GameResult,
      'instantWinRank' | 'instantWinCombination' | 'automatic' | 'victoryType' | 'revealedHands'
    >
  > = {},
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
  game.endReason = method;
  clearTurn(game);
  play.nextPlayerId = undefined;
  return [{ type: 'game:finished', payload: { result: structuredClone(result) } }];
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/**
 * Nouveau tour du joueur attendu (D-034) : il a `durationMs` pour jouer, échéance fixée
 * par le serveur et persistée avec l'état. Le timer en mémoire n'en est qu'une copie.
 */
function beginTurn(game: Game, now: Date, durationMs: number = TURN_DURATION_MS): void {
  game.turnStartedAt = now;
  game.turnDeadlineAt = new Date(now.getTime() + durationMs);
  game.turnTimedOutAt = undefined;
}

export function clearTurn(game: Game): void {
  game.turnStartedAt = undefined;
  game.turnDeadlineAt = undefined;
  game.turnTimedOutAt = undefined;
}

function turnChanged(game: Game, play: TerPlay): GameEventDraft {
  return {
    type: 'game:turn_changed',
    payload: {
      trickNumber: play.trickNumber,
      nextPlayerId: play.nextPlayerId,
      trickOrder: [...play.trickOrder],
      turnStartedAt: game.turnStartedAt?.toISOString(),
      turnDeadlineAt: game.turnDeadlineAt?.toISOString(),
    },
  };
}

function hasFled(game: Game, playerId: PlayerId): boolean {
  return game.players.some((p) => p.playerId === playerId && p.fledAt);
}

function requireInProgress(game: Game): TerPlay {
  if (game.status !== 'in_progress' || !game.play) {
    throw new GameNotInProgressError(game.id);
  }
  return game.play;
}

function requireActivePlayer(game: Game, playerId: PlayerId): void {
  assertPlayerInGame(game, playerId);
  if (hasFled(game, playerId)) {
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
