import { usePathname } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useAuthStore } from '../../stores/auth-store';
import { ReconnectionPanel } from './ReconnectionPanel';
import { useActiveGameRestorer } from './use-return-to-active-game';

/**
 * Reprise de la partie active au lancement et au retour au premier plan, sur tous les écrans
 * sauf celui d'une partie (qui relit lui-même son état). Le panneau « Reconnexion » ne
 * s'affiche que pendant une recherche réelle sur le serveur.
 */
export function ActiveGameRestorer() {
  const signedIn = useAuthStore((s) => s.status === 'signedIn');
  const pathname = usePathname();
  const { phase, retry, dismiss } = useActiveGameRestorer(signedIn, pathname);
  if (phase === 'idle') return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <ReconnectionPanel
        state={phase}
        onRetry={retry}
        secondary={{ title: 'Continuer', onPress: dismiss }}
      />
    </View>
  );
}
