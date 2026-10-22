import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { tablePalette } from '../table/TableDecor';

/**
 * Règle de l'application (D-126) : un composant secondaire ouvert (panneau, boutique, fenêtre
 * de confirmation, sélecteur, avertissement…) est SEUL visible et SEUL interactif jusqu'à sa
 * fermeture. Ce fond plein écran est OPAQUE (le fond de table, sans aucun élément de l'écran
 * précédent), reçoit tous les appuis et masque l'écran du dessous aux lecteurs d'écran.
 *
 * Tout composant secondaire passe par ici : jamais de voile semi-transparent qui laisserait
 * voir ou toucher l'interface précédente.
 *
 * Un appui HORS de la fenêtre n'a aucun effet (D-131) : elle ne se ferme JAMAIS ainsi, mais
 * seulement par son propre bouton (X, Annuler, Valider…) ou le bouton retour d'Android.
 */
export function ExclusiveOverlay({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  /** Marges (zones sûres…) et alignement du contenu. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[StyleSheet.absoluteFill, styles.backdrop, style]}
      accessibilityViewIsModal
    >
      {/* Le fond capte tous les appuis HORS de la fenêtre : rien de l'écran du dessous ne reste
          touchable. Couche SŒUR placée derrière le contenu, jamais son parent : un appui dans
          la fenêtre (libellé, cadre, texte) ne lui remonte pas et le défilement de la fenêtre
          fonctionne où que commence le geste (D-132). */}
      <View
        testID={testID ? `${testID}-blocker` : undefined}
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => true}
        importantForAccessibility="no"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    zIndex: 100,
    elevation: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tablePalette.backdrop,
    experimental_backgroundImage:
      'radial-gradient(ellipse at center, #C25E14 0%, #8E2512 30%, #5A0E0B 58%, #240504 100%)',
  },
});
