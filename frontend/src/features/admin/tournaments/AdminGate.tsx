import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../components/ui/Button';
import { colors, spacing } from '../../../constants/theme';
import { useCurrentUser } from '../../auth/hooks';

export const adminBack = (fallback = '/admin') =>
  router.canGoBack() ? router.back() : router.replace(fallback as never);

/**
 * Accès aux écrans d'administration : rôle `admin` existant (D-049). Contrôle d'AFFICHAGE
 * seulement : le serveur revérifie le rôle à chaque appel (401 / 403). Un compte joueur ne
 * voit rien et n'appelle aucune route d'administration.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  if (user.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.feltLight} />
      </View>
    );
  }
  if (user.data?.role !== 'admin') {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Page indisponible.</Text>
        <Button title="Retour" variant="link" onPress={() => adminBack('/')} />
      </View>
    );
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  text: { fontSize: 16, color: colors.textMuted },
});
