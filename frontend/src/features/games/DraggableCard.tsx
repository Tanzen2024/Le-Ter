import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { cardLabel } from './format';
import { CARD_RATIO, CardFace } from './table/Cards';

/** Durée du trajet d'une carte lâchée vers sa place sur la table : un seul mouvement. */
export const CARD_LANDING_MS = 220;

/**
 * Place d'une carte lâchée sur la table, relative à sa place dans la main : décalage de son
 * centre et échelle (largeur de la carte sur la table / largeur dans la main).
 */
export interface LandingTarget {
  dx: number;
  dy: number;
  scale: number;
}

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
  /**
   * Place de la carte sur la table une fois lâchée dans la zone : elle y glisse d'un seul
   * mouvement et y reste pendant l'envoi. Sans cible, elle attend dans la main.
   */
  landingTarget?: LandingTarget;
  /**
   * Carte lâchée encore attendue sur la table (envoi en cours ou coup accepté). Passe de vrai
   * à faux seulement si le serveur REFUSE le coup : la carte revient alors dans la main.
   */
  held?: boolean;
  /** La carte lâchée est arrivée à sa place sur la table. */
  onLanded?: (cardId: string) => void;
  /** Placement dans la main (chevauchement, ordre d'empilement). */
  style?: StyleProp<ViewStyle>;
}

/**
 * Carte de MA main, à glisser-déposer vers la zone d'action de la table (décision 48).
 * Seules les cartes que le serveur déclare jouables peuvent être saisies. Pendant le glissé,
 * la carte suit le doigt, se soulève (agrandie, ombre portée, légère rotation). Lâchée dans la
 * zone, elle déclenche PLAY_CARD et poursuit, d'un seul mouvement sans rebond, jusqu'à sa
 * place sur la table (`landingTarget`), où elle attend estompée la réponse : si le serveur
 * accepte (décision 49), la carte jouée du serveur la remplace exactement au même endroit ;
 * s'il refuse (`held` repasse à faux), elle revient dans la main. Hors de la zone, elle
 * revient à sa place.
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
  landingTarget,
  held = false,
  onLanded,
  style,
}: Props) {
  const [position] = useState(() => new Animated.ValueXY());
  const [lift] = useState(() => new Animated.Value(0));
  // Échelle de la carte posée sur la table (1 dans la main).
  const [landed] = useState(() => new Animated.Value(1));
  // Inclinaison de la carte soulevée (0 → −4°) : remise à 0 dès le lâcher dans la zone, la
  // carte posée au centre est toujours droite, quel que soit le joueur.
  const [tilt] = useState(() => new Animated.Value(0));
  // Gestionnaires STABLES pendant tout un glissé (un nouveau rendu ne doit pas remplacer
  // le répondeur en cours de geste) : les dernières props sont lues via une référence.
  const props = useRef({ enabled, getDropZone, onDrop, onDragChange, landingTarget, onLanded });
  useEffect(() => {
    props.current = { enabled, getDropZone, onDrop, onDragChange, landingTarget, onLanded };
  });

  const settle = useMemo(
    () => () => {
      Animated.parallel([
        Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }),
        Animated.spring(lift, { toValue: 0, useNativeDriver: false }),
        Animated.spring(landed, { toValue: 1, useNativeDriver: false }),
      ]).start();
    },
    [position, lift, landed],
  );

  // Coup refusé (la carte était attendue sur la table, elle ne l'est plus et reste en main) :
  // retour dans la main, comme avant.
  const wasHeld = useRef(held);
  useEffect(() => {
    if (wasHeld.current && !held) settle();
    wasHeld.current = held;
  }, [held, settle]);

  const responder = useMemo(() => {
    /** Lâchée dans la zone : un seul trajet continu, sans ressort, jusqu'à sa place. */
    const land = (target: LandingTarget) => {
      const timing = (value: Animated.Value | Animated.ValueXY, toValue: number | LandingTarget) =>
        Animated.timing(value, {
          toValue: typeof toValue === 'number' ? toValue : { x: toValue.dx, y: toValue.dy },
          duration: CARD_LANDING_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        });
      Animated.parallel([
        timing(position, target),
        timing(lift, 0),
        timing(landed, target.scale),
      ]).start(({ finished }) => finished && props.current.onLanded?.(cardId));
    };
    // La référence n'est lue que dans les rappels du geste, jamais pendant le rendu.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: () => props.current.enabled,
      onMoveShouldSetPanResponder: () => props.current.enabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        props.current.onDragChange?.(true);
        tilt.setValue(1);
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
          const target = props.current.landingTarget;
          if (target) {
            tilt.setValue(0);
            land(target);
            return;
          }
          // Sans place connue sur la table : la carte attend dans la main.
          props.current.onLanded?.(cardId);
        }
        settle();
      },
      onPanResponderTerminate: () => {
        props.current.onDragChange?.(false);
        settle();
      },
    });
  }, [cardId, position, lift, landed, tilt, settle]);

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
          // Sans geste : aucun trajet, la carte attend la réponse dans la main.
          onDrop(cardId);
          onLanded?.(cardId);
        }
      }}
      style={[
        styles.card,
        { width, height: width * CARD_RATIO },
        {
          zIndex: 10,
          transform: [
            ...position.getTranslateTransform(),
            {
              scale: Animated.multiply(
                lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }),
                landed,
              ),
            },
            {
              rotate: Animated.multiply(lift, tilt).interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', '-4deg'],
              }),
            },
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
