import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { tablePalette } from '../src/components/table/TableDecor';
import { HomeScreen } from '../src/features/lobby/HomeScreen';
import { useAuthStore } from '../src/stores/auth-store';

/**
 * Accueil connecté (D-028, paysage) : choix du mode Privé ou Tournois, HUD, Profil et
 * Réglages. Sans session, retour à la connexion (R-10, aucun mode invité).
 */
export default function Home() {
  const status = useAuthStore((s) => s.status);

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tablePalette.gold} size="large" />
      </View>
    );
  }
  if (status === 'signedOut') {
    return <Redirect href="/login" />;
  }
  return <HomeScreen />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tablePalette.backdrop,
  },
});
