/// <reference types="jest" />
import { leterCardsSize } from './LoginDecor';
import { computeLoginMetrics } from './LoginLayout';

const safe = (side: number, vertical: number) => ({
  top: vertical,
  bottom: vertical,
  left: side,
  right: side,
});

/** Hauteur du panneau : marque, titre, 2 champs, lien, message d'erreur, bouton, pied. */
function panelHeight(m: ReturnType<typeof computeLoginMetrics>) {
  const lines = (size: number) => Math.ceil(size * 1.35);
  // Écran décoré : cartes L E T E R (à moitié au-dessus du panneau) puis titre gravé.
  return (
    // Le haut du panneau est occupé par les cartes (au lieu de sa marge intérieure).
    m.padding +
    leterCardsSize(m.leterCardHeight).height +
    m.gap / 2 +
    lines(m.engravedTitleSize) +
    m.gap * 1.5 +
    m.controlHeight * 3 +
    m.gap +
    2 +
    24 +
    4 +
    lines(m.smallFontSize) * 2 +
    m.gap +
    m.gap +
    24
  );
}

describe('écran de connexion : dimensions (D-028, paysage)', () => {
  it.each([
    ['petit téléphone', { width: 640, height: 360, safe: safe(12, 6) }],
    ['téléphone standard', { width: 915, height: 412, safe: safe(24, 6) }],
    ['iPhone à encoche', { width: 844, height: 390, safe: safe(47, 21) }],
    ['tablette', { width: 1024, height: 768, safe: safe(12, 20) }],
    ['ordinateur', { width: 1440, height: 900, safe: safe(12, 6) }],
  ])('%s : tout tient sans défiler ni déborder', (_, viewport) => {
    const m = computeLoginMetrics(viewport);
    const availableWidth = viewport.width - viewport.safe.left - viewport.safe.right;
    const availableHeight = viewport.height - viewport.safe.top - viewport.safe.bottom;
    expect(m.panelWidth).toBeLessThanOrEqual(availableWidth);
    expect(m.controlHeight).toBeGreaterThanOrEqual(44);
    expect(panelHeight(m)).toBeLessThanOrEqual(availableHeight);
    // Inscription : panneau large à deux colonnes, jamais plus large que l'écran.
    const wide = computeLoginMetrics(viewport, true);
    expect(wide.panelWidth).toBeLessThanOrEqual(availableWidth);
    expect(wide.panelWidth).toBeGreaterThanOrEqual(m.panelWidth);
  });
});
