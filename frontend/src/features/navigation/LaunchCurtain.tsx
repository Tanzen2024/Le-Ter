import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { tablePalette } from '../../components/table/TableDecor';
import { useAuthStore } from '../../stores/auth-store';
import { isLaunchSettled, onLaunchSettled } from './last-route';

/** Le temps que l'écran rouvert (ou la partie reprise) soit dessiné sous le rideau. */
export const LAUNCH_CURTAIN_SETTLE_DELAY_MS = 300;
/** Serveur lent ou injoignable : le rideau se lève quand même (Reconnexion visible). */
export const LAUNCH_CURTAIN_MAX_MS = 8_000;

/**
 * Rideau de relancement. Quand Android a détruit le processus (ou recréé l'activité) pendant
 * que le joueur était dans une autre application, l'arborescence React repart de l'accueil :
 * sans rideau, le joueur verrait l'accueil, le panneau « Reconnexion », puis l'écran qu'il
 * avait laissé glisser par-dessus, comme un redémarrage. Le rideau couvre cette reconstruction
 * et se lève une fois le dernier écran (ou la partie active) rouvert.
 *
 * Il n'existe qu'au montage de la racine : un simple retour au premier plan ne remonte rien
 * et ne l'affiche jamais. Déconnecté, il se lève aussitôt (écran de connexion).
 */
export function LaunchCurtain() {
  const status = useAuthStore((s) => s.status);
  const settled = useSyncExternalStore(onLaunchSettled, isLaunchSettled, isLaunchSettled);
  const [lifted, setLifted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLifted(true), LAUNCH_CURTAIN_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  // Déconnecté : levé pour de bon (une reconnexion ne le ramène pas).
  if (status === 'signedOut' && !lifted) setLifted(true);

  useEffect(() => {
    if (!settled) return;
    const timer = setTimeout(() => setLifted(true), LAUNCH_CURTAIN_SETTLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [settled]);

  if (lifted) return null;
  return (
    <View style={styles.curtain} testID="launch-curtain">
      <ActivityIndicator color={tablePalette.gold} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  curtain: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tablePalette.backdrop,
  },
});
