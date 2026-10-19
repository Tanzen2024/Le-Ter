/// <reference types="jest" />
import { cleanup, render, screen, within } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';

import { cardLabel } from '../format';
import {
  CARD_RATIO,
  CardBack,
  CardFace,
  CENTER_GLYPH_ORIGIN,
  CENTER_PIP_DRAW_LINE,
  centerPipText,
  FACE_CORNER,
  FACE_MIN_GAP,
  faceLayout,
  SUIT_GLYPH_SCALE,
  SUIT_PIP_COLORS,
  SUIT_STYLES,
} from './Cards';
import { CardGallery } from './CardGallery';

/**
 * Face visible des cartes, modèle de la planche de référence : valeur en haut à gauche, petit
 * symbole dessous, espace net, grand symbole centré en bas ; couleurs par famille ; rendu
 * proportionnel à la largeur fournie par la table (aucune dimension imposée).
 */
const hidden = { includeHiddenElements: true };
const ANTHRACITE = '#1E2125';
const RED = '#D3202A';
const SPADE_PIP = '#08090B';
const CLUB_PIP = '#6A7079';

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

describe('familles', () => {
  it.each([
    ['PIQUE', '♠', ANTHRACITE, SPADE_PIP],
    ['COEUR', '♥', RED, RED],
    ['TREFLE', '♣', ANTHRACITE, CLUB_PIP],
    ['ETOILE', '★', RED, RED],
  ] as const)('%s : symbole %s, valeur %s, symboles %s', async (suit, symbol, color, pipColor) => {
    expect(SUIT_STYLES[suit]).toEqual({ symbol, color });
    await render(<CardFace cardId={`${suit}-7`} width={80} />);
    expect(screen.getByText('7')).toHaveStyle({ color });
    const pips = screen.getAllByText(symbol, hidden);
    expect(pips).toHaveLength(2);
    for (const pip of pips) expect(pip).toHaveStyle({ color: pipColor });
    expect(screen.getByLabelText(cardLabel(`${suit}-7`))).toBeTruthy();
  });

  it('symboles du pique noir foncé, du trèfle noir léger ; fond identique', async () => {
    expect(SUIT_PIP_COLORS).toEqual({ PIQUE: SPADE_PIP, TREFLE: CLUB_PIP });
    const backgrounds: string[] = [];
    for (const [cardId, symbol, pipColor] of [
      ['PIQUE-5', '♠', SPADE_PIP],
      ['TREFLE-5', '♣', CLUB_PIP],
    ] as const) {
      await render(<CardFace cardId={cardId} width={80} />);
      for (const pip of screen.getAllByText(symbol, hidden)) expect(pip).toHaveStyle({ color: pipColor });
      expect(screen.getByText('5')).toHaveStyle({ color: ANTHRACITE });
      backgrounds.push(JSON.stringify(screen.toJSON()).replace(/[♠♣]|#08090B|#6A7079|TREFLE|PIQUE|Pique|Trèfle/g, ''));
      await cleanup();
    }
    expect(backgrounds[0]).toBe(backgrounds[1]);
  });
});

describe('valeurs', () => {
  it.each(['A', '2', '5', '10', 'J', 'Q', 'K', '3', '9'])(
    'valeur %s affichée telle quelle dans le coin (aucune transformation)',
    async (value) => {
      await render(<CardFace cardId={`PIQUE-${value}`} width={80} />);
      const corner = screen.getByTestId('card-corner');
      expect(within(corner).getByText(value)).toHaveStyle({
        fontSize: 80 * (value.length > 1 ? FACE_CORNER.valueLong : FACE_CORNER.value),
      });
    },
  );
});

describe('étoiles agrandies (famille ★ seulement)', () => {
  it('les deux étoiles d’une carte ★ sont agrandies, sans toucher à la mise en page', async () => {
    await render(<CardFace cardId="ETOILE-8" width={80} />);
    const pips = screen.getAllByText('★', hidden);
    expect(pips).toHaveLength(2);
    for (const pip of pips) {
      expect(StyleSheet.flatten(pip.props.style).transform).toEqual([
        { scale: SUIT_GLYPH_SCALE.ETOILE },
      ]);
    }
    // Grand symbole : agrandi depuis le bas de sa boîte (il remonte, même taille) ; jamais
    // coupé par le bord bas. Petit symbole du coin : autour de son centre, inchangé.
    expect(StyleSheet.flatten(pips[1]!.props.style).transformOrigin).toBe(CENTER_GLYPH_ORIGIN);
    expect(StyleSheet.flatten(pips[0]!.props.style).transformOrigin).toBeUndefined();
    expect(SUIT_GLYPH_SCALE.ETOILE).toBeGreaterThan(1);
    // Tailles de police et positions inchangées (même géométrie que les autres familles).
    const { pipSize, centerSize } = faceLayout(80);
    expect(pips[0]).toHaveStyle({ fontSize: pipSize });
    expect(pips[1]).toHaveStyle({ fontSize: centerSize });
  });

  it.each(['PIQUE', 'COEUR', 'TREFLE'])('%s : symboles non agrandis', async (suit) => {
    await render(<CardFace cardId={`${suit}-8`} width={80} />);
    const symbol = SUIT_STYLES[suit]!.symbol;
    for (const pip of screen.getAllByText(symbol, hidden)) {
      expect(StyleSheet.flatten(pip.props.style).transform).toBeUndefined();
    }
  });
});

describe('grand symbole jamais rogné en haut (Android)', () => {
  it('Android : ligne plus haute, boîte décalée de la moitié ajoutée, dessin au même endroit', () => {
    for (const size of [20, 44, 66.6, 90]) {
      const { lineHeight, shift } = centerPipText(size, 'android');
      // Place au-dessus de la ligne de base : la moitié de la hauteur ajoutée en plus.
      expect(lineHeight).toBeCloseTo(size * CENTER_PIP_DRAW_LINE);
      expect(lineHeight).toBeGreaterThan(size * 1.05);
      // Ligne de base inchangée : la boîte descend d'autant que la ligne de base monterait.
      expect(shift).toBeCloseTo((lineHeight - size * 1.05) / 2);
    }
  });

  it('iOS et web : rien ne change', () => {
    expect(centerPipText(80, 'ios')).toEqual({ lineHeight: 80 * 1.05, shift: 0 });
    expect(centerPipText(80, 'web')).toEqual({ lineHeight: 80 * 1.05, shift: 0 });
  });

  it('petit ♣ du coin, Android : ligne plus haute, hauteur occupée dans le coin inchangée', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await render(<CardFace cardId="TREFLE-8" width={80} />);
    const { pipSize } = faceLayout(80);
    const pip = within(screen.getByTestId('card-corner')).getByText('♣');
    const style = StyleSheet.flatten(pip.props.style);
    expect(style.lineHeight).toBeCloseTo(pipSize * CENTER_PIP_DRAW_LINE);
    // Marges négatives : la place ajoutée est rendue, le coin ne bouge pas.
    expect(style.lineHeight + 2 * style.marginVertical).toBeCloseTo(pipSize * 1.05);
  });

  it('petit symbole du coin, iOS : hauteur de ligne habituelle, aucune marge', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await render(<CardFace cardId="TREFLE-8" width={80} />);
    const { pipSize } = faceLayout(80);
    const style = StyleSheet.flatten(
      within(screen.getByTestId('card-corner')).getByText('♣').props.style,
    );
    expect(style.lineHeight).toBeCloseTo(pipSize * 1.05);
    expect(style.marginVertical).toBeCloseTo(0);
  });
});

describe('mise en page', () => {
  it('coin : valeur puis petit symbole ; grand symbole seul, centré, en bas', async () => {
    await render(<CardFace cardId="COEUR-5" width={90} />);
    const corner = screen.getByTestId('card-corner');
    const [valueText, pip] = within(corner).getAllByText(/^(5|♥)$/);
    expect(valueText!.props.children).toBe('5');
    expect(pip!.props.children).toBe('♥');
    expect(corner).toHaveStyle({ top: 90 * FACE_CORNER.top, left: 90 * FACE_CORNER.left });
    expect(screen.getByTestId('card-center-pip', hidden)).toHaveStyle({
      bottom: 90 * FACE_CORNER.centerBottom,
      left: 0,
      right: 0,
      alignItems: 'center',
    });
    // Taille normale de la référence aux tailles courantes.
    expect(faceLayout(90).centerSize).toBe(90 * FACE_CORNER.center);
  });

  it('espace net entre le petit symbole et le grand, à toutes les tailles utilisées', () => {
    for (const width of [20, 24, 32, 44, 60, 72, 90, 120]) {
      for (const longValue of [false, true]) {
        const l = faceLayout(width, longValue);
        expect(l.height).toBe(width * CARD_RATIO);
        // Proportionnel : au moins 10 % de la largeur, jamais un chevauchement.
        expect(l.gap).toBeGreaterThanOrEqual(width * FACE_MIN_GAP - 1e-9);
        // Rien ne sort de la carte : grand symbole dans la hauteur et la largeur.
        expect(l.centerTop).toBeGreaterThan(0);
        expect(l.centerTop + l.centerSize * 1.05 + width * FACE_CORNER.centerBottom).toBeCloseTo(
          l.height,
        );
        expect(l.centerSize * 0.8).toBeLessThan(width);
        // Coin : la valeur la plus large (« 10 ») tient dans la largeur de la carte.
        expect(width * FACE_CORNER.left + l.valueSize * 1.2).toBeLessThan(width);
      }
    }
  });

  it('fond texturé vectoriel et double contour clair, sans image chargée', async () => {
    await render(<CardFace cardId="TREFLE-10" width={60} />);
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain('"brushRef":"faceFill"');
    expect(json).toContain('"brushRef":"faceLozenges"');
    expect(json).not.toContain('"uri"');
  });
});

describe('dos inchangé', () => {
  it('le dos garde son dessin bleu (tissage, monogramme)', async () => {
    await render(<CardBack width={40} />);
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain('"brushRef":"backFill"');
    expect(json).toContain('"brushRef":"backWeave"');
    expect(json).not.toContain('faceLozenges');
  });
});

describe('planche de comparaison', () => {
  it('4 familles × valeurs de la référence et du Ter, avec le composant réel', async () => {
    await render(<CardGallery />);
    // 4 × 9 (référence) + 4 × 8 (Ter) + 5 tailles d’étoile.
    expect(screen.getAllByTestId('card-face')).toHaveLength(4 * 9 + 4 * 8 + 5);
    expect(screen.getAllByLabelText(cardLabel('PIQUE-A')).length).toBeGreaterThan(0);
  });
});
