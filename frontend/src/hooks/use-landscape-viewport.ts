import { useWindowDimensions } from 'react-native';
import {
  useSafeAreaFrame,
  useSafeAreaInsets,
  type EdgeInsets,
} from 'react-native-safe-area-context';

/** Marges minimales, même sur un appareil sans encoche ni barre gestuelle. */
const MIN_SIDE_MARGIN = 12;
const MIN_VERTICAL_MARGIN = 6;

export interface LandscapeViewport {
  /** Grande dimension de la fenêtre : toujours la largeur logique (D-028, paysage uniquement). */
  width: number;
  /** Petite dimension de la fenêtre : toujours la hauteur logique. */
  height: number;
  /** Marges de sécurité effectives (encoche, coins arrondis, barres système, marges minimales). */
  safe: EdgeInsets;
}

/**
 * Taille réellement disponible : celle de la vue racine (`useSafeAreaFrame`), pas celle de la
 * fenêtre. Sur Android, la fenêtre peut compter la barre d'état alors que la vue racine commence
 * sous elle : tout serait alors dessiné ~36 dp trop bas et le bas de l'écran (main, plaque du
 * joueur, boutons) sortirait de l'écran. Repli sur la fenêtre tant que la vue n'est pas mesurée.
 */
export function viewportSize(
  frame: { width: number; height: number },
  window: { width: number; height: number },
): { width: number; height: number } {
  const measured = frame.width > 0 && frame.height > 0;
  const { width, height } = measured ? frame : window;
  return { width: Math.max(width, height), height: Math.min(width, height) };
}

/**
 * Surface paysage de l'écran. L'application est verrouillée en paysage, mais la fenêtre peut
 * transitoirement être mesurée en portrait (démarrage, rotation) : la surface est donc toujours
 * construite à partir de la grande et de la petite dimension, jamais d'un gabarit portrait.
 */
export function useLandscapeViewport(): LandscapeViewport {
  const window = useWindowDimensions();
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  return {
    ...viewportSize(frame, window),
    safe: {
      top: Math.max(insets.top, MIN_VERTICAL_MARGIN),
      bottom: Math.max(insets.bottom, MIN_VERTICAL_MARGIN),
      left: Math.max(insets.left, MIN_SIDE_MARGIN),
      right: Math.max(insets.right, MIN_SIDE_MARGIN),
    },
  };
}
