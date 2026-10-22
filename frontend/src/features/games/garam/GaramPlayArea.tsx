import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../../components/table/TableDecor';
import { ApiError } from '../../../lib/api-client';
import { useMessages } from '../../../lib/i18n';
import type { GameView, PlayerInGame } from '../../../types/game';
import { useLobbyMetrics } from '../../lobby/lobby-metrics';
import { PanelButton } from '../../lobby/LobbyUi';
import { DraggableCard, type DropZone } from '../DraggableCard';
import { playerLabel } from '../format';
import { useGameAction } from '../hooks';
import { flightState, handWithFlight, type CardFlight } from '../table/card-flight';
import { CARD_RATIO, CardBack, CardFace, PublicRow } from '../table/Cards';
import {
  DealFlight,
  playedRowIn,
  PlayedCardSpotlight,
  publicRowBox,
  seatZones,
  smallCardWidth,
  SPOT_ANGLE,
  spotCardWidth,
} from '../table/TableCards';
import {
  arrangeSeats,
  type GameTableLayout,
  type Rect,
} from '../table/table-layout';
import {
  ControlGlow,
  GlassBox,
  plateContentHeight,
  SeatPlate,
  WoodTable,
  type SeatState,
} from '../table/TableParts';
import { TimerDial } from '../table/TurnHud';
import { dialVisibleFor, seatTurnFor, useRemainingMs, useTurnPhase } from '../table/turn-phase';
import { useReducedMotion } from '../table/turn-signal';
import { useGaramDealProgress } from './garam-deal';
import {
  GARAM_CONTROL_NOTICE_MS,
  GARAM_DRAW_FLIGHT_MS,
  GARAM_DRAW_FLIGHT_REDUCED_MS,
  GARAM_TWO_ACES_SCORE,
  garamCenterGeometry,
  garamHandStep,
  garamHandWidth,
  garamSeatRows,
  myHandSlot,
  revealedHandsOf,
  rowSlotCenter,
  seatHandLayout,
  useGaramDrawFlights,
  useGaramReveal,
  type GaramRevealStage,
} from './garam-presentation';

/** Durée des notifications normales (« Impossible », carte jouée automatiquement) : §7.13. */
const NOTICE_MS = 2_000;

/**
 * Aire de jeu d'une manche de GARAM TIA (D-119, D-128), construite avec les éléments de la
 * table du Ter (bois, plaques, faces et dos de cartes, glisser-déposer, chrono). Chaque état
 * d'une carte a SA zone (`garam-presentation.ts`), jamais partagée :
 * - terre : rang en haut de la table, tête à gauche, places fixes pour la manche ;
 * - cartes du tour : zone du centre, chaque carte devant son joueur, jusqu'à la dernière ;
 * - zone de départ de chaque joueur (là où ses lots sont arrivés à la distribution : dos chez
 *   les adversaires, ma main en bas) : ses cartes cachées, puis les cartes qu'il a tirées du
 *   terre, face visible pour tous (fin liseré doré) ;
 * - cadre « 1er tour » du siège : sa carte du premier tour, classée ;
 * - fin : zone de départ dévoilée joueur après joueur, avec le total de ses cartes, puis le
 *   gagnant.
 * Le tirage se fait en glissant la tête du terre jusqu'à ma zone (ou « Tirer »). Tout vient de
 * la vue du serveur : aucune règle n'est évaluée ici, seules les présentations attendent.
 */
export function GaramPlayArea({
  game,
  receivedAt,
  layout,
  dealing,
  onDealDone,
  onResultShown,
  center,
}: {
  game: GameView;
  receivedAt: number;
  layout: GameTableLayout;
  dealing: boolean;
  onDealDone: () => void;
  onResultShown: () => void;
  /**
   * Panneau central commun aux deux jeux (attente, résultat). `presenting` : la fin de manche
   * est encore présentée sur la table, le panneau de résultat attend.
   */
  center: (presenting: boolean) => ReactNode;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const t = useMessages().gameOver;
  const act = useGameAction(game.gameId);
  const { cx, tableCy: cy, diameter, plateWidth: pw, plateHeight: ph } = layout;
  const seats = arrangeSeats(game);
  const garam = game.garam;
  const sw = smallCardWidth(layout);
  const zones = (side: Parameters<typeof seatZones>[0]) => seatZones(side, layout, m);
  const sideOf = (playerId: string) =>
    seats.find((s) => s.player?.playerId === playerId)?.side ?? 'bottom';
  const geo = garamCenterGeometry(layout);
  const rowsOf = (side: Parameters<typeof seatZones>[0]) =>
    garamSeatRows(playedRowIn(zones(side).publicRow));

  // Zone de dépôt d'une carte du 1er tour : le centre de la table, comme au Ter.
  const dropSize = layout.center.drop;
  const dropRef = useRef<View>(null);
  const dropZone = useRef<DropZone | null>(null);
  const [dragging, setDragging] = useState(false);
  const measureDropZone = useCallback(() => {
    dropRef.current?.measureInWindow((x, y, width, height) => {
      dropZone.current = { x, y, width, height };
    });
  }, []);
  useEffect(() => measureDropZone(), [measureDropZone, cx, cy, diameter]);

  // Distribution (D-123), INCHANGÉE : 2 cartes ensemble par joueur, puis la 3e, dans l'ordre
  // du serveur (antihoraire), puis le terre carte par carte.
  const serverTerreCount = garam?.terre.length ?? 0;
  const deal = useGaramDealProgress(
    garam?.dealSequence ?? [],
    serverTerreCount,
    dealing,
    onDealDone,
  );
  const cardsOf = (playerId: string) =>
    dealing ? (deal.landed[playerId] ?? 0) : (garam?.handCounts[playerId] ?? 0);
  const myHand = garam ? garam.myHand.slice(0, dealing ? cardsOf(game.viewerId) : undefined) : [];

  const turnPhase = useTurnPhase(game, receivedAt, dealing);
  // Tirage automatique (D-136), main spéciale déclarée par le serveur (D-137) : aucune
  // décision du joueur, donc ni chrono ni barre de tour.
  const phase = garam?.phase === 'DRAW' || garam?.specialPending ? null : turnPhase;
  const remaining = useRemainingMs(phase);
  const notice = useRefusalNotice(game);
  const failure =
    act.error instanceof ApiError && act.error.code !== 'VERSION_CONFLICT'
      ? act.error.message
      : undefined;
  const pendingCard =
    act.isPending && act.variables?.action.type === 'PLAY_CARD'
      ? act.variables.action.cardId
      : undefined;
  // Ma carte lâchée sur la table, comme au Ter (card-flight.ts).
  const [flight, setFlight] = useState<CardFlight | null>(null);
  const onLanded = useCallback(
    (cardId: string) =>
      setFlight((f) => (f && f.cardId === cardId ? { ...f, landed: true } : f)),
    [],
  );
  const rejected =
    act.isError &&
    act.variables?.action.type === 'PLAY_CARD' &&
    act.variables.action.cardId === flight?.cardId;
  const { flightCard, inHand: flightInHand } = flightState(flight, rejected, garam?.myHand ?? []);

  // --- Cartes du tour : au centre jusqu'à la dernière, puis classées chez leur joueur. ---
  const firstCards = garam?.firstCards ?? [];
  const [settled, setSettled] = useState(() => ({
    gameId: game.gameId,
    cards: new Set(firstCards.map((p) => p.cardId)),
  }));
  if (settled.gameId !== game.gameId) {
    setSettled({ gameId: game.gameId, cards: new Set(firstCards.map((p) => p.cardId)) });
  }
  const settle = useCallback(
    (cardId: string) =>
      setSettled((prev) => ({ gameId: prev.gameId, cards: new Set(prev.cards).add(cardId) })),
    [],
  );
  const order = garam?.order ?? [];
  const roundComplete =
    !garam || garam.phase !== 'FIRST_ROUND' || firstCards.length >= order.length;
  /** Toutes les cartes du tour sont classées : le contrôle peut être annoncé. */
  const roundSettled = roundComplete && firstCards.every((p) => settled.cards.has(p.cardId));
  const spotWidth = spotCardWidth(diameter, sw);

  // --- Contrôle : annoncé seulement une fois le tour vu en entier et rangé. ---
  const controllerId = garam?.controllerId;
  const controlShown = Boolean(controllerId) && roundSettled && firstCards.length > 0;
  const controlNotice = useControlNotice(game.gameId, controlShown ? controllerId : undefined);
  // « Je passe » du contrôleur (D-140) : après l'annonce du contrôle, jusqu'à ce que le serveur
  // passe la main (fin de son tour).
  const passingId = garam?.passingPlayerId;
  const passShown = Boolean(passingId) && controlShown && !controlNotice;

  // --- Tirage automatique (D-136) : le SERVEUR tire ; chaque carte vole, une à la fois, de la
  // tête du terre à la zone de son joueur, une fois le premier tour vu et rangé. ---
  const flights = useGaramDrawFlights(game.gameId, garam, roundSettled);
  const shownTotal = order.reduce((n, id) => n + flights.shownOf(id).length, 0);
  // Places du terre FIXES pour la manche : chaque carte garde la sienne jusqu'à son départ.
  const terreSize = serverTerreCount + Object.values(garam?.drawn ?? {}).flat().length;
  const terreBase = shownTotal + (flights.flying ? 1 : 0);
  const terreCards = dealing ? (garam?.terre ?? []).slice(0, deal.terreLanded) : flights.terre;
  const terreSlotOf = (i: number) => geo.terreSlot(dealing ? i : terreBase + i, terreSize);
  const inProgress = game.status === 'in_progress' && garam;

  // --- Fin de manche : révélation, totaux, gagnant, puis panneau de fin. ---
  const revealed = revealedHandsOf(game);
  const ready = !dealing && flights.idle && roundSettled;
  const stage = useGaramReveal(game, ready);
  const presenting = game.status === 'finished' && !stage.done;
  /** Panneau de fin affiché : posé AU-DESSUS des cartes (terre, mains dévoilées, totaux). */
  const resultShown = game.status === 'finished' && !presenting;
  useEffect(() => {
    if (game.status === 'finished' && stage.done) onResultShown();
  }, [game.status, stage.done, onResultShown]);
  const scoreOf = (id: string) => game.result?.scores?.[id] ?? game.garamTie?.scores?.[id];

  // --- Ma zone de départ (main du bas) : mes cartes cachées, puis mes cartes tirées du terre,
  // face visible pour tous. Ma carte jouée va à sa place devant moi, dans la zone du tour. ---
  const handCards = handWithFlight(myHand, flightInHand);
  const myDrawnShown = garam ? flights.shownOf(game.viewerId) : [];
  const zoneCards = [...handCards, ...myDrawnShown];
  const handBottom = m.height - m.safe.bottom;
  const handLeft =
    layout.handLeft + (layout.handSlotWidth - garamHandWidth(zoneCards.length, layout)) / 2;
  const handStep = garamHandStep(zoneCards.length, layout);
  const handTop = handBottom - layout.cardHeight;
  const mySpot = geo.spot('bottom');
  const landingTarget = (index: number) => ({
    dx: mySpot.x - (handLeft + index * handStep + layout.cardWidth / 2),
    dy: mySpot.y - (handTop + layout.cardHeight / 2),
    scale: spotWidth / layout.cardWidth,
  });

  /** Destination d'une carte tirée : la zone de départ de son joueur, après ses cartes. */
  const flightTarget = (playerId: string, index: number) => {
    if (playerId === game.viewerId) {
      const position = handCards.length + index;
      return {
        to: myHandSlot(layout, handBottom, position + 1, position),
        toWidth: layout.cardWidth,
      };
    }
    const backs = zones(sideOf(playerId)).backs;
    const hidden = cardsOf(playerId);
    if (!backs) return { to: { x: cx, y: cy }, toWidth: sw };
    return {
      to: seatHandLayout(backs, sw, hidden + index + 1).center(hidden + index),
      toWidth: sw,
    };
  };

  const small = [styles.smallText, { fontSize: m.smallSize }];
  const ghost = [styles.ghostText, { fontSize: Math.max(9, m.smallSize - 3) }];
  const terreRect = geo.terreRect(Math.max(terreSize, 1), 0);
  const trickRect = geo.trickRect(spotWidth);
  /** Zone de départ d'un adversaire : ses cartes cachées (ou révélées), puis ses tirées. */
  const seatCardsOf = (id: string) => {
    const shown = stage.revealed.includes(id) ? revealed?.[id] : undefined;
    const hidden = shown ? shown.length : cardsOf(id);
    return { shown, hidden, drawn: flights.shownOf(id) };
  };

  return (
    <>
      <View
        accessibilityLabel="Aire de jeu"
        style={[
          styles.absolute,
          { left: cx - diameter / 2, top: cy - diameter / 2, width: diameter, height: diameter },
        ]}
      >
        <WoodTable
          diameter={diameter}
          ring={layout.center.ring}
          ringBorder={layout.center.ringBorder}
        />
      </View>
      <View
        ref={dropRef}
        onLayout={measureDropZone}
        accessibilityLabel="Zone de jeu : déposez une carte ici"
        style={[
          styles.dropZone,
          dragging && styles.dropZoneActive,
          {
            left: cx - dropSize / 2,
            top: cy - dropSize / 2,
            width: dropSize,
            height: dropSize,
            borderRadius: dropSize / 2,
          },
        ]}
      />

      {/* Zone « cartes du tour » : visible pendant le 1er tour seulement. */}
      {inProgress && !dealing && garam.phase === 'FIRST_ROUND' ? (
        <View
          testID="garam-trick-zone"
          pointerEvents="none"
          style={[styles.absolute, styles.trickZone, rectStyle(trickRect)]}
        >
          <Text style={[ghost, styles.zoneCaption]}>Cartes du tour</Text>
        </View>
      ) : null}

      {/* Terre public : rang en haut de la table, tête à gauche, places fixes. */}
      {garam && terreSize > 0 ? (
        <View
          testID="garam-terre"
          accessibilityLabel={`Terre : ${terreCards.length} carte${terreCards.length > 1 ? 's' : ''}, tête à gauche`}
          pointerEvents="none"
          style={[styles.absolute, styles.terreZone, framed(terreRect, layout.gap * 0.4)]}
        >
          <Text style={[ghost, styles.terreCaption, { top: -m.smallSize - 2 }]}>
            Terre · tête → queue
          </Text>
        </View>
      ) : null}
      {terreCards.map((cardId, i) => {
        const slot = terreSlotOf(i);
        return (
          <View
            key={cardId}
            testID={`garam-terre-card-${i}`}
            pointerEvents="none"
            style={[
              styles.absolute,
              {
                left: slot.x - geo.terreWidth / 2,
                top: slot.y - (geo.terreWidth * CARD_RATIO) / 2,
                // De gauche à droite, la tête (1re carte posée) au-dessus des suivantes ; le
                // faible chevauchement laisse la valeur de chacune visible. Aucune rotation :
                // chaque joueur voit le terre droit, face à lui, sur son écran.
                zIndex: 5 + (terreCards.length - i),
              },
            ]}
          >
            <CardFace cardId={cardId} width={geo.terreWidth} />
          </View>
        );
      })}
      {flights.flying ? (
        // Carte tirée par le serveur (tirage automatique, D-136) : de la tête du terre à la zone
        // de son joueur, face visible, une seule à la fois.
        <TerreFlight
          key={`${flights.flying.playerId}:${flights.flying.cardId}`}
          cardId={flights.flying.cardId}
          from={geo.terreSlot(shownTotal, terreSize)}
          fromWidth={geo.terreWidth}
          {...flightTarget(flights.flying.playerId, flights.flying.index)}
          upsideDown={sideOf(flights.flying.playerId) === 'top'}
          onLanded={flights.land}
        />
      ) : null}

      {/* Joueurs : zone de départ (cartes cachées puis tirées), plaque, carte classée. */}
      {seats.map(({ seat, side, player }) => {
        const z = zones(side);
        const mine = player?.playerId === game.viewerId;
        const id = player?.playerId ?? '';
        const rows = rowsOf(side);
        const first = player ? firstCards.find((p) => p.playerId === id)?.cardId : undefined;
        const classified = first && settled.cards.has(first) ? first : undefined;
        const cards = player ? seatCardsOf(id) : undefined;
        const total =
          player && stage.revealed.includes(id) && game.status === 'finished'
            ? scoreOf(id)
            : undefined;
        const seatHand =
          player && !mine && z.backs && garam && cards
            ? seatHandLayout(z.backs, sw, cards.hidden + cards.drawn.length)
            : undefined;
        return (
          <Fragment key={seat}>
            {seatHand && cards && z.backs ? (
              <View
                testID={`garam-start-zone-${id}`}
                accessibilityLabel={`${playerLabel(game, id)} : ${cards.shown ? 'cartes dévoilées' : `${cards.hidden} carte${cards.hidden > 1 ? 's' : ''} cachée${cards.hidden > 1 ? 's' : ''}`}, ${cards.drawn.length} tirée${cards.drawn.length > 1 ? 's' : ''} du terre`}
                pointerEvents="none"
                style={[
                  styles.absolute,
                  {
                    left: z.backs.left,
                    top: z.backs.top,
                    width: z.backs.width,
                    height: sw * CARD_RATIO,
                  },
                ]}
              />
            ) : null}
            {seatHand && cards
              ? [
                  ...(cards.shown
                    ? cards.shown.map((cardId) => ({ cardId, kind: 'revealed' as const }))
                    : Array.from({ length: cards.hidden }, (_, i) => ({
                        cardId: `back-${i}`,
                        kind: 'back' as const,
                      }))),
                  ...cards.drawn.map((cardId) => ({ cardId, kind: 'drawn' as const })),
                ].map(({ cardId, kind }, index) => {
                  const c = seatHand.center(index);
                  const place = {
                    left: c.x - sw / 2,
                    top: c.y - (sw * CARD_RATIO) / 2,
                    zIndex: 3 + index,
                  };
                  const upsideDown = side === 'top' ? styles.upsideDown : null;
                  if (kind === 'back') {
                    return (
                      <CardBack
                        key={`${id}:${cardId}`}
                        width={sw}
                        style={[styles.absolute, place]}
                      />
                    );
                  }
                  if (kind === 'revealed') {
                    // Carte cachée qui se retourne sur place.
                    return (
                      <RevealIn
                        key={`${game.gameId}:${id}:${cardId}`}
                        style={[styles.absolute, place, upsideDown]}
                      >
                        <CardFace cardId={cardId} width={sw} />
                      </RevealIn>
                    );
                  }
                  return (
                    <View key={`${id}:${cardId}`} style={[styles.absolute, place, upsideDown]}>
                      <CardFace cardId={cardId} width={sw} />
                      <View
                        pointerEvents="none"
                        style={[
                          StyleSheet.absoluteFill,
                          styles.drawnMark,
                          { borderRadius: sw * 0.1 },
                        ]}
                      />
                    </View>
                  );
                })
              : null}
            {seatHand && total !== undefined && z.backs ? (
              <TotalChip
                testID={`garam-total-${id}`}
                total={total}
                winner={stage.winner && game.result?.winnerId === id}
                center={{
                  x: z.backs.left + z.backs.width / 2,
                  y: z.backs.top + sw * CARD_RATIO * 0.78,
                }}
                fontFamily={fonts.button}
                size={m.smallSize}
              />
            ) : null}
            <SeatPlate
              state={
                player
                  ? garamSeatState(game, player, { controlShown, winnerShown: stage.winner })
                  : undefined
              }
              width={pw}
              height={ph}
              align={side === 'bottom' ? 'bottom' : 'top'}
              turn={seatTurnFor(phase, player?.playerId, game.viewerId)}
              style={z.plate}
            />
            {player && garam ? (
              <>
                <View
                  testID={`garam-classified-${id}`}
                  accessibilityLabel={`${mine ? 'Ma carte' : `Carte de ${playerLabel(game, id)}`} du 1er tour : ${classified ? 'classée' : 'aucune'}`}
                  pointerEvents="none"
                  style={[styles.absolute, styles.classifiedFrame, rectStyle(rows.classifiedRect)]}
                >
                </View>
                {classified ? (
                  <PublicRow
                    cardIds={[classified]}
                    width={rows.classified.cardWidth}
                    upsideDown={side === 'top'}
                    style={(({ left, top }) => ({ left, top }))(publicRowBox(rows.classified, 1))}
                  />
                ) : null}
              </>
            ) : null}
          </Fragment>
        );
      })}

      {/* Halo du joueur qui prend le contrôle, une fois le tour classé. */}
      {controlNotice
        ? (() => {
            const side = sideOf(controlNotice);
            const z = zones(side);
            const height = plateContentHeight(ph, false);
            const top = side === 'bottom' ? z.plate.top + ph - height : z.plate.top;
            return (
              <ControlGlow
                key={`${game.gameId}:control`}
                rect={{ left: z.plate.left, top, width: pw, height }}
              />
            );
          })()
        : null}

      {resultShown ? null : center(presenting)}

      {/* Ma main : cachée aux autres ; seules les cartes que le serveur autorise se glissent. */}
      {garam && (inProgress || game.status === 'finished') ? (
        <View
          testID="garam-my-start-zone"
          accessibilityLabel={`Mes cartes : ${handCards.length} en main, ${myDrawnShown.length} tirée${myDrawnShown.length > 1 ? 's' : ''} du terre`}
          style={[styles.hand, { left: handLeft, bottom: m.safe.bottom }]}
        >
          {myDrawnShown.map((cardId, i) => (
            // Cartes tirées du terre : après mes cartes cachées, visibles de tous.
            <View
              key={cardId}
              style={[
                styles.absolute,
                {
                  left: (handCards.length + i) * handStep,
                  bottom: 0,
                  zIndex: 10 + handCards.length + i,
                },
              ]}
            >
              <CardFace cardId={cardId} width={layout.cardWidth} />
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  styles.drawnMark,
                  { borderRadius: layout.cardWidth * 0.1 },
                ]}
              />
            </View>
          ))}
          {handCards.map((cardId, index) => {
            const playable =
              Boolean(inProgress) &&
              myHand.includes(cardId) &&
              !dealing &&
              !act.isPending &&
              game.myActions.canPlayCard &&
              game.myActions.playableCardIds.includes(cardId);
            return (
              <DraggableCard
                key={cardId}
                cardId={cardId}
                width={layout.cardWidth}
                pending={pendingCard === cardId}
                held={flightCard === cardId}
                landingTarget={landingTarget(index)}
                onLanded={onLanded}
                enabled={playable}
                getDropZone={() => (playable ? dropZone.current : null)}
                onDragChange={(active) => {
                  setDragging(active);
                  if (active) measureDropZone();
                }}
                onDrop={(id) => {
                  setFlight({ cardId: id, index, landed: false });
                  act.send({ type: 'PLAY_CARD', cardId: id }, game.version);
                }}
                style={{
                  marginLeft: index === 0 ? 0 : handStep - layout.cardWidth,
                  zIndex: 10 + index,
                }}
              />
            );
          })}
          {/* Place réservée aux cartes tirées (positionnées en absolu ci-dessus). */}
          {myDrawnShown.length > 0 ? (
            <View style={{ width: myDrawnShown.length * handStep, height: layout.cardHeight }} />
          ) : null}
        </View>
      ) : null}
      {garam && game.status === 'finished' && stage.revealed.includes(game.viewerId) ? (
        (() => {
          const total = scoreOf(game.viewerId);
          return total === undefined ? null : (
            <TotalChip
              testID={`garam-total-${game.viewerId}`}
              total={total}
              winner={stage.winner && game.result?.winnerId === game.viewerId}
              center={{
                x: handLeft + garamHandWidth(zoneCards.length, layout) / 2,
                y: handTop + layout.cardHeight * 0.78,
              }}
              fontFamily={fonts.button}
              size={m.smallSize}
            />
          );
        })()
      ) : null}

      {dealing
        ? deal.flying.map(({ step, key }) => {
            if (step.kind === 'terre') {
              // Pioche (centre) → place de la carte dans le rang du terre.
              return (
                <DealFlight
                  key={key}
                  batch={{ pass: 0, playerId: 'terre', count: 1 }}
                  from={{ x: cx, y: cy }}
                  to={geo.terreSlot(step.index, terreSize)}
                  width={geo.terreWidth}
                  onLanded={deal.land}
                />
              );
            }
            const { batch } = step;
            const side = sideOf(batch.playerId);
            const backs = zones(side).backs;
            const to =
              side === 'bottom' || !backs
                ? {
                    x: layout.handLeft + layout.handSlotWidth / 2,
                    y: m.height - m.safe.bottom - layout.cardHeight / 2,
                  }
                : { x: backs.left + backs.width / 2, y: backs.top + (sw * CARD_RATIO) / 2 };
            return (
              <DealFlight
                key={key}
                batch={batch}
                from={{ x: cx, y: cy }}
                to={to}
                width={sw}
                onLanded={deal.land}
              />
            );
          })
        : null}

      {/* Consigne du tour : sous la zone du tour (1er tour), au centre pendant le tirage. */}
      {inProgress && !dealing ? (
        <View
          style={[
            styles.absolute,
            styles.centerBand,
            {
              left: cx - diameter * 0.4,
              width: diameter * 0.8,
              top:
                garam.phase === 'FIRST_ROUND'
                  ? trickRect.top + trickRect.height + 2
                  : geo.spot('top').y,
              gap: m.gap * 0.4,
            },
          ]}
          pointerEvents="box-none"
        >
          {controlNotice ? (
            <GlassBox style={styles.chip}>
              <Text testID="garam-control-notice" accessibilityLiveRegion="polite" style={[small, styles.gold]}>
                {controlNotice === game.viewerId
                  ? 'Vous prenez le contrôle'
                  : `${playerLabel(game, controlNotice)} prend le contrôle`}
              </Text>
            </GlassBox>
          ) : garam.specialPending ? (
            <SpecialAnnounce style={small} />
          ) : passShown && passingId ? (
            <GlassBox style={styles.chip}>
              <Text
                testID="garam-pass-notice"
                accessibilityLiveRegion="assertive"
                style={[
                  styles.centerText,
                  styles.gold,
                  fontOf(fonts.button),
                  { fontSize: m.bodySize * 1.05 },
                ]}
              >
                {passingId === game.viewerId
                  ? 'Vous : « Je passe »'
                  : `${playerLabel(game, passingId)} : « Je passe »`}
              </Text>
            </GlassBox>
          ) : (
            <Text style={small}>{garamTurnMessage(game)}</Text>
          )}
          {garam.myTotal !== undefined && garam.phase === 'DRAW' ? (
            <Text style={small}>{`Mon total : ${garam.myTotal}`}</Text>
          ) : null}
          {notice ? (
            <GlassBox style={styles.chip}>
              <Text accessibilityLiveRegion="polite" style={small}>
                {notice}
              </Text>
            </GlassBox>
          ) : null}
          {failure ? (
            <GlassBox style={styles.chip}>
              <Text accessibilityRole="alert" style={[small, styles.error]}>
                {failure}
              </Text>
            </GlassBox>
          ) : null}
        </View>
      ) : null}

      {/* Fin de manche présentée : gagnant (ou égalité) au centre, avant le panneau de fin. */}
      {game.status === 'finished' && stage.winner && !stage.done ? (
        <View
          pointerEvents="none"
          style={[
            styles.absolute,
            styles.centerBand,
            { left: cx - diameter * 0.4, width: diameter * 0.8, top: geo.spot('top').y },
          ]}
        >
          <GlassBox style={[styles.banner, { padding: m.gap * 0.8, gap: m.gap * 0.3 }]}>
            <WinnerBanner game={game} stage={stage} fontFamily={fonts.button} size={m.bodySize} t={t} />
          </GlassBox>
        </View>
      ) : null}

      {/* Cartes du 1er tour : devant leur joueur jusqu'à la dernière, puis classées chez lui. */}
      {firstCards.map((p) => {
        if (settled.cards.has(p.cardId)) return null;
        if (p.cardId === flightInHand?.cardId) return null;
        const side = sideOf(p.playerId);
        const rows = rowsOf(side);
        return (
          <PlayedCardSpotlight
            key={`${game.gameId}:${p.cardId}`}
            cardId={p.cardId}
            from={geo.spot(side)}
            to={rowSlotCenter(rows.classified, 0)}
            width={spotWidth}
            targetWidth={rows.classified.cardWidth}
            angle={SPOT_ANGLE[side]}
            instant={p.cardId === flightCard && p.playerId === game.viewerId}
            release={roundComplete}
            onSettled={settle}
          />
        );
      })}



      {/* Chrono numérique : SEULEMENT chez le joueur attendu (25 s affichées, D-143). Les
          adversaires ne voient que la barre dans sa plaque (`seatTurnFor`). */}
      {phase && remaining !== null && dialVisibleFor(phase, game.viewerId) ? (
        <View
          style={[
            styles.absolute,
            {
              left: m.safe.left + layout.gap,
              bottom: m.safe.bottom + layout.gap,
              width: layout.control * 1.6,
              height: layout.control * 1.6,
            },
          ]}
        >
          <TimerDial
            size={layout.control * 1.6}
            fraction={remaining / phase.totalMs}
            urgent={remaining < 2_000}
          />
          <View style={[StyleSheet.absoluteFill, styles.centered]}>
            <Text
              style={[styles.dialText, fontOf(fonts.button), { fontSize: layout.control * 0.6 }]}
            >
              {Math.ceil(remaining / 1000)}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Fin de manche : la table s'assombrit sous le panneau de résultat, rendu en dernier et
          au-dessus de toutes les cartes, pour que le message et le montant restent lisibles. */}
      {resultShown ? (
        <View testID="garam-result-layer" pointerEvents="box-none" style={styles.resultLayer}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.resultScrim]} />
          {center(false)}
        </View>
      ) : null}
    </>
  );
}

const rectStyle = (r: Rect) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
const framed = (r: Rect, pad: number) => ({
  left: r.left - pad,
  top: r.top - pad,
  width: r.width + pad * 2,
  height: r.height + pad * 2,
});

/** Gagnant (ou égalité) annoncé au centre, d'après le résultat du serveur. */
function WinnerBanner({
  game,
  stage,
  fontFamily,
  size,
  t,
}: {
  game: GameView;
  stage: GaramRevealStage;
  fontFamily: string | undefined;
  size: number;
  t: ReturnType<typeof useMessages>['gameOver'];
}) {
  const title = [
    styles.centerText,
    fontFamily ? { fontFamily } : { fontWeight: '700' as const },
    { fontSize: size * 1.15 },
  ];
  const line = [styles.smallText, { fontSize: size * 0.9 }];
  if (!stage.winner) return null;
  if (game.endReason === 'GARAM_TIE') {
    return (
      <>
        <Text testID="garam-banner" style={title}>
          Égalité
        </Text>
        <Text style={line}>Nouvelle manche</Text>
      </>
    );
  }
  const result = game.result;
  if (!result) return null;
  const score = result.scores?.[result.winnerId];
  return (
    <>
      <Text testID="garam-banner" style={title}>
        {`🏆 ${playerLabel(game, result.winnerId)}`}
      </Text>
      <Text style={line}>
        {score !== undefined
          ? // 22 points = deux As (D-130) : « Gagne avec deux As », jamais « 22 points ».
            score === GARAM_TWO_ACES_SCORE
            ? t.garamTwoAcesBanner
            : `${score} points`
          : result.garamCondition
            ? t.garamAutomatic(t.garamConditions[result.garamCondition] ?? '')
            : 'Vainqueur'}
      </Text>
    </>
  );
}

/**
 * Main spéciale déclarée par le serveur (D-137) : annonce légère, visible par TOUS les joueurs
 * pendant le court délai qui précède la victoire (`specialPending`, état du serveur). Aucun
 * bouton, aucune commande : l'écran présente la transition, le serveur la décide. Elle
 * apparaît en douceur (instantanée si « Réduire les animations ») ; rerendu ou reconnexion ne
 * déclenchent rien, l'annonce suit seulement l'état reçu.
 */
function SpecialAnnounce({ style }: { style: StyleProp<TextStyle> }) {
  const [progress] = useState(() => new Animated.Value(0));
  const reduced = useReducedMotion();
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? 0 : 260,
      easing: Easing.out(Easing.back(2)),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced]);
  return (
    <Animated.View
      testID="garam-special-announce"
      style={{
        opacity: progress,
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
      }}
    >
      <GlassBox style={styles.chip}>
        <Text accessibilityLiveRegion="polite" style={[style, styles.gold]}>
          ✨ Main spéciale !
        </Text>
      </GlassBox>
    </Animated.View>
  );
}

/** Total d'un joueur (calculé par le serveur), posé sur sa zone de départ dévoilée. */
function TotalChip({
  testID,
  total,
  winner,
  center,
  fontFamily,
  size,
}: {
  testID: string;
  total: number;
  winner: boolean;
  center: { x: number; y: number };
  fontFamily: string | undefined;
  size: number;
}) {
  const width = size * 5;
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[
        styles.absolute,
        { left: center.x - width / 2, top: center.y - size, width, zIndex: 25, alignItems: 'center' },
      ]}
    >
      <GlassBox style={[styles.chip, winner && styles.winnerChip]}>
        <Text style={[styles.total, fontOf(fontFamily), { fontSize: size }]}>{`Total ${total}`}</Text>
      </GlassBox>
    </View>
  );
}

/** Carte tirée du terre : vole, face visible, de la tête du terre à la zone de son joueur. */
function TerreFlight({
  cardId,
  from,
  fromWidth,
  to,
  toWidth,
  upsideDown,
  onLanded,
}: {
  cardId: string;
  from: { x: number; y: number };
  fromWidth: number;
  to: { x: number; y: number };
  toWidth: number;
  upsideDown: boolean;
  onLanded: () => void;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  const reduced = useReducedMotion();
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      // « Réduire les animations » : transition courte, la carte rejoint quand même son joueur.
      duration: reduced ? GARAM_DRAW_FLIGHT_REDUCED_MS : GARAM_DRAW_FLIGHT_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => finished && onLanded());
    return () => animation.stop();
  }, [progress, onLanded, reduced]);
  const height = fromWidth * CARD_RATIO;
  return (
    <Animated.View
      testID="garam-draw-flight"
      pointerEvents="none"
      accessibilityLabel="Carte tirée du terre"
      style={[
        styles.absolute,
        {
          left: from.x - fromWidth / 2,
          top: from.y - height / 2,
          zIndex: 30,
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
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [1, toWidth / fromWidth],
              }),
            },
            {
              rotate: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', upsideDown ? '180deg' : '0deg'],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.flightGlow}>
        <CardFace cardId={cardId} width={fromWidth} />
      </View>
    </Animated.View>
  );
}

/** Révélation d'une carte cachée : elle se retourne sur place (largeur 0 → 1). */
function RevealIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress]);
  return (
    <Animated.View pointerEvents="none" style={style}>
      <Animated.View
        style={{
          opacity: progress,
          transform: [
            { scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [0.1, 1] }) },
          ],
        }}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Annonce du contrôle : le joueur qui le prend est mis en évidence quelques instants, une
 * seule fois par manche, quand les cartes du tour sont classées.
 */
function useControlNotice(gameId: string, controllerId: string | undefined): string | undefined {
  const key = controllerId ? `${gameId}|${controllerId}` : null;
  const [shown, setShown] = useState<{ key: string | null; visible: boolean }>({
    key: null,
    visible: false,
  });
  if (key && shown.key !== key) setShown({ key, visible: true });
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(
      () => setShown((s) => (s.key === key ? { ...s, visible: false } : s)),
      GARAM_CONTROL_NOTICE_MS,
    );
    return () => clearTimeout(timer);
  }, [key]);
  return key && shown.key === key && shown.visible ? controllerId : undefined;
}

/** Plaque d'un joueur : état lu dans la vue du serveur uniquement. */
function garamSeatState(
  game: GameView,
  player: PlayerInGame,
  { controlShown, winnerShown }: { controlShown: boolean; winnerShown: boolean },
): SeatState {
  const id = player.playerId;
  const garam = game.garam;
  const winner = game.status === 'finished' && winnerShown && game.result?.winnerId === id;
  const active = game.status === 'in_progress' && game.activePlayerId === id;
  const parts: string[] = [];
  if (winner) parts.push('Gagnant');
  else if (active) parts.push(id === game.viewerId ? 'À vous de jouer' : 'À son tour');
  if (garam?.dealerId === id) parts.push('Dégageur');
  if (controlShown && garam?.controllerId === id) parts.push('Contrôle');
  if (game.status === 'waiting' && id === game.creatorId) parts.push('Créateur');
  return {
    name: playerLabel(game, id),
    local: id === game.viewerId,
    active,
    firstPlayer: game.firstPlayerId === id,
    detail: parts.join(' · ') || undefined,
    dimmed: false,
    winner,
  };
}

/** Consigne du tour, d'après l'état du serveur. */
export function garamTurnMessage(game: GameView): string {
  const garam = game.garam;
  if (!garam) return '';
  const active = game.activePlayerId;
  // Tirage automatique (D-136) : le serveur tire pour le joueur attendu, sans action de sa part.
  if (garam.phase === 'DRAW') {
    // « Je passe » (D-140) : annoncé à part, personne ne tire pendant ce tour.
    if (!active || garam.passingPlayerId) return '';
    return active === game.viewerId
      ? 'Tirage automatique…'
      : `${playerLabel(game, active)} tire au terre`;
  }
  if (game.turnTimedOutAt) return 'Temps écoulé : action automatique';
  const mine = active === game.viewerId;
  if (garam.phase === 'FIRST_ROUND') {
    if (mine) {
      return garam.firstCards.length === 0
        ? 'Dégagez : déposez une carte au centre'
        : 'Déposez une carte (même signe si vous en avez)';
    }
    return active ? `${playerLabel(game, active)} joue sa carte` : '';
  }
  return '';
}

/**
 * Notification de 2 s (§7.13) quand un tirage s'arrête : « Impossible » (la carte ferait
 * dépasser 21) ou terre vide. Le « Je passe » du contrôleur (D-140) a déjà été annoncé pendant
 * son tour : il n'est pas répété ici.
 */
function useRefusalNotice(game: GameView): string | null {
  const last = game.garam?.lastRefusal;
  const refusal = last?.passed ? undefined : last;
  const key = refusal ? `${refusal.playerId}|${game.garam?.drawDone.length}` : null;
  const [shown, setShown] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (key !== shown) {
    setShown(key);
    setNotice(
      refusal
        ? refusal.cardId
          ? `${playerLabel(game, refusal.playerId)} : Impossible`
          : `${playerLabel(game, refusal.playerId)} : plus de carte au terre`
        : null,
    );
  }
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return notice;
}

/**
 * Proposition de doubler la mise (§3.15), au centre de la table pendant que la manche nulle
 * attend : chaque joueur répond une fois ; le serveur double seulement si tous acceptent.
 */
export function GaramStakeVotePanel({ game }: { game: GameView }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const act = useGameAction(game.gameId);
  const vote = game.garamStakeVote;
  if (!vote) return null;
  const text = [styles.centerText, fontOf(fonts.button), { fontSize: m.bodySize * 1.05 }];
  const small = [styles.smallText, { fontSize: m.smallSize }];
  const failure = act.error instanceof ApiError ? act.error.message : undefined;
  return (
    <View style={[styles.centerRow, { gap: m.gap * 0.6 }]}>
      <Text style={text}>Manche nulle</Text>
      <Text style={small}>{`Doubler la mise : ${vote.previousStake} → ${vote.proposedStake} ?`}</Text>
      {vote.canVote ? (
        <View style={[styles.row, { gap: m.gap }]}>
          <PanelButton
            title="Oui"
            loading={act.isPending}
            onPress={() => act.send({ type: 'STAKE_VOTE', accept: true })}
          />
          <PanelButton
            title="Non"
            onPress={() => act.send({ type: 'STAKE_VOTE', accept: false })}
          />
        </View>
      ) : (
        <Text style={small}>
          {vote.myVote === undefined
            ? 'En attente des réponses…'
            : `Réponse envoyée (${vote.myVote ? 'oui' : 'non'}). En attente des autres joueurs…`}
        </Text>
      )}
      <Text style={small}>
        {`${vote.answeredPlayerIds.length}/${game.players.length} réponse${game.players.length > 1 ? 's' : ''}`}
      </Text>
      {failure ? <Text style={[small, styles.error]}>{failure}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute' },
  // Couche du panneau de fin : plein écran, au-dessus des cartes (zIndex jusqu'à 30).
  resultLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, elevation: 100 },
  resultScrim: { backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  centerRow: { alignItems: 'center' },
  centerBand: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  hand: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end' },
  dropZone: { position: 'absolute', borderWidth: 2, borderColor: 'transparent' },
  dropZoneActive: {
    borderColor: 'rgba(242, 196, 81, 0.85)',
    backgroundColor: 'rgba(242, 196, 81, 0.14)',
    boxShadow: '0 0 22px rgba(242, 196, 81, 0.5)',
  },
  // Zone « cartes du tour » : pointillé discret sur le bois.
  trickZone: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 245, 225, 0.35)',
  },
  zoneCaption: { position: 'absolute', top: 2, left: 6 },
  // Terre : bande sombre qui le détache des cartes du tour.
  terreZone: {
    borderRadius: 8,
    backgroundColor: 'rgba(4, 30, 12, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.45)',
  },
  terreCaption: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
  // Carte classée du 1er tour : cadre neutre.
  classifiedFrame: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    backgroundColor: 'rgba(4, 30, 12, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Carte tirée du terre : fin liseré doré, visible de tous.
  drawnMark: { borderWidth: 1.5, borderColor: 'rgba(242, 196, 81, 0.9)' },
  upsideDown: { transform: [{ rotate: '180deg' }] },
  frameGhost: { textAlign: 'center' },
  ghostText: { color: 'rgba(255, 245, 225, 0.6)' },
  flightGlow: { borderRadius: 8, boxShadow: '0 0 16px rgba(242, 196, 81, 0.6)' },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  winnerChip: { borderWidth: 1.5, borderColor: '#F5C842' },
  banner: { alignItems: 'center', borderRadius: 14 },
  centerText: { color: '#FFFFFF', textAlign: 'center' },
  smallText: { color: 'rgba(255, 255, 255, 0.85)', textAlign: 'center' },
  total: { color: palette.gold },
  gold: { color: palette.gold },
  error: { color: palette.error },
  dialText: { color: '#FFFFFF' },
});
