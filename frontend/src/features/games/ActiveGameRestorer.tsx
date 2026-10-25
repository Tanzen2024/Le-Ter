import { usePathname } from 'expo-router';

import { useAuthStore } from '../../stores/auth-store';
import { ConnectionIndicator } from './ConnectionIndicator';
import { useLongPendingAction } from './use-long-pending-action';
import { useActiveGameRestorer } from './use-return-to-active-game';

/**
 * Reprise de la partie active au lancement et au retour au premier plan, sur tous les écrans
 * sauf celui d'une partie (qui relit lui-même son état et affiche son propre indicateur).
 * L'indicateur flottant (D-152) se pose au-dessus de l'écran courant, qui reste en place et
 * utilisable : « Reconnexion en cours… » pendant une recherche réelle sur le serveur,
 * « Traitement en cours… » pendant une action longue.
 */
export function ActiveGameRestorer() {
  const signedIn = useAuthStore((s) => s.status === 'signedIn');
  const pathname = usePathname();
  const { phase, retry, dismiss } = useActiveGameRestorer(signedIn, pathname);
  const longAction = useLongPendingAction();
  const onGame = pathname.startsWith('/game/');
  const status = phase !== 'idle' ? phase : longAction && !onGame ? 'pending' : null;
  return (
    <ConnectionIndicator
      status={status}
      onRetry={retry}
      secondary={{ title: 'Continuer', onPress: dismiss }}
    />
  );
}
