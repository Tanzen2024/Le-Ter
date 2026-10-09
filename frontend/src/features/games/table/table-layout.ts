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
  /** Cartes de MA main, légèrement chevauchées (pas = `handStep`). */
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
  /** Bas droit : boutons d'action ponctuels (Se coucher, Gagner). */
  action: { size: number; top: number };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Longueur du libellé le plus long du compteur : « Tour 5/5 ». */
const LABEL_CHARS = 8;

/** Cartes distribuées à chaque joueur (D-032). */
export const MAX_HAND_CARDS = 5;

/** Largeur d'une main de `count` cartes chevauchées. */
export const handWidthOf = (count: number, L: GameTableLayout) =>
  count > 0 ? L.cardWidth + (count - 1) * L.handStep : 0;

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
  const handStep = Math.round(cardWidth * 0.8);
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
  // Bas droit : bouton carré « Se coucher » (et « Gagner » au-dessus si autorisé).
  const actionSize = Math.round(clamp(height * 0.19, 56, 92));

  // La plaque du haut mord sur le bord de la table, ses dos de carte au-dessus d'elle.
  const top = options.topSeat
    ? safe.top + smallCard * CARD_RATIO + 2 + plateHeight * 0.3
    : safe.top + plateHeight * 0.5;
  const bottom = safe.bottom + cardHeight * 0.8;
  const diameter = Math.round(
    Math.min(height - top - bottom, (width - safe.left - safe.right) * 0.42, 760),
  );
  const cx = width / 2;
  const cy = top + diameter / 2;

  const handSlotWidth = cardWidth + (MAX_HAND_CARDS - 1) * handStep;
  const rightLimit = width - safe.right - actionSize - gap;
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
      top: height - safe.bottom - actionSize * 2 - gap,
    },
  };
}
