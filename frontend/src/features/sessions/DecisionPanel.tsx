import { StyleSheet, Text, View } from 'react-native';

import { tablePalette as palette } from '../../components/table/TableDecor';
import { useServerCountdown } from '../../hooks/use-server-countdown';
import type { SessionView } from '../../types/session';
import { PanelButton } from '../lobby/LobbyUi';

/**
 * Ronde Poursuivre / Quitter (15 s, D-034, D-068), posée sur la table à la fin de la partie : le
 * joueur répond sans changer d'écran. Le compte à rebours est calculé à partir de l'échéance
 * du serveur ; à zéro, l'écran annonce le départ automatique et attend que le serveur
 * l'applique (il ne quitte rien lui-même). La session qui porte la ronde n'est jamais nommée.
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
    <View style={styles.container}>
      <Text style={styles.title}>Poursuivre avec cette table ?</Text>
      {waitingForMe ? (
        secondsLeft ? (
          <>
            <Text style={[styles.countdown, secondsLeft <= 3 && styles.countdownUrgent]}>
              {secondsLeft} s
            </Text>
            <Text style={styles.text}>
              Sans réponse à la fin du compte à rebours, vous quitterez automatiquement la table.
            </Text>
            <View style={styles.row}>
              <PanelButton
                title="Poursuivre"
                loading={pending}
                onPress={() => onDecide('continue')}
              />
              <PanelButton
                title="Quitter"
                tone="danger"
                disabled={pending}
                onPress={() => onDecide('leave')}
              />
            </View>
          </>
        ) : (
          <Text style={styles.text}>Temps écoulé : départ automatique en cours…</Text>
        )
      ) : (
        <Text style={styles.text}>
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
  container: { gap: 4, alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  text: { fontSize: 13, color: 'rgba(255, 255, 255, 0.8)', textAlign: 'center' },
  countdown: { fontSize: 24, fontWeight: '800', color: palette.gold },
  countdownUrgent: { color: palette.error },
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
});
