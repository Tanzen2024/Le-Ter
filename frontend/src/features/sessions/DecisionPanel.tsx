import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/ui/Button';
import { colors, radius, spacing } from '../../constants/theme';
import { useServerCountdown } from '../../hooks/use-server-countdown';
import type { SessionView } from '../../types/session';

/**
 * Ronde Poursuivre / Quitter (10 s, D-034), affichée sur l'écran de la session ET sur
 * l'écran de fin de partie : le joueur peut répondre sans changer d'écran. Le compte à
 * rebours est calculé à partir de l'échéance du serveur ; à zéro, l'écran annonce le
 * départ automatique et attend que le serveur l'applique (il ne quitte rien lui-même).
 */
export function DecisionPanel({
  session,
  receivedAt,
  viewerId,
  pending,
  onDecide,
}: {
  session: SessionView;
  receivedAt: number;
  viewerId?: string;
  pending: boolean;
  onDecide: (choice: 'continue' | 'leave') => void;
}) {
  const round = session.decision;
  const secondsLeft = useServerCountdown(round?.deadlineAt, session.serverNow, receivedAt);
  if (!round) {
    return null;
  }
  const mine = round.decisions.find((d) => d.playerId === viewerId)?.choice;
  const waitingForMe = Boolean(viewerId && round.pendingPlayerIds.includes(viewerId));

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Partie terminée : poursuivre ?</Text>
      {waitingForMe ? (
        secondsLeft ? (
          <>
            <Text style={[styles.countdown, secondsLeft <= 3 && styles.countdownUrgent]}>
              {secondsLeft} s
            </Text>
            <Text style={styles.cardText}>
              Sans réponse à la fin du compte à rebours, vous quitterez automatiquement la
              session.
            </Text>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button title="Poursuivre" loading={pending} onPress={() => onDecide('continue')} />
              </View>
              <View style={styles.flex}>
                <Button
                  title="Quitter"
                  variant="secondary"
                  disabled={pending}
                  onPress={() => onDecide('leave')}
                />
              </View>
            </View>
          </>
        ) : (
          <Text style={styles.cardText}>Temps écoulé : départ automatique en cours…</Text>
        )
      ) : (
        <Text style={styles.cardText}>
          {mine === 'continue' ? 'Vous poursuivez. ' : ''}
          En attente de {round.pendingPlayerIds.length} joueur
          {round.pendingPlayerIds.length > 1 ? 's' : ''}
          {secondsLeft ? ` · ${secondsLeft} s` : ' · départs automatiques en cours…'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  cardText: { fontSize: 14, color: colors.text },
  countdown: { fontSize: 32, fontWeight: '800', color: colors.text },
  countdownUrgent: { color: colors.danger },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
