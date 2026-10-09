import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';

import { colors, radius, spacing } from '../../constants/theme';
import { useDetectionSetting, useSetDetection } from './hooks';

/**
 * Interrupteur GLOBAL de la détection anti-collusion (D-053), réservé à l'administration.
 * L'interrupteur reflète uniquement la valeur confirmée par le serveur.
 */
export function DetectionSwitchPanel() {
  const setting = useDetectionSetting();
  const change = useSetDetection();
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  const onChange = (enabled: boolean) => {
    setMessage(null);
    change.mutate(enabled, {
      onSuccess: (result) =>
        setMessage({
          text: result.enabled
            ? 'Détection anti-collusion activée.'
            : 'Détection anti-collusion désactivée.',
          error: false,
        }),
      onError: () =>
        setMessage({
          text: "Le changement n'a pas pu être enregistré.",
          error: true,
        }),
    });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Détection anti-collusion</Text>
      {setting.isPending ? (
        <ActivityIndicator color={colors.feltLight} />
      ) : setting.isError ? (
        <Text style={styles.error}>Statut indisponible.</Text>
      ) : (
        <View style={styles.row}>
          <Text style={styles.status}>
            Statut : {setting.data.enabled ? 'Activée' : 'Désactivée'}
          </Text>
          <Switch
            accessibilityLabel="Détection anti-collusion"
            value={setting.data.enabled}
            disabled={change.isPending}
            onValueChange={onChange}
            trackColor={{ false: colors.border, true: colors.feltLight }}
            thumbColor={colors.surface}
          />
        </View>
      )}
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={message.error ? styles.error : styles.confirmation}
        >
          {message.text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  status: { fontSize: 16, color: colors.text },
  confirmation: { color: colors.success },
  error: { color: colors.danger },
});
