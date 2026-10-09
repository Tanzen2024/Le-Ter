import type { DetectionGlobalSwitch } from '../../src/services/detection/detection-settings.service';

/**
 * Interrupteur global (D-053) ACTIVÉ, pour les tests des étapes 1 à 5 : ils vérifient les
 * analyses, scores et alertes, pas l'interrupteur (testé dans detection-global-switch).
 */
export const GLOBAL_DETECTION_ON: DetectionGlobalSwitch = {
  isGloballyEnabled: () => Promise.resolve(true),
};
