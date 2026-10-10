import { useCallback, useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import type { DealBatch } from '../../../types/game';
import type { LobbyMetrics } from '../../lobby/lobby-metrics';
import { CARD_RATIO, CardBack, CardFace } from './Cards';
import { handWidthOf, type GameTableLayout, type SeatSide } from './table-layout';

/**
 * Cartes sur la table : où se trouvent la main (face visible pour soi, dos pour les autres)
 * et les cartes publiques de chaque joueur, la distribution animée (D-032) et le parcours
 * d'une carte jouée (centre, puis zone publique de son joueur).
 *
 * Animation ≠ état métier : tout ce qui est affiché vient de la vue du serveur ; les durées
 * ci-dessous ne retardent jamais une commande.
 */

/** Intervalle entre deux lots de la distribution (le tour de J1 dure 15 s, D-034, D-068). */
export const DEAL_STEP_MS = 420;
/** Vol d'un lot du centre vers son joueur. */
const DEAL_FLIGHT_MS = 360;
/** Carte jouée visible au centre avant d'être rangée chez son joueur (2 à 3 s). */
export const PLAYED_CARD_HOLD_MS = 2500;
const PLAYED_CARD_MOVE_MS = 450;

export interface SeatZones {
  plate: { left: number; top: number };
  /** Main cachée d'un adversaire (dos), centrée au-dessus de sa plaque ; absente pour moi. */
  backs?: { left: number; top: number; width: number };
  /** Cartes publiques jouées par ce joueur. */
  publicRow: { left: number; top: number };
  /** Emplacement de l'étiquette de distance (adversaires), entre lui et le joueur connecté. */
  distance?: { left: number; top: number; width: number };
}

/** Emplacement de l'étiquette de distance : petite, réduite sur les petits écrans. */
export function distanceTagWidth(m: LobbyMetrics): number {
  return Math.round(Math.min(Math.max(m.smallSize * 4.6, 52), 80));
}
export function distanceTagHeight(m: LobbyMetrics): number {
  return Math.round(Math.max(10, m.smallSize - 2) * 1.6 + 6);
}

/** Largeur des petites cartes (dos des adversaires, cartes publiques). */
export function smallCardWidth(L: GameTableLayout): number {
  return L.smallCard;
}

/**
 * Zones d'un siège autour de la table. Pour chaque adversaire : sa plaque (nom) au bord de la
 * table, les dos de ses cartes en main juste au-dessus, centrés, et ses cartes publiques à
 * côté (en haut) ou au-dessous (sur les côtés), loin de la zone de dépôt centrale. Pour le
 * joueur connecté : sa plaque à droite de sa main, ses cartes publiques au-dessus d'elle.
 */
export function seatZones(side: SeatSide, L: GameTableLayout, m: LobbyMetrics): SeatZones {
  const { cx, cy, diameter, plateWidth: pw, plateHeight: ph, gap } = L;
  const r = diameter / 2;
  const sw = L.smallCard;
  const sh = sw * CARD_RATIO;
  switch (side) {
    case 'top': {
      const backsTop = m.safe.top;
      const top = backsTop + sh + 2;
      const left = cx - pw / 2;
      return {
        plate: { left, top },
        backs: { left, top: backsTop, width: pw },
        publicRow: { left: left + pw + gap, top: top + ph / 2 - sh / 2 },
        // À gauche de sa plaque, côté du joueur connecté.
        distance: {
          left: left - gap - distanceTagWidth(m),
          top: top + ph / 2 - distanceTagHeight(m) / 2,
          width: distanceTagWidth(m),
        },
      };
    }
    case 'left':
    case 'right': {
      const left = side === 'left' ? cx - r - gap - pw : cx + r + gap;
      const top = cy - ph / 2 + sh * 0.3;
      const backsTop = top - 2 - sh;
      const below = top + ph + gap * 0.5;
      // Étiquette de distance sous ses cartes publiques (vers le joueur connecté) ; si la
      // hauteur manque (petits écrans), au-dessus de ses dos, pour ne jamais toucher le chrono,
      // les boutons d'action ni la main du bas.
      const tagHeight = distanceTagHeight(m);
      const underneath = below + sh + 3;
      const bottomLimit = Math.min(L.hud.top, L.action.top);
      const fitsBelow = underneath + tagHeight + gap <= bottomLimit;
      return {
        plate: { left, top },
        backs: { left, top: backsTop, width: pw },
        publicRow: { left, top: below },
        distance: {
          left,
          width: pw,
          top: fitsBelow ? underneath : backsTop - 3 - tagHeight,
        },
      };
    }
    case 'bottom': {
      const top = m.height - m.safe.bottom - ph;
      return {
        plate: { left: L.localPlateLeft, top },
        publicRow: { left: L.localPlateLeft, top: top - gap * 0.5 - sh },
      };
    }
  }
}

/** Rectangle de la zone « cartes encore en main » d'un joueur, cible du signal de tour. */
export function handZoneRect(
  side: SeatSide,
  count: number,
  L: GameTableLayout,
  m: LobbyMetrics,
): { left: number; top: number; width: number; height: number } {
  if (side === 'bottom') {
    const width = Math.max(L.cardWidth, handWidthOf(count, L));
    return {
      left: L.handLeft + (L.handSlotWidth - width) / 2,
      top: m.height - m.safe.bottom - L.cardHeight,
      width,
      height: L.cardHeight,
    };
  }
  const z = seatZones(side, L, m);
  const backs = z.backs ?? {
    left: z.plate.left,
    top: z.plate.top,
    width: L.plateWidth,
  };
  return {
    left: backs.left,
    top: backs.top,
    width: backs.width,
    height: z.plate.top + L.plateHeight - backs.top,
  };
}

/**
 * Progression VISUELLE de la distribution décidée par le serveur (`dealSequence`) : les lots
 * sont lancés l'un après l'autre (passage 1 : 3 cartes par joueur, passage 2 : 2 cartes, sens
 * antihoraire), chaque lot vole d'un bloc. `landed[playerId]` = cartes déjà arrivées.
 */
export function useDealProgress(sequence: DealBatch[], active: boolean, onDone: () => void) {
  const [launched, setLaunched] = useState(0);
  const [landedCount, setLandedCount] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (launched < sequence.length) {
      const timer = setTimeout(
        () => setLaunched((n) => n + 1),
        launched === 0 ? 250 : DEAL_STEP_MS,
      );
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(onDone, DEAL_FLIGHT_MS + 150);
    return () => clearTimeout(timer);
  }, [active, launched, sequence.length, onDone]);

  const landed: Record<string, number> = {};
  for (const batch of sequence.slice(0, landedCount)) {
    landed[batch.playerId] = (landed[batch.playerId] ?? 0) + batch.count;
  }
  /** Un lot a atterri : il compte désormais dans la main de son joueur. */
  const land = useCallback(() => setLandedCount((n) => n + 1), []);
  return {
    landed,
    /** Lots en vol, avec leur rang dans la séquence (clé stable). */
    flying: sequence.slice(landedCount, launched).map((batch, i) => ({
      batch,
      index: landedCount + i,
    })),
    land,
  };
}

/** Un lot en vol : `count` dos de carte partent du centre ensemble vers leur joueur. */
export function DealFlight({
  batch,
  from,
  to,
  width,
  onLanded,
}: {
  batch: DealBatch;
  from: { x: number; y: number };
  to: { x: number; y: number };
  width: number;
  onLanded: () => void;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: DEAL_FLIGHT_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => finished && onLanded());
  }, [progress, onLanded]);
  const height = width * CARD_RATIO;
  return (
    <Animated.View
      style={[
        styles.absolute,
        styles.passThrough,
        {
          left: from.x - width / 2,
          top: from.y - height / 2,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, to.x - from.x],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, to.y - from.y],
              }),
            },
          ],
        },
      ]}
      accessibilityLabel={`Distribution : ${batch.count} cartes`}
    >
      {Array.from({ length: batch.count }, (_, i) => (
        <CardBack
          key={i}
          width={width}
          style={[
            styles.absolute,
            {
              left: i * width * 0.22,
              transform: [{ rotate: `${(i - 1) * 6}deg` }],
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

/**
 * Carte qui vient d'être jouée (confirmée par le serveur) : elle apparaît dans la zone
 * centrale, y reste ~2,5 s visible de tous, puis rejoint la zone publique de son joueur où
 * elle reste face visible. Seul l'affichage attend ; l'état métier est déjà à jour.
 */
export function PlayedCardSpotlight({
  cardId,
  from,
  to,
  width,
  targetWidth,
  delayMs = 0,
  onReveal,
  onSettled,
}: {
  cardId: string;
  /** Attente avant l'apparition (pause entre deux cartes du 5e tour). */
  delayMs?: number;
  /** La carte apparaît au centre : elle n'est plus dessinée dans la main de son joueur. */
  onReveal?: (cardId: string) => void;
  /** Centre de la carte dans la zone d'action. */
  from: { x: number; y: number };
  /** Centre de sa place dans la zone publique du joueur. */
  to: { x: number; y: number };
  width: number;
  targetWidth: number;
  onSettled: (cardId: string) => void;
}) {
  const [appear] = useState(() => new Animated.Value(0));
  const [move] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let sequence: Animated.CompositeAnimation | undefined;
    const run = () => {
      onReveal?.(cardId);
      sequence = Animated.sequence([
        Animated.timing(appear, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.delay(PLAYED_CARD_HOLD_MS),
        Animated.timing(move, {
          toValue: 1,
          duration: PLAYED_CARD_MOVE_MS,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      sequence.start(({ finished }) => finished && onSettled(cardId));
    };
    const timer = setTimeout(run, delayMs);
    return () => {
      clearTimeout(timer);
      sequence?.stop();
    };
  }, [appear, move, cardId, delayMs, onReveal, onSettled]);
  const height = width * CARD_RATIO;
  return (
    <Animated.View
      style={[
        styles.absolute,
        styles.passThrough,
        {
          left: from.x - width / 2,
          top: from.y - height / 2,
          zIndex: 20,
          opacity: appear,
          transform: [
            {
              translateX: move.interpolate({
                inputRange: [0, 1],
                outputRange: [0, to.x - from.x],
              }),
            },
            {
              translateY: move.interpolate({
                inputRange: [0, 1],
                outputRange: [0, to.y - from.y],
              }),
            },
            {
              scale: Animated.multiply(
                appear.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.85, 1],
                }),
                move.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, targetWidth / width],
                }),
              ),
            },
          ],
        },
      ]}
    >
      <View style={styles.spotGlow}>
        <CardFace cardId={cardId} width={width} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute' },
  passThrough: { pointerEvents: 'none' },
  spotGlow: {
    borderRadius: 8,
    boxShadow: '0 0 18px rgba(255, 220, 140, 0.55)',
  },
});
