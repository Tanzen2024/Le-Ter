const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

/**
 * Changements de configuration gérés par l'activité elle-même au lieu de la RECRÉER. Une
 * activité recréée remonte toute l'arborescence React : pile de navigation perdue, écrans et
 * panneaux refermés, ce qui ressemble à un redémarrage au retour dans Le Ter. Ceux-ci arrivent
 * typiquement pendant que le joueur est dans une autre application :
 * - Réglages : taille du texte, taille d'affichage, langue ;
 * - appel téléphonique, carte SIM, réseau mobile (`mcc`, `mnc` : téléphones double SIM,
 *   changement d'opérateur ou de réseau enregistré) ;
 * - matériel de saisie (`navigation`, `touchscreen`).
 * React Native les applique sans recréation (dimensions, échelle de police relues) ; Le Ter n'a
 * aucune ressource propre à un opérateur, un pays de SIM ou un type d'écran tactile.
 */
const HANDLED_CONFIG_CHANGES = [
  'density',
  'fontScale',
  'locale',
  'layoutDirection',
  'mcc',
  'mnc',
  'navigation',
  'touchscreen',
];

function withHandledConfigChanges(current = '') {
  const flags = current.split('|').filter(Boolean);
  for (const flag of HANDLED_CONFIG_CHANGES) {
    if (!flags.includes(flag)) flags.push(flag);
  }
  return flags.join('|');
}

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
    mainActivity.$['android:configChanges'] = withHandledConfigChanges(
      mainActivity.$['android:configChanges'],
    );
    return modConfig;
  });
};

module.exports.withHandledConfigChanges = withHandledConfigChanges;
module.exports.HANDLED_CONFIG_CHANGES = HANDLED_CONFIG_CHANGES;
