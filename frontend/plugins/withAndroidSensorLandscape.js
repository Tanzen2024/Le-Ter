const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

/**
 * Le Ter est en paysage uniquement (docs/decisions.md, D-028).
 *
 * `orientation: "landscape"` d'app.json produit `android:screenOrientation="landscape"`, qui fige
 * un seul sens. `sensorLandscape` garde le verrouillage paysage tout en suivant le capteur entre
 * paysage gauche et paysage droit, comme iOS (LandscapeLeft + LandscapeRight).
 */
module.exports = function withAndroidSensorLandscape(config) {
  return withAndroidManifest(config, (modConfig) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(modConfig.modResults);
    mainActivity.$['android:screenOrientation'] = 'sensorLandscape';
    return modConfig;
  });
};
