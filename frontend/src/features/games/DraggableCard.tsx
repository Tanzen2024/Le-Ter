import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { cardLabel } from './format';
import { CARD_RATIO, CardFace } from './table/Cards';

/** Rectangle de la zone de dépôt, en coordonnées de la fenêtre. */
export interface DropZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  cardId: string;
  width: number;
  /** Jouable maintenant selon le SERVEUR (myActions.playableCardIds). */
  enabled: boolean;
  /** Commande envoyée, en attente de la réponse du serveur : la carte reste estompée. */
  pending?: boolean;
  /** Mesure à jour de la zone de dépôt (lue au moment du lâcher). */
  getDropZone: () => DropZone | null;
  /** Carte lâchée sur la zone de dépôt : envoie la commande ; le serveur décide. */
  onDrop: (cardId: string) => void;
  onDragChange?: (dragging: boolean) => void;
  /** Placement dans la main (chevauchement, ordre d'empilement). */
  style?: StyleProp<ViewStyle>;
}

/**
 * Carte de MA main, à glisser-déposer vers la zone d'action de la table (décision 48).
 * Seules les cartes que le serveur déclare jouables peuvent être saisies. Pendant le glissé,
 * la carte suit le doigt, se soulève (agrandie, ombre portée, légère rotation). Lâchée dans la
 * zone, elle déclenche PLAY_CARD et revient estompée dans la main jusqu'à la réponse : le
 * serveur la retire de la main s'il accepte le coup (décision 49), sinon elle redevient
 * normale. Hors de la zone, elle revient à sa place.
 *
 * Accessibilité : l'action « activer » joue la carte sans geste (lecteur d'écran).
 */
export function DraggableCard({
  cardId,
  width,
  enabled,
  pending = false,
  getDropZone,
  onDrop,
  onDragChange,
  style,
}: Props) {
  const [position] = useState(() => new Animated.ValueXY());
  const [lift] = useState(() => new Animated.Value(0));
  // Gestionnaires STABLES pendant tout un glissé (un nouveau rendu ne doit pas remplacer
  // le répondeur en cours de geste) : les dernières props sont lues via une référence.
  const props = useRef({ enabled, getDropZone, onDrop, onDragChange });
  useEffect(() => {
    props.current = { enabled, getDropZone, onDrop, onDragChange };
  });

  const responder = useMemo(() => {
    const settle = () => {
      Animated.parallel([
        Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }),
        Animated.spring(lift, { toValue: 0, useNativeDriver: false }),
      ]).start();
    };
    // La référence n'est lue que dans les rappels du geste, jamais pendant le rendu.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: () => props.current.enabled,
      onMoveShouldSetPanResponder: () => props.current.enabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        props.current.onDragChange?.(true);
        Animated.spring(lift, { toValue: 1, useNativeDriver: false }).start();
      },
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
        settle();
      },
      onPanResponderTerminate: () => {
        props.current.onDragChange?.(false);
        settle();
      },
    });
  }, [cardId, position, lift]);

  return (
    <Animated.View
      {...responder.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${cardLabel(cardId)}${enabled ? ', à glisser vers la zone de jeu' : ''}`}
      accessibilityState={{ disabled: !enabled, busy: pending }}
      accessibilityActions={enabled ? [{ name: 'activate', label: 'Jouer cette carte' }] : []}
      onAccessibilityAction={(event) => {
        if (enabled && event.nativeEvent.actionName === 'activate') {
          onDrop(cardId);
        }
      }}
      style={[
        styles.card,
        { width, height: width * CARD_RATIO },
        {
          zIndex: 10,
          transform: [
            ...position.getTranslateTransform(),
            { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) },
            { rotate: lift.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-4deg'] }) },
          ],
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.shadow,
          { borderRadius: width * 0.1, opacity: lift },
        ]}
      />
      <CardFace cardId={cardId} width={width} />
      {/* États sans aucune opacité sur la carte : sur Android, une opacité sur une vue à
          plusieurs couches les rend translucides une à une (la carte du dessous transparaît,
          effet de flou). La carte reste opaque ; l'état est dessiné PAR-DESSUS. */}
      {enabled && !pending ? (
        <View
          testID="card-playable"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.playable, { borderRadius: width * 0.08 }]}
        />
      ) : null}
      {pending ? (
        <View
          testID="card-pending"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.pendingVeil, { borderRadius: width * 0.08 }]}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 8 },
  // Carte jouable maintenant (selon le serveur) : liseré doré net.
  playable: { borderWidth: 2, borderColor: '#F5C842' },
  // Envoi en cours : voile clair posé sur la carte opaque (bref, jusqu'à la réponse).
  pendingVeil: { backgroundColor: 'rgba(255, 255, 255, 0.55)' },
  shadow: { boxShadow: '0 14px 22px rgba(0, 0, 0, 0.5)' },
});
