import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette, useTableFonts } from '../../components/table/TableDecor';
import { ExclusiveOverlay } from '../../components/ui/ExclusiveOverlay';
import { PanelButton } from '../lobby/LobbyUi';
import { useLobbyMetrics } from '../lobby/lobby-metrics';

/** Restauration en cours, ou échec durable (le serveur reste injoignable). */
export type ReconnectionState = 'restoring' | 'failed';

export const RECONNECTION_TITLE = 'Reconnexion';
export const RECONNECTION_MESSAGE = 'Veuillez patienter pendant la reconnexion.';
export const RECONNECTION_FAILED_MESSAGE =
  'La connexion n’est pas encore rétablie. Votre partie continue sur le serveur.';

/**
 * Panneau « Reconnexion » posé sur l'écran courant : voile sombre, panneau vert profond au
 * centre. Il est piloté par un état RÉEL de restauration (relecture de la partie, recherche
 * de la partie active), jamais par une durée. Le voile capte les appuis : rien en dessous ne
 * peut être touché pendant la restauration. En cas d'échec durable, « Réessayer » relance la
 * lecture ; la partie, elle, continue côté serveur quoi qu'il arrive.
 */
export function ReconnectionPanel({
  state,
  onRetry,
  secondary,
}: {
  state: ReconnectionState;
  onRetry?: () => void;
  /** Action de repli en cas d'échec (ex. continuer vers l'accueil). */
  secondary?: { title: string; onPress: () => void };
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const insets = m.safe;
  const failed = state === 'failed';
  const width = Math.min(m.availableWidth - 32, 420);
  return (
    <ExclusiveOverlay
      style={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 16,
        paddingLeft: insets.left + 16,
        paddingRight: insets.right + 16,
      }}
      testID="reconnection-panel"
    >
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.panel, { width, padding: m.gap * 1.25, gap: m.gap * 0.75 }]}
      >
        <Text style={[styles.title, fontOf(fonts.button), { fontSize: m.panelTitleSize }]}>
          {RECONNECTION_TITLE}
        </Text>
        <Text style={[styles.message, fontOf(fonts.button), { fontSize: m.bodySize }]}>
          {failed ? RECONNECTION_FAILED_MESSAGE : RECONNECTION_MESSAGE}
        </Text>
        {failed ? (
          <View style={[styles.actions, { gap: m.gap * 0.5 }]}>
            {onRetry ? <PanelButton title="Réessayer" onPress={onRetry} /> : null}
            {secondary ? (
              <PanelButton title={secondary.title} tone="danger" onPress={secondary.onPress} />
            ) : null}
          </View>
        ) : (
          <ActivityIndicator color={tablePalette.cream} accessibilityLabel="Reconnexion en cours" />
        )}
      </View>
    </ExclusiveOverlay>
  );
}

const styles = StyleSheet.create({
  panel: {
    maxWidth: '100%',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    backgroundColor: '#0D3A2D',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  title: { color: tablePalette.cream, textAlign: 'center', letterSpacing: 0.5 },
  message: { color: tablePalette.cream, textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
});
