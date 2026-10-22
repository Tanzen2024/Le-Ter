/// <reference types="jest" />
import { computeLobbyMetrics } from '../../lobby/lobby-metrics';
import { playedRowIn, playedZoneRect, seatZones, spotCardWidth } from '../table/TableCards';
import { CARD_RATIO, fanWidth } from '../table/Cards';
import {
  computeGameTableLayout,
  handStepFor,
  overlaps,
  type Rect,
  type SeatSide,
} from '../table/table-layout';
import {
  GARAM_HAND_MIN_STEP,
  GARAM_MAX_SEAT_CARDS,
  GARAM_REVEAL_STEP_MS,
  GARAM_SCORE_HOLD_MS,
  GARAM_TIE_HOLD_MS,
  GARAM_WINNER_HOLD_MS,
  garamCenterGeometry,
  garamHandStep,
  garamHandWidth,
  garamRevealSchedule,
  garamSeatRows,
  myHandSlot,
  pendingDraws,
  seatHandLayout,
} from './garam-presentation';

/**
 * Déroulement visuel d'une manche de GARAM TIA (D-128) : chaque état d'une carte a sa zone,
 * jamais partagée, sur tous les écrans ; les cartes tirées partent une à une dans l'ordre réel
 * du tirage ; la fin de manche suit un calendrier identique à celui du serveur.
 */

const SCREENS: [number, number][] = [
  [640, 320],
  [720, 330],
  [800, 360],
  [853, 393],
  [915, 412],
  [1024, 460],
  [1280, 800],
];
const SAFE = { top: 6, bottom: 6, left: 12, right: 12 };
const TABLES: Record<string, SeatSide[]> = {
  '2 joueurs': ['bottom', 'top'],
  '3 joueurs': ['bottom', 'right', 'left'],
  '4 joueurs': ['bottom', 'right', 'top', 'left'],
};
const inside = (inner: Rect, outer: Rect, tolerance = 0.5) =>
  inner.left >= outer.left - tolerance &&
  inner.top >= outer.top - tolerance &&
  inner.left + inner.width <= outer.left + outer.width + tolerance &&
  inner.top + inner.height <= outer.top + outer.height + tolerance;

describe('zones de la table GARAM sur tous les écrans (2, 3, 4 joueurs)', () => {
  for (const [name, sides] of Object.entries(TABLES)) {
    it.each(SCREENS)(`${name} — %i × %i : terre, cartes du tour et zones des sièges séparés`, (w, h) => {
      const m = computeLobbyMetrics({ width: w, height: h, safe: SAFE });
      const L = computeGameTableLayout(m, { topSeat: sides.includes('top') });
      const geo = garamCenterGeometry(L);
      const spotWidth = spotCardWidth(L.diameter, L.smallCard);
      const terre = geo.terreRect(5, 0);
      const spots = sides.map((side) => ({ side, rect: geo.spotRect(side, spotWidth) }));
      // Le terre ne touche aucune carte du tour ; deux cartes du tour ne se touchent pas.
      for (const { side, rect } of spots) {
        expect([side, overlaps(terre, rect)]).toEqual([side, false]);
      }
      for (const [i, a] of spots.entries()) {
        for (const b of spots.slice(i + 1)) {
          expect([a.side, b.side, overlaps(a.rect, b.rect)]).toEqual([a.side, b.side, false]);
        }
      }
      // Terre et cartes du tour restent sur la table (le cercle de bois).
      const r = L.diameter / 2;
      for (const rect of [terre, ...spots.map((s) => s.rect)]) {
        for (const [x, y] of [
          [rect.left, rect.top],
          [rect.left + rect.width, rect.top],
          [rect.left, rect.top + rect.height],
          [rect.left + rect.width, rect.top + rect.height],
        ] as const) {
          expect(Math.hypot(x - L.cx, y - L.tableCy)).toBeLessThanOrEqual(r + 0.5);
        }
      }
      for (const side of sides) {
        const z = seatZones(side, L, m);
        const rows = garamSeatRows(playedRowIn(z.publicRow));
        const frame = playedZoneRect(z.publicRow);
        // Cadre « 1er tour » : dans la place du siège, loin du terre et des cartes du tour.
        expect([side, inside(rows.classifiedRect, frame, 3)]).toEqual([side, true]);
        for (const rect of [terre, ...spots.map((s) => s.rect)]) {
          expect([side, overlaps(rows.classifiedRect, rect)]).toEqual([side, false]);
        }
        // Zone de départ pleine (2 cartes cachées + 4 tirées) : elle tient dans sa place.
        if (side === 'bottom') {
          const width = garamHandWidth(GARAM_MAX_SEAT_CARDS, L);
          expect(width).toBeLessThanOrEqual(L.handSlotWidth + 0.5);
          // Coins lisibles : jamais plus serré que les éventails des adversaires.
          expect(garamHandStep(GARAM_MAX_SEAT_CARDS, L)).toBeGreaterThanOrEqual(
            L.cardWidth * GARAM_HAND_MIN_STEP,
          );
          // Jusqu'à 5 cartes : exactement le pas de la main du Ter.
          expect(garamHandStep(5, L)).toBe(handStepFor(5, L));
          const last = myHandSlot(L, m.height - m.safe.bottom, GARAM_MAX_SEAT_CARDS, GARAM_MAX_SEAT_CARDS - 1);
          expect(last.x + L.cardWidth / 2).toBeLessThanOrEqual(L.handLeft + L.handSlotWidth + 0.5);
        } else {
          const backs = z.backs!;
          const hand = seatHandLayout(backs, L.smallCard, GARAM_MAX_SEAT_CARDS);
          const rect: Rect = {
            left: hand.left,
            top: backs.top,
            width: fanWidth(GARAM_MAX_SEAT_CARDS, L.smallCard, hand.step),
            height: L.smallCard * CARD_RATIO,
          };
          // Ni sur le terre, ni sur les cartes du tour, ni sur le cadre « 1er tour ».
          for (const other of [terre, ...spots.map((s) => s.rect), rows.classifiedRect]) {
            expect([side, overlaps(rect, other)]).toEqual([side, false]);
          }
          // Reste à l'écran.
          expect([side, rect.left >= 0 && rect.left + rect.width <= m.width]).toEqual([side, true]);
        }
        // La plaque d'en face ne recouvre pas le terre.
        if (side === 'top') {
          expect(overlaps({ ...z.plate, width: L.plateWidth, height: L.plateHeight }, terre)).toBe(false);
        }
      }
    });
  }
});

describe('cartes tirées : une à la fois, dans l’ordre réel du tirage', () => {
  const garam = {
    drawOrder: ['b', 'c', 'a'],
    drawn: { a: ['A1'], b: ['B1', 'B2'], c: ['C1'] },
  };

  it('le contrôleur d’abord (toutes ses cartes), puis sens antihoraire', () => {
    expect(pendingDraws(garam, {}).map((p) => p.cardId)).toEqual(['B1', 'B2', 'C1', 'A1']);
  });

  it('cartes déjà posées : seules les suivantes restent à présenter, avec leur rang', () => {
    expect(pendingDraws(garam, { b: 2, c: 1 })).toEqual([{ playerId: 'a', cardId: 'A1', index: 0 }]);
    expect(pendingDraws(garam, { b: 1 })[0]).toEqual({ playerId: 'b', cardId: 'B2', index: 1 });
    expect(pendingDraws(garam, { a: 1, b: 2, c: 1 })).toEqual([]);
  });
});

describe('fin de manche : révélation, totaux, gagnant (calendrier du serveur)', () => {
  it('mains révélées une par une, puis totaux, puis gagnant, puis panneau de fin', () => {
    const schedule = garamRevealSchedule(['a', 'b', 'c'], false);
    expect(schedule.map((s) => s.at)).toEqual([
      0,
      GARAM_REVEAL_STEP_MS,
      2 * GARAM_REVEAL_STEP_MS,
      3 * GARAM_REVEAL_STEP_MS,
      3 * GARAM_REVEAL_STEP_MS + GARAM_SCORE_HOLD_MS,
      3 * GARAM_REVEAL_STEP_MS + GARAM_SCORE_HOLD_MS + GARAM_WINNER_HOLD_MS,
    ]);
    expect(schedule.map((s) => s.stage.revealed)).toEqual([
      ['a'],
      ['a', 'b'],
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
    ]);
    // Aucun total avant que toutes les mains soient révélées ; aucun gagnant avant les totaux.
    expect(schedule.map((s) => [s.stage.scores, s.stage.winner, s.stage.done])).toEqual([
      [false, false, false],
      [false, false, false],
      [false, false, false],
      [true, false, false],
      [true, true, false],
      [true, true, true],
    ]);
  });

  it('même durée que le serveur (backend garam-rules.ts : 2 600 ms d’avance + calendrier)', () => {
    for (const n of [2, 3, 4]) {
      const order = ['a', 'b', 'c', 'd'].slice(0, n);
      const last = garamRevealSchedule(order, false).at(-1)!.at;
      // garamRevealPresentationMs(n) = 2 600 + n × 900 + 900 + 2 000 (backend).
      expect(2_600 + last).toBe(2_600 + n * 900 + 900 + 2_000);
    }
  });

  it('égalité : mains et totaux ensemble, « Égalité », puis nouvelle manche', () => {
    const schedule = garamRevealSchedule(['a', 'b'], true);
    expect(schedule).toEqual([
      { at: 0, stage: { revealed: ['a', 'b'], scores: true, winner: true, done: false } },
      { at: GARAM_TIE_HOLD_MS, stage: { revealed: ['a', 'b'], scores: true, winner: true, done: true } },
    ]);
  });
});
