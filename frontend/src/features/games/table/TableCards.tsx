import { useCallback, useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import type { DealBatch } from '../../../types/game';
import type { LobbyMetrics } from '../../lobby/lobby-metrics';
import { CARD_RATIO, CardBack, CardFace, ROW_STEP } from './Cards';
import {
  handWidthOf,
  MAX_HAND_CARDS,
  tableHalfWidthOver,
  type GameTableLayout,
  type Rect,
  type SeatSide,
} from './table-layout';

/**
 * Cartes sur la table : où se trouvent la main (face visible pour soi, dos pour les autres)
 * et les cartes publiques de chaque joueur, la distribution animée (D-032) et le parcours
 * d'une carte jouée (centre, puis zone publique de son joueur).
 *
 * Animation ≠ état métier : tout ce qui est affiché vient de la vue du serveur ; les durées
 * ci-dessous ne retardent jamais une commande.
 */

/** Intervalle entre deux lots de la distribution (le tour de J1 dure 10 s, D-034, D-092). */
export const DEAL_STEP_MS = 420;
/** Vol d'un lot du centre vers son joueur. */
const DEAL_FLIGHT_MS = 360;
/**
 * Les cartes d'un tour restent sur la table jusqu'à la dernière ; elles sont rangées chez
 * leur joueur ce délai après la dernière carte du tour.
 */
export const TRICK_CLEAR_DELAY_MS = 2000;
const PLAYED_CARD_MOVE_MS = 450;

/**
 * Rangée des cartes déjà jouées par un joueur. `left` : bord gauche de la PREMIÈRE carte ;
 * `step` : pas entre deux cartes, en largeurs de carte (≥ 1 : cartes séparées) ; `reverse` :
 * la rangée s'étend vers la gauche (siège de gauche, pour ne pas mordre sur la table).
 */
export interface PublicRowZone {
  left: number;
  top: number;
  step: number;
  reverse?: boolean;
  /** Largeur des cartes de CETTE rangée (réduite seulement si la place manque). */
  cardWidth: number;
}

/** Pas maximal : cartes séparées par un espace de 12 % de leur largeur. */
export const PUBLIC_ROW_MAX_STEP = 1.12;
/** Réduction maximale des cartes jouées quand même le pas minimal ne suffit pas. */
export const PUBLIC_ROW_MIN_SCALE = 0.75;

/**
 * Pas le plus large qui fait tenir les 5 cartes possibles (5 tours) dans `available` px, entre
 * le pas chevauché d'origine (`ROW_STEP`, jamais moins lisible qu'avant) et des cartes
 * nettement séparées. La taille des cartes ne change pas.
 */
export function publicRowStep(available: number, cardWidth: number): number {
  const step = (available - cardWidth) / ((MAX_HAND_CARDS - 1) * cardWidth);
  return Math.min(PUBLIC_ROW_MAX_STEP, Math.max(ROW_STEP, step));
}

/** Largeur d'une rangée de 5 cartes au pas minimal, pour une largeur de carte donnée. */
const minRowSpan = (cardWidth: number) => cardWidth * (1 + (MAX_HAND_CARDS - 1) * ROW_STEP);

/**
 * Rangée de 5 cartes qui tient dans `available` px : d'abord le chevauchement s'adapte
 * (`publicRowStep`) ; si même le pas minimal déborde, les cartes rétrécissent, jusqu'à
 * `PUBLIC_ROW_MIN_SCALE` de leur taille. La place étant réservée pour 5 cartes dès le départ,
 * la rangée ne bouge jamais au fil des tours.
 */
export function fitPublicRow(available: number, cardWidth: number) {
  if (available >= minRowSpan(cardWidth)) {
    return { cardWidth, step: publicRowStep(available, cardWidth) };
  }
  const width = Math.max(
    Math.ceil(cardWidth * PUBLIC_ROW_MIN_SCALE),
    Math.floor(available / minRowSpan(1)),
  );
  return { cardWidth: width, step: ROW_STEP };
}

/** Bord gauche de la carte `index` d'une rangée publique. */
export function publicCardLeft(
  row: PublicRowZone,
  index: number,
  cardWidth = row.cardWidth,
): number {
  const offset = index * cardWidth * row.step;
  return row.reverse ? row.left - offset : row.left + offset;
}

/** Rectangle occupé par une rangée de `count` cartes (aucune carte hors de ce rectangle). */
export function publicRowBox(row: PublicRowZone, count: number, cardWidth = row.cardWidth) {
  const span = count > 0 ? cardWidth + (count - 1) * cardWidth * row.step : 0;
  return {
    left: row.reverse ? row.left + cardWidth - span : row.left,
    top: row.top,
    width: span,
    height: cardWidth * CARD_RATIO,
  };
}

export interface SeatZones {
  plate: { left: number; top: number };
  /** Main cachée d'un adversaire (dos), centrée au-dessus de sa plaque ; absente pour moi. */
  backs?: { left: number; top: number; width: number };
  /** Cartes publiques jouées par ce joueur. */
  publicRow: PublicRowZone;
  /** Emplacement de l'étiquette de distance (adversaires), entre lui et le joueur connecté. */
  distance?: { left: number; top: number; width: number };
}

/**
 * Emplacement de l'étiquette de distance : assez large pour une cause lisible (« Position
 * obsolète »), réduite sur les petits écrans (le texte rétrécit au besoin).
 */
export function distanceTagWidth(m: LobbyMetrics): number {
  return Math.round(Math.min(Math.max(m.smallSize * 8, 84), 128));
}
export function distanceTagHeight(m: LobbyMetrics): number {
  return Math.round(Math.max(10, m.smallSize - 2) * 1.6 + 6);
}

/**
 * Largeur d'une carte jouée au centre de la table : 11 % du diamètre, comme sur la référence,
 * jamais plus petite que les cartes publiques (lisible sur smartphone).
 */
export function spotCardWidth(diameter: number, smallCard: number): number {
  return Math.round(Math.min(Math.max(diameter * 0.11, smallCard), 72));
}

/** Largeur des petites cartes (dos des adversaires, cartes publiques). */
export function smallCardWidth(L: GameTableLayout): number {
  return L.smallCard;
}

const clampTo = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Une bande horizontale [left, right] passe-t-elle sous un rectangle ? */
const spans = (left: number, right: number, rect: Rect) =>
  left < rect.left + rect.width && rect.left < right;

/**
 * Rangée de 5 cartes posée dans [from, to] (vers la gauche si `reverse`), alignée sur `baseline`
 * (bas des cartes) : si les cartes rétrécissent, la rangée garde la même ligne de pied.
 */
function rowIn(
  from: number,
  to: number,
  baseline: number,
  sw: number,
  reverse = false,
): PublicRowZone {
  const fit = fitPublicRow(to - from, sw);
  const top = baseline - fit.cardWidth * CARD_RATIO;
  return reverse
    ? { left: to - fit.cardWidth, top, step: fit.step, cardWidth: fit.cardWidth, reverse: true }
    : { left: from, top, step: fit.step, cardWidth: fit.cardWidth };
}

/**
 * Zones d'un siège autour de la table, sans jamais se recouvrir (vérifié sur une gamme de
 * smartphones en paysage, `table-collisions.test.ts`) :
 *
 * - en face (haut) : dos des cartes en main au bord de l'écran, plaque dessous qui mord sur
 *   la table, cartes jouées à sa droite, après le bois, jusqu'aux contrôles du coin ;
 * - sur les côtés : une colonne entre la table et le bord de l'écran — dos, plaque, cartes
 *   jouées dessous. Le bloc reste à hauteur du centre de la table, mais ne descend jamais
 *   jusqu'aux cartes du joueur connecté ni aux blocs du bas (actions à droite, chrono à
 *   gauche), ni ne remonte sous les contrôles des coins. Sans assez de hauteur, la rangée
 *   passe à côté de la plaque, vers le bord de l'écran ;
 * - le joueur connecté (bas) : plaque à droite de sa main, cartes jouées au-dessus d'elle,
 *   après le bois, jusqu'aux boutons d'action.
 *
 * Chaque rangée est réservée pour 5 cartes et s'adapte à sa place (`fitPublicRow`).
 */
export function seatZones(side: SeatSide, L: GameTableLayout, m: LobbyMetrics): SeatZones {
  const { cx, cy, diameter, plateWidth: pw, plateHeight: ph, gap } = L;
  const r = diameter / 2;
  const sw = L.smallCard;
  const sh = sw * CARD_RATIO;
  const tagWidth = distanceTagWidth(m);
  const tagHeight = distanceTagHeight(m);
  const screenLeft = m.safe.left + gap;
  const screenRight = m.width - m.safe.right - gap;
  /** Bas d'un coin haut, s'il est au-dessus de la bande [left, right] ; sinon le bord sûr. */
  const ceiling = (left: number, right: number) =>
    Math.max(
      m.safe.top,
      ...[L.corners.left, L.corners.right]
        .filter((c) => spans(left, right, c))
        .map((c) => c.top + c.height + gap),
    );

  switch (side) {
    case 'bottom': {
      const plateTop = m.height - m.safe.bottom - ph;
      const baseline = plateTop - gap * 0.5;
      // Après le bois de la table sur la bande de la rangée, jusqu'aux boutons d'action.
      const clear = cx + tableHalfWidthOver(baseline - sh, baseline, L) + gap;
      return {
        plate: { left: L.localPlateLeft, top: plateTop },
        publicRow: rowIn(
          Math.max(L.localPlateLeft, clear),
          m.width - m.safe.right - L.action.width - gap,
          baseline,
          sw,
        ),
      };
    }
    case 'top': {
      const backsTop = m.safe.top;
      const top = backsTop + sh + 2;
      const left = cx - pw / 2;
      const baseline = top + ph / 2 + sh / 2;
      const clear = cx + tableHalfWidthOver(baseline - sh, baseline, L) + gap;
      return {
        plate: { left, top },
        backs: { left, top: backsTop, width: pw },
        publicRow: rowIn(Math.max(left + pw + gap, clear), L.corners.right.left - gap, baseline, sw),
        // À gauche de sa plaque, côté du joueur connecté.
        distance: {
          left: left - gap - tagWidth,
          top: top + ph / 2 - tagHeight / 2,
          width: tagWidth,
        },
      };
    }
    case 'left':
    case 'right': {
      const right = side === 'right';
      const left = right ? cx + r + gap : cx - r - gap - pw;
      // La colonne du siège : de la table au bord de l'écran.
      const colLeft = right ? left : screenLeft;
      const colRight = right ? screenRight : left + pw;
      // Plafond : sous les contrôles d'un coin situé au-dessus de la plaque ou de la rangée.
      const plateCeiling = ceiling(left, left + pw);
      const rowCeiling = ceiling(colLeft, colRight);
      // Plancher : cartes jouées du joueur connecté et boutons d'action (droite), chrono et
      // bandeau de tour (gauche).
      const local = seatZones('bottom', L, m).publicRow;
      const floor = right ? Math.min(local.top, L.action.top) - gap : L.hud.top;
      const preferred = cy - ph / 2 + sh * 0.3;
      const tag = tagHeight + 3;

      // Rangée sous la plaque (colonne entière), ou à côté d'elle vers le bord de l'écran.
      const under = rowIn(colLeft, colRight, 0, sw, !right);
      const beside = right
        ? rowIn(left + pw + gap, screenRight, 0, sw)
        : rowIn(screenLeft, left - gap, 0, sw, true);
      const underHeight = under.cardWidth * CARD_RATIO;
      const besideHeight = beside.cardWidth * CARD_RATIO;
      /**
       * Dispositions essayées dans l'ordre : la première dont le bloc (dos, plaque, cartes
       * jouées, distance) tient entre plafond et plancher est retenue, au plus près du
       * centre de la table. `rowTop` et `tagTop` sont relatifs au haut de la plaque.
       */
      const options = [
        // Rangée sous la plaque, distance dessous (vers le joueur connecté).
        { row: under, rowTop: ph + gap * 0.5, tagTop: ph + gap * 0.5 + underHeight + 3, tagAbove: false },
        // Rangée sous la plaque, distance au-dessus des dos.
        { row: under, rowTop: ph + gap * 0.5, tagTop: -2 - sh - tag, tagAbove: true },
        // Rangée à côté de la plaque, distance sous la plaque, puis au-dessus des dos.
        { row: beside, rowTop: ph / 2 - besideHeight / 2, tagTop: ph + 3, tagAbove: false },
        { row: beside, rowTop: ph / 2 - besideHeight / 2, tagTop: -2 - sh - tag, tagAbove: true },
      ];
      for (const [index, option] of options.entries()) {
        const rowHeight = option.row === under ? underHeight : besideHeight;
        const blockTop = Math.min(-2 - sh, option.tagAbove ? option.tagTop : 0);
        const blockBottom = Math.max(
          ph,
          option.rowTop + rowHeight,
          option.tagAbove ? 0 : option.tagTop + tagHeight,
        );
        const lo = Math.max(plateCeiling - blockTop, rowCeiling - option.rowTop);
        const hi = floor - blockBottom;
        if (lo > hi && index < options.length - 1) continue;
        const top = lo > hi ? lo : clampTo(preferred, lo, hi);
        return {
          plate: { left, top },
          backs: { left, top: top - 2 - sh, width: pw },
          publicRow: { ...option.row, top: top + option.rowTop },
          distance: { left, width: pw, top: top + option.tagTop },
        };
      }
      throw new Error('unreachable');
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
 * Carte jouée (confirmée par le serveur) : elle apparaît sur la table, devant son joueur, et
 * y RESTE tant que le tour n'est pas complet. Quand la dernière carte du tour est jouée
 * (`release`), toutes les cartes du tour rejoignent ensemble, `TRICK_CLEAR_DELAY_MS` plus
 * tard, la zone publique de leur joueur, où elles restent face visible. Seul l'affichage
 * attend ; l'état métier est déjà à jour.
 */
export function PlayedCardSpotlight({
  cardId,
  from,
  to,
  width,
  targetWidth,
  delayMs = 0,
  release,
  onReveal,
  onSettled,
}: {
  cardId: string;
  /** Attente avant l'apparition (pause entre deux cartes du 5e tour), lue à la création. */
  delayMs?: number;
  /** Tour complet : la carte quitte la table `TRICK_CLEAR_DELAY_MS` après son apparition. */
  release: boolean;
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
  // Délai d'apparition figé à la création : une nouvelle valeur ne rejoue jamais l'apparition.
  const [initialDelay] = useState(delayMs);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined;
    const timer = setTimeout(() => {
      onReveal?.(cardId);
      setShown(true);
      animation = Animated.timing(appear, { toValue: 1, duration: 220, useNativeDriver: true });
      animation.start();
    }, initialDelay);
    return () => {
      clearTimeout(timer);
      animation?.stop();
    };
  }, [appear, cardId, initialDelay, onReveal]);
  useEffect(() => {
    if (!shown || !release) return;
    let animation: Animated.CompositeAnimation | undefined;
    const timer = setTimeout(() => {
      animation = Animated.timing(move, {
        toValue: 1,
        duration: PLAYED_CARD_MOVE_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      });
      animation.start(({ finished }) => finished && onSettled(cardId));
    }, TRICK_CLEAR_DELAY_MS);
    return () => {
      clearTimeout(timer);
      animation?.stop();
    };
  }, [shown, release, move, cardId, onSettled]);
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
