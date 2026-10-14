import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { fontOf, useTableFonts } from '../../components/table/TableDecor';
import type { GameView } from '../../types/game';
import { useAppear, useBackToClose } from '../games/table/GameOverlays';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { ApiError } from '../../lib/api-client';
import { useDeclineAndLeave, useGameGeolocation, useScreenActive } from './hooks';

/**
 * Géolocalisation d'une partie surveillée (D-046, D-095), posée sur l'écran de jeu.
 * L'explication est BLOQUANTE tant que le serveur n'a pas enregistré le consentement du
 * joueur pour sa place à la table : « Continuer » l'enregistre (puis la permission système
 * est demandée), « Non merci » fait quitter la table et ouvre la création de partie. La collecte
 * elle-même est invisible et s'arrête dès que l'écran n'est plus actif.
 */
export function GameGeolocation({ game }: { game: GameView }) {
  const active = useScreenActive();
  const { askConsent, accept, accepting, acceptError } = useGameGeolocation({
    gameId: game.gameId,
    tableKey: game.sessionId ?? game.gameId,
    finished: game.status === 'finished',
    active,
  });
  const departure = useDeclineAndLeave(game);
  if (!askConsent) return null;
  return (
    <LocationConsentDialog
      onAccept={accept}
      onDecline={() => void departure.decline()}
      accepting={accepting}
      leaving={departure.leaving}
      error={departure.error ?? (acceptError ? consentFailureMessage(acceptError) : null)}
    />
  );
}

/** Consentement non confirmé par le serveur : jamais présenté comme accepté. */
export function consentFailureMessage(error: unknown): string {
  if (error instanceof ApiError && error.status !== 0) return error.message;
  const cause = error instanceof ApiError ? ` ${error.message}` : '';
  return `Votre choix n’est pas enregistré.${cause} Réessayez.`;
}

export const CONSENT_TITLE = 'Localisation de la partie protégée';

/** Texte d'explication : neutre, jamais accusateur ; le refus est toujours possible. */
export const CONSENT_LINES = [
  'Cette table a activé la détection anti-collusion 🛡️. Pour aider à repérer d’éventuelles ententes entre joueurs, l’application peut utiliser votre position pendant la partie, seulement quand l’écran de jeu est ouvert.',
  'Votre position n’est jamais montrée aux autres joueurs : le serveur calcule seulement les distances entre joueurs.',
  'Les positions sont conservées temporairement, puis supprimées au plus tard 24 h après la fin de la partie.',
  'Vous pouvez refuser : vous quittez alors cette table et revenez à la création de partie, pour créer ou rejoindre une partie sans cette fonctionnalité.',
] as const;

/** Retour Android : sans effet, le choix doit être explicite (jamais un départ par mégarde). */
const ignoreBack = () => undefined;

export function LocationConsentDialog({
  onAccept,
  onDecline,
  accepting = false,
  leaving = false,
  error = null,
}: {
  onAccept: () => void;
  onDecline: () => void;
  /** Consentement en cours d'enregistrement. */
  accepting?: boolean;
  /** Départ de la table en cours. */
  leaving?: boolean;
  /** Échec du dernier choix : le panneau reste affiché, le bouton réessaie. */
  error?: string | null;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const appear = useAppear();
  useBackToClose(ignoreBack);
  const busy = accepting || leaving;
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
        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
            {error}
          </Text>
        ) : null}
        <View style={[styles.row, { gap: m.gap * 1.5 }]}>
          <Pressable
            onPress={onDecline}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="NON MERCI"
            accessibilityState={{ disabled: busy, busy: leaving }}
            style={({ pressed }) => [
              ...button,
              styles.decline,
              pressed && styles.pressed,
              busy && !leaving && styles.idle,
            ]}
          >
            {leaving ? (
              <ActivityIndicator testID="consent-leaving" color="#FFFFFF" />
            ) : (
              <Text style={label}>NON MERCI</Text>
            )}
          </Pressable>
          <Pressable
            onPress={onAccept}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="CONTINUER"
            accessibilityState={{ disabled: busy, busy: accepting }}
            style={({ pressed }) => [
              ...button,
              styles.accept,
              pressed && styles.pressed,
              busy && !accepting && styles.idle,
            ]}
          >
            {accepting ? (
              <ActivityIndicator testID="consent-accepting" color="#FFFFFF" />
            ) : (
              <Text style={label}>CONTINUER</Text>
            )}
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  idle: { opacity: 0.5 },
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
  error: { color: '#FFB4A8', textAlign: 'center' },
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
