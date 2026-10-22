import { computeHomeLayout, MODE_COUNT } from './home-layout';
import { computeLobbyMetrics } from './lobby-metrics';

/**
 * Gabarit de l'accueil : un seul groupe de trois panneaux identiques, centré, sous le titre,
 * au-dessus des boutons du bas, sur toutes les surfaces paysage (l'application est en paysage
 * uniquement, D-028 : « 320 px » = téléphone 568 × 320).
 */
const SCREENS: [string, number, number, { top: number; bottom: number; left: number; right: number }][] = [
  ['téléphone 320', 568, 320, { top: 0, bottom: 0, left: 0, right: 0 }],
  ['téléphone 360', 640, 360, { top: 0, bottom: 0, left: 0, right: 0 }],
  ['téléphone 375', 667, 375, { top: 0, bottom: 0, left: 0, right: 0 }],
  ['téléphone 390 (encoche)', 844, 390, { top: 0, bottom: 21, left: 47, right: 47 }],
  ['téléphone 414 (encoche)', 896, 414, { top: 0, bottom: 21, left: 44, right: 44 }],
  ['téléphone 430 (encoche)', 932, 430, { top: 0, bottom: 21, left: 59, right: 59 }],
  ['tablette', 1024, 768, { top: 0, bottom: 0, left: 0, right: 0 }],
  ['ordinateur', 1440, 900, { top: 0, bottom: 0, left: 0, right: 0 }],
];

describe.each(SCREENS)('accueil — %s', (_name, width, height, safe) => {
  const m = computeLobbyMetrics({ width, height, safe });
  const layout = computeHomeLayout(m);
  const rowWidth = layout.cardWidth * MODE_COUNT + layout.cardsGap * (MODE_COUNT - 1);

  it('groupe centré, dans la largeur utile, écarts égaux', () => {
    expect(layout.sideSpace * 2 + rowWidth).toBeCloseTo(width, 5);
    expect(layout.sideSpace).toBeGreaterThanOrEqual(safe.left);
    expect(layout.cardsGap).toBeGreaterThan(0);
  });

  it('panneaux jamais écrasés : au moins aussi hauts que larges, sous le bas du groupe', () => {
    expect(layout.cardHeight).toBeGreaterThanOrEqual(layout.cardWidth);
    expect(layout.cardsTop + layout.cardHeight).toBeLessThanOrEqual(layout.cardsBottom);
    expect(layout.cardsBottom).toBeLessThanOrEqual(height - safe.bottom);
  });

  it('groupe remonté juste sous le titre, sans toucher aucun panneau', () => {
    const titleBottom = layout.titleTop + layout.titleSize * 1.25;
    expect(layout.cardsTop).toBeGreaterThan(titleBottom);
    expect(layout.cardsTop).toBeLessThanOrEqual(Math.round(titleBottom + m.gap * 1.5));
    expect(layout.cardsBottom).toBe(layout.cardsTop + layout.cardHeight);
    expect(layout.titleTop).toBeGreaterThanOrEqual(safe.top);
  });

  it('boutons Profil / Réglages jamais sous un panneau', () => {
    const buttonsRight = safe.left + m.iconButton * 2 + m.gap * 2;
    const buttonsTop = height - safe.bottom - m.iconButton;
    const groupBottom = layout.cardsTop + layout.cardHeight;
    expect(buttonsRight <= layout.sideSpace || groupBottom <= buttonsTop).toBe(true);
  });
});
