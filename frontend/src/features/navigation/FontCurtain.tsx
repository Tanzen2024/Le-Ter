import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { tablePalette, useTableFontsSettled } from '../../components/table/TableDecor';

/** Polices lentes ou en échec : l'interface s'affiche quand même, en police de repli. */
export const FONT_CURTAIN_MAX_MS = 2_000;

/**
 * Voile du démarrage à froid : couvre l'interface (fond de la table) tant que les polices
 * Cinzel et Rajdhani ne sont pas prêtes. Sans lui, le premier écran (connexion, accueil)
 * apparaissait en police système puis changeait de largeur de texte une fois les polices
 * chargées : titres, boutons et colonnes semblaient bouger. La pile reste montée dessous
 * (liens et reprises inchangés) ; une fois les polices chargées, il ne revient jamais.
 */
export function FontCurtain() {
  const settled = useTableFontsSettled();
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (settled) return;
    const timer = setTimeout(() => setExpired(true), FONT_CURTAIN_MAX_MS);
    return () => clearTimeout(timer);
  }, [settled]);

  if (settled || expired) return null;
  return <View style={styles.curtain} testID="font-curtain" />;
}

const styles = StyleSheet.create({
  curtain: { ...StyleSheet.absoluteFill, backgroundColor: tablePalette.backdrop },
});
