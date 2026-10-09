import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

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
 * Surface paysage de l'écran. L'application est verrouillée en paysage, mais la fenêtre peut
 * transitoirement être mesurée en portrait (démarrage, rotation) : la surface est donc toujours
 * construite à partir de la grande et de la petite dimension, jamais d'un gabarit portrait.
 */
export function useLandscapeViewport(): LandscapeViewport {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return {
    width: Math.max(width, height),
    height: Math.min(width, height),
    safe: {
      top: Math.max(insets.top, MIN_VERTICAL_MARGIN),
      bottom: Math.max(insets.bottom, MIN_VERTICAL_MARGIN),
      left: Math.max(insets.left, MIN_SIDE_MARGIN),
      right: Math.max(insets.right, MIN_SIDE_MARGIN),
    },
  };
}
