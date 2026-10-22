import { useCallback, useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import type { DealBatch, GameView } from '../../../types/game';
import type { LobbyMetrics } from '../../lobby/lobby-metrics';
import { CARD_RATIO, CardBack, CardFace, PublicRow, ROW_STEP } from './Cards';
import { settledCardsOf, type PublicPlay } from './presentation-plan';
import {
  arrangeSeats,
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
 * Orientation d'une carte posée au centre (degrés, sens horaire) : droite DEVANT le joueur qui
 * l'a jouée, le haut de la carte tourné vers le centre de la table, et vue ainsi par tous.
 * Moi (bas) : droite ; en face : renversée ; à gauche : haut vers la droite ; à droite : haut
 * vers la gauche.
 */
export const SPOT_ANGLE: Record<SeatSide, number> = {
  bottom: 0,
  top: 180,
  left: 90,
  right: -90,
};

/**
 * Position de la carte jouée sur la table, poussée vers son joueur comme sur la référence
 * (carte posée à 16 % du diamètre du centre, côté de celui qui l'a jouée). Partagée par les
 * deux jeux (FAP-FAP, GARAM TIA) : centre = `tableCy`, distances en diamètres de table.
 */
export const SPOT_OFFSET: Record<SeatSide, { x: number; y: number }> = {
  bottom: { x: 0, y: 0.16 },
  top: { x: 0, y: -0.16 },
  left: { x: -0.16, y: 0 },
  right: { x: 0.16, y: 0 },
};

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

/**
 * Pas maximal : cartes empilées avec un léger décalage (20 % de chaque carte recouvert), la
 * valeur et la famille de chacune restant lisibles.
 */
export const PUBLIC_ROW_MAX_STEP = 0.8;
/** Réduction maximale des cartes jouées quand même le pas minimal ne suffit pas. */
export const PUBLIC_ROW_MIN_SCALE = 0.75;

/**
 * Pas le plus large qui fait tenir les 5 cartes possibles (5 tours) dans `available` px, entre
 * le pas chevauché d'origine (`ROW_STEP`, jamais moins lisible qu'avant) et un léger
 * décalage (`PUBLIC_ROW_MAX_STEP`). La taille des cartes ne change pas.
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
export function fitPublicRow(
  available: number,
  cardWidth: number,
  minWidth = Math.ceil(cardWidth * PUBLIC_ROW_MIN_SCALE),
) {
  if (available >= minRowSpan(cardWidth)) {
    return { cardWidth, step: publicRowStep(available, cardWidth) };
  }
  const width = Math.max(minWidth, Math.floor(available / minRowSpan(1)));
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

/** Marge intérieure du cadre (part de la largeur d'une carte jouée). */
export const PLAYED_ZONE_PAD = 0.08;

/**
 * Cadre de la zone « cartes jouées » d'un siège (référence annotée, zones 1 à 4) : ajusté aux
 * 5 cartes possibles TELLES QU'ELLES SONT DESSINÉES (`playedRowIn`), avec la même fine marge
 * tout autour. Un peu moins large que la place réservée (qui suppose des cartes pleine taille),
 * même hauteur, collé au même bord (côté table). Toujours de la même taille, même vide : il ne
 * bouge jamais au fil des tours et ne déborde jamais sur ses voisins.
 */
export function playedZoneRect(row: PublicRowZone): Rect {
  const inner = playedRowIn(row);
  const pad = inner.top - row.top;
  const cards = publicRowBox(inner, MAX_HAND_CARDS);
  return {
    left: cards.left - pad,
    top: row.top,
    width: cards.width + pad * 2,
    height: row.cardWidth * CARD_RATIO,
  };
}

/**
 * Rangée réellement dessinée DANS le cadre : cartes un peu réduites pour laisser une fine
 * marge, même pas, même sens. Cible aussi du trajet d'une carte jouée.
 */
export function playedRowIn(row: PublicRowZone): PublicRowZone {
  const pad = Math.max(2, Math.round(row.cardWidth * PLAYED_ZONE_PAD));
  const cardWidth = row.cardWidth - (pad * 2) / CARD_RATIO;
  const top = row.top + pad;
  return row.reverse
    ? { ...row, cardWidth, top, left: row.left + row.cardWidth - cardWidth - pad }
    : { ...row, cardWidth, top, left: row.left + pad };
}

/** Zone « cartes jouées » d'un siège OCCUPÉ dans cette partie. */
export interface PlayedZone {
  seat: number;
  side: SeatSide;
  playerId: string;
  /** Cadre visible, même vide (place des 5 cartes). */
  rect: Rect;
  /** Rangée dessinée dans le cadre (`playedRowIn`). */
  row: PublicRowZone;
  /** Cartes rangées de ce joueur, dans l'ordre chronologique du serveur. */
  cardIds: string[];
}

/**
 * Les zones de cartes jouées de la table (référence annotée, zones 1 à 4) : une par siège
 * occupé par un joueur de CETTE partie (fuyard compris : ses cartes restent publiques), aucune
 * pour un siège vide. La correspondance siège-joueur vient de l'état courant de la partie
 * (`arrangeSeats`, le joueur connecté en bas) ; les cartes, de `completedTricks` /
 * `currentTrick` du serveur, publiques pour tous, une fois leur présentation finie.
 */
export function playedZones(
  game: GameView,
  plays: PublicPlay[],
  settled: ReadonlySet<string>,
  L: GameTableLayout,
  m: LobbyMetrics,
): PlayedZone[] {
  return arrangeSeats(game).flatMap(({ seat, side, player }) => {
    if (!player) return [];
    const reserved = seatZones(side, L, m).publicRow;
    return [
      {
        seat,
        side,
        playerId: player.playerId,
        rect: playedZoneRect(reserved),
        row: playedRowIn(reserved),
        cardIds: settledCardsOf(plays, player.playerId, settled),
      },
    ];
  });
}

/**
 * Cadre translucide (matière des barres des joueurs) et cartes déjà jouées d'un siège,
 * légèrement empilées dans l'ordre de jeu : valeur et famille de chacune restent visibles.
 */
export function PlayedCardsZone({ zone, label }: { zone: PlayedZone; label: string }) {
  const { rect, row, cardIds } = zone;
  return (
    <>
      <View
        testID="played-zone"
        accessible
        accessibilityLabel={`Cartes jouées par ${label} : ${cardIds.length}`}
        style={[
          styles.absolute,
          styles.passThrough,
          styles.playedZone,
          { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        ]}
      />
      {cardIds.length > 0 ? (
        <PublicRow
          cardIds={cardIds}
          width={row.cardWidth}
          step={row.step}
          reverse={row.reverse}
          upsideDown={zone.side === 'top'}
          style={(({ left, top }) => ({ left, top }))(publicRowBox(row, cardIds.length))}
        />
      ) : null}
    </>
  );
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
  minWidth?: number,
): PublicRowZone {
  const fit = fitPublicRow(to - from, sw, minWidth);
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
 * Chaque rangée est réservée pour 5 cartes ; toutes les zones de cartes jouées de la table ont
 * ensuite les MÊMES dimensions (`uniformPlayedRow`), et le cadre (`playedZoneRect`) en garde la
 * place, même vide.
 */
export function seatZones(side: SeatSide, L: GameTableLayout, m: LobbyMetrics): SeatZones {
  const zones = reservedZones(side, L, m);
  return { ...zones, publicRow: uniformPlayedRow(zones.publicRow, playedRowSize(L, m)) };
}

/** Sièges dont la zone de cartes jouées compte à cette table (en face seulement s'il existe). */
const playedSides = (L: GameTableLayout): SeatSide[] =>
  L.topSeat ? ['bottom', 'right', 'top', 'left'] : ['bottom', 'right', 'left'];

/**
 * Taille commune des zones de cartes jouées : la plus petite carte et le plus petit pas parmi
 * les places réservées des sièges. Chaque zone tient donc dans sa propre place (aucun nouveau
 * chevauchement) et toutes ont exactement la même largeur et la même hauteur.
 */
export function playedRowSize(L: GameTableLayout, m: LobbyMetrics) {
  const rows = playedSides(L).map((side) => reservedZones(side, L, m).publicRow);
  return {
    cardWidth: Math.min(...rows.map((row) => row.cardWidth)),
    step: Math.min(...rows.map((row) => row.step)),
  };
}

/**
 * Rangée à la taille commune, posée dans la place réservée du siège : centrée verticalement,
 * collée au même bord (côté table : à gauche, ou à droite pour une rangée inversée).
 */
export function uniformPlayedRow(
  row: PublicRowZone,
  size: { cardWidth: number; step: number },
): PublicRowZone {
  const top = row.top + ((row.cardWidth - size.cardWidth) * CARD_RATIO) / 2;
  const left = row.reverse ? row.left + row.cardWidth - size.cardWidth : row.left;
  return { ...row, ...size, top, left };
}

/** Places réservées d'un siège, avant la mise à la taille commune des zones. */
function reservedZones(side: SeatSide, L: GameTableLayout, m: LobbyMetrics): SeatZones {
  const { cx, cy, diameter, plateWidth: pw, plateHeight: ph, gap } = L;
  const r = diameter / 2;
  const sw = L.smallCard;
  const sh = sw * CARD_RATIO;
  // Cartes déjà jouées : légèrement plus petites que celles de la main.
  const pc = L.playedCard;
  const pch = pc * CARD_RATIO;
  // Faute de place, jamais plus petites qu'avant (75 % d'un dos de carte d'adversaire).
  const pmin = Math.ceil(sw * PUBLIC_ROW_MIN_SCALE);
  /**
   * Rangée de cartes jouées dans [from, to] : à leur taille (`pc`), réduites au besoin ; si
   * même ainsi les 5 cartes ne tiennent pas, la rangée d'origine (taille d'un dos de carte).
   */
  const playedRow = (from: number, to: number, baseline: number, reverse = false) => {
    const row = rowIn(from, to, baseline, pc, reverse, pmin);
    return publicRowBox(row, MAX_HAND_CARDS).width <= to - from + 0.5
      ? row
      : rowIn(from, to, baseline, sw, reverse);
  };  const tagWidth = distanceTagWidth(m);
  const tagHeight = distanceTagHeight(m);
  const screenLeft = m.safe.left + gap;
  const screenRight = m.width - m.safe.right - gap;
  /** Bas d'un coin haut, s'il est au-dessus de la bande [left, right] ; sinon le bord sûr. */
  const ceiling = (left: number, right: number, extra: Rect[] = []) =>
    Math.max(
      m.safe.top,
      ...[L.corners.left, L.corners.right, ...extra]
        .filter((c) => spans(left, right, c))
        .map((c) => c.top + c.height + gap),
    );

  switch (side) {
    case 'bottom': {
      const plateTop = m.height - m.safe.bottom - ph;
      const baseline = plateTop - gap * 0.5;
      // Après le bois de la table sur la bande de la rangée, jusqu'aux boutons d'action. Des
      // cartes plus hautes élargissent la bande de bois à éviter : sans assez de place, la
      // rangée reprend la taille d'un dos de carte.
      const limit = m.width - m.safe.right - L.action.width - gap;
      const rowFor = (width: number) => {
        const clear = cx + tableHalfWidthOver(baseline - width * CARD_RATIO, baseline, L) + gap;
        const from = Math.max(L.localPlateLeft, clear);
        const row = rowIn(from, limit, baseline, width, false, pmin);
        return { row, fits: publicRowBox(row, MAX_HAND_CARDS).width <= limit - from + 0.5 };
      };
      const played = rowFor(pc);
      return {
        plate: { left: L.localPlateLeft, top: plateTop },
        publicRow: played.fits ? played.row : rowFor(sw).row,
      };
    }
    case 'top': {
      const backsTop = m.safe.top;
      // Siège en face vide : aucun dos dessiné, une part seulement de leur bande est gardée
      // au-dessus de sa plaque vide (`EMPTY_TOP_SEAT_RESERVE`).
      const top = L.topPlateTop;
      const left = cx - pw / 2;
      const baseline = top + ph / 2 + pch / 2;
      const clear = cx + tableHalfWidthOver(baseline - pch, baseline, L) + gap;
      return {
        plate: { left, top },
        backs: { left, top: backsTop, width: pw },
        publicRow: playedRow(Math.max(left + pw + gap, clear), L.corners.right.left - gap, baseline),
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
      // Siège en face : sa zone de cartes jouées et sa distance sont des plafonds de plus.
      const facing = L.topSeat ? reservedZones('top', L, m) : undefined;
      const topZone = facing
        ? [
            publicRowBox(facing.publicRow, MAX_HAND_CARDS),
            // Son étiquette de distance (partie surveillée) aussi.
            { ...facing.distance!, height: tagHeight },
          ]
        : [];
      const plateCeiling = ceiling(left, left + pw, topZone);
      const rowCeiling = ceiling(colLeft, colRight, topZone);
      // Plancher : cartes jouées du joueur connecté et boutons d'action (droite), chrono et
      // bandeau de tour (gauche).
      const local = reservedZones('bottom', L, m).publicRow;
      const floor = right ? Math.min(local.top, L.action.top) - gap : L.hud.top;
      const preferred = cy - ph / 2 + sh * 0.3;
      const tag = tagHeight + 3;

      // Rangée sous la plaque (colonne entière), ou à côté d'elle vers le bord de l'écran.
      const under = playedRow(colLeft, colRight, 0, !right);
      const beside = right
        ? playedRow(left + pw + gap, screenRight, 0)
        : playedRow(screenLeft, left - gap, 0, true);
      const underHeight = under.cardWidth * CARD_RATIO;
      const besideHeight = beside.cardWidth * CARD_RATIO;
      /**
       * Dispositions essayées dans l'ordre : la première dont le bloc (dos, plaque, cartes
       * jouées, distance) tient entre plafond et plancher est retenue, au plus près du
       * centre de la table. `rowTop` et `tagTop` sont relatifs au haut de la plaque.
       */
      // Sous la plaque, des cartes jouées à leur taille d'origine si les plus grandes n'y
      // tiennent pas, avant de passer la rangée à côté de la plaque.
      const underSmall = rowIn(colLeft, colRight, 0, sw, !right);
      const underSmallHeight = underSmall.cardWidth * CARD_RATIO;
      const options = [
        // Rangée sous la plaque, distance dessous (vers le joueur connecté).
        { row: under, rowTop: ph + gap * 0.5, tagTop: ph + gap * 0.5 + underHeight + 3, tagAbove: false },
        // Rangée sous la plaque, distance au-dessus des dos.
        { row: under, rowTop: ph + gap * 0.5, tagTop: -2 - sh - tag, tagAbove: true },
        // Idem, cartes à la taille d'un dos.
        { row: underSmall, rowTop: ph + gap * 0.5, tagTop: ph + gap * 0.5 + underSmallHeight + 3, tagAbove: false },
        { row: underSmall, rowTop: ph + gap * 0.5, tagTop: -2 - sh - tag, tagAbove: true },
        // Rangée à côté de la plaque, distance sous la plaque, puis au-dessus des dos.
        { row: beside, rowTop: ph / 2 - besideHeight / 2, tagTop: ph + 3, tagAbove: false },
        { row: beside, rowTop: ph / 2 - besideHeight / 2, tagTop: -2 - sh - tag, tagAbove: true },
      ];
      for (const [index, option] of options.entries()) {
        const rowHeight = option.row.cardWidth * CARD_RATIO;
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
  angle = 0,
  instant = false,
  release,
  onReveal,
  onSettled,
}: {
  cardId: string;
  /**
   * Orientation au centre (`SPOT_ANGLE` du siège de son joueur) ; la carte se redresse en
   * rejoignant la zone de cartes jouées, où toutes les cartes sont droites.
   */
  angle?: number;
  /**
   * La carte est DÉJÀ à cet endroit (ma carte glissée, posée là avant la réponse du serveur) :
   * elle s'affiche telle quelle, sans fondu ni grossissement, lu à la création.
   */
  instant?: boolean;
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
  const [appear] = useState(() => new Animated.Value(instant ? 1 : 0));
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
            {
              rotate: move.interpolate({
                inputRange: [0, 1],
                // Joueur d'en face : sa carte reste renversée dans sa rangée (`PublicRow`).
                outputRange: [`${angle}deg`, angle === SPOT_ANGLE.top ? `${angle}deg` : '0deg'],
              }),
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
  // Même matière que les barres des joueurs : vert très sombre translucide.
  playedZone: {
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.25)',
    backgroundColor: 'rgba(4, 30, 12, 0.55)',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
  },
  spotGlow: {
    borderRadius: 8,
    boxShadow: '0 0 18px rgba(255, 220, 140, 0.55)',
  },
});
