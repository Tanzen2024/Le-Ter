import { router } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/ui/Button';
import { colors, spacing } from '../../constants/theme';
import { useCurrentUser } from '../auth/hooks';
import { DetectionSwitchPanel } from './DetectionSwitchPanel';

const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * Administration (route /admin, D-053). Aucun lien depuis l'application joueur. Le rôle est
 * vérifié par le SERVEUR à chaque appel (401 / 403) ; ce contrôle-ci ne sert qu'à
 * l'affichage : un compte non administrateur ne voit aucun réglage et n'appelle aucune route
 * d'administration.
 */
export function AdminScreen() {
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
        <Button title="Retour" variant="link" onPress={back} />
      </View>
    );
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Administration</Text>
      <DetectionSwitchPanel />
      {/* Tournois (D-054) : création, approbation, annulation, paramètres, résultats. */}
      <Button
        title="Tournois"
        variant="secondary"
        onPress={() => router.push('/admin/tournaments')}
      />
      <Button title="Retour" variant="link" onPress={back} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.xl * 2, gap: spacing.lg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  heading: { fontSize: 24, fontWeight: '700', color: colors.text },
  text: { fontSize: 16, color: colors.textMuted },
});
