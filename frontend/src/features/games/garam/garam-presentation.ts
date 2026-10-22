import { useCallback, useEffect, useRef, useState } from 'react';

import type { GameView, GaramView } from '../../../types/game';
import { CARD_RATIO, FAN_STEP, fanStepFor, fanWidth } from '../table/Cards';
import { publicCardLeft, publicRowBox, type PublicRowZone } from '../table/TableCards';
import {
  handStepFor,
  type GameTableLayout,
  type Rect,
  type SeatSide,
} from '../table/table-layout';

/**
 * Déroulement VISUEL d'une manche de GARAM TIA (D-128). Rien n'est décidé ici : l'état
 * officiel (cartes, contrôle, totaux, gagnant) vient toujours de la vue du serveur ; ce module
 * dit seulement OÙ et QUAND chaque carte est montrée, pour que chaque état d'une carte ait sa
 * propre zone et que la manche se lise étape par étape :
 *
 * distribution (inchangée, `garam-deal.ts`) → cartes du tour, au centre, devant leur joueur,
 * jusqu'à la dernière → contrôle annoncé → cartes du tour classées chez leur joueur → tirage :
 * chaque carte quitte la tête du terre l'une après l'autre et rejoint, face visible pour tous,
 * la zone de départ de son joueur, à côté de ses cartes cachées → quand tous ont tiré, la zone
 * de départ de chaque joueur est dévoilée, joueur après joueur, avec la somme de ses cartes
 * (total du serveur) → gagnant → panneau de fin.
 *
 * États d'une carte et zone UNIQUE de chacun :
 * - en distribution : vol (`DealFlight`) ;
 * - cachée en main : dos chez l'adversaire, ma main en bas ;
 * - jouée au tour en cours : centre de la table (zone « cartes du tour ») ;
 * - classée : petit cadre « 1er tour » du siège ;
 * - au terre : rang du terre, en haut de la table, tête à gauche ;
 * - tirée : zone de départ de son joueur, après ses cartes cachées, face visible pour tous ;
 * - révélée : les cartes cachées de la zone de départ se retournent, avec le total.
 */

// --- Tempo (mêmes valeurs que le serveur pour la présentation de fin, backend garam-rules.ts) ---

/** Révélation de la zone de départ d'un joueur (cartes et total), puis du suivant. */
export const GARAM_REVEAL_STEP_MS = 900;
/** Pause après la dernière révélation, avant l'annonce du gagnant. */
export const GARAM_SCORE_HOLD_MS = 900;
/** Gagnant mis en évidence avant le panneau de fin (Continuer / Sortir). */
export const GARAM_WINNER_HOLD_MS = 2_000;
/** Manche nulle : mains et totaux montrés ensemble, puis la nouvelle manche. */
export const GARAM_TIE_HOLD_MS = 2_500;
/**
 * Total des deux As gardés (11 + 11, D-130) : seul total gagnant au-dessus de 21. Une victoire
 * à ce total s'annonce « Gagne avec deux As » / « Victoire avec deux As », jamais
 * « 22 points ».
 */
export const GARAM_TWO_ACES_SCORE = 22;
/** Vol d'une carte tirée, de la tête du terre au cadre « terre » de son joueur. */
export const GARAM_DRAW_FLIGHT_MS = 520;
/** « Réduire les animations » : la carte rejoint son joueur par une transition courte. */
export const GARAM_DRAW_FLIGHT_REDUCED_MS = 160;
/**
 * Respiration entre deux cartes tirées (aucune ne part avant que la précédente soit posée).
 * Respiration + vol = 800 ms : le cycle du tirage automatique du serveur (D-136,
 * `GARAM_AUTO_DRAW_STEP_MS`), pour que les vols ne prennent pas de retard sur les tirages.
 */
export const GARAM_DRAW_BREATH_MS = 280;
/**
 * Pause entre le rangement du premier tour (cartes classées chez leur joueur) et le départ de
 * la 1re carte du terre, pour que l'œil suive une étape après l'autre. Le serveur attend de
 * son côté le tour visible, son rangement et cette pause (`GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS`,
 * backend garam-rules.ts).
 */
export const GARAM_DRAW_START_PAUSE_MS = 1_000;
/** Annonce « X prend le contrôle », une fois les cartes du tour classées. */
export const GARAM_CONTROL_NOTICE_MS = 1_800;

// --- Géométrie du centre de la table (en diamètres de table, depuis le centre dessiné) ---

/** Rang du terre : en haut de la table, au-dessus des cartes du tour. */
export const GARAM_TERRE_Y = -0.29;
/**
 * Pas du rang du terre (part d'une largeur de carte) : de gauche à droite, la tête (1re carte
 * posée) au-dessus de la suivante, qui n'en cache que 6 % (le bord gauche) : la valeur et la
 * famille de CHAQUE carte, dans son coin (à 7 % du bord), restent visibles.
 */
export const GARAM_TERRE_STEP = 0.94;
/** Largeur maximale d'une carte du terre (le rang de 5 cartes tient dans le haut de la table). */
export const GARAM_TERRE_MAX_CARD = 0.11;
/** Centre de la zone « cartes du tour », sous le terre. */
export const GARAM_TRICK_Y = 0.07;
/**
 * Place de la carte jouée par chaque siège, depuis le centre de la zone du tour : devant son
 * joueur, sans jamais toucher le terre ni la carte d'un autre.
 */
export const GARAM_SPOT_OFFSET: Record<SeatSide, { x: number; y: number }> = {
  bottom: { x: 0, y: 0.125 },
  top: { x: 0, y: -0.11 },
  left: { x: -0.17, y: 0.005 },
  right: { x: 0.17, y: 0.005 },
};

export interface GaramCenterGeometry {
  terreWidth: number;
  /** Centre de la carte `index` du rang du terre (tête = 0). */
  terreSlot: (index: number, count: number) => { x: number; y: number };
  /** Rectangle du rang du terre pour `count` cartes, repères « Tête / Queue » compris. */
  terreRect: (count: number, labelHeight: number) => Rect;
  /** Centre de la carte jouée par le siège `side`. */
  spot: (side: SeatSide) => { x: number; y: number };
  /** Rectangle (orientation comprise) de la carte jouée par le siège `side`. */
  spotRect: (side: SeatSide, cardWidth: number) => Rect;
  /** Cadre de la zone « cartes du tour ». */
  trickRect: (cardWidth: number) => Rect;
}

export function garamCenterGeometry(
  L: Pick<GameTableLayout, 'cx' | 'tableCy' | 'diameter' | 'smallCard'>,
): GaramCenterGeometry {
  const { cx, tableCy: cy, diameter: D } = L;
  const terreWidth = Math.round(Math.min(L.smallCard * 1.1, D * GARAM_TERRE_MAX_CARD));
  const terreCy = cy + GARAM_TERRE_Y * D;
  const trickCy = cy + GARAM_TRICK_Y * D;
  const terreLeft = (count: number) => cx - fanWidth(count, terreWidth, GARAM_TERRE_STEP) / 2;
  const spot = (side: SeatSide) => ({
    x: cx + GARAM_SPOT_OFFSET[side].x * D,
    y: trickCy + GARAM_SPOT_OFFSET[side].y * D,
  });
  const spotRect = (side: SeatSide, w: number) => {
    const { x, y } = spot(side);
    const h = w * CARD_RATIO;
    // Cartes des sièges de côté : posées en travers (90°).
    const [width, height] = side === 'left' || side === 'right' ? [h, w] : [w, h];
    return { left: x - width / 2, top: y - height / 2, width, height };
  };
  return {
    terreWidth,
    terreSlot: (index, count) => ({
      x: terreLeft(count) + index * terreWidth * GARAM_TERRE_STEP + terreWidth / 2,
      y: terreCy,
    }),
    terreRect: (count, labelHeight) => ({
      left: terreLeft(count),
      top: terreCy - (terreWidth * CARD_RATIO) / 2,
      width: fanWidth(count, terreWidth, GARAM_TERRE_STEP),
      height: terreWidth * CARD_RATIO + labelHeight,
    }),
    spot,
    spotRect,
    trickRect: (w) => {
      const rects = (['bottom', 'top', 'left', 'right'] as const).map((s) => spotRect(s, w));
      const pad = w * 0.12;
      const left = Math.min(...rects.map((r) => r.left)) - pad;
      const top = Math.min(...rects.map((r) => r.top)) - pad;
      const right = Math.max(...rects.map((r) => r.left + r.width)) + pad;
      const bottom = Math.max(...rects.map((r) => r.top + r.height)) + pad;
      return { left, top, width: right - left, height: bottom - top };
    },
  };
}

// --- Zones des cartes d'un siège ---

/**
 * Cartes au plus dans la zone de départ d'un joueur : ses 2 cartes gardées et 4 cartes tirées
 * du terre (2 cartes gardées ≥ 6 points, la limite de 21).
 */
export const GARAM_MAX_SEAT_CARDS = 6;

export interface GaramSeatRows {
  /** Carte classée du premier tour (une seule), dans le cadre « 1er tour » du siège. */
  classified: PublicRowZone;
  classifiedRect: Rect;
}

/**
 * Cadre « 1er tour » d'un siège : la première place de sa rangée de cartes publiques (place
 * réservée existante, `playedRowIn`). Les cartes tirées du terre n'y vont PAS : elles
 * rejoignent la zone de départ du joueur (là où ses cartes sont arrivées à la distribution).
 */
export function garamSeatRows(row: PublicRowZone): GaramSeatRows {
  const pad = Math.max(2, Math.round(row.cardWidth * 0.06));
  const box = publicRowBox(row, 1);
  return {
    classified: { ...row, step: 1 },
    classifiedRect: {
      left: box.left - pad,
      top: box.top - pad,
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    },
  };
}

/**
 * Zone de départ d'un ADVERSAIRE (là où ses lots sont arrivés à la distribution, `backs`) :
 * ses cartes cachées puis, à leur droite, ses cartes tirées du terre, face visible, en
 * éventail centré qui tient dans la zone (`fanStepFor`).
 */
export function seatHandLayout(
  zone: { left: number; top: number; width: number },
  cardWidth: number,
  count: number,
) {
  const step = fanStepFor(count, cardWidth, zone.width);
  const left = zone.left + (zone.width - fanWidth(count, cardWidth, step)) / 2;
  return {
    left,
    step,
    /** Centre de la carte `index` quand la zone en compte `count`. */
    center: (index: number) => ({
      x: left + index * cardWidth * step + cardWidth / 2,
      y: zone.top + (cardWidth * CARD_RATIO) / 2,
    }),
  };
}

/**
 * Pas minimal de MA zone de départ (part d'une largeur de carte) : celui des éventails des
 * adversaires (`FAN_STEP`), qui laisse lisible le coin de chaque carte (valeur et famille).
 * Atteint seulement avec 6 cartes (2 cachées + 4 tirées, cas rare).
 */
export const GARAM_HAND_MIN_STEP = FAN_STEP;

/**
 * Pas de ma zone de départ : celui de la main du Ter (`handStepFor`) jusqu'à 5 cartes ; à 6
 * (2 cachées + 4 tirées), il se resserre pour rester dans l'emplacement de la main, sans
 * jamais masquer un coin.
 */
export function garamHandStep(
  count: number,
  L: Pick<GameTableLayout, 'cardWidth' | 'handStep' | 'handSlotWidth'>,
): number {
  if (count <= 5) return handStepFor(count, L);
  const fill = Math.floor((L.handSlotWidth - L.cardWidth) / (count - 1));
  return Math.max(Math.ceil(L.cardWidth * GARAM_HAND_MIN_STEP), Math.min(handStepFor(count, L), fill));
}

/** Largeur de ma zone de départ pour `count` cartes. */
export function garamHandWidth(count: number, L: GameTableLayout): number {
  return count > 0 ? L.cardWidth + (count - 1) * garamHandStep(count, L) : 0;
}

/** Centre de la carte `index` de MA main quand elle en compte `count` (main du bas). */
export function myHandSlot(
  L: GameTableLayout,
  bottom: number,
  count: number,
  index: number,
): { x: number; y: number } {
  const left = L.handLeft + (L.handSlotWidth - garamHandWidth(count, L)) / 2;
  return {
    x: left + index * garamHandStep(count, L) + L.cardWidth / 2,
    y: bottom - L.cardHeight / 2,
  };
}

/** Centre de la carte `index` d'une rangée publique. */
export function rowSlotCenter(row: PublicRowZone, index: number) {
  return {
    x: publicCardLeft(row, index) + row.cardWidth / 2,
    y: row.top + (row.cardWidth * CARD_RATIO) / 2,
  };
}

// --- Cartes tirées : une à la fois, dans l'ordre réel du tirage ---

export interface PendingDraw {
  playerId: string;
  cardId: string;
  /** Rang de la carte dans les cartes tirées de son joueur. */
  index: number;
}

/**
 * Cartes tirées par le serveur mais pas encore présentées, dans l'ordre réel du tirage : le
 * tirage suit `drawOrder` (le contrôleur, puis sens antihoraire, chacun jusqu'au bout), donc
 * les cartes d'un joueur précèdent celles du suivant. Ce sont aussi, dans cet ordre, les
 * cartes qui étaient en tête du terre.
 */
export function pendingDraws(
  garam: Pick<GaramView, 'drawOrder' | 'drawn'> | undefined,
  shown: Readonly<Record<string, number>>,
): PendingDraw[] {
  if (!garam) return [];
  const order = [
    ...garam.drawOrder,
    ...Object.keys(garam.drawn).filter((id) => !garam.drawOrder.includes(id)),
  ];
  return order.flatMap((playerId) =>
    (garam.drawn[playerId] ?? [])
      .slice(shown[playerId] ?? 0)
      .map((cardId, i) => ({ playerId, cardId, index: (shown[playerId] ?? 0) + i })),
  );
}

const drawnCounts = (garam: GaramView | undefined) =>
  Object.fromEntries(Object.entries(garam?.drawn ?? {}).map(([id, cards]) => [id, cards.length]));

/**
 * Présentation des cartes tirées (toutes tirées par le serveur, D-136) : chaque nouvelle carte
 * part de la tête du terre et rejoint son joueur, une seule à la fois, avec une courte
 * respiration entre deux. Les cartes pas encore parties restent dessinées en tête du terre.
 * Aucun vol ne part tant que `enabled` est faux (premier tour pas encore rangé), ni avant
 * `GARAM_DRAW_START_PAUSE_MS` une fois le tour rangé. À l'arrivée
 * sur la table (ou en reconnexion), les cartes déjà tirées sont posées d'emblée, sans rejouer
 * les vols ; une vue identique reçue de nouveau ne relance rien.
 */
export function useGaramDrawFlights(
  gameId: string,
  garam: GaramView | undefined,
  enabled = true,
) {
  const [state, setState] = useState(() => ({
    gameId,
    shown: drawnCounts(garam) as Record<string, number>,
    flying: null as PendingDraw | null,
    // Tour déjà rangé à l'arrivée sur la table (reconnexion) : aucune pause rejouée.
    open: enabled,
  }));
  if (state.gameId !== gameId) {
    setState({ gameId, shown: drawnCounts(garam), flying: null, open: enabled });
  }
  const pending = pendingDraws(garam, state.shown);
  const next = pending[0];
  const flying = state.flying;
  const nextKey = next ? `${next.playerId}:${next.cardId}` : null;

  // Premier tour rangé sous nos yeux : courte pause avant la 1re carte du terre.
  useEffect(() => {
    if (!enabled || state.open) return;
    const timer = setTimeout(
      () => setState((s) => (s.open ? s : { ...s, open: true })),
      GARAM_DRAW_START_PAUSE_MS,
    );
    return () => clearTimeout(timer);
  }, [enabled, state.open]);
  const ready = enabled && state.open;

  useEffect(() => {
    if (flying || !next || !ready) return;
    const timer = setTimeout(
      () => setState((s) => (s.flying ? s : { ...s, flying: next })),
      GARAM_DRAW_BREATH_MS,
    );
    return () => clearTimeout(timer);
    // `next` est identifié par `nextKey` : une nouvelle vue identique ne relance rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flying, nextKey, ready]);

  const land = useCallback(
    () =>
      setState((s) =>
        s.flying
          ? {
              ...s,
              shown: { ...s.shown, [s.flying.playerId]: s.flying.index + 1 },
              flying: null,
            }
          : s,
      ),
    [],
  );
  const waiting = pending.filter((p) => p.cardId !== flying?.cardId);
  return {
    /** Cartes tirées déjà posées chez chaque joueur. */
    shownOf: (playerId: string) => (garam?.drawn[playerId] ?? []).slice(0, state.shown[playerId] ?? 0),
    flying,
    /** Terre dessiné : cartes tirées pas encore parties, en tête, puis le terre du serveur. */
    terre: [...waiting.map((p) => p.cardId), ...(garam?.terre ?? [])],
    idle: pending.length === 0 && !flying,
    land,
  };
}

// --- Fin de manche : révélation, totaux, gagnant ---

export interface GaramRevealStage {
  /** Joueurs dont la main cachée est déjà révélée (dans l'ordre de la manche). */
  revealed: string[];
  /** Toutes les zones dévoilées (chaque total s'affiche avec la révélation de son joueur). */
  scores: boolean;
  /** Gagnant mis en évidence (ou égalité annoncée). */
  winner: boolean;
  /** Présentation terminée : panneau de fin (Continuer / Sortir, ou nouvelle manche). */
  done: boolean;
}

/** Mains révélées par le serveur à la fin de la manche (aucune avant la fin). */
export function revealedHandsOf(game: GameView): Record<string, string[]> | undefined {
  if (game.status !== 'finished') return undefined;
  return game.result?.garamHands ?? game.garamTie?.hands;
}

/** Calendrier de la présentation de fin, depuis le moment où la table est prête. */
export function garamRevealSchedule(
  order: readonly string[],
  tie: boolean,
): { at: number; stage: GaramRevealStage }[] {
  if (tie) {
    const all = { revealed: [...order], scores: true, winner: true, done: false };
    return [
      { at: 0, stage: all },
      { at: GARAM_TIE_HOLD_MS, stage: { ...all, done: true } },
    ];
  }
  const steps = order.map((_, i) => ({
    at: i * GARAM_REVEAL_STEP_MS,
    stage: { revealed: order.slice(0, i + 1), scores: false, winner: false, done: false },
  }));
  const afterReveal = order.length * GARAM_REVEAL_STEP_MS;
  const all = [...order];
  return [
    ...steps,
    { at: afterReveal, stage: { revealed: all, scores: true, winner: false, done: false } },
    {
      at: afterReveal + GARAM_SCORE_HOLD_MS,
      stage: { revealed: all, scores: true, winner: true, done: false },
    },
    {
      at: afterReveal + GARAM_SCORE_HOLD_MS + GARAM_WINNER_HOLD_MS,
      stage: { revealed: all, scores: true, winner: true, done: true },
    },
  ];
}

const NOTHING: GaramRevealStage = { revealed: [], scores: false, winner: false, done: false };

/**
 * Présentation de fin d'une manche, lancée quand la table est prête (`ready` : dernier tour
 * rangé, dernière carte tirée posée). Une manche déjà terminée à l'arrivée sur la table
 * (reconnexion) est montrée d'emblée dans son état final.
 */
export function useGaramReveal(game: GameView, ready: boolean): GaramRevealStage {
  const finished = game.status === 'finished';
  const order = game.garam?.order ?? game.players.map((p) => p.playerId);
  const tie = game.endReason === 'GARAM_TIE';
  const [state, setState] = useState(() => ({
    gameId: game.gameId,
    // Déjà terminée à l'ouverture de l'écran : aucune présentation rejouée.
    stage: finished ? { revealed: order, scores: true, winner: true, done: true } : NOTHING,
  }));
  if (state.gameId !== game.gameId) {
    setState({
      gameId: game.gameId,
      stage: finished ? { revealed: order, scores: true, winner: true, done: true } : NOTHING,
    });
  }
  const orderKey = order.join('|');
  // Présentation lancée une seule fois par manche ; ses étapes ne sont jamais annulées par un
  // nouveau rendu (seulement au départ de l'écran).
  const launched = useRef<string | null>(finished ? game.gameId : null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    if (!finished || !ready || launched.current === game.gameId) return;
    const gameId = game.gameId;
    launched.current = gameId;
    timers.current = garamRevealSchedule(orderKey.split('|'), tie).map(({ at, stage }) =>
      setTimeout(() => setState((s) => (s.gameId === gameId ? { ...s, stage } : s)), at),
    );
  }, [finished, ready, orderKey, tie, game.gameId]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return finished ? state.stage : NOTHING;
}
