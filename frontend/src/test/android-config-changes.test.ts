/// <reference types="jest" />
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Activité Android : les changements de configuration fréquents pendant que le joueur est
 * ailleurs (Réglages, appel téléphonique, SIM et réseau mobile) sont gérés SANS recréer
 * l'activité, donc sans remonter l'application.
 */
const plugin = require('../../plugins/withAndroidSensorLandscape') as {
  withHandledConfigChanges(current?: string): string;
  HANDLED_CONFIG_CHANGES: string[];
};

const EXPO_DEFAULT =
  'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths';

describe('changements de configuration gérés par l’activité', () => {
  it('ajoute réglages, SIM / réseau mobile et saisie, en gardant ceux d’Expo', () => {
    const flags = plugin.withHandledConfigChanges(EXPO_DEFAULT).split('|');
    expect(flags).toEqual(expect.arrayContaining(EXPO_DEFAULT.split('|')));
    for (const flag of ['density', 'fontScale', 'locale', 'mcc', 'mnc', 'navigation', 'touchscreen']) {
      expect(flags).toContain(flag);
    }
  });

  it('aucun doublon, idempotent', () => {
    const once = plugin.withHandledConfigChanges(EXPO_DEFAULT);
    const twice = plugin.withHandledConfigChanges(once);
    expect(twice).toBe(once);
    expect(new Set(once.split('|')).size).toBe(once.split('|').length);
  });

  it('activité sans valeur : seulement les changements gérés', () => {
    expect(plugin.withHandledConfigChanges().split('|')).toEqual(plugin.HANDLED_CONFIG_CHANGES);
  });
});
