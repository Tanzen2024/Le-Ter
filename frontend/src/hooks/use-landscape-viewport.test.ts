/// <reference types="jest" />
import { viewportSize } from './use-landscape-viewport';

/** Surface de jeu : la vue racine réellement disponible, toujours en paysage. */

describe('taille de la surface de jeu', () => {
  it('vue racine plus courte que la fenêtre (barre d’état Android) : la vue racine', () => {
    // Fenêtre 897 × 393 dp, mais la vue commence sous la barre d'état (36 dp).
    expect(viewportSize({ width: 897, height: 357 }, { width: 897, height: 393 })).toEqual({
      width: 897,
      height: 357,
    });
  });

  it('vue racine = fenêtre (bord à bord) : inchangé', () => {
    expect(viewportSize({ width: 897, height: 393 }, { width: 897, height: 393 })).toEqual({
      width: 897,
      height: 393,
    });
  });

  it('mesure en portrait (démarrage, rotation) : toujours largeur > hauteur', () => {
    expect(viewportSize({ width: 393, height: 897 }, { width: 393, height: 897 })).toEqual({
      width: 897,
      height: 393,
    });
  });

  it('vue pas encore mesurée : repli sur la fenêtre', () => {
    expect(viewportSize({ width: 0, height: 0 }, { width: 897, height: 393 })).toEqual({
      width: 897,
      height: 393,
    });
  });
});
