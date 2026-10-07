import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing } from '../../constants/theme';
import { cardLabel } from './format';

/** Rectangle de l'aire de jeu, en coordonnées de la fenêtre. */
export interface DropZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  cardId: string;
  /** Jouable maintenant selon le SERVEUR (myActions.playableCardIds). */
  enabled: boolean;
  /** Mesure à jour de l'aire de jeu (lue au moment du lâcher). */
  getDropZone: () => DropZone | null;
  /** Carte lâchée sur l'aire de jeu : envoie la commande ; le serveur décide. */
  onDrop: (cardId: string) => void;
  onDragChange?: (dragging: boolean) => void;
}

/**
 * Carte de MA main, à glisser-déposer vers l'aire de jeu (décision 48). Seules les cartes
 * que le serveur déclare jouables peuvent être saisies ; lâchée sur l'aire de jeu, la carte
 * déclenche PLAY_CARD, sinon elle revient à sa place. Le geste n'est jamais une preuve de
 * légalité : le serveur valide ou refuse (décision 49), et l'état affiché vient de lui.
 *
 * Accessibilité : l'action « activer » joue la carte sans geste (lecteur d'écran).
 */
export function DraggableCard({ cardId, enabled, getDropZone, onDrop, onDragChange }: Props) {
  const [position] = useState(() => new Animated.ValueXY());
  // Gestionnaires STABLES pendant tout un glissé (un nouveau rendu ne doit pas remplacer
  // le répondeur en cours de geste) : les dernières props sont lues via une référence.
  const props = useRef({ enabled, getDropZone, onDrop, onDragChange });
  useEffect(() => {
    props.current = { enabled, getDropZone, onDrop, onDragChange };
  });

  const responder = useMemo(
    () =>
      // La référence n'est lue que dans les rappels du geste, jamais pendant le rendu.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => props.current.enabled,
        onMoveShouldSetPanResponder: () => props.current.enabled,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => props.current.onDragChange?.(true),
        onPanResponderMove: Animated.event([null, { dx: position.x, dy: position.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_event, gesture) => {
          props.current.onDragChange?.(false);
          const zone = props.current.getDropZone();
          const inside =
            zone &&
            gesture.moveX >= zone.x &&
            gesture.moveX <= zone.x + zone.width &&
            gesture.moveY >= zone.y &&
            gesture.moveY <= zone.y + zone.height;
          if (inside) {
            props.current.onDrop(cardId);
          }
          Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        },
        onPanResponderTerminate: () => {
          props.current.onDragChange?.(false);
          Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        },
      }),
    [cardId, position],
  );

  return (
    <Animated.View
      {...responder.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${cardLabel(cardId)}${enabled ? ', à glisser vers l’aire de jeu' : ''}`}
      accessibilityState={{ disabled: !enabled }}
      accessibilityActions={enabled ? [{ name: 'activate', label: 'Jouer cette carte' }] : []}
      onAccessibilityAction={(event) => {
        if (enabled && event.nativeEvent.actionName === 'activate') {
          onDrop(cardId);
        }
      }}
      style={[
        styles.card,
        !enabled && styles.cardDisabled,
        { transform: position.getTranslateTransform() },
      ]}
    >
      <Text style={styles.cardText}>{cardLabel(cardId)}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 64,
    minHeight: 88,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    zIndex: 10,
  },
  cardDisabled: { opacity: 0.55 },
  cardText: { fontSize: 20, fontWeight: '800', color: colors.text },
});
