import type { GameView, PlayerInGame } from '../../../types/game';
import type { LobbyMetrics } from '../../lobby/lobby-metrics';
import { tableSeat } from '../format';
import { CARD_RATIO } from './Cards';

/** Côté de la table où un siège est dessiné ; le joueur connecté est toujours en bas. */
export type SeatSide = 'bottom' | 'right' | 'top' | 'left';

/**
 * Sens de jeu ANTIHORAIRE (D-033) : vu du joueur assis en bas, le siège suivant est à sa
 * droite, puis en face, puis à sa gauche.
 */
const SIDES: Record<number, SeatSide[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'right', 'left'],
  4: ['bottom', 'right', 'top', 'left'],
};

export interface SeatView {
  /** Siège FIXE de la session (D-034). */
  seat: number;
  side: SeatSide;
  /** Absent : aucun joueur de CETTE partie sur ce siège. */
  player?: PlayerInGame;
}

/** Les sièges de la table, en partant du joueur connecté (siège 0 s'il n'est pas assis). */
export function arrangeSeats(game: GameView): SeatView[] {
  const count = game.maxPlayers;
  const sides = SIDES[count] ?? SIDES[4];
  const me = game.players.find((p) => p.playerId === game.viewerId);
  const origin = me ? tableSeat(me) : 0;
  return sides.map((side, offset) => {
    const seat = (origin + offset) % count;
    return {
      seat,
      side,
      player: game.players.find((p) => tableSeat(p) === seat),
    };
  });
}

export interface GameTableLayout {
  /** Centre et diamètre de la table en bois : l'élément dominant de l'écran. */
  cx: number;
  cy: number;
  diameter: number;
  plateWidth: number;
  plateHeight: number;
  /** Cartes de MA main, nettement chevauchées comme sur la référence (pas = `handStep`). */
  cardWidth: number;
  cardHeight: number;
  handStep: number;
  /** Bord gauche de l'emplacement de 5 cartes ; une main plus courte y est centrée. */
  handLeft: number;
  handSlotWidth: number;
  /** Plaque du joueur connecté, à droite de sa main. */
  localPlateLeft: number;
  /** Petites cartes : dos des adversaires, cartes publiques. */
  smallCard: number;
  control: number;
  gap: number;
  /** Bas gauche : chrono circulaire, « Tour n/5 » et bandeau « C'est ton tour ! ». */
  hud: {
    ring: number;
    columnWidth: number;
    labelHeight: number;
    labelFontSize: number;
    /** Bandeau à droite du chrono (place suffisante) ou au-dessus (petits écrans). */
    message: { left: number; bottom: number; width: number; height: number };
    /** Haut du bloc : aucun élément de siège ne descend plus bas sur la gauche. */
    top: number;
  };
  /**
   * Bas droit : boutons ronds « Main spéciale » et « Se coucher », côte à côte. `size` :
   * diamètre d'un bouton ; `width` : largeur de la rangée des deux boutons.
   */
  action: { size: number; width: number; top: number };
  /**
   * Les cercles du centre de la table : anneau gravé (monogramme) et zone de dépôt, qui
   * occupe l'intérieur de l'anneau (aucun cercle supplémentaire visible au repos).
   */
  center: { ring: number; ringBorder: number; drop: number };
  /**
   * Contrôles des coins hauts : quitter et réglages (gauche), solde et chat (droite), en
   * colonne. Aucun élément de siège n'y est posé.
   */
  corners: { left: Rect; right: Rect };
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

/**
 * Demi-largeur de la table ronde sur la bande horizontale [y1, y2] : ce qu'il faut laisser
 * libre de part et d'autre du centre pour qu'une rangée posée dans cette bande ne mord pas
 * sur le bois.
 */
export function tableHalfWidthOver(y1: number, y2: number, L: Pick<GameTableLayout, 'cy' | 'diameter'>) {
  const r = L.diameter / 2;
  if (y1 <= L.cy && y2 >= L.cy) return r;
  const d = Math.min(Math.abs(y1 - L.cy), Math.abs(y2 - L.cy));
  return d >= r ? 0 : Math.sqrt(r * r - d * d);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Longueur du libellé le plus long du compteur : « Tour 5/5 ». */
const LABEL_CHARS = 8;

/**
 * Proportions des cercles de la table de référence (capture 1280 × 561 : table de 407 px de
 * diamètre, anneau gravé de 219 px au trait de 18 px), rapportées à la hauteur de l'écran et
 * au diamètre de la table : elles restent les mêmes sur tous les smartphones.
 */
export const TABLE_REFERENCE = {
  /** Diamètre de la table / hauteur de l'écran. */
  diameterToHeight: 0.725,
  /** Diamètre extérieur de l'anneau gravé / diamètre de la table. */
  ring: 0.54,
  /** Épaisseur du trait de l'anneau / diamètre de la table. */
  ringBorder: 0.044,
  /** Pas de la main chevauchée, en largeur de carte. */
  handStep: 0.48,
} as const;

export function centerCircles(diameter: number): { ring: number; ringBorder: number; drop: number } {
  const ring = Math.round(diameter * TABLE_REFERENCE.ring);
  const ringBorder = Math.max(3, Math.round(diameter * TABLE_REFERENCE.ringBorder));
  // La zone de dépôt est l'intérieur de l'anneau gravé.
  return { ring, ringBorder, drop: ring - ringBorder * 2 };
}

/** Cartes distribuées à chaque joueur (D-032). */
export const MAX_HAND_CARDS = 5;

/** Pas maximal de la main : avec peu de cartes, chacune reste nettement visible. */
export const HAND_MAX_STEP = 0.78;

/**
 * Pas de la main selon son nombre de cartes : 5 cartes gardent le pas de la référence
 * (`handStep`) ; avec moins de cartes, le pas s'élargit dans le même emplacement (jusqu'à
 * `HAND_MAX_STEP` de la largeur), la main restant centrée. Le coin de chaque carte
 * (valeur, famille) reste toujours visible.
 */
export function handStepFor(count: number, L: Pick<GameTableLayout, 'cardWidth' | 'handStep' | 'handSlotWidth'>) {
  if (count <= 1) return L.handStep;
  // Arrondi vers le bas : la main ne déborde jamais de son emplacement, même d'un pixel.
  const fill = Math.floor((L.handSlotWidth - L.cardWidth) / (count - 1));
  return Math.min(Math.round(L.cardWidth * HAND_MAX_STEP), Math.max(L.handStep, fill));
}

/** Largeur d'une main de `count` cartes chevauchées. */
export const handWidthOf = (count: number, L: GameTableLayout) =>
  count > 0 ? L.cardWidth + (count - 1) * handStepFor(count, L) : 0;

/**
 * Disposition de la table de référence (paysage) : table ronde au centre, adversaires autour
 * (dos de leurs cartes juste au-dessus de leur plaque), contrôles dans les coins hauts, chrono
 * et tour en bas à gauche, main au centre du bas, plaque locale puis actions en bas à droite.
 * Tout découle de la surface disponible : les éléments périphériques rétrécissent avant la
 * table, et le bandeau de tour passe au-dessus du chrono quand la largeur manque.
 */
export function computeGameTableLayout(
  m: LobbyMetrics,
  options: { topSeat?: boolean } = {},
): GameTableLayout {
  const { width, height, safe } = m;
  const gap = Math.round(clamp(height * 0.02, 6, 14));
  const plateWidth = Math.round(clamp(width * 0.14, 96, 180));
  const plateHeight = Math.round(clamp(height * 0.095, 32, 46));
  const cardWidth = Math.round(clamp(height * 0.17, 48, 92));
  const cardHeight = Math.round(cardWidth * CARD_RATIO);
  const handStep = Math.round(cardWidth * TABLE_REFERENCE.handStep);
  const smallCard = Math.round(clamp(height * 0.085, 24, 48));
  const control = Math.round(clamp(height * 0.11, 44, 52));

  // Bas gauche : chrono + étiquette « Tour n/5 ».
  const ring = Math.round(clamp(height * 0.16, 50, 84));
  const labelHeight = Math.round(clamp(height * 0.065, 20, 30));
  const labelFontSize = Math.round(labelHeight * 0.58);
  // La colonne s'élargit pour que « Tour 5/5 » (8 signes, police grasse ≈ 0,62 em par
  // signe) tienne en entier avec ses marges : jamais de texte tronqué.
  const labelWidth = Math.ceil(labelFontSize * 0.62 * LABEL_CHARS + labelHeight * 0.8 + 2);
  const columnWidth = Math.max(Math.round(ring * 1.12), labelWidth);
  // Bas droit : deux boutons ronds côte à côte (« Main spéciale », « Se coucher »).
  const actionSize = Math.round(clamp(height * 0.18, 60, 92));
  const actionWidth = actionSize * 2 + Math.round(gap * 0.6);

  // La plaque du haut mord sur le bord de la table, ses dos de carte au-dessus d'elle.
  const top = options.topSeat
    ? safe.top + smallCard * CARD_RATIO + 2 + plateHeight * 0.3
    : safe.top + plateHeight * 0.5;
  // Table de la référence : 72,5 % de la hauteur ; la main du bas la chevauche, comme sur
  // la capture, sans jamais la faire sortir de l'écran.
  const bottom = safe.bottom + height * 0.06;
  const diameter = Math.round(
    Math.min(
      height * TABLE_REFERENCE.diameterToHeight,
      height - top - bottom,
      (width - safe.left - safe.right) * 0.42,
      760,
    ),
  );
  const cx = width / 2;
  const cy = top + diameter / 2;

  const handSlotWidth = cardWidth + (MAX_HAND_CARDS - 1) * handStep;
  const rightLimit = width - safe.right - actionWidth - gap;
  const localPlateLeft = Math.min(cx + handSlotWidth / 2 + gap, rightLimit - plateWidth);
  const handLeft = Math.min(cx - handSlotWidth / 2, localPlateLeft - gap - handSlotWidth);

  // Bandeau de tour : à droite du chrono s'il tient avant la main, sinon au-dessus.
  const inlineLeft = safe.left + columnWidth + gap;
  const inlineWidth = Math.min(handLeft - gap - inlineLeft, width * 0.16);
  const messageHeight = Math.round(clamp(height * 0.11, 34, 52));
  const blockHeight = ring + labelHeight + gap * 0.5;
  const message =
    inlineWidth >= 84
      ? {
          left: inlineLeft,
          bottom: safe.bottom,
          width: inlineWidth,
          height: messageHeight,
        }
      : {
          left: safe.left,
          bottom: safe.bottom + blockHeight + gap * 0.5,
          width: Math.max(columnWidth, handLeft - gap - safe.left),
          height: messageHeight,
        };
  const hudTop =
    height - Math.max(blockHeight + safe.bottom, message.bottom + message.height) - gap;

  return {
    cx,
    cy,
    diameter,
    plateWidth,
    plateHeight,
    cardWidth,
    cardHeight,
    handStep,
    handLeft,
    handSlotWidth,
    localPlateLeft,
    smallCard,
    control,
    gap,
    hud: {
      ring,
      columnWidth,
      labelHeight,
      labelFontSize,
      message,
      top: hudTop,
    },
    action: {
      size: actionSize,
      width: actionWidth,
      top: height - safe.bottom - actionSize - gap * 0.5,
    },
    center: centerCircles(diameter),
    corners: {
      left: {
        left: safe.left,
        top: safe.top,
        width: control,
        height: control * 2 + gap,
      },
      // Solde (pastille de largeur variable, au plus ≈ 2,6 boutons) puis chat dessous.
      right: {
        left: width - safe.right - control * 2.6,
        top: safe.top,
        width: control * 2.6,
        height: control * 2 + gap,
      },
    },
  };
}
