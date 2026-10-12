import { StyleSheet, Text, View } from 'react-native';

import { useLobbyMetrics } from '../lobby/lobby-metrics';
import type { WithdrawalAvailabilityNotice } from './withdrawal-state';

/**
 * État des retraits annoncé par le serveur (D-077) : indisponibilité motivée, ou bandeau
 * « Mode test » en sandbox. Rien en production.
 */
export function WithdrawalModeNotice({ notice }: { notice: WithdrawalAvailabilityNotice | undefined }) {
  const m = useLobbyMetrics();
  if (!notice) return null;
  if (notice.tone === 'test') {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel={notice.message}
        style={[styles.test, { padding: m.gap * 0.4, marginTop: m.gap * 0.6 }]}
      >
        <Text style={[styles.testTitle, { fontSize: m.smallSize }]}>ENVIRONNEMENT DE TEST</Text>
        <Text style={[styles.text, { fontSize: m.smallSize }]}>{notice.message}</Text>
      </View>
    );
  }
  return (
    <Text style={[styles.text, { fontSize: m.smallSize, marginTop: m.gap * 0.6 }]}>
      {notice.message}
    </Text>
  );
}

const styles = StyleSheet.create({
  test: {
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(242, 196, 81, 0.7)',
    backgroundColor: 'rgba(242, 196, 81, 0.1)',
    alignItems: 'center',
  },
  testTitle: { color: 'rgb(242, 196, 81)', fontWeight: '700', letterSpacing: 1 },
  text: { color: 'rgba(255, 255, 255, 0.78)', textAlign: 'center' },
});
