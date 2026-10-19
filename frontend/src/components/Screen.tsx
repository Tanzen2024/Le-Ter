import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ScreenProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Conteneur racine d'un écran. L'application est en paysage uniquement (D-028) : l'encoche et
 * les coins arrondis sont sur les côtés, donc les marges de sécurité s'appliquent à tous les bords.
 *
 * Les marges viennent du fournisseur racine (`useSafeAreaInsets`), comme pour tous les autres
 * écrans (`useLandscapeViewport`) : elles sont connues dès le premier rendu, alors qu'un
 * `SafeAreaView` natif les recalcule après coup et pouvait décaler le contenu à l'arrivée.
 */
export function Screen({ children, style }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
