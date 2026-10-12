/// <reference types="jest" />
import { computeLobbyMetrics, type LobbyMetrics } from '../../lobby/lobby-metrics';
import { CARD_RATIO, FACE_CORNER, ROW_STEP } from './Cards';
import {
  distanceTagHeight,
  fitPublicRow,
  handZoneRect,
  PUBLIC_ROW_MAX_STEP,
  PUBLIC_ROW_MIN_SCALE,
  publicRowBox,
  seatZones,
} from './TableCards';
import {
  computeGameTableLayout,
  HAND_MAX_STEP,
  handStepFor,
  handWidthOf,
  MAX_HAND_CARDS,
  overlaps,
  tableHalfWidthOver,
  type GameTableLayout,
  type Rect,
  type SeatSide,
} from './table-layout';

/**
 * Aucun élément de la table n'en recouvre un autre, quel que soit le smartphone en paysage :
 * chaque siège (dos, plaque, 5 cartes jouées, distance), la main, la plaque et les cartes du
 * joueur connecté, le chrono, le bandeau de tour, les actions et les contrôles des coins.
 * Les rangées de cartes jouées ne mordent jamais sur la table en bois.
 */

const SCREENS: [number, number][] = [
  [640, 320],
  [720, 330],
  // Capture de référence du défaut (1152 × 508 px à 1,5) : rangées de deux joueurs mêlées.
  [768, 339],
  [800, 360],
  [853, 393],
  [915, 412],
  [1024, 460],
  [1280, 800],
];
const INSETS = {
  aucun: { top: 0, bottom: 0, left: 0, right: 0 },
  courant: { top: 6, bottom: 6, left: 12, right: 12 },
  encoche: { top: 0, bottom: 14, left: 34, right: 0 },
};
/** Côtés occupés selon le nombre de places (le joueur connecté est toujours en bas). */
const TABLES: Record<string, SeatSide[]> = {
  '2 places': ['bottom', 'top'],
  '3 places': ['bottom', 'right', 'left'],
  '4 places': ['bottom', 'right', 'top', 'left'],
};

function layoutOf(
  width: number,
  height: number,
  safe: LobbyMetrics['safe'],
  sides: SeatSide[],
): { m: LobbyMetrics; L: GameTableLayout } {
  const m = computeLobbyMetrics({ width, height, safe });
  return { m, L: computeGameTableLayout(m, { topSeat: sides.includes('top') }) };
}

/** Tous les éléments posés, nommés pour un message d'échec lisible. */
function elementsOf(m: LobbyMetrics, L: GameTableLayout, sides: SeatSide[]) {
  const items: { name: string; rect: Rect; row?: boolean }[] = [
    { name: 'coin gauche', rect: L.corners.left },
    { name: 'coin droit', rect: L.corners.right },
    {
      name: 'chrono',
      rect: {
        left: m.safe.left,
        top: m.height - m.safe.bottom - L.hud.ring - L.hud.labelHeight,
        width: L.hud.columnWidth,
        height: L.hud.ring + L.hud.labelHeight,
      },
    },
    {
      name: 'bandeau de tour',
      rect: {
        left: L.hud.message.left,
        top: m.height - L.hud.message.bottom - L.hud.message.height,
        width: L.hud.message.width,
        height: L.hud.message.height,
      },
    },
    {
      name: 'actions',
      rect: {
        left: m.width - m.safe.right - L.action.width,
        top: L.action.top,
        width: L.action.width,
        height: L.action.size,
      },
    },
    { name: 'main', rect: handZoneRect('bottom', MAX_HAND_CARDS, L, m) },
  ];
  for (const side of sides) {
    const z = seatZones(side, L, m);
    const cardWidth = z.publicRow.cardWidth;
    items.push({
      name: `plaque ${side}`,
      rect: { ...z.plate, width: L.plateWidth, height: L.plateHeight },
    });
    items.push({
      name: `cartes jouées ${side}`,
      rect: publicRowBox(z.publicRow, MAX_HAND_CARDS, cardWidth),
      row: true,
    });
    if (z.backs) {
      items.push({
        name: `dos ${side}`,
        rect: { ...z.backs, height: L.smallCard * CARD_RATIO },
      });
    }
    if (z.distance) {
      items.push({
        name: `distance ${side}`,
        rect: { ...z.distance, height: distanceTagHeight(m) },
      });
    }
  }
  return items;
}

describe('rangée de cartes jouées : adaptation à la place', () => {
  it('assez de place : taille inchangée, chevauchement adapté', () => {
    expect(fitPublicRow(10_000, 30)).toEqual({ cardWidth: 30, step: PUBLIC_ROW_MAX_STEP });
    expect(fitPublicRow(30 * (1 + 4 * ROW_STEP), 30)).toEqual({ cardWidth: 30, step: ROW_STEP });
  });

  it('trop étroit : cartes réduites au pas minimal, jamais sous 75 % de leur taille', () => {
    const fit = fitPublicRow(90, 30);
    expect(fit.step).toBe(ROW_STEP);
    expect(fit.cardWidth).toBeLessThan(30);
    expect(fit.cardWidth * (1 + 4 * ROW_STEP)).toBeLessThanOrEqual(90);
    expect(fitPublicRow(10, 30).cardWidth).toBe(Math.ceil(30 * PUBLIC_ROW_MIN_SCALE));
  });
});

describe('main du joueur : pas selon le nombre de cartes', () => {
  it.each(SCREENS)('%i×%i : centrée dans son emplacement, coin toujours visible', (width, height) => {
    const { L } = layoutOf(width, height, INSETS.courant, TABLES['4 places']!);
    const corner = L.cardWidth * (FACE_CORNER.left + FACE_CORNER.value * 0.62);
    let previous = Infinity;
    expect(handWidthOf(1, L)).toBe(L.cardWidth);
    for (let count = 2; count <= MAX_HAND_CARDS; count += 1) {
      const step = handStepFor(count, L);
      // Moins de cartes : jamais plus serrées ; 5 cartes : pas de la référence.
      expect(step).toBeLessThanOrEqual(previous);
      expect(step).toBeGreaterThanOrEqual(L.handStep);
      expect(step).toBeLessThanOrEqual(Math.round(L.cardWidth * HAND_MAX_STEP));
      expect(corner).toBeLessThan(step);
      expect(handWidthOf(count, L)).toBeLessThanOrEqual(L.handSlotWidth + 0.5);
      previous = step;
    }
    expect(handStepFor(MAX_HAND_CARDS, L)).toBe(L.handStep);
  });
});

describe.each(Object.entries(TABLES))('table à %s', (_label, sides) => {
  describe.each(Object.entries(INSETS))('bords sûrs : %s', (_inset, safe) => {
    it.each(SCREENS)('%i×%i : aucun chevauchement, rien hors de l’écran', (width, height) => {
      const { m, L } = layoutOf(width, height, safe, sides);
      const items = elementsOf(m, L, sides);
      const collisions: string[] = [];
      items.forEach((a, i) =>
        items.slice(i + 1).forEach((b) => {
          if (overlaps(a.rect, b.rect)) collisions.push(`${a.name} × ${b.name}`);
        }),
      );
      expect(collisions).toEqual([]);

      for (const { name, rect } of items) {
        // Dans l'écran, bords sûrs compris (demi-pixel d'arrondi toléré).
        expect([name, rect.left >= m.safe.left - 0.5]).toEqual([name, true]);
        expect([name, rect.top >= m.safe.top - 0.5]).toEqual([name, true]);
        expect([name, rect.left + rect.width <= width - m.safe.right + 0.5]).toEqual([name, true]);
        expect([name, rect.top + rect.height <= height - m.safe.bottom + 0.5]).toEqual([
          name,
          true,
        ]);
      }
    });

    it.each(SCREENS)('%i×%i : cartes jouées hors de la table en bois', (width, height) => {
      const { m, L } = layoutOf(width, height, safe, sides);
      for (const { name, rect } of elementsOf(m, L, sides).filter((i) => i.row)) {
        const half = tableHalfWidthOver(rect.top, rect.top + rect.height, L);
        const clear = rect.left >= L.cx + half - 0.5 || rect.left + rect.width <= L.cx - half + 0.5;
        expect([name, clear]).toEqual([name, true]);
      }
    });
  });
});
