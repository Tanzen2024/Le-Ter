import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { fontOf, useTableFonts } from '../../components/table/TableDecor';
import type { GameView } from '../../types/game';
import { useAppear, useBackToClose } from '../games/table/GameOverlays';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { useGameGeolocation, useScreenActive } from './hooks';

/**
 * Géolocalisation d'une partie surveillée (D-046), posée sur l'écran de jeu. N'affiche que
 * l'explication, une fois par table, avant toute demande de permission native ; la
 * collecte elle-même est invisible et s'arrête dès que l'écran n'est plus actif.
 */
export function GameGeolocation({ game }: { game: GameView }) {
  const active = useScreenActive();
  const { askConsent, accept, decline } = useGameGeolocation({
    gameId: game.gameId,
    tableKey: game.sessionId ?? game.gameId,
    finished: game.status === 'finished',
    active,
  });
  return askConsent ? <LocationConsentDialog onAccept={accept} onDecline={decline} /> : null;
}

export const CONSENT_TITLE = 'Localisation de la partie protégée';

/** Texte d'explication : neutre, jamais accusateur ; le refus est toujours possible. */
export const CONSENT_LINES = [
  'Cette table a activé la détection anti-collusion 🛡️. Pour aider à repérer d’éventuelles ententes entre joueurs, l’application peut utiliser votre position pendant la partie, seulement quand l’écran de jeu est ouvert.',
  'Votre position n’est jamais montrée aux autres joueurs : le serveur calcule seulement les distances entre joueurs.',
  'Les positions sont conservées temporairement, puis supprimées au plus tard 24 h après la fin de la partie.',
  'Vous pouvez refuser : vous continuez à jouer normalement, sans affichage des distances.',
] as const;

export function LocationConsentDialog({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const appear = useAppear();
  useBackToClose(onDecline);
  const buttonHeight = Math.max(40, Math.round(m.controlHeight * 0.85));
  const button = [styles.button, { height: buttonHeight, borderRadius: buttonHeight / 2 }];
  const label = [styles.buttonText, fontOf(fonts.button), { fontSize: m.bodySize * 1.05 }];
  return (
    <View style={[StyleSheet.absoluteFill, styles.veil]}>
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.dialog,
          {
            width: Math.min(Math.max(m.width * 0.5, 300), 560),
            padding: m.gap * 1.4,
            gap: m.gap * 0.8,
            opacity: appear,
          },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={[styles.title, fontOf(fonts.button), { fontSize: m.bodySize * 1.2 }]}
        >
          {CONSENT_TITLE}
        </Text>
        {CONSENT_LINES.map((line) => (
          <Text key={line} style={[styles.text, { fontSize: m.smallSize }]}>
            {line}
          </Text>
        ))}
        <View style={[styles.row, { gap: m.gap * 1.5 }]}>
          <Pressable
            onPress={onDecline}
            accessibilityRole="button"
            style={({ pressed }) => [...button, styles.decline, pressed && styles.pressed]}
          >
            <Text style={label}>NON MERCI</Text>
          </Pressable>
          <Pressable
            onPress={onAccept}
            accessibilityRole="button"
            style={({ pressed }) => [...button, styles.accept, pressed && styles.pressed]}
          >
            <Text style={label}>CONTINUER</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  veil: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  dialog: {
    alignItems: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.4)',
    backgroundColor: 'rgba(18, 10, 6, 0.9)',
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.4)',
  },
  title: { color: '#FFFFFF', textAlign: 'center' },
  text: { color: 'rgba(255, 255, 255, 0.88)' },
  row: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 4 },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  decline: {
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  accept: {
    borderColor: 'rgba(242, 196, 81, 0.5)',
    backgroundColor: 'rgba(242, 196, 81, 0.22)',
  },
  buttonText: { color: '#FFFFFF', letterSpacing: 1 },
});
