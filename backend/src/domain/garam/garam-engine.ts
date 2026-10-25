/**
 * Moteur de GARAM TIA (D-119) : fonctions déterministes appliquant une commande à UNE manche.
 *
 * Mêmes garanties que le moteur du Ter (ter-engine.ts) : aucune dépendance technique, hasard
 * et heure injectés, modification d'une COPIE DE TRAVAIL fournie par GameService, événements
 * renvoyés. Une erreur laisse l'état stocké inchangé.
 *
 * Déroulement d'une manche (cahier des charges §3, machine d'état §11.11) :
 * DISTRIBUTION (3 cartes par joueur, terre) → mains spéciales (une seule : à déclarer ;
 * plusieurs : arbitrage par priorité, D-130) → PREMIER_TOUR (dégagement puis une carte par
 * joueur, même signe obligatoire) → contrôle → TIRAGE (une passe, depuis le contrôleur ; deux
 * As déclarables au tour du joueur) → RÉSULTAT (plus grand total ≤ 21) ou manche nulle.
 */
import { shuffleDeck } from '../cards/deck';
import type { RandomSource } from '../cards/random-source';
import {
  DEAL_BATCH_LANDING_MS,
  DEAL_DELIVERY_MARGIN_MS,
  DEAL_FIRST_BATCH_DELAY_MS,
} from '../game/deal-timing';
import { rotateFrom } from '../sessions/table-order';
import type { Game, GameEndMethod, GameResult } from '../game/game';
import { assertPlayerInGame } from '../game/game-access';
import {
  CardNotInHandError,
  CardNotPlayableError,
  DealInProgressError,
  NotAWinningHandError,
  WinDeclarationNotAllowedError,
  GameNotInProgressError,
  GaramActionNotAllowedError,
  InvalidGaramVariantError,
  NotYourTurnError,
} from '../game/game-errors';
import type { GameEventDraft } from '../game/game-events';
import type { PlayerId } from '../game/game-id';
import {
  assertCanStart,
  beginTurn,
  clearTurn,
  isDealing,
  tableOrder,
} from '../game/game-lifecycle';
import {
  createGaramDeck,
  GARAM_ACE_VALUE,
  GARAM_SUITS,
  garamCard,
  garamTotal,
  parseGaramCardId,
  type GaramCardId,
} from './garam-cards';
import {
  GARAM_HAND_SIZE,
  GARAM_SCORE_LIMIT,
  GARAM_SEVEN,
  GARAM_SPECIAL_PRIORITY,
  GARAM_SUM_TEN,
  GARAM_SUM_TWENTY_ONE,
  GARAM_TURN_DURATION_MS,
  GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS,
  GARAM_AUTO_DRAW_FIRST_MS,
  GARAM_AUTO_DRAW_STEP_MS,
  GARAM_AUTO_DECLARE_MS,
  GARAM_DEAL_PASS_PAUSE_MS,
  GARAM_DEAL_PASSES,
  GARAM_DEAL_PLAYER_STEP_MS,
  GARAM_DEAL_TERRE_PAUSE_MS,
  GARAM_DEAL_TERRE_STEP_MS,
  GARAM_PASS_NOTICE_MS,
  isBelowGaramThreshold,
  isGaramVariant,
  terreSizeFor,
  type GaramPlay,
  type GaramSpecialCondition,
  type GaramTie,
  type GaramVariant,
} from './garam-rules';

export interface GaramContext {
  now: Date;
  /** Durée d'un tour : GARAM_TURN_DURATION_MS (20 s affichées + 3 s de marge, D-143, D-153). */
  turnDurationMs?: number;
  /** Tirage automatique (D-136) : délai avant la 1re carte d'un joueur, puis entre deux cartes. */
  autoDrawFirstMs?: number;
  autoDrawStepMs?: number;
  /** Délai avant la 1re carte de la manche : le premier tour est d'abord vu et rangé. */
  autoDrawAfterFirstRoundMs?: number;
  /**
   * « Je passe » (D-145) : durée TOTALE d'un tour sans carte prenable. Par défaut l'attente
   * avant une 1re carte (`autoDrawAfterFirstRoundMs` pour le contrôleur, `autoDrawFirstMs`
   * ensuite) + `GARAM_PASS_NOTICE_MS`.
   */
  passTurnMs?: number;
  /** Main spéciale unique (D-137) : délai avant sa déclaration automatique par le serveur. */
  autoDeclareMs?: number;
}

/**
 * Phase de distribution d'une manche (D-102, D-123) : 2 cartes ensemble à chaque joueur, puis
 * la 3e, puis le terre carte par carte, selon le calendrier des téléphones, plus la pose de la dernière
 * carte et la marge de réception du Ter. Le premier tour (et son temps, celui du Ter) ne
 * commence qu'à la transition COMPLETE_DEAL, à la fin de cette phase : l'animation ne
 * consomme jamais le temps de décision. L'état officiel est fixé dès le démarrage, sans
 * attente côté serveur (une échéance persistée, aucun `sleep`).
 */
export function garamDealPhaseMs(playerCount: number, terreCards: number): number {
  if (playerCount <= 0) return 0;
  const passes = GARAM_DEAL_PASSES.length;
  const lastHandBatch =
    DEAL_FIRST_BATCH_DELAY_MS +
    passes * (playerCount - 1) * GARAM_DEAL_PLAYER_STEP_MS +
    (passes - 1) * GARAM_DEAL_PASS_PAUSE_MS;
  const lastCard =
    terreCards > 0
      ? lastHandBatch + GARAM_DEAL_TERRE_PAUSE_MS + (terreCards - 1) * GARAM_DEAL_TERRE_STEP_MS
      : lastHandBatch;
  return lastCard + DEAL_BATCH_LANDING_MS + DEAL_DELIVERY_MARGIN_MS;
}

export interface GaramStartContext extends GaramContext {
  random: RandomSource;
  /** Durée de la présentation de la distribution (D-102). 0 : premier tour immédiat. */
  dealDurationMs?: (batchCount: number) => number;
}

/** Lot de la distribution, publique (aucune carte) : `count` cartes remises ENSEMBLE. */
export interface GaramDealBatch {
  pass: number;
  playerId: PlayerId;
  count: number;
}

/**
 * Présentation de la distribution (D-123), dans l'ordre de la table depuis le dégageur
 * (`tableOrder`, sens antihoraire) : passage 1, un lot de 2 cartes par joueur ; passage 2,
 * la 3e carte de chacun. Total : GARAM_HAND_SIZE cartes par joueur. Publique : aucune carte.
 */
export function garamDealSequence(order: readonly PlayerId[]): GaramDealBatch[] {
  return GARAM_DEAL_PASSES.flatMap((count, i) =>
    order.map((playerId) => ({ pass: i + 1, playerId, count })),
  );
}

// ---------------------------------------------------------------------------
// Distribution et conditions spéciales (§3.4, §3.12)
// ---------------------------------------------------------------------------

/**
 * Démarrage d'une manche, en UNE transition : paquet de 35 cartes mélangé (hasard
 * cryptographique injecté), 3 cartes par joueur dans l'ordre de la table depuis le dégageur,
 * puis le terre (3, 4 ou 5 cartes) ; les cartes restantes ne servent pas. Les conditions
 * spéciales sont évaluées aussitôt, dans l'ordre de priorité du §3.12.
 */
export function startGaramGame(game: Game, ctx: GaramStartContext): GameEventDraft[] {
  assertCanStart(game);
  // Variante explicite obligatoire (D-127) : jamais de seuil implicite.
  garamVariantOf(game);
  const order = tableOrder(game);
  const dealerId = order[0] as PlayerId;
  const deck = shuffleDeck(createGaramDeck(), ctx.random);
  const hands: Record<string, GaramCardId[]> = {};
  let next = 0;
  for (const playerId of order) {
    hands[playerId] = deck.slice(next, next + GARAM_HAND_SIZE);
    next += GARAM_HAND_SIZE;
  }
  const terreSize = terreSizeFor(order.length);
  const terre = deck.slice(next, next + terreSize);
  const stock = deck.slice(next + terreSize);

  const play: GaramPlay = {
    phase: 'FIRST_ROUND',
    dealerId,
    order,
    hands,
    initialHands: structuredClone(hands),
    terre,
    stock,
    firstCards: [],
    drawOrder: [],
    drawn: Object.fromEntries(order.map((id) => [id, []])),
    drawDone: [],
    nextPlayerId: dealerId,
  };
  game.garam = play;
  game.status = 'in_progress';
  game.startedAt = ctx.now;
  game.startDeadlineAt = undefined;
  game.garamStakeVote = undefined;

  const sequence = garamDealSequence(order);
  const events: GameEventDraft[] = [
    {
      type: 'game:started',
      // Public : ordre, dégageur, terre (public), lots (aucune carte en main).
      payload: {
        gameType: 'GARAM',
        garamVariant: game.garamVariant,
        order,
        firstPlayerId: dealerId,
        dealerId,
        nextPlayerId: dealerId,
        terre: [...terre],
        dealSequence: sequence,
      },
    },
    ...order.map((playerId) => ({
      type: 'game:hand_dealt' as const,
      recipientId: playerId,
      payload: { playerId, cards: [...(hands[playerId] ?? [])] },
    })),
  ];

  const special = specialOutcome(play);
  if (special?.kind === 'win' && special.automatic) {
    // Plusieurs mains spéciales : arbitrage automatique par priorité (D-130).
    return [
      ...events,
      ...finishWin(game, play, special.playerId, 'GARAM_AUTOMATIC_WIN', ctx.now, {
        garamCondition: special.condition,
        garamHands: structuredClone(play.initialHands),
        automatic: true,
      }),
    ];
  }
  if (special?.kind === 'win') {
    // Une seule main spéciale (D-137) : le serveur la déclare lui-même, peu après la fin de la
    // distribution (`openFirstRound`), avant toute carte du premier tour.
    play.special = { playerId: special.playerId, condition: special.condition };
  }
  if (special?.kind === 'tie') {
    return [
      ...events,
      ...tieRound(
        game,
        play,
        {
          kind: 'SPECIAL',
          condition: special.condition,
          playerIds: special.playerIds,
          hands: structuredClone(play.initialHands),
        },
        ctx.now,
      ),
    ];
  }

  // D-102 : la distribution est présentée sur les tables avant tout temps de décision.
  const dealMs = ctx.dealDurationMs
    ? ctx.dealDurationMs(sequence.length + terre.length)
    : garamDealPhaseMs(order.length, terre.length);
  const started = events[0] as GameEventDraft;
  if (dealMs > 0) {
    clearTurn(game);
    game.dealEndsAt = new Date(ctx.now.getTime() + dealMs);
    started.payload = { ...started.payload, dealEndsAt: game.dealEndsAt.toISOString() };
    return events;
  }
  openFirstRound(game, play, ctx);
  started.payload = {
    ...started.payload,
    turnStartedAt: game.turnStartedAt?.toISOString(),
    turnDeadlineAt: game.turnDeadlineAt?.toISOString(),
    ...(play.special && { specialPending: true }),
  };
  return events;
}

/**
 * Ouverture du premier tour, à la fin de la distribution. Main spéciale unique en attente
 * (D-137) : l'échéance du tour est le court délai de sa déclaration automatique
 * (`GARAM_AUTO_DECLARE_MS`) ; aucune carte ne peut être jouée avant (`garamPlayableCards`), et
 * l'échéance déclenche la déclaration (`playGaramAutomatically`). Sinon : tour normal.
 */
function openFirstRound(game: Game, play: GaramPlay, ctx: GaramContext): void {
  beginTurn(
    game,
    ctx.now,
    play.special
      ? (ctx.autoDeclareMs ?? GARAM_AUTO_DECLARE_MS)
      : (ctx.turnDurationMs ?? GARAM_TURN_DURATION_MS),
  );
}

type SpecialOutcome =
  | { kind: 'win'; playerId: PlayerId; condition: GaramSpecialCondition; automatic: boolean }
  | { kind: 'tie'; playerIds: PlayerId[]; condition: GaramSpecialCondition };

/**
 * Main spéciale des 3 cartes reçues (D-130), la meilleure si plusieurs s'appliquent. Deux As
 * n'en sont PAS une (propriétaire, D-130) : ils ne comptent qu'à la fin normale (`finishRound`).
 */
export function dealtSpecialOf(cards: readonly GaramCardId[]): GaramSpecialCondition | undefined {
  if (cards.length !== GARAM_HAND_SIZE) return undefined;
  const parsed = cards.map((c) => garamCard(c));
  const values = parsed.map((c) => c.value);
  const total = garamTotal(cards);
  if (values.every((v) => v === GARAM_SEVEN)) return 'THREE_SEVENS';
  if (values.every((v) => v === values[0])) return 'THREE_OF_A_KIND';
  if (total === GARAM_SUM_TEN) return 'SUM_TEN';
  if (parsed.every((c) => c.suit === parsed[0]?.suit)) return 'SAME_SUIT';
  if (total === GARAM_SUM_TWENTY_ONE) return 'SUM_TWENTY_ONE';
  return undefined;
}

/**
 * Deux As gardés (D-130) : après le premier tour, ses deux As font 22 et il ne peut rien
 * tirer ; à la fin normale, il bat tout autre total. Un seul joueur au plus (3 As au paquet).
 */
function keepsTwoAces(play: GaramPlay, playerId: PlayerId): boolean {
  return keptCards(play, playerId).filter((c) => garamCard(c).value === GARAM_ACE_VALUE).length >= 2;
}

/**
 * Mains spéciales après la distribution (D-130) :
 * - aucune : rien ;
 * - une seule : AUCUNE victoire automatique ; son détenteur la déclare (« Main spéciale »)
 *   avant de jouer sa première carte ;
 * - plusieurs : arbitrage AUTOMATIQUE par priorité absolue (1 > 2 > … > 5), sans attendre le
 *   tour des joueurs concernés ; meilleure priorité détenue par plusieurs joueurs : manche
 *   nulle, sans AUCUN départage (ni siège, ni ordre, ni valeur, ni famille, ni rapidité).
 */
export function specialOutcome(play: GaramPlay): SpecialOutcome | null {
  const holders = play.order.flatMap((playerId) => {
    const condition = dealtSpecialOf(play.hands[playerId] ?? []);
    return condition ? [{ playerId, condition }] : [];
  });
  const first = holders[0];
  if (!first) return null;
  if (holders.length === 1) return { kind: 'win', ...first, automatic: false };
  const best = Math.min(...holders.map((h) => GARAM_SPECIAL_PRIORITY[h.condition]));
  const top = holders.filter((h) => GARAM_SPECIAL_PRIORITY[h.condition] === best);
  const winner = top[0] as (typeof holders)[number];
  if (top.length > 1) {
    return { kind: 'tie', playerIds: top.map((h) => h.playerId), condition: winner.condition };
  }
  return { kind: 'win', ...winner, automatic: true };
}

/** COMPLETE_DEAL (D-102) pour une manche GARAM : ouvre le tour du dégageur. */
export function completeGaramDeal(game: Game, ctx: GaramContext): GameEventDraft[] | null {
  if (!isDealing(game)) {
    return null;
  }
  const play = requireGaram(game);
  const incomplete = play.order.some(
    (id) => (play.hands[id]?.length ?? 0) !== GARAM_HAND_SIZE,
  );
  if (incomplete || play.firstCards.length > 0) {
    throw new Error(`Distribution GARAM incomplète pour la partie ${game.id}`);
  }
  game.dealEndsAt = undefined;
  openFirstRound(game, play, ctx);
  return [
    {
      type: 'game:deal_completed',
      payload: {
        nextPlayerId: play.nextPlayerId,
        turnStartedAt: game.turnStartedAt?.toISOString(),
        turnDeadlineAt: game.turnDeadlineAt?.toISOString(),
        ...(play.special && { specialPending: true }),
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Premier tour : dégagement et obligation de signe (§3.5-3.7)
// ---------------------------------------------------------------------------

/**
 * Cartes jouables par `playerId` maintenant : toutes pour le dégageur ; sinon celles du signe
 * dégagé s'il en possède, toutes sinon (§3.6).
 */
export function garamPlayableCards(game: Game, playerId: PlayerId): GaramCardId[] {
  const play = game.garam;
  if (
    game.status !== 'in_progress' ||
    !play ||
    isDealing(game) ||
    play.phase !== 'FIRST_ROUND' ||
    play.nextPlayerId !== playerId ||
    // Main spéciale unique en attente de sa déclaration automatique (D-137).
    play.special
  ) {
    return [];
  }
  const hand = play.hands[playerId] ?? [];
  if (!play.leadSuit) return [...hand];
  const follow = hand.filter((c) => garamCard(c).suit === play.leadSuit);
  return follow.length > 0 ? follow : [...hand];
}

export function playGaramCard(
  game: Game,
  playerId: PlayerId,
  rawCardId: unknown,
  ctx: GaramContext,
  automatic = false,
): GameEventDraft[] {
  const play = requireGaram(game);
  requireDealt(game);
  assertPlayerInGame(game, playerId);
  if (play.phase !== 'FIRST_ROUND') {
    throw new GaramActionNotAllowedError(game.id, 'le premier tour est terminé');
  }
  if (play.nextPlayerId !== playerId) {
    throw new NotYourTurnError(game.id, playerId);
  }
  if (play.special) {
    throw new GaramActionNotAllowedError(game.id, 'main spéciale en cours de déclaration');
  }
  const card = parseGaramCardId(rawCardId);
  const hand = play.hands[playerId] ?? [];
  if (!hand.includes(card.id)) {
    throw new CardNotInHandError(game.id, card.id);
  }
  if (!garamPlayableCards(game, playerId).includes(card.id)) {
    throw new CardNotPlayableError(game.id, card.id);
  }
  hand.splice(hand.indexOf(card.id), 1);
  play.firstCards.push({ playerId, cardId: card.id });
  if (!play.leadSuit) play.leadSuit = card.suit;

  const events: GameEventDraft[] = [
    {
      type: 'game:card_played',
      payload: {
        playerId,
        cardId: card.id,
        phase: 'FIRST_ROUND',
        leadSuit: play.leadSuit,
        ...(automatic && { automatic: true }),
      },
    },
  ];
  const next = play.order.find((id) => !play.firstCards.some((p) => p.playerId === id));
  if (next) {
    play.nextPlayerId = next;
    beginTurn(game, ctx.now, ctx.turnDurationMs ?? GARAM_TURN_DURATION_MS);
    return [...events, turnChanged(game, play)];
  }
  return [...events, ...endFirstRound(game, play, ctx)];
}

/**
 * Fin du premier tour : la plus grande carte du signe dégagé prend le contrôle (§3.7) ; le
 * tirage commence par le contrôleur, puis sens antihoraire (D-119). Le droit de déclarer une
 * main de départ prend fin (tous ont joué leur première carte).
 */
function endFirstRound(game: Game, play: GaramPlay, ctx: GaramContext): GameEventDraft[] {
  let best: { playerId: PlayerId; cardId: GaramCardId; value: number } | undefined;
  for (const p of play.firstCards) {
    const card = garamCard(p.cardId);
    if (card.suit === play.leadSuit && (!best || card.value > best.value)) {
      best = { playerId: p.playerId, cardId: p.cardId, value: card.value };
    }
  }
  if (!best) {
    throw new Error(`Aucune carte du signe dégagé dans la partie ${game.id}`);
  }
  play.controllerId = best.playerId;
  const events: GameEventDraft[] = [
    { type: 'game:control_changed', payload: { controllerId: best.playerId, cardId: best.cardId } },
  ];
  play.special = undefined;
  play.phase = 'DRAW';
  play.drawOrder = rotateFrom(play.order, best.playerId);
  // Le premier tour doit être vu puis rangé sur les écrans avant la 1re carte tirée.
  const firstMs = ctx.autoDrawAfterFirstRoundMs ?? GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS;
  return [
    ...events,
    ...openDrawTurn(game, play, play.drawOrder[0] as PlayerId, ctx, firstMs),
  ];
}

// ---------------------------------------------------------------------------
// Tirage (§3.8-3.10)
// ---------------------------------------------------------------------------

/** Cartes conservées d'un joueur : sa main (sans la première carte jouée) et ses tirages. */
function keptCards(play: GaramPlay, playerId: PlayerId): GaramCardId[] {
  return [...(play.hands[playerId] ?? []), ...(play.drawn[playerId] ?? [])];
}

export function garamKeptTotal(play: GaramPlay, playerId: PlayerId): number {
  return garamTotal(keptCards(play, playerId));
}

/**
 * Le joueur peut-il prendre la tête du terre ? Sinon, la raison : terre vide (`cardId`
 * absent, §3.10) ou carte qui ferait dépasser 21 (« Impossible », §3.8).
 */
function drawRefusal(play: GaramPlay, playerId: PlayerId): { cardId?: GaramCardId } | null {
  const head = play.terre[0];
  if (!head) return {};
  if (garamKeptTotal(play, playerId) + garamCard(head).value > GARAM_SCORE_LIMIT) {
    return { cardId: head };
  }
  return null;
}

/** Peut-il tirer maintenant ? (pour la vue) */
export function canDrawGaram(game: Game, playerId: PlayerId): boolean {
  const play = game.garam;
  return Boolean(
    game.status === 'in_progress' &&
    play &&
    !isDealing(game) &&
    play.phase === 'DRAW' &&
    play.nextPlayerId === playerId &&
    !game.turnTimedOutAt &&
    !drawRefusal(play, playerId),
  );
}

/**
 * Tour de tirage de `playerId`. S'il ne peut prendre aucune carte (terre vide ou carte qui
 * ferait dépasser 21, dont le joueur aux deux As à 22, D-130), il n'a aucun choix à faire :
 * quand la main lui arrive, il annonce « Je passe » à la table (`passing`, D-145), puis son
 * tirage est clos à l'échéance (`passGaramTurn`). Sinon son échéance est le délai du tirage
 * automatique (D-136) : le serveur tirera pour lui.
 */
function openDrawTurn(
  game: Game,
  play: GaramPlay,
  playerId: PlayerId,
  ctx: GaramContext,
  firstMs = ctx.autoDrawFirstMs ?? GARAM_AUTO_DRAW_FIRST_MS,
): GameEventDraft[] {
  play.nextPlayerId = playerId;
  const refusal = drawRefusal(play, playerId);
  if (!refusal) {
    beginTurn(game, ctx.now, firstMs);
    return [turnChanged(game, play)];
  }
  play.passing = { playerId, ...(refusal.cardId && { cardId: refusal.cardId }) };
  // Même attente qu'avant une 1re carte (le tour précédent se pose), puis l'annonce.
  beginTurn(game, ctx.now, ctx.passTurnMs ?? firstMs + GARAM_PASS_NOTICE_MS);
  return [{ type: 'game:player_passed', payload: { ...play.passing } }, turnChanged(game, play)];
}

function nextDrawer(play: GaramPlay): PlayerId | undefined {
  return play.drawOrder.find((id) => !play.drawDone.includes(id));
}

function endDraw(
  play: GaramPlay,
  playerId: PlayerId,
  cardId?: GaramCardId,
  passed = false,
): GameEventDraft {
  play.drawDone.push(playerId);
  play.lastRefusal = { playerId, ...(cardId && { cardId }), ...(passed && { passed: true }) };
  return {
    type: 'game:draw_impossible',
    payload: {
      playerId,
      ...(cardId && { cardId }),
      ...(passed && { passed: true }),
      drawnCount: play.drawn[playerId]?.length ?? 0,
    },
  };
}

/**
 * Fin d'un « Je passe » (D-145), à l'échéance du tour : le tirage du joueur est clos (aucune
 * carte prise) et la main passe au joueur suivant, ou la manche se termine.
 */
function passGaramTurn(game: Game, play: GaramPlay, ctx: GaramContext): GameEventDraft[] {
  const passing = play.passing as NonNullable<GaramPlay['passing']>;
  play.passing = undefined;
  const events = [endDraw(play, passing.playerId, passing.cardId, true)];
  const next = nextDrawer(play);
  return [...events, ...(next ? openDrawTurn(game, play, next, ctx) : finishRound(game, play, ctx.now))];
}

/**
 * Tirer UNE carte à la tête du terre (§3.8). Le joueur doit continuer tant que la carte
 * suivante ne fait pas dépasser 21 : son tour reste ouvert (prochaine carte tirée
 * automatiquement après `GARAM_AUTO_DRAW_STEP_MS`, D-136) ; sinon « Impossible » : la carte
 * reste au terre, ses cartes prises sont conservées, tour suivant. Seule opération de tirage :
 * le tirage automatique (`playGaramAutomatically`) passe par elle.
 */
export function drawGaramCard(
  game: Game,
  playerId: PlayerId,
  ctx: GaramContext,
  automatic = false,
): GameEventDraft[] {
  const play = requireGaram(game);
  requireDealt(game);
  assertPlayerInGame(game, playerId);
  if (play.phase !== 'DRAW') {
    throw new GaramActionNotAllowedError(game.id, 'le tirage n’a pas commencé');
  }
  if (play.nextPlayerId !== playerId) {
    throw new NotYourTurnError(game.id, playerId);
  }
  if (drawRefusal(play, playerId)) {
    // Un tour sans carte prenable est clos à son ouverture, ou annonce « Je passe » (D-145).
    throw new GaramActionNotAllowedError(game.id, 'aucune carte ne peut être tirée');
  }
  const head = play.terre.shift() as GaramCardId;
  play.drawn[playerId] = [...(play.drawn[playerId] ?? []), head];
  const events: GameEventDraft[] = [
    {
      type: 'game:card_drawn',
      payload: {
        playerId,
        cardId: head,
        terreCount: play.terre.length,
        ...(automatic && { automatic: true }),
      },
    },
  ];
  const refusal = drawRefusal(play, playerId);
  if (!refusal) {
    beginTurn(game, ctx.now, ctx.autoDrawStepMs ?? GARAM_AUTO_DRAW_STEP_MS);
    return [...events, turnChanged(game, play)];
  }
  events.push(endDraw(play, playerId, refusal.cardId));
  const next = nextDrawer(play);
  return [
    ...events,
    ...(next ? openDrawTurn(game, play, next, ctx) : finishRound(game, play, ctx.now)),
  ];
}

/**
 * Carte jouée automatiquement par le Katika au premier tour (D-127), DÉTERMINISTE : la plus
 * petite valeur parmi les cartes LÉGALES (`garamPlayableCards` : même signe obligatoire si le
 * joueur en a), ce qui garde ses plus fortes cartes pour le total ; à valeur égale, l'ordre
 * technique des familles `GARAM_SUITS` (cœur, trèfle, carreau, pique), sans valeur de règle.
 */
export function garamAutomaticCard(game: Game, playerId: PlayerId): GaramCardId | undefined {
  const rank = (id: GaramCardId) => {
    const card = garamCard(id);
    return card.value * GARAM_SUITS.length + GARAM_SUITS.indexOf(card.suit);
  };
  return [...garamPlayableCards(game, playerId)].sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * Action automatique du Katika après l'échéance du tour (§3.11, §7.11, D-127), par les MÊMES
 * fonctions du moteur que l'action d'un joueur (mêmes validations : tour, phase, carte, signe,
 * limite de 21) :
 * - premier tour : la carte légale de `garamAutomaticCard` ;
 * - tirage : UNE carte à la tête du terre (jamais plusieurs en une opération), seulement si
 *   elle ne fait pas dépasser 21 (sinon le tour est déjà clos par le moteur). C'est le tirage
 *   automatique de D-136 : l'échéance d'un tour de tirage est son court délai.
 * Main spéciale unique en attente (D-137) : l'échéance est celle de sa déclaration
 * automatique ; le serveur la déclare (`declareGaramWin`), aucune carte n'est jouée.
 * « Je passe » (D-145) : l'échéance clôt le tirage du joueur (`passGaramTurn`).
 */
export function playGaramAutomatically(
  game: Game,
  playerId: PlayerId,
  ctx: GaramContext,
): GameEventDraft[] {
  const play = requireGaram(game);
  if (play.passing) {
    if (play.passing.playerId !== playerId) {
      throw new NotYourTurnError(game.id, playerId);
    }
    return passGaramTurn(game, play, ctx);
  }
  if (play.special) {
    // Échéance de la main spéciale unique (D-137) : le serveur la déclare pour son détenteur,
    // par la MÊME opération que l'ancienne déclaration manuelle (mêmes vérifications).
    return declareGaramWin(game, play.special.playerId, ctx, true);
  }
  if (play.phase === 'FIRST_ROUND') {
    const cardId = garamAutomaticCard(game, playerId);
    if (!cardId) {
      throw new Error(`Aucune carte jouable pour ${playerId} (${game.id})`);
    }
    return playGaramCard(game, playerId, cardId, ctx, true);
  }
  return drawGaramCard(game, playerId, ctx, true);
}

// ---------------------------------------------------------------------------
// Fin de manche (§3.14, §3.15)
// ---------------------------------------------------------------------------

/**
 * Trois 7 parmi les cartes révélées (gardées) du joueur. Le paquet n'a que quatre 7 : un seul
 * joueur peut les avoir.
 */
function keepsThreeSevens(play: GaramPlay, playerId: PlayerId): boolean {
  return keptCards(play, playerId).filter((c) => garamCard(c).value === GARAM_SEVEN).length >= 3;
}

/**
 * Fin normale : révélation, totaux, gagnant = le joueur aux deux As gardés s'il existe (il bat
 * tout autre total, D-130 ; seul total possible au-dessus de 21 : 22), sinon le plus grand
 * total (≤ 21). Égalité à 21 : le joueur qui révèle trois 7 gagne (D-165). Toute autre égalité
 * au plus grand total → manche nulle. Koraté (D-127, D-130) : chaque PERDANT dont le total est
 * STRICTEMENT inférieur à la variante X (15, 16, 17 ou 18) est noté pour le règlement ; il ne
 * change jamais le gagnant.
 */
function finishRound(game: Game, play: GaramPlay, now: Date): GameEventDraft[] {
  const scores = Object.fromEntries(play.order.map((id) => [id, garamKeptTotal(play, id)]));
  const twoAces = play.order.filter((id) => keepsTwoAces(play, id));
  const valid = play.order.filter((id) => (scores[id] as number) <= GARAM_SCORE_LIMIT);
  const best = Math.max(...valid.map((id) => scores[id] as number));
  let leaders = twoAces.length > 0 ? twoAces : valid.filter((id) => scores[id] === best);
  if (twoAces.length === 0 && best === GARAM_SCORE_LIMIT && leaders.length > 1) {
    const sevens = leaders.filter((id) => keepsThreeSevens(play, id));
    if (sevens.length === 1) leaders = sevens;
  }
  const hands = structuredClone(play.hands);
  if (leaders.length !== 1) {
    return tieRound(game, play, { kind: 'SCORE', playerIds: leaders, scores, hands }, now);
  }
  const winnerId = leaders[0] as PlayerId;
  const variant = garamVariantOf(game);
  const belowThresholdIds = play.order.filter(
    (id) => id !== winnerId && isBelowGaramThreshold(scores[id] as number, variant),
  );
  return finishWin(game, play, winnerId, 'GARAM_BEST_SCORE', now, {
    scores,
    belowThresholdIds,
    penaltyThreshold: variant,
    garamHands: hands,
  });
}

function finishWin(
  game: Game,
  play: GaramPlay,
  winnerId: PlayerId,
  method: GameEndMethod,
  now: Date,
  extra: Partial<
    Pick<
      GameResult,
      | 'garamCondition'
      | 'scores'
      | 'belowThresholdIds'
      | 'penaltyThreshold'
      | 'garamHands'
      | 'automatic'
    >
  >,
): GameEventDraft[] {
  const result: GameResult = {
    winnerId,
    method,
    victoryType: 'SIMPLE',
    ...extra,
    remainingOpponentIds: play.order.filter((id) => id !== winnerId),
    fledPlayerIds: [],
  };
  game.status = 'finished';
  game.finishedAt = now;
  game.result = result;
  game.endReason = method;
  clearTurn(game);
  play.nextPlayerId = undefined;
  return [{ type: 'game:finished', payload: { result: structuredClone(result) } }];
}

/** Manche nulle : aucun gagnant ; la session la rejoue aussitôt, même dégageur (D-119). */
function tieRound(game: Game, play: GaramPlay, tie: GaramTie, now: Date): GameEventDraft[] {
  game.status = 'finished';
  game.finishedAt = now;
  game.endReason = 'GARAM_TIE';
  game.garamTie = tie;
  clearTurn(game);
  play.nextPlayerId = undefined;
  return [{ type: 'game:garam_tie', payload: structuredClone({ ...tie }) }];
}

// ---------------------------------------------------------------------------
// Main spéciale à déclarer (D-129, D-130)
// ---------------------------------------------------------------------------

/**
 * Le joueur peut-il déclarer sa main spéciale maintenant ? Au premier tour, tant qu'il n'a
 * pas joué sa carte (même hors de son tour). Depuis D-137, c'est le serveur qui la déclare à
 * l'échéance (`playGaramAutomatically`) ; la commande du détenteur reste acceptée (même
 * résultat, une seule fois : la manche est alors terminée).
 */
export function canDeclareGaramWin(game: Game, playerId: PlayerId): boolean {
  const play = game.garam;
  if (game.status !== 'in_progress' || !play || isDealing(game)) return false;
  const special = play.special;
  if (!special || special.playerId !== playerId) return false;
  return play.phase === 'FIRST_ROUND' && !play.firstCards.some((p) => p.playerId === playerId);
}

/**
 * « Main spéciale » : le détenteur déclare sa victoire (D-129, D-130). Le serveur revérifie
 * tout sur son propre état (main réellement détenue, première carte jouée, phase) ;
 * rien ne vient du client. Refusée sans main spéciale (NotAWinningHandError) ou hors de sa
 * fenêtre (WinDeclarationNotAllowedError).
 */
export function declareGaramWin(
  game: Game,
  playerId: PlayerId,
  ctx: GaramContext,
  automatic = false,
): GameEventDraft[] {
  const play = requireGaram(game);
  requireDealt(game);
  assertPlayerInGame(game, playerId);
  const special = play.special;
  if (!special || special.playerId !== playerId) {
    throw new NotAWinningHandError(game.id);
  }
  // La main reçue doit toujours être celle-là (aucune donnée du client).
  if (dealtSpecialOf(play.initialHands[playerId] ?? []) !== special.condition) {
    throw new NotAWinningHandError(game.id);
  }
  if (!canDeclareGaramWin(game, playerId)) {
    throw new WinDeclarationNotAllowedError(game.id);
  }
  play.special = undefined;
  return finishWin(game, play, playerId, 'GARAM_AUTOMATIC_WIN', ctx.now, {
    garamCondition: special.condition,
    garamHands: structuredClone(play.initialHands),
    automatic,
  });
}

// ---------------------------------------------------------------------------
// Proposition de doubler la mise (§3.15)
// ---------------------------------------------------------------------------

/**
 * Réponse d'un joueur de la manche en attente. La première réponse est définitive : une
 * seconde ne change rien (null). Refusée après l'échéance.
 */
export function voteGaramStake(
  game: Game,
  playerId: PlayerId,
  accept: boolean,
  now: Date,
): GameEventDraft[] | null {
  const vote = game.garamStakeVote;
  if (game.status !== 'waiting' || !vote) {
    throw new GaramActionNotAllowedError(game.id, 'aucune proposition de mise en cours');
  }
  assertPlayerInGame(game, playerId);
  if (now.getTime() >= vote.deadlineAt.getTime()) {
    throw new GaramActionNotAllowedError(game.id, 'le temps de réponse est écoulé');
  }
  if (vote.votes[playerId] !== undefined) {
    return null;
  }
  vote.votes[playerId] = accept;
  return [{ type: 'game:stake_vote', payload: { playerId } }];
}

/** Tous les joueurs de la manche ont-ils répondu ? */
export function stakeVoteComplete(game: Game): boolean {
  const vote = game.garamStakeVote;
  return Boolean(vote && game.players.every((p) => vote.votes[p.playerId] !== undefined));
}

/** Doublée seulement si TOUS les joueurs de la manche ont répondu oui (§3.15). */
export function stakeVoteAccepted(game: Game): boolean {
  const vote = game.garamStakeVote;
  return Boolean(vote && game.players.every((p) => vote.votes[p.playerId] === true));
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function turnChanged(game: Game, play: GaramPlay): GameEventDraft {
  return {
    type: 'game:turn_changed',
    payload: {
      phase: play.phase,
      nextPlayerId: play.nextPlayerId,
      turnStartedAt: game.turnStartedAt?.toISOString(),
      turnDeadlineAt: game.turnDeadlineAt?.toISOString(),
    },
  };
}

/** Variante de la partie (D-127) : obligatoire, jamais déduite ni remplacée. */
export function garamVariantOf(game: Pick<Game, 'garamVariant'>): GaramVariant {
  if (!isGaramVariant(game.garamVariant)) {
    throw new InvalidGaramVariantError(game.garamVariant);
  }
  return game.garamVariant;
}

function requireGaram(game: Game): GaramPlay {
  if (game.status !== 'in_progress' || !game.garam) {
    throw new GameNotInProgressError(game.id);
  }
  return game.garam;
}

function requireDealt(game: Game): void {
  if (isDealing(game)) {
    throw new DealInProgressError(game.id);
  }
}
