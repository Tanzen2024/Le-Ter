import { DefaultTheme, type Theme } from 'expo-router';

import { tablePalette } from '../../components/table/TableDecor';

/**
 * Options communes à TOUTES les piles (racine et connexion) : un seul comportement de
 * transition dans l'application.
 *
 * - `animation: 'fade'` : l'animation Android par défaut de react-native-screens déplace les
 *   deux écrans (glissement de 10 % de la largeur sur 450 ms à partir d'Android 13, mise à
 *   l'échelle 0,85 → 1 avant) : l'écran semblait « bouger » puis se recaler. Le fondu affiche
 *   le nouvel écran directement à sa position finale, sans changer sa taille.
 * - `contentStyle` : fond opaque couleur table derrière chaque écran, pour qu'aucune autre
 *   couleur ne transparaisse pendant le fondu ou avant le premier rendu de l'écran.
 */
export const stableStackScreenOptions = {
  headerShown: false,
  animation: 'fade',
  contentStyle: { backgroundColor: tablePalette.backdrop },
} as const;

/**
 * Thème de navigation : le fond des conteneurs de pile est celui de la table, et non le gris
 * clair par défaut qui apparaissait en éclair pendant les transitions.
 */
export const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: tablePalette.backdrop },
};
