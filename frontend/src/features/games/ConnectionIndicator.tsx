import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { fontOf, tablePalette, useTableFonts } from '../../components/table/TableDecor';
import { gameTheme, salon } from '../../constants/theme';
import { PanelButton } from '../lobby/LobbyUi';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { useReducedMotion } from './table/turn-signal';

/**
 * Action longue en attente, reconnexion en cours, ou échec durable (serveur injoignable).
 * `null` : rien à signaler.
 */
export type ConnectionStatus = 'pending' | 'restoring' | 'failed';

export const PENDING_MESSAGE = 'Traitement en cours…';
export const RECONNECTION_MESSAGE = 'Reconnexion en cours…';
export const RECONNECTION_FAILED_MESSAGE =
  'La connexion n’est pas encore rétablie. Votre partie continue sur le serveur.';

/**
 * Attente imperceptible : l'indicateur n'apparaît que si l'état dure au-delà (un échec
 * durable, lui, s'affiche aussitôt). Seuil de perception, jamais une durée de progression.
 */
export const CONNECTION_REVEAL_DELAY_MS = 400;
const FADE_MS = 180;
/** Un tour de l'icône de synchronisation : lent, discret. */
const SPIN_MS = 1_800;
/** Un passage du segment de la barre de chargement. */
const PROGRESS_MS = 1_300;

/**
 * Indicateur de latence et de reconnexion (D-152, D-155), au CENTRE de l'écran courant : une
 * carte OPAQUE, jamais posée en transparence sur un autre texte ; autour d'elle, l'écran reste
 * monté, visible et en place (aucune navigation, aucun voile). Pendant l'attente, une barre de
 * chargement montre que le traitement avance (indéterminée : aucun pourcentage n'est inventé).
 * La carte ne capte aucun appui, sauf ses propres boutons en cas d'échec. Il est piloté par un état RÉEL (relecture, recherche de la partie active, requête
 * en attente), jamais par une durée, et n'affiche jamais de détail technique : ceux-ci restent
 * dans le journal réseau (`logNetworkIssue`).
 *
 * Bloquer les actions qui exigent la connexion reste l'affaire de l'écran (la table de jeu
 * devient inerte pendant sa reconnexion) : l'indicateur, lui, ne bloque rien.
 */
export function ConnectionIndicator({
  status,
  onRetry,
  secondary,
}: {
  status: ConnectionStatus | null;
  onRetry?: () => void;
  /** Action de repli en cas d'échec (ex. continuer, revenir à l'accueil). */
  secondary?: { title: string; onPress: () => void };
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const reduced = useReducedMotion();
  // État affiché : suit `status` après le seuil d'apparition, et reste le temps du fondu de
  // sortie quand l'état réel redevient normal.
  const [shown, setShown] = useState<ConnectionStatus | null>(status === 'failed' ? status : null);
  const [opacity] = useState(() => new Animated.Value(shown ? 1 : 0));
  const [spin] = useState(() => new Animated.Value(0));
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (status === null) {
      const fade = Animated.timing(opacity, {
        toValue: 0,
        duration: reduced ? 0 : FADE_MS,
        useNativeDriver: true,
      });
      fade.start(({ finished }) => finished && setShown(null));
      return () => fade.stop();
    }
    let fade: Animated.CompositeAnimation | undefined;
    const reveal = () => {
      setShown(status);
      fade = Animated.timing(opacity, {
        toValue: 1,
        duration: reduced ? 0 : FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      });
      fade.start();
    };
    // Déjà visible, ou échec : aucun seuil.
    const immediate = status === 'failed' || shown !== null;
    const timer = setTimeout(reveal, immediate ? 0 : CONNECTION_REVEAL_DELAY_MS);
    return () => {
      clearTimeout(timer);
      fade?.stop();
    };
    // `shown` n'est lu que pour savoir si le panneau est déjà là (pas de nouveau seuil) ;
    // `reduced`, lu de façon asynchrone, ne relance jamais le seuil d'apparition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, opacity]);

  const spinning = shown !== null && shown !== 'failed' && !reduced;
  useEffect(() => {
    if (!spinning) return;
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: SPIN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spinning, spin]);

  useEffect(() => {
    if (!spinning) return;
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: PROGRESS_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spinning, progress]);

  if (shown === null) return null;
  const failed = shown === 'failed';
  const message =
    shown === 'pending' ? PENDING_MESSAGE : failed ? RECONNECTION_FAILED_MESSAGE : RECONNECTION_MESSAGE;
  const iconSize = Math.round(m.bodySize * 1.1);
  const width = Math.round(Math.min(m.availableWidth - 32, 380));
  const track = width - Math.round(m.gap * 1.8) * 2;
  const segment = Math.round(track * 0.36);
  return (
    <View
      style={[
        styles.layer,
        {
          paddingTop: m.safe.top,
          paddingBottom: m.safe.bottom,
          paddingLeft: m.safe.left + 16,
          paddingRight: m.safe.right + 16,
        },
      ]}
      pointerEvents="box-none"
    >
      <Animated.View
        testID="connection-indicator"
        // Rien ne se touche à travers le panneau, sauf ses boutons en cas d'échec.
        pointerEvents={failed ? 'box-none' : 'none'}
        accessibilityRole={failed ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        style={[
          styles.panel,
          {
            width,
            gap: m.gap * 0.8,
            paddingVertical: m.gap * 1.1,
            paddingHorizontal: Math.round(m.gap * 1.8),
            opacity,
            transform: [
              { scale: opacity.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
            ],
          },
        ]}
      >
        <View style={[styles.row, { gap: m.gap * 0.5 }]}>
          {failed ? null : (
            <Animated.View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                transform: [
                  { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
                ],
              }}
            >
              <SyncIcon size={iconSize} />
            </Animated.View>
          )}
          <Text
            style={[styles.message, fontOf(fonts.button), { fontSize: m.bodySize * 0.95 }]}
            numberOfLines={failed ? 3 : 2}
          >
            {message}
          </Text>
        </View>
        {failed ? null : (
          // Barre de chargement : un segment de laiton parcourt le rail tant que l'attente dure
          // (immobile si « réduire les animations » est activé).
          <View
            testID="connection-progress"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.track, { width: track }]}
          >
            <Animated.View
              style={[
                styles.segment,
                { width: segment },
                reduced
                  ? { left: (track - segment) / 2 }
                  : {
                      transform: [
                        {
                          translateX: progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-segment, track],
                          }),
                        },
                      ],
                    },
              ]}
            />
          </View>
        )}
        {failed && (onRetry || secondary) ? (
          <View style={[styles.actions, { gap: m.gap * 0.5 }]}>
            {onRetry ? <PanelButton title="Réessayer" onPress={onRetry} /> : null}
            {secondary ? (
              <PanelButton title={secondary.title} tone="danger" onPress={secondary.onPress} />
            ) : null}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** Deux flèches en cercle (synchronisation). */
function SyncIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 12a8 8 0 0 0-14.2-5M4 12a8 8 0 0 0 14.2 5"
        stroke={tablePalette.gold}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <Path
        d="M5.4 3v4h4M18.6 21v-4h-4"
        stroke={tablePalette.gold}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // Toute la surface, sans voile : seule la carte, au centre, est dessinée.
  layer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
    elevation: 200,
  },
  // Carte OPAQUE : rien de l'écran ne transparaît sous le message.
  panel: {
    alignItems: 'center',
    maxWidth: '100%',
    borderRadius: salon.radius.panel,
    borderWidth: 1,
    borderColor: gameTheme.brass.line,
    backgroundColor: gameTheme.lacquer.solid,
    experimental_backgroundImage:
      'linear-gradient(180deg, #1B2924 0%, #0B1411 100%)',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  message: { color: salon.text, textAlign: 'center', flexShrink: 1 },
  track: {
    height: 4,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: 'rgba(246, 239, 223, 0.1)',
  },
  segment: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 2,
    backgroundColor: gameTheme.brass.main,
    experimental_backgroundImage: salon.brass.gradient,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
});
