/// <reference types="jest" />
import { formPaneWidth, sideMetrics } from './AuthScreen';

describe('formPaneWidth (paysage)', () => {
  it('donne 65 % de la largeur utile au formulaire quand l’écran est assez large', () => {
    expect(formPaneWidth(820)).toBe(533);
    expect(formPaneWidth(1200)).toBe(780);
  });

  it('laisse à la présentation sa largeur minimale lisible sur un paysage étroit', () => {
    expect(formPaneWidth(560)).toBe(360);
  });

  it('ne réduit jamais le formulaire sous la moitié', () => {
    expect(formPaneWidth(300)).toBe(150);
  });
});

describe('sideMetrics', () => {
  it('agrandit la présentation avec sa largeur, dans des bornes lisibles', () => {
    const phone = sideMetrics(287);
    expect(phone.monogram).toBe(49);
    expect(phone.title).toBe(26);
    const narrow = sideMetrics(120);
    expect(narrow.monogram).toBe(40);
    expect(narrow.title).toBe(22);
    const tablet = sideMetrics(900);
    expect(tablet.monogram).toBe(64);
    expect(tablet.title).toBe(36);
  });
});
