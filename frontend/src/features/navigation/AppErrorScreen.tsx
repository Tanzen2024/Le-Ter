import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { tablePalette } from '../../components/table/TableDecor';

/**
 * Écran affiché si un écran plante (erreur JavaScript imprévue) : aucun message d'erreur
 * (D-168), ni phrase, ni trace, ni code ; seulement « Réessayer », qui rouvre l'écran.
 * Volontairement sans police chargée, ni store, ni requête : il doit s'afficher même si le
 * reste de l'application est en panne. La cause n'est journalisée qu'en développement.
 */
export function AppErrorScreen({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    if (__DEV__) console.error('[écran] erreur imprévue', error);
  }, [error]);
  return (
    <View style={styles.root} testID="app-error-screen">
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>Réessayer</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: tablePalette.backdrop,
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: tablePalette.jade,
    borderWidth: 1,
    borderColor: tablePalette.gold,
  },
  pressed: { opacity: 0.8 },
  buttonText: { color: tablePalette.gold, fontSize: 16, fontWeight: '800' },
});
