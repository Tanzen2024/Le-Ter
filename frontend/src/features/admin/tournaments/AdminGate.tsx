import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  return <AdminSafeArea>{children}</AdminSafeArea>;
}

/**
 * Marges de sécurité des écrans d'administration (paysage, D-028) : encoche et coins arrondis
 * sur les côtés, barre gestuelle en bas. Sans elles, le contenu passait sous l'encoche.
 * Connues dès le premier rendu (fournisseur racine) : aucun décalage à l'arrivée.
 */
export function AdminSafeArea({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.safe,
        { paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: insets.bottom },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  text: { fontSize: 16, color: colors.textMuted },
});
