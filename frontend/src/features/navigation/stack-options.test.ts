/// <reference types="jest" />
import { tablePalette } from '../../components/table/TableDecor';
import { navigationTheme, stableStackScreenOptions } from './stack-options';

describe('options de pile communes', () => {
  it('transition en fondu : aucun glissement ni mise à l’échelle de l’écran', () => {
    expect(stableStackScreenOptions.animation).toBe('fade');
    expect(stableStackScreenOptions.headerShown).toBe(false);
  });

  it('fond opaque couleur table derrière chaque écran', () => {
    expect(stableStackScreenOptions.contentStyle.backgroundColor).toBe(tablePalette.backdrop);
  });

  it('conteneurs de pile couleur table, jamais le gris clair par défaut', () => {
    expect(navigationTheme.colors.background).toBe(tablePalette.backdrop);
    expect(navigationTheme.colors.background).not.toBe('rgb(242, 242, 242)');
  });
});
