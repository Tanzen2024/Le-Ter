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

import { gameTheme, motion } from '../../constants/theme';
import { playSound } from '../../services/audio-service';
import { cardLabel } from './format';
import { CARD_RATIO, CardFace } from './table/Cards';
import { useReducedMotion } from './table/turn-signal';

/** Durée du trajet d'une carte lâchée vers sa place sur la table : un seul mouvement. */
export const CARD_LANDING_MS = 220;
/** Secousse d'un coup refusé par le serveur (visuel seulement). */
export const REFUSAL_SHAKE_MS = 240;
/** Petit refus visuel quand on touche une carte que le serveur n'autorise pas ce tour-ci. */
export const RESTRICTED_NUDGE_MS = 180;

/** Le point (fenêtre) est-il dans la zone de dépôt ? */
function insideZone(zone: DropZone | null, x: number, y: number): boolean {
  return Boolean(
    zone && x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height,
  );
}

/** Soulèvement au toucher : ressort vif et peu élastique (feedback quasi immédiat). */
const LIFT_SPRING = { toValue: 1, speed: 28, bounciness: 5, useNativeDriver: false } as const;
/**
 * Carte jouable (selon le serveur) : sortie de la main de cette fraction de sa hauteur, pour se
 * lire d'un coup d'œil. Visuel seulement ; retombe dès qu'elle n'est plus jouable ou se pose.
 */
export const READY_RAISE = 0.08;

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
  /**
   * C'est à moi de jouer mais le SERVEUR n'autorise pas cette carte (absente de
   * `playableCardIds`) : un voile sombre la met en retrait. Affichage seulement ; aucune règle
   * n'est calculée ici.
   */
  restricted?: boolean;
  /** Mesure à jour de la zone de dépôt (lue au moment du lâcher). */
  getDropZone: () => DropZone | null;
  /** Carte lâchée sur la zone de dépôt : envoie la commande ; le serveur décide. */
  onDrop: (cardId: string) => void;
  onDragChange?: (dragging: boolean) => void;
  /**
   * La carte glissée entre dans la zone de dépôt (`true`) ou en sort (`false`) : la table
   * l'annonce (« lâchez ici »). Visuel seulement ; le lâcher décide toujours sur la même mesure.
   */
  onHoverChange?: (over: boolean) => void;
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
  restricted = false,
  getDropZone,
  onDrop,
  onDragChange,
  onHoverChange,
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
  // Secousse latérale brève quand le serveur REFUSE le coup (retour dans la main).
  const [shake] = useState(() => new Animated.Value(0));
  // Carte jouable sortie de la main (0 → 1), en attente d'être saisie.
  const raised = enabled && !pending && !held;
  const [ready] = useState(() => new Animated.Value(raised ? 1 : 0));
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      ready.setValue(raised ? 1 : 0);
      return;
    }
    const animation = Animated.timing(ready, {
      toValue: raised ? 1 : 0,
      duration: motion.select,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [raised, ready, reduced]);
  // Gestionnaires STABLES pendant tout un glissé (un nouveau rendu ne doit pas remplacer
  // le répondeur en cours de geste) : les dernières props sont lues via une référence.
  // Touchable sans être jouable : seulement pour le petit refus visuel (aucun glissé).
  const refusable = restricted && !enabled && !pending;
  const latest = {
    enabled,
    refusable,
    reduced,
    getDropZone,
    onDrop,
    onDragChange,
    onHoverChange,
    landingTarget,
    onLanded,
  };
  const props = useRef(latest);
  useEffect(() => {
    props.current = latest;
  });
  // Carte glissée au-dessus de la zone de dépôt (dernier état annoncé).
  const over = useRef(false);
  // Geste en cours : un glissé (carte jouable à la saisie) ou un simple refus visuel. Décidé à
  // la saisie : une carte qui cesse d'être jouable en plein glissé revient quand même en main.
  const dragging = useRef(false);

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
  // retour dans la main, comme avant, puis une courte secousse signale le refus. Le refus vient
  // du serveur (`held` repasse à faux) : aucune validation locale.
  const wasHeld = useRef(held);
  useEffect(() => {
    const refused = wasHeld.current && !held;
    wasHeld.current = held;
    if (!refused) return;
    settle();
    if (reduced) return;
    const step = (toValue: number) =>
      Animated.timing(shake, {
        toValue,
        duration: REFUSAL_SHAKE_MS / 4,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      });
    const animation = Animated.sequence([step(1), step(-1), step(0.5), step(0)]);
    animation.start();
    return () => {
      // Interrompue (nouveau coup, démontage) : jamais de carte restée décalée.
      animation.stop();
      shake.setValue(0);
    };
  }, [held, settle, shake, reduced]);

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
      // `ready` retombe aussi (la cible est mesurée depuis la place de repos dans la main), à
      // part : l'effet de `raised` peut le relancer sans interrompre le trajet de la carte.
      timing(ready, 0).start();
      Animated.parallel([
        timing(position, target),
        timing(lift, 0),
        timing(landed, target.scale),
      ]).start(({ finished }) => finished && props.current.onLanded?.(cardId));
    };
    /** Annonce l'entrée ou la sortie de la zone de dépôt, une fois par changement. */
    const hover = (next: boolean) => {
      if (over.current === next) return;
      over.current = next;
      props.current.onHoverChange?.(next);
    };
    /** Carte non autorisée touchée : courte secousse sur place, rien n'est envoyé. */
    const nudge = () => {
      if (props.current.reduced) return;
      const step = (toValue: number) =>
        Animated.timing(shake, {
          toValue,
          duration: RESTRICTED_NUDGE_MS / 3,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        });
      Animated.sequence([step(0.45), step(-0.45), step(0)]).start();
    };
    const follow = Animated.event([null, { dx: position.x, dy: position.y }], {
      useNativeDriver: false,
    });
    // La référence n'est lue que dans les rappels du geste, jamais pendant le rendu.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: () => props.current.enabled || props.current.refusable,
      onMoveShouldSetPanResponder: () => props.current.enabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragging.current = props.current.enabled;
        if (!dragging.current) {
          nudge();
          return;
        }
        props.current.onDragChange?.(true);
        tilt.setValue(1);
        // Effleurement très discret : seulement à la saisie d'une carte jouable.
        playSound('cardPick');
        // Réponse immédiate au toucher (~120 ms) : la carte se soulève sans rebond appuyé.
        Animated.spring(lift, LIFT_SPRING).start();
      },
      onPanResponderMove: (event, gesture) => {
        if (!dragging.current) return;
        follow(event, gesture);
        hover(insideZone(props.current.getDropZone(), gesture.moveX, gesture.moveY));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (!dragging.current) return;
        dragging.current = false;
        hover(false);
        props.current.onDragChange?.(false);
        if (insideZone(props.current.getDropZone(), gesture.moveX, gesture.moveY)) {
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
        if (!dragging.current) return;
        dragging.current = false;
        hover(false);
        props.current.onDragChange?.(false);
        settle();
      },
    });
  }, [cardId, position, lift, landed, tilt, ready, shake, settle]);

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
            { translateX: Animated.multiply(shake, width * 0.08) },
            { translateY: Animated.multiply(ready, -width * CARD_RATIO * READY_RAISE) },
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
      {restricted && !enabled && !pending ? (
        <View
          testID="card-restricted"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.restrictedVeil, { borderRadius: width * 0.08 }]}
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
  // Carte jouable maintenant (selon le serveur) : liseré or net, lueur autour et lumière
  // chaude sur le haut de la carte (coin lisible : voile translucide, jamais d'opacité).
  playable: {
    borderWidth: 2,
    borderColor: gameTheme.focus,
    boxShadow: `0 0 12px 1px ${gameTheme.focusGlow}, inset 0 0 6px rgba(245, 200, 66, 0.35)`,
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(255, 232, 160, 0.16) 0%, rgba(255, 232, 160, 0) 38%)',
  },
  // Non autorisée ce tour-ci (selon le serveur) : voile sombre, plus dense vers le bas (le coin
  // reste lisible), la carte reste opaque.
  restrictedVeil: {
    backgroundColor: 'rgba(4, 12, 9, 0.4)',
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(4, 12, 9, 0.3) 0%, rgba(4, 12, 9, 0.55) 100%)',
  },
  // Envoi en cours : voile clair posé sur la carte opaque (bref, jusqu'à la réponse).
  pendingVeil: { backgroundColor: 'rgba(255, 255, 255, 0.55)' },
  shadow: { boxShadow: gameTheme.shadow.lifted },
});
