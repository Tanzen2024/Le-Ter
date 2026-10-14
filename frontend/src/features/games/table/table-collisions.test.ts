/// <reference types="jest" />
import { computeLobbyMetrics, type LobbyMetrics } from '../../lobby/lobby-metrics';
import { CARD_RATIO, FACE_CORNER, ROW_STEP } from './Cards';
import {
  distanceTagHeight,
  fitPublicRow,
  handZoneRect,
  playedRowIn,
  playedZoneRect,
  PUBLIC_ROW_MAX_STEP,
  PUBLIC_ROW_MIN_SCALE,
  publicRowBox,
  seatZones,
} from './TableCards';
import {
  computeGameTableLayout,
  EMPTY_TOP_SEAT_RESERVE,
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
  // Capture de référence du cadre « mes cartes jouées ».
  [897, 393],
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
    items.push({
      name: `plaque ${side}`,
      rect: { ...z.plate, width: L.plateWidth, height: L.plateHeight },
    });
    // Le cadre de la zone (visible même vide) contient la rangée de 5 cartes.
    items.push({ name: `zone cartes jouées ${side}`, rect: playedZoneRect(z.publicRow), row: true });
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

    it.each(SCREENS)('%i×%i : zones de cartes jouées hors de la table en bois', (width, height) => {
      const { m, L } = layoutOf(width, height, safe, sides);
      for (const { name, rect } of elementsOf(m, L, sides).filter((i) => i.row)) {
        const half = tableHalfWidthOver(rect.top, rect.top + rect.height, L);
        const clear = rect.left >= L.cx + half - 0.5 || rect.left + rect.width <= L.cx - half + 0.5;
        expect([name, clear]).toEqual([name, true]);
      }
    });

    it.each(SCREENS)('%i×%i : cartes jouées latérales lisibles, hors plaque', (width, height) => {
      const { m, L } = layoutOf(width, height, safe, sides);
      for (const side of sides.filter((s) => s === 'left' || s === 'right')) {
        const z = seatZones(side, L, m);
        const row = publicRowBox(z.publicRow, MAX_HAND_CARDS);
        // Coin (valeur, famille) de chaque carte visible : jamais plus serré que ROW_STEP.
        expect([side, z.publicRow.step >= ROW_STEP]).toEqual([side, true]);
        const plate = { ...z.plate, width: L.plateWidth, height: L.plateHeight };
        const backs = { ...z.backs!, height: L.smallCard * CARD_RATIO };
        expect([side, overlaps(row, plate) || overlaps(row, backs)]).toEqual([side, false]);
      }
    });

    it.each(SCREENS)('%i×%i : zones de cartes jouées, 5 cartes dans le cadre', (width, height) => {
      const { m, L } = layoutOf(width, height, safe, sides);
      for (const side of sides) {
        const z = seatZones(side, L, m);
        const zone = playedZoneRect(z.publicRow);
        const row = publicRowBox(playedRowIn(z.publicRow), MAX_HAND_CARDS);
        expect([side, row.left > zone.left && row.top > zone.top]).toEqual([side, true]);
        expect([
          side,
          row.left + row.width < zone.left + zone.width &&
            row.top + row.height < zone.top + zone.height,
        ]).toEqual([side, true]);
      }
    });
  });
});

describe('capture de référence (897 × 393, 4 places) : zones 1 à 4', () => {
  const safe = { top: 0, bottom: 0, left: 36, right: 0 };
  const { m, L } = layoutOf(897, 393, safe, TABLES['4 places']!);
  const zone = (side: SeatSide) => playedZoneRect(seatZones(side, L, m).publicRow);
  const plate = (side: SeatSide) => seatZones(side, L, m).plate;

  it('zone 1 (moi) : à droite du centre, juste au-dessus de ma plaque', () => {
    expect(zone('bottom').left).toBeGreaterThan(L.cx);
    expect(zone('bottom').top + zone('bottom').height).toBeLessThanOrEqual(plate('bottom').top);
  });

  it('zone 2 (droite) : à droite de la table, contre la plaque du siège de droite', () => {
    const z = zone('right');
    const p = plate('right');
    expect(z.left).toBeGreaterThanOrEqual(L.cx + L.diameter / 2);
    // Sous la plaque ou à côté d'elle : jamais au-dessus, jamais loin en dessous.
    expect(z.top + z.height).toBeGreaterThan(p.top);
    expect(z.top).toBeLessThanOrEqual(p.top + L.plateHeight + L.gap);
  });

  it('zone 3 (haut) : à droite de la plaque du siège d’en face, en haut de l’écran', () => {
    expect(zone('top').left).toBeGreaterThan(plate('top').left + L.plateWidth);
    expect(zone('top').top).toBeLessThan(plate('top').top + L.plateHeight);
  });

  it('zone 4 (gauche) : sous la plaque du siège de gauche, à gauche de la table', () => {
    expect(zone('left').left + zone('left').width).toBeLessThanOrEqual(L.cx - L.diameter / 2);
    expect(zone('left').top).toBeGreaterThanOrEqual(plate('left').top + L.plateHeight);
  });
});

describe('cartes jouées : légèrement plus petites que la main, lisibles et empilées', () => {
  it.each(SCREENS)('%i×%i', (width, height) => {
    for (const sides of Object.values(TABLES)) {
      const { m, L } = layoutOf(width, height, INSETS.courant, sides);
      expect(L.playedCard).toBeLessThan(L.cardWidth);
      expect(L.playedCard).toBeGreaterThanOrEqual(L.smallCard);
      for (const side of sides) {
        const row = seatZones(side, L, m).publicRow;
        // Réduites seulement si la place manque, jamais plus petites qu'avant (75 % d'un dos).
        expect(row.cardWidth).toBeLessThanOrEqual(L.playedCard);
        expect(row.cardWidth).toBeGreaterThanOrEqual(Math.ceil(L.smallCard * PUBLIC_ROW_MIN_SCALE));
        // Empilées : légèrement décalées, coin (valeur, famille) de chacune visible.
        expect(row.step).toBeGreaterThanOrEqual(ROW_STEP);
        expect(row.step).toBeLessThanOrEqual(PUBLIC_ROW_MAX_STEP);
        expect(row.step).toBeLessThan(1);
      }
    }
  });
});
describe('zones de cartes jouées : dimensions identiques', () => {
  describe.each(Object.entries(TABLES))('table à %s', (_label, sides) => {
    it.each(SCREENS)('%i×%i : même largeur, même hauteur pour tous les sièges', (width, height) => {
      for (const safe of Object.values(INSETS)) {
        const { m, L } = layoutOf(width, height, safe, sides);
        const rects = sides.map((side) => playedZoneRect(seatZones(side, L, m).publicRow));
        const rows = sides.map((side) => seatZones(side, L, m).publicRow);
        for (const rect of rects) {
          expect(rect.width).toBeCloseTo(rects[0]!.width, 6);
          expect(rect.height).toBeCloseTo(rects[0]!.height, 6);
        }
        // Mêmes cartes, même pas : un même empilement dans chaque zone.
        expect(new Set(rows.map((row) => row.cardWidth)).size).toBe(1);
        expect(new Set(rows.map((row) => row.step)).size).toBe(1);
      }
    });
  });
});

describe('table légèrement remontée', () => {
  it.each(SCREENS)('%i×%i : plus haute qu’avant, de 30 % de plaque au plus', (width, height) => {
    for (const sides of Object.values(TABLES)) {
      const { m, L } = layoutOf(width, height, INSETS.courant, sides);
      const topSeat = sides.includes('top');
      // Haut de la table avec l'ancienne règle (plaque d'en face mordant de 30 %, marge d'une
      // demi-plaque sans siège en face).
      const before = topSeat
        ? m.safe.top + L.smallCard * CARD_RATIO + 2 + L.plateHeight * 0.3
        : m.safe.top + L.plateHeight * 0.5;
      const tableTop = L.cy - L.diameter / 2;
      expect(tableTop).toBeLessThan(before);
      expect(before - tableTop).toBeLessThanOrEqual(L.plateHeight * 0.3 + 0.01);
      // Jamais au-dessus du bord sûr de l'écran.
      expect(tableTop).toBeGreaterThanOrEqual(m.safe.top);
    }
  });
});
describe('siège d’en face vide (4 places, capture) : la table remonte', () => {
  const occupied: SeatSide[] = ['bottom', 'right', 'left'];
  describe.each(Object.entries(INSETS))('bords sûrs : %s', (_inset, safe) => {
    it.each(SCREENS)('%i×%i : plus haute, plaque vide en haut, rien ne se chevauche', (width, height) => {
      const m = computeLobbyMetrics({ width, height, safe });
      const L = computeGameTableLayout(m, { emptyTopSeat: true });
      const full = computeGameTableLayout(m, { topSeat: true });
      // Siège vide : la table remonte, mais une part de la bande des dos reste au-dessus de sa
      // plaque vide (jamais collée au bord haut de l'écran).
      const tableTop = L.cy - L.diameter / 2;
      expect(tableTop).toBeLessThan(full.cy - full.diameter / 2);
      const band = L.smallCard * CARD_RATIO + 2;
      expect(L.topPlateTop).toBeCloseTo(m.safe.top + band * EMPTY_TOP_SEAT_RESERVE, 6);
      expect(tableTop).toBeGreaterThan(m.safe.top + band * EMPTY_TOP_SEAT_RESERVE);
      // Les éléments des sièges occupés, plus la plaque vide du siège d'en face.
      const top = seatZones('top', L, m);
      const items = [
        ...elementsOf(m, L, occupied),
        { name: 'plaque top (vide)', rect: { ...top.plate, width: L.plateWidth, height: L.plateHeight } },
      ];
      const collisions: string[] = [];
      items.forEach((a, i) =>
        items.slice(i + 1).forEach((b) => {
          if (overlaps(a.rect, b.rect)) collisions.push(`${a.name} × ${b.name}`);
        }),
      );
      expect(collisions).toEqual([]);
      for (const { name, rect } of items) {
        expect([name, rect.top >= m.safe.top - 0.5]).toEqual([name, true]);
        expect([name, rect.top + rect.height <= height - m.safe.bottom + 0.5]).toEqual([name, true]);
      }
    });
  });
});

describe('carte la plus haute entièrement visible', () => {
  it.each(SCREENS)('%i×%i : dos et cartes jouées d’en face sous le bord sûr', (width, height) => {
    for (const safe of Object.values(INSETS)) {
      const { m, L } = layoutOf(width, height, safe, TABLES['4 places']!);
      const z = seatZones('top', L, m);
      expect(z.backs!.top).toBeGreaterThanOrEqual(m.safe.top);
      expect(publicRowBox(z.publicRow, MAX_HAND_CARDS).top).toBeGreaterThanOrEqual(m.safe.top);
    }
  });
});