import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';

import {
  fontOf,
  tablePalette as palette,
  useTableFonts,
} from '../../../components/table/TableDecor';
import { displayedDeadline } from '../../../hooks/use-server-countdown';
import { ApiError } from '../../../lib/api-client';
import { useMessages } from '../../../lib/i18n';
import { useGameUiStore } from '../../../stores/game-ui-store';
import { garamVariantLabel, type GameView, type PlayerInGame } from '../../../types/game';
import { useLobbyMetrics } from '../../lobby/lobby-metrics';
import { Coin, PanelButton } from '../../lobby/LobbyUi';
import { SettingsPanel } from '../../lobby/SettingsPanel';
import { walletKey } from '../../wallet/hooks';
import { useLeaveSession, useSession, useSessionDecision } from '../../sessions/hooks';
import type { SessionView } from '../../../types/session';
import { DraggableCard, type DropZone } from '../DraggableCard';
import { ReconnectionPanel } from '../ReconnectionPanel';
import { gameScreenContent, useGameReconnection } from '../use-game-reconnection';
import { playerLabel } from '../format';
import { chatKeys } from '../../chat/hooks';
import {
  gameKeys,
  isGameId,
  MIN_PLAYERS_TO_START,
  useGame,
  useGameAction,
  useStartGame,
} from '../hooks';
import { useGameUpdates, useTournamentSettlementUpdates } from '../game-updates';
import { TournamentTableWaiting } from './TournamentTableWaiting';
import { GaramPlayArea, GaramStakeVotePanel } from '../garam/GaramPlayArea';
import { TournamentTableHud } from './TournamentTableHud';
import { tournamentKeys, useTournamentSignals } from '../../tournaments/hooks';
import { CARD_RATIO, HiddenHand } from './Cards';
import { GameChat, useGameChatWithUnread } from '../../chat/GameChat';
import { GameGeolocation } from '../../geolocation/GameGeolocation';
import { GameOverPanel } from './GameOverPanel';
import { usePlayerDistances } from './distance';
import { planPresentation, publicPlays, turnHeld } from './presentation-plan';
import { flightState, handWithFlight, type CardFlight } from './card-flight';
import { useTableBalanceLabel } from './table-balance';
import {
  DealFlight,
  FAP_FAP_PLAYED_CARD_MOVE_MS,
  handZoneRect,
  PlayedCardSpotlight,
  PlayedCardsZone,
  SPOT_ANGLE,
  SPOT_OFFSET,
  playedRowIn,
  playedZones,
  publicCardLeft,
  seatZones,
  smallCardWidth,
  spotCardWidth,
  useDealProgress,
} from './TableCards';
import {
  arrangeSeats,
  computeGameTableLayout,
  handStepFor,
  handWidthOf,
  type GameTableLayout,
  type SeatSide,
} from './table-layout';
import { useTableDealing } from './deal-phase';
import { seatTurnFor, useTurnPhase } from './turn-phase';
import {
  controllerOf,
  playerOfControlSignal,
  playerOfTurnKey,
  turnKeyOf,
  useControlSignal,
  useTurnSignal,
} from './turn-signal';
import { FarewellHand, TurnActions, TurnGlow, TurnHud, useFarewell } from './TurnHud';
import {
  BalancePill,
  ControlGlow,
  DistanceTag,
  ExitGlyph,
  FeltBackdrop,
  GlassBox,
  plateContentHeight,
  SeatPlate,
  SoftIconButton,
  WoodTable,
  type SeatState,
} from './TableParts';

/**
 * Écran d'UNE partie (D-017), identifiée par la route : une table de jeu vue de dessus.
 *
 * Hiérarchie visuelle : 1. la table en bois (aire de jeu, zone de dépôt des cartes),
 * 2. les joueurs autour (plaques compactes et translucides, sens antihoraire, le joueur
 * connecté en bas), 3. l'état de la partie (au centre de la table), 4. les contrôles
 * discrets dans les coins, 5. le chat et les informations secondaires.
 *
 * Tout ce qui est affiché vient du serveur (D-008) : aucun état, nom ou distance inventé.
 */
export function GameTableScreen() {
  const { gameId, reprise } = useLocalSearchParams<{ gameId: string; reprise?: string }>();
  const valid = isGameId(gameId);
  const game = useGame(valid ? gameId : '');
  // Carte acceptée par le serveur : nouvel état relu aussitôt chez tous les joueurs (D-101).
  useGameUpdates(valid ? gameId : '');
  // Partie de tournoi : bilan fictif relu dès que son règlement est écrit (D-111).
  useTournamentSettlementUpdates(valid ? gameId : '', game.data?.tournamentId);
  // Reprise après une absence : l'état est relu sur le serveur, jamais reconstruit localement.
  const reconnection = useGameReconnection(game, { resume: reprise === '1' });

  const view = gameScreenContent({
    hasData: game.data !== undefined,
    error: game.error,
    reconnecting: reconnection.state !== null,
  });

  let content;
  if (!valid) {
    content = <CenteredMessage message="Identifiant de partie invalide." />;
  } else if (view === 'table' && game.data) {
    // Une partie = un état d'écran : nouvelle partie (Poursuivre, égalité) → tout repart à neuf
    // (mains, cartes jouées, animations), jamais de cartes de l'ancienne partie.
    content = <GameTable key={game.data.gameId} game={game.data} receivedAt={game.dataUpdatedAt} />;
  } else if (view === 'retry') {
    // Serveur injoignable avant le premier état : la partie continue côté serveur ; on réessaie.
    content = (
      <ReconnectionPanel
        state={game.isFetching ? 'restoring' : 'failed'}
        onRetry={reconnection.retry}
        secondary={{ title: 'Accueil', onPress: goHome }}
      />
    );
  } else if (view === 'message') {
    // Partie inaccessible (non membre, introuvable) : aucune navigation forcée.
    content = (
      <CenteredMessage
        message={game.error instanceof ApiError ? game.error.message : 'Partie indisponible.'}
      />
    );
  } else if (view === 'loading') {
    content = (
      <View style={styles.fill}>
        <ActivityIndicator color={palette.gold} size="large" />
      </View>
    );
  }
  return (
    <FeltBackdrop>
      {content}
      {/* Table affichée (ou reprise en cours) mais état périmé : relecture sur le serveur. */}
      {(view === 'table' || view === 'restoring') && reconnection.state ? (
        <ReconnectionPanel state={reconnection.state} onRetry={reconnection.retry} />
      ) : null}
    </FeltBackdrop>
  );
}

/** Retour à l'accueil (sans empiler d'écran) : jamais vers un écran technique. */
function goHome() {
  router.dismissTo('/');
}

/** Passe à une autre partie de la même table (égalité rejouée, partie suivante). */
function openGame(gameId: string) {
  router.replace(`/game/${gameId}`);
}

function CenteredMessage({ message }: { message: string }) {
  const m = useLobbyMetrics();
  return (
    <View style={styles.fill}>
      <GlassBox style={{ padding: m.gap * 1.5, gap: m.gap }}>
        <Text style={[styles.centerText, { fontSize: m.bodySize }]}>{message}</Text>
        <PanelButton title="Accueil" onPress={goHome} />
      </GlassBox>
    </View>
  );
}

type Overlay = 'settings' | null;

/** Durée d'affichage d'un refus de départ du serveur. */
const QUIT_REFUSAL_MS = 4_000;

function GameTable({ game, receivedAt }: { game: GameView; receivedAt: number }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  // Place des dos de cartes du siège d'en face réservée entièrement s'il est OCCUPÉ ; siège vide,
  // une part seulement (`EMPTY_TOP_SEAT_RESERVE`) : la table remonte sans toucher le haut.
  const layout = computeGameTableLayout(m, {
    topSeat: arrangeSeats(game).some((s) => s.side === 'top' && s.player),
    emptyTopSeat: arrangeSeats(game).some((s) => s.side === 'top' && !s.player),
  });
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // Résultat annoncé à l'écran : partie terminée ET dernière carte présentée (D-041).
  const [announcedGameId, setAnnouncedGameId] = useState<string | null>(null);
  const resultAnnounced = game.status === 'finished' && announcedGameId === game.gameId;
  const onResultShown = useCallback(() => setAnnouncedGameId(game.gameId), [game.gameId]);
  // Aucun nouveau solde avant l'annonce du résultat (D-080) : figé pendant la présentation.
  const balance = useTableBalanceLabel(game.status === 'finished' && !resultAnnounced);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  // Chat suivi dès l'arrivée sur la table (temps réel + badge), affiché à la demande.
  const { chat, unread } = useGameChatWithUnread(game.gameId, game.viewerId, chatOpen);
  const queryClient = useQueryClient();
  // Fin de partie : l'état d'envoi du chat est relu (lecture seule, décidé par le serveur),
  // ainsi que la partie, dont la lecture porte mon bilan réglé (D-074).
  useEffect(() => {
    if (game.status === 'finished') {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.history(game.gameId),
      });
      void queryClient.invalidateQueries({ queryKey: gameKeys.detail(game.gameId) });
    }
  }, [queryClient, game.status, game.gameId]);
  // Fin (règlement, D-074) : le solde est relu au moment où le résultat est ANNONCÉ, pas
  // quand le serveur termine la partie (le dernier tour est encore présenté, D-041, D-080).
  useEffect(() => {
    if (!resultAnnounced) return;
    // Table de tournoi : seuls les jetons de CE tournoi changent (D-106) ; sinon le compte de jeu.
    void queryClient.invalidateQueries({
      queryKey: game.tournamentId ? tournamentKeys.context(game.tournamentId) : walletKey,
    });
  }, [queryClient, resultAnnounced, game.tournamentId]);
  // Fin du tournoi annoncée en temps réel pendant la partie : notifications et classement relus.
  useTournamentSignals();

  // « Quitter la partie » : départ DIRECT, sans boîte de confirmation. Le serveur décide si
  // le départ est possible (D-037) ; son refus s'affiche brièvement sous le bouton.
  const { quit, pending: quitting, error: quitError } = useQuitGame(game);
  const [refusalShown, setRefusalShown] = useState(false);
  const leaveTable = useCallback(() => {
    if (quitting) return;
    setRefusalShown(false);
    void quit().then((ok) => (ok ? goHome() : setRefusalShown(true)));
  }, [quit, quitting]);
  useEffect(() => {
    if (!refusalShown) return;
    const timer = setTimeout(() => setRefusalShown(false), QUIT_REFUSAL_MS);
    return () => clearTimeout(timer);
  }, [refusalShown]);
  const quitRefusal = refusalShown ? quitError : undefined;

  // Sortir de l'aire de jeu passe toujours par « Quitter la partie » : le retour Android quitte
  // directement (les panneaux ouverts se ferment d'abord, ils l'écoutent aussi).
  const backState = useRef({ panelOpen: false, leave: leaveTable });
  useEffect(() => {
    backState.current = { panelOpen: overlay !== null || chatOpen, leave: leaveTable };
  });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!backState.current.panelOpen) backState.current.leave();
      return true;
    });
    return () => subscription.remove();
  }, []);

  // Distribution perceptible (D-032) : jouée une fois par partie, seulement tant que le
  // serveur n'a pas confirmé la distribution (D-102). L'état réel vient toujours du serveur.
  const dealAnimated = useGameUiStore((s) => Boolean(s.dealAnimated[game.gameId]));
  const markDealAnimated = useGameUiStore((s) => s.markDealAnimated);
  const finishDeal = useCallback(
    () => markDealAnimated(game.gameId),
    [markDealAnimated, game.gameId],
  );
  // La distribution se joue SUR la table, sans écran intermédiaire.
  const dealing = useTableDealing(game, dealAnimated);

  const controlsTop = m.safe.top;
  const chatTop = controlsTop + layout.control * 2 + layout.gap * 2;
  return (
    <View style={styles.fill}>
      {game.gameType === 'GARAM' ? (
        // GARAM TIA (D-119) : même table, mêmes cartes, déroulement propre au jeu.
        <GaramPlayArea
          game={game}
          receivedAt={receivedAt}
          layout={layout}
          dealing={dealing}
          onDealDone={finishDeal}
          onResultShown={onResultShown}
          center={(presenting) => (
            // Fin de manche présentée sur la table (révélation, totaux, gagnant, D-128) : le
            // panneau de résultat attend la fin de la présentation.
            <TableCenter
              game={game}
              receivedAt={receivedAt}
              layout={layout}
              dealing={dealing}
              presenting={presenting}
            />
          )}
        />
      ) : (
        <PlayArea
          game={game}
          receivedAt={receivedAt}
          layout={layout}
          dealing={dealing}
          onDealDone={finishDeal}
          onResultShown={onResultShown}
        />
      )}

      {/* Contrôles discrets : quitter et réglages en haut à gauche. */}
      <View style={[styles.corner, { top: controlsTop, left: m.safe.left, gap: layout.gap }]}>
        <SoftIconButton
          label="Quitter la partie"
          tone="danger"
          size={layout.control}
          onPress={leaveTable}
        >
          <ExitGlyph size={layout.control} />
        </SoftIconButton>
        <SoftIconButton
          label="Réglages"
          tone="teal"
          size={layout.control}
          onPress={() => setOverlay('settings')}
        >
          <Text allowFontScaling={false} style={{ fontSize: layout.control * 0.46 }}>
            ⚙️
          </Text>
        </SoftIconButton>
        {game.gameType === 'GARAM' ? (
          // Variante jouée (D-127), visible de tous pendant toute la partie (vue du serveur).
          <GlassBox style={styles.chip}>
            <Text
              testID="garam-variant"
              accessibilityLabel={`Variante : ${garamVariantLabel(game.garamVariant)}`}
              style={[styles.variantText, fontOf(fonts.button), { fontSize: m.smallSize }]}
            >
              {garamVariantLabel(game.garamVariant)}
            </Text>
          </GlassBox>
        ) : null}
      </View>

      {/* Solde en lecture seule (aucune donnée de portefeuille : « — ») et chat en haut à
          droite. Pendant une partie, aucun achat ni retrait n'est proposé. */}
      <View
        style={[
          styles.corner,
          styles.cornerRight,
          { top: controlsTop, right: m.safe.right, gap: layout.gap },
        ]}
      >
        {game.tournamentId ? (
          <TournamentTableHud tournamentId={game.tournamentId} height={layout.control} />
        ) : (
          <BalancePill height={layout.control}>
            <Text
              accessibilityLabel={balance.label}
              style={[styles.balanceText, fontOf(fonts.button), { fontSize: m.bodySize * 1.15 }]}
            >
              {balance.text}
            </Text>
            <Coin size={Math.round(layout.control * 0.62)} fontFamily={fonts.title} />
            {balance.reserved ? (
              // Inscriptions à des tournois : réservées, PAS débitées (une partie en cours
              // ne réserve plus rien d'affiché, D-080).
              <Text
                testID="table-reserved"
                importantForAccessibility="no"
                style={[styles.reservedText, { fontSize: m.smallSize }]}
              >
                {balance.reserved}
              </Text>
            ) : null}
          </BalancePill>
        )}
        <View>
          <SoftIconButton
            label={
              chatOpen
                ? 'Fermer le chat'
                : unread > 0
                  ? `Ouvrir le chat, ${unread} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}`
                  : 'Ouvrir le chat'
            }
            tone="teal"
            size={layout.control}
            onPress={() => setChatOpen((open) => !open)}
          >
            <Text allowFontScaling={false} style={{ fontSize: layout.control * 0.46 }}>
              💬
            </Text>
          </SoftIconButton>
          {unread > 0 && !chatOpen ? (
            <View pointerEvents="none" style={styles.chatBadge}>
              <Text allowFontScaling={false} style={styles.chatBadgeText}>
                {unread > 9 ? '9+' : unread}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {chatOpen ? (
        <GameChat
          gameId={game.gameId}
          myId={game.viewerId}
          chat={chat}
          top={chatTop}
          bottom={m.safe.bottom + layout.plateHeight + layout.gap}
          onClose={closeChat}
        />
      ) : null}
      {overlay === 'settings' ? <SettingsPanel onClose={closeOverlay} /> : null}
      {quitRefusal ? (
        <View
          style={[
            styles.absolute,
            { top: controlsTop + layout.control + layout.gap, left: m.safe.left + layout.gap },
          ]}
        >
          <GlassBox style={styles.chip}>
            <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
              {quitRefusal}
            </Text>
          </GlassBox>
        </View>
      ) : null}
      {/* Détection anti-collusion (D-046) : explication et collecte, parties surveillées seules. */}
      <GameGeolocation game={game} />
    </View>
  );
}

/**
 * Quitter (D-037, décidé par le serveur) : partie en attente → départ de la session ;
 * partie terminée avec une ronde ouverte → choix « Quitter » ; partie en cours → le serveur
 * refuse (PLAYER_IN_ACTIVE_GAME) et son message s'affiche. Partagé par le bouton « Quitter
 * la partie » (départ direct, sans confirmation) et le panneau de fin de partie : `quit`
 * résout `true` si le départ a abouti ; l'écran revient alors à l'accueil.
 */
function useQuitGame(game: GameView) {
  const sessionId = game.sessionId ?? '';
  const session = useSession(game.status === 'finished' ? sessionId : '');
  const leave = useLeaveSession();
  const decision = useSessionDecision(sessionId);
  const failure = [leave.error, decision.error].find((e) => e instanceof ApiError)?.message;

  const quit = async (): Promise<boolean> => {
    if (!game.sessionId) return true;
    const round = session.data?.decision;
    try {
      if (
        game.status === 'finished' &&
        round?.open &&
        round.gameId === game.gameId &&
        round.pendingPlayerIds.includes(game.viewerId)
      ) {
        await decision.mutateAsync('leave');
      } else {
        await leave.mutateAsync(game.sessionId);
      }
      return true;
    } catch {
      return false;
    }
  };

  return {
    session,
    decision,
    quit,
    pending: leave.isPending || decision.isPending,
    error: failure,
  };
}

function seatStateOf(game: GameView, player: PlayerInGame, presenting: boolean): SeatState {
  const id = player.playerId;
  const play = game.play;
  const local = id === game.viewerId;
  const fled = Boolean(player.fledAt);
  const inProgress = game.status === 'in_progress';
  // Le gagnant n'est montré qu'une fois la dernière carte présentée (D-041).
  const winner = game.status === 'finished' && !presenting && game.result?.winnerId === id;
  const expected = game.activePlayerId ?? play?.nextPlayerId;
  const active = inProgress && !fled && expected === id;
  const parts: string[] = [];
  if (winner) parts.push('Gagnant');
  else if (fled) parts.push('A fui');
  else if (active) parts.push(local ? 'À vous de jouer' : 'À son tour');
  if (inProgress && play && !fled && play.controllerId === id) parts.push('Contrôle');
  if (game.status === 'waiting' && id === game.creatorId) parts.push('Créateur');
  return {
    name: playerLabel(game, id),
    local,
    active,
    firstPlayer: game.firstPlayerId === id,
    detail: parts.join(' · ') || undefined,
    dimmed: fled,
    winner,
  };
}

/**
 * L'aire de jeu : table, zone d'action centrale, joueurs, mains et cartes publiques.
 *
 * Confidentialité : la vue du serveur ne contient que MA main (`myHand`) et le NOMBRE de
 * cartes des autres (`handCounts`) ; leurs cartes sont donc dessinées de dos, sans aucune
 * valeur disponible côté client. Une carte jouée (`currentTrick`, `completedTricks`) est
 * publique : elle apparaît au centre ~2,5 s, puis rejoint la zone publique de son joueur où
 * elle s'ajoute, face visible, aux cartes qu'il a déjà jouées.
 */
function PlayArea({
  game,
  receivedAt,
  layout,
  dealing,
  onDealDone,
  onResultShown,
}: {
  game: GameView;
  receivedAt: number;
  layout: GameTableLayout;
  dealing: boolean;
  onDealDone: () => void;
  /** Partie terminée et dernière carte présentée : le résultat est à l'écran. */
  onResultShown: () => void;
}) {
  const m = useLobbyMetrics();
  const act = useGameAction(game.gameId);
  // La table et ce qui est posé dessus suivent son centre dessiné (`tableCy`).
  const { cx, tableCy: cy, diameter, plateWidth: pw, plateHeight: ph } = layout;
  const seats = arrangeSeats(game);
  const play = game.play;
  const inProgress = game.status === 'in_progress' && play;
  const sw = smallCardWidth(layout);
  const distances = usePlayerDistances(game);
  const zones = (side: SeatSide) => seatZones(side, layout, m);
  const sideOf = (playerId: string) =>
    seats.find((s) => s.player?.playerId === playerId)?.side ?? 'bottom';

  // Zone d'action : cercle au centre de la table, cible du glisser-déposer (agrandi sur
  // smartphone, `centerCircles`).
  const dropSize = layout.center.drop;
  const dropRef = useRef<View>(null);
  const dropZone = useRef<DropZone | null>(null);
  const [dragging, setDragging] = useState(false);
  const measureDropZone = useCallback(() => {
    dropRef.current?.measureInWindow((x, y, width, height) => {
      dropZone.current = { x, y, width, height };
    });
  }, []);
  const onDragChange = useCallback(
    (active: boolean) => {
      setDragging(active);
      if (active) measureDropZone();
    },
    [measureDropZone],
  );
  useEffect(() => measureDropZone(), [measureDropZone, cx, cy, diameter]);

  // Distribution sur la table (D-032) : lots de 3 puis de 2, dans l'ordre du serveur.
  const deal = useDealProgress(play?.dealSequence ?? [], dealing, onDealDone);
  const cardsOf = (playerId: string) =>
    dealing ? (deal.landed[playerId] ?? 0) : (play?.handCounts[playerId] ?? 0);
  const myHand = play ? (dealing ? play.myHand.slice(0, cardsOf(game.viewerId)) : play.myHand) : [];
  const handCenter = {
    x: layout.handLeft + layout.handSlotWidth / 2,
    y: m.height - m.safe.bottom - layout.cardHeight / 2,
  };
  const dealTarget = (playerId: string) => {
    const side = sideOf(playerId);
    const backs = zones(side).backs;
    if (side === 'bottom' || !backs) return handCenter;
    return {
      x: backs.left + backs.width / 2,
      y: backs.top + (sw * CARD_RATIO) / 2,
    };
  };

  // Cartes publiques : déjà rangées (« settled ») ou encore mises en avant au centre. Les
  // cartes présentes au premier affichage sont rangées d'emblée (pas d'animation rejouée).
  const plays = publicPlays(play);
  const [settled, setSettled] = useState(() => new Set(plays.map((p) => p.cardId)));
  const settle = useCallback(
    (cardId: string) => setSettled((prev) => new Set(prev).add(cardId)),
    [],
  );
  // 5e tour automatique (D-041) : le serveur a joué toutes les dernières cartes d'un coup ;
  // elles sont présentées UNE PAR UNE, dans l'ordre du tour (fuyards absents), chacune 2 s
  // après que la précédente a été rangée, et seulement après les cartes du 4e tour. Une
  // carte pas encore présentée reste dessinée de dos (ou dans ma main).
  const [revealed, setRevealed] = useState(() => new Set<string>());
  const reveal = useCallback(
    (cardId: string) => setRevealed((prev) => new Set(prev).add(cardId)),
    [],
  );
  // Tours complets selon le serveur : leurs cartes quittent la table ensemble, 2 s après la
  // dernière carte jouée.
  const completedTricks = new Set((play?.completedTricks ?? []).map((t) => t.number));
  const { spotlights, notYetShown, presenting } = planPresentation(
    plays,
    settled,
    revealed,
    completedTricks,
  );
  const resultShown = game.status === 'finished' && !presenting;
  // Main d'au revoir de 3 s juste après MA fuite confirmée par le serveur.
  const farewell = useFarewell(game);
  useEffect(() => {
    if (resultShown) onResultShown();
  }, [resultShown, onResultShown]);
  const showHands = Boolean(inProgress) || (presenting && Boolean(play));
  const spotWidth = spotCardWidth(diameter, sw);
  const playsBy = (playerId: string) => plays.filter((p) => p.playerId === playerId);
  const publicSlot = (playerId: string, cardId: string) => {
    const row = playedRowIn(zones(sideOf(playerId)).publicRow);
    const index = playsBy(playerId).findIndex((p) => p.cardId === cardId);
    return {
      x: publicCardLeft(row, index) + row.cardWidth / 2,
      y: row.top + (row.cardWidth * CARD_RATIO) / 2,
      width: row.cardWidth,
    };
  };

  const pendingCard =
    act.isPending && act.variables?.action.type === 'PLAY_CARD'
      ? act.variables.action.cardId
      : undefined;
  // Carte que je viens de lâcher sur la table : elle y glisse d'un seul mouvement, attend la
  // réponse du serveur à l'endroit exact où la carte jouée apparaîtra, puis lui cède la place
  // (même identifiant de carte, même position, sans fondu) : aucun retour dans la main.
  const [flight, setFlight] = useState<CardFlight | null>(null);
  const onLanded = useCallback(
    (cardId: string) =>
      setFlight((f) => (f && f.cardId === cardId ? { ...f, landed: true } : f)),
    [],
  );
  // Coup refusé par le serveur : la carte reste dans la main (comportement de refus inchangé).
  const rejected =
    act.isError &&
    act.variables?.action.type === 'PLAY_CARD' &&
    act.variables.action.cardId === flight?.cardId;
  // Coup accepté pendant le trajet : la carte reste dessinée (main) jusqu'à son arrivée ; la
  // carte jouée du serveur n'apparaît qu'ensuite, jamais deux fois à l'écran.
  const { flightCard, inHand: flightInHand } = flightState(flight, rejected, play?.myHand ?? []);

  // Conflit de version : la partie est déjà relue (useGameAction), rien à montrer au joueur.
  const failure =
    act.error instanceof ApiError && act.error.code !== 'VERSION_CONFLICT'
      ? act.error.message
      : undefined;

  // Tour attendu selon le serveur : même état pour les barres des joueurs et le chrono. Aucun
  // tour (attente, distribution, 5e tour automatique, fin) : aucune barre ne progresse.
  // Barres et roulette suspendues : ma carte lâchée (arrêt immédiat), ou cartes d'un tour
  // terminé pas encore rangées dans leurs zones (presentation-plan.ts).
  const held = turnHeld({
    pendingCardId: pendingCard,
    droppedCardId: flight?.cardId,
    rejected,
    myHand: play?.myHand ?? [],
    plays,
    settled,
    completedTricks,
  });
  const phase = useTurnPhase(game, receivedAt, dealing || held);

  // Halo lumineux de 5 s sur la zone du joueur qui DEVIENT actif (une fois par tour).
  const signalKey = useTurnSignal(turnKeyOf(game, dealing));
  const signaled = signalKey ? playerOfTurnKey(signalKey) : null;
  const glowFor = (playerId: string, side: SeatSide, count: number) =>
    signalKey && signaled === playerId ? (
      <TurnGlow key={signalKey} rect={handZoneRect(side, count, layout, m)} />
    ) : null;

  // Halo de 3 s sur la plaque du joueur qui OBTIENT le contrôle (état officiel du serveur).
  const controlSignal = useControlSignal(controllerOf(game, dealing));
  const controlHolder = controlSignal ? playerOfControlSignal(controlSignal) : null;
  const controlGlow = (() => {
    if (!controlSignal || !controlHolder) return null;
    const side = seats.find((s) => s.player?.playerId === controlHolder)?.side;
    if (!side) return null;
    const z = zones(side);
    // Barre réelle (une ligne : le pseudo), posée en haut de son emplacement, ou en bas
    // pour le joueur connecté.
    const height = plateContentHeight(ph, false);
    const top = side === 'bottom' ? z.plate.top + ph - height : z.plate.top;
    return (
      <ControlGlow
        key={controlSignal}
        rect={{ left: z.plate.left, top, width: pw, height }}
      />
    );
  })();

  // Cartes jouées de CHAQUE joueur présent (publiques, état du serveur), une fois rangées.
  const played = playedZones(game, plays, settled, layout, m);

  // Ma main : cartes légèrement chevauchées, centrées dans l'emplacement de 5 cartes.
  const handCards = handWithFlight(
    [...myHand, ...notYetShown(game.viewerId).map((p) => p.cardId)],
    flightInHand,
  );
  const handLeft =
    layout.handLeft + (layout.handSlotWidth - handWidthOf(handCards.length, layout)) / 2;
  const handStep = handStepFor(handCards.length, layout);
  const [draggedCard, setDraggedCard] = useState<string | null>(null);
  // Place sur la table de MA carte jouée (celle de `PlayedCardSpotlight`), vue depuis sa place
  // dans la main : décalage des centres et rapport des largeurs.
  const mySpot = SPOT_OFFSET.bottom;
  const landingTarget = (index: number) => ({
    dx: cx + mySpot.x * diameter - (handLeft + index * handStep + layout.cardWidth / 2),
    dy: cy + mySpot.y * diameter - (m.height - m.safe.bottom - layout.cardHeight / 2),
    scale: spotWidth / layout.cardWidth,
  });

  return (
    <>
      {/* 1. La table et sa zone d'action. */}
      <View
        accessibilityLabel="Aire de jeu"
        style={[
          styles.tableSlot,
          {
            left: cx - diameter / 2,
            top: cy - diameter / 2,
            width: diameter,
            height: diameter,
          },
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

      {/* Halo de contrôle : juste au-dessus de la table, DERRIÈRE plaques, cartes et contrôles. */}
      {controlGlow}

      {/* Zones des cartes jouées (sièges occupés seulement), sous les panneaux du centre. */}
      {played.map((zone) => (
        <PlayedCardsZone
          key={zone.seat}
          zone={zone}
          label={zone.playerId === game.viewerId ? 'moi' : playerLabel(game, zone.playerId)}
        />
      ))}
      {/* 3. L'état de la partie, au centre de la table. Après « Se coucher » : main d'au
          revoir pendant 3 s, puis le panneau de fin (il attend la fin de la main). */}
      <TableCenter
        game={game}
        receivedAt={receivedAt}
        layout={layout}
        failure={failure}
        dealing={dealing}
        presenting={presenting || farewell}
      />
      {farewell ? <FarewellHand cx={cx} cy={cy} size={Math.round(diameter * 0.32)} /> : null}
      <TurnHud
        game={game}
        receivedAt={receivedAt}
        layout={layout}
        dealing={dealing}
        presenting={presenting}
        turnHeld={held}
        safeLeft={m.safe.left}
        safeBottom={m.safe.bottom}
      />

      {/* 2. Les joueurs autour de la table : plaque, main (dos), cartes publiques. */}
      {seats.map(({ seat, side, player }) => {
        const z = zones(side);
        const mine = player?.playerId === game.viewerId;
        const hidden = player ? cardsOf(player.playerId) + notYetShown(player.playerId).length : 0;
        return (
          <Fragment key={seat}>
            {player && !mine ? glowFor(player.playerId, side, hidden) : null}
            {player && !mine && z.backs && showHands ? (
              <HiddenHand count={hidden} width={sw} zone={z.backs} />
            ) : null}
            <SeatPlate
              state={player ? seatStateOf(game, player, presenting) : undefined}
              width={pw}
              height={ph}
              align={side === 'bottom' ? 'bottom' : 'top'}
              turn={seatTurnFor(phase, player?.playerId, game.viewerId)}
              style={z.plate}
            />
            {player && !mine && z.distance && distances ? (
              // Partie surveillée seulement : une étiquette par AUTRE joueur présent, jamais
              // pour soi (voir distance.ts).
              <DistanceTag
                distance={distances.of(player.playerId)}
                playerName={playerLabel(game, player.playerId)}
                width={z.distance.width}
                style={[styles.absolute, { left: z.distance.left, top: z.distance.top }]}
              />
            ) : null}
          </Fragment>
        );
      })}

      {/* Ma main, face visible, en bas : seules les cartes autorisées se glissent. */}
      {showHands ? glowFor(game.viewerId, 'bottom', handCards.length) : null}
      {showHands ? (
        <View style={[styles.hand, { left: handLeft, bottom: m.safe.bottom }]}>
          {handCards.map((cardId, index) => {
            // Ma dernière carte, jouée par le système (5e tour) : pas de glisser-déposer.
            const playable =
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
                  setDraggedCard(active ? cardId : null);
                  onDragChange(active);
                }}
                onDrop={(id) => {
                  setFlight({ cardId: id, index, landed: false });
                  act.send({ type: 'PLAY_CARD', cardId: id }, game.version);
                }}
                style={{
                  marginLeft: index === 0 ? 0 : handStep - layout.cardWidth,
                  zIndex: draggedCard === cardId ? 40 : 10 + index,
                }}
              />
            );
          })}
        </View>
      ) : null}

      {/* Distribution : chaque lot vole du centre vers son joueur. */}
      {dealing
        ? deal.flying.map(({ batch, index }) => (
            <DealFlight
              key={index}
              batch={batch}
              from={{ x: cx, y: cy }}
              to={dealTarget(batch.playerId)}
              width={sw}
              onLanded={deal.land}
            />
          ))
        : null}

      {/* Cartes du tour : sur la table jusqu'à la dernière, puis 2 s après, vers leur joueur. */}
      {spotlights.map(({ play: p, delayMs, release }) => {
        // Encore en route depuis ma main : la carte jouée prendra sa place à l'arrivée.
        if (p.cardId === flightInHand?.cardId) return null;
        const side = sideOf(p.playerId);
        const offset = SPOT_OFFSET[side];
        const slot = publicSlot(p.playerId, p.cardId);
        return (
          <PlayedCardSpotlight
            key={p.cardId}
            cardId={p.cardId}
            from={{ x: cx + offset.x * diameter, y: cy + offset.y * diameter }}
            to={slot}
            width={spotWidth}
            targetWidth={slot.width}
            delayMs={delayMs}
            angle={SPOT_ANGLE[side]}
            instant={p.cardId === flightCard && p.playerId === game.viewerId}
            moveMs={FAP_FAP_PLAYED_CARD_MOVE_MS}
            release={release}
            onReveal={reveal}
            onSettled={settle}
          />
        );
      })}

      {/* Actions ponctuelles autorisées par le serveur (1er tour seulement). */}
      {inProgress && !dealing ? (
        <TurnActions
          game={game}
          layout={layout}
          pending={act.isPending}
          onFlee={() => act.send({ type: 'FLEE' }, game.version)}
          onDeclareWin={() => act.send({ type: 'DECLARE_WIN' }, game.version)}
          safeRight={m.safe.right}
          safeBottom={m.safe.bottom}
        />
      ) : null}
    </>
  );
}

function TableCenter({
  game,
  receivedAt,
  layout,
  failure,
  dealing,
  presenting,
}: {
  game: GameView;
  receivedAt: number;
  layout: GameTableLayout;
  failure?: string;
  dealing: boolean;
  /** Cartes encore présentées (5e tour) : le résultat attend la dernière. */
  presenting: boolean;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const start = useStartGame(game.gameId);
  const { cx, tableCy: cy, diameter } = layout;
  const radius = diameter / 2;
  const play = game.play;
  const text = [styles.centerText, fontOf(fonts.button), { fontSize: m.bodySize * 1.1 }];
  const small = [styles.smallText, { fontSize: m.smallSize - 1 }];
  const box = { padding: m.gap, gap: m.gap * 0.6, maxWidth: diameter * 0.9 };
  const centered = (width: number) => ({ left: cx - width / 2, width });

  if (game.status === 'waiting' && game.autoStart) {
    return (
      <View style={[styles.centerSlot, centered(diameter), { top: cy - radius, height: diameter }]}>
        <GlassBox style={box}>
          <TournamentTableWaiting game={game} receivedAt={receivedAt} start={start} />
        </GlassBox>
      </View>
    );
  }

  if (game.status === 'waiting' && game.garamStakeVote) {
    return (
      <View style={[styles.centerSlot, centered(diameter), { top: cy - radius, height: diameter }]}>
        <GlassBox style={box}>
          <GaramStakeVotePanel game={game} />
        </GlassBox>
      </View>
    );
  }

  if (game.status === 'waiting') {
    const missing = game.maxPlayers - game.players.length;
    const isCreator = game.creatorId === game.viewerId;
    const canStart = game.players.length >= MIN_PLAYERS_TO_START;
    const startFailure = start.error instanceof ApiError ? start.error.message : undefined;
    return (
      <View style={[styles.centerSlot, centered(diameter), { top: cy - radius, height: diameter }]}>
        <GlassBox style={box}>
          <Text style={text}>
            {missing > 0
              ? `En attente de ${missing} joueur${missing > 1 ? 's' : ''}`
              : 'Table complète'}
          </Text>
          {isCreator && canStart ? (
            <PanelButton title="Démarrer" loading={start.isPending} onPress={start.start} />
          ) : null}
          {startFailure ? <Text style={[small, styles.error]}>{startFailure}</Text> : null}
        </GlassBox>
      </View>
    );
  }

  if (game.status === 'finished') {
    if (presenting) return null;
    // Panneau centré sur la table, sans déborder de l'écran (marge de 16 de chaque côté).
    const width = Math.min(Math.max(diameter * 0.85, 260), m.availableWidth - 32, 440);
    return (
      <View style={[styles.centerSlot, centered(width), { top: cy - radius, height: diameter }]}>
        <GameOutcome game={game} width={width} />
      </View>
    );
  }

  if (!play) return null;
  const chipWidth = diameter * 0.7;
  return (
    <>
      {!dealing && play.currentTrick.length === 0 && game.myActions.canPlayCard ? (
        <View
          style={[
            styles.absolute,
            styles.centerRow,
            styles.passThrough,
            centered(chipWidth),
            { top: cy - 10 },
          ]}
        >
          <Text style={[small, styles.whisper]}>Déposez une carte ici</Text>
        </View>
      ) : null}
      {failure ? (
        <View
          style={[
            styles.absolute,
            styles.centerRow,
            centered(diameter),
            { top: cy + radius * 0.5 },
          ]}
        >
          <GlassBox style={styles.chip}>
            <Text accessibilityRole="alert" style={[small, styles.error]}>
              {failure}
            </Text>
          </GlassBox>
        </View>
      ) : null}
    </>
  );
}

/**
 * Fin de partie, telle que le serveur l'a décidée : égalité de priorité (partie rejouée
 * aussitôt) ou panneau de résultat (gagnant, bilan, Quitter / Rejouer). « Rejouer » est le
 * choix « Poursuivre » de la ronde du serveur (D-034) ; ensuite la partie suivante se rejoint
 * d'ici même. La session qui enchaîne les parties reste technique : jamais nommée.
 */
function GameOutcome({ game, width }: { game: GameView; width: number }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const t = useMessages().gameOver;
  const { session, decision, quit, pending, error } = useQuitGame(game);
  // Égalité de priorité (Ter) ou manche nulle (GARAM TIA) : rejouée aussitôt par le serveur.
  const tie = game.endReason === 'INSTANT_WIN_TIE' || game.endReason === 'GARAM_TIE';
  const garamTie = game.garamTie;
  const tieBest = garamTie?.scores ? Math.max(...Object.values(garamTie.scores)) : 0;
  const replayId = tie ? session.data?.currentGame?.gameId : undefined;

  // Reprise immédiate (D-035) : la nouvelle donne remplace cet écran, sans étape.
  useEffect(() => {
    if (replayId && replayId !== game.gameId) {
      openGame(replayId);
    }
  }, [replayId, game.gameId]);

  if (tie) {
    return (
      <GlassBox style={{ padding: m.gap, gap: m.gap * 0.6 }}>
        <Text style={[styles.centerText, fontOf(fonts.button), { fontSize: m.bodySize * 1.2 }]}>
          {garamTie ? t.garamTieTitle : t.tieTitle}
        </Text>
        <Text style={[styles.smallText, { fontSize: m.smallSize }]}>
          {garamTie
            ? garamTie.kind === 'SCORE'
              ? t.garamTieScore(tieBest)
              : t.garamTieSpecial
            : t.tieDetail}
        </Text>
        {replayId ? <PanelButton title={t.newDeal} onPress={() => openGame(replayId)} /> : null}
      </GlassBox>
    );
  }

  const data = session.data;
  const round = data?.decision?.open && data.decision.gameId === game.gameId ? data.decision : null;
  const awaitingMe = data ? Boolean(round?.pendingPlayerIds.includes(game.viewerId)) : undefined;
  // Échéance AFFICHÉE (serveur − 3 s, D-098) ramenée à l'horloge du téléphone (décalage
  // mesuré à la réception).
  const capAt =
    round && data
      ? displayedDeadline(Date.parse(round.deadlineAt)) -
        (Date.parse(data.serverNow) - session.dataUpdatedAt)
      : undefined;
  const footer =
    awaitingMe !== false || !data ? undefined : round ? (
      <Text style={[styles.smallText, { fontSize: m.smallSize }]}>
        {t.waitingOthers(round.pendingPlayerIds.length)}
      </Text>
    ) : (
      <NextGame game={game} session={data} />
    );

  return (
    <GameOverPanel
      game={game}
      width={width}
      awaitingMe={awaitingMe}
      canContinue={round?.canContinue}
      capAt={capAt}
      pending={pending}
      error={error}
      footer={footer}
      onQuit={async (automatic) => {
        const ok = await quit();
        // Fin du compte à rebours : on sort même si l'envoi échoue, le serveur appliquera de
        // toute façon le départ automatique à son échéance.
        if (ok || automatic) goHome();
        return ok || automatic;
      }}
      onReplay={async () => {
        try {
          await decision.mutateAsync('continue');
          return true;
        } catch {
          return false;
        }
      }}
    />
  );
}

/**
 * Après « Rejouer » (D-042) : le serveur crée et distribue lui-même la partie suivante de la
 * même table dès la clôture de la ronde. L'écran n'a AUCUNE action à proposer : il passe
 * directement à l'aire de jeu de la nouvelle partie (distribution sur la table), où les
 * mains, cartes jouées et indicateurs repartent à zéro.
 */
function NextGame({ game, session }: { game: GameView; session: SessionView }) {
  const m = useLobbyMetrics();
  const t = useMessages().gameOver;
  const small = [styles.smallText, { fontSize: m.smallSize }];
  const next = session.currentGame;
  const seated = session.seats.some((s) => s.playerId === game.viewerId);
  const mine = next && next.gameId !== game.gameId && next.playerIds.includes(game.viewerId);

  // Nouvelle partie dont je suis joueur : on y passe directement.
  useEffect(() => {
    if (mine) openGame(next.gameId);
  }, [mine, next?.gameId]);

  if (session.status !== 'open' || !seated) {
    return <PanelButton title={t.home} onPress={goHome} />;
  }
  if (next && next.gameId !== game.gameId && !mine) {
    // Arrivé pendant une partie en cours : il jouera la suivante (D-035).
    return <Text style={small}>{t.nextGameLater}</Text>;
  }
  return (
    <View style={[styles.centerRow, { gap: m.gap * 0.5 }]} accessibilityLiveRegion="polite">
      <ActivityIndicator color={palette.gold} />
      <Text style={small}>{t.newGame}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chatBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C62F37',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.85)',
  },
  chatBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  absolute: { position: 'absolute' },
  corner: { position: 'absolute', alignItems: 'flex-start' },
  cornerRight: { alignItems: 'flex-end' },
  balanceText: { color: '#FFFFFF' },
  reservedText: { color: 'rgba(255, 236, 200, 0.85)' },
  tableSlot: { position: 'absolute' },
  passThrough: { pointerEvents: 'none' },
  // Intérieur de l'anneau gravé : invisible au repos (seul l'anneau se voit, comme sur la
  // référence), souligné pendant le glisser-déposer.
  dropZone: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  dropZoneActive: {
    borderColor: 'rgba(242, 196, 81, 0.85)',
    backgroundColor: 'rgba(242, 196, 81, 0.14)',
    boxShadow: '0 0 22px rgba(242, 196, 81, 0.5)',
  },
  centerSlot: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerRow: { alignItems: 'center' },
  centerText: { color: '#FFFFFF', textAlign: 'center' },
  smallText: { color: 'rgba(255, 255, 255, 0.78)', textAlign: 'center' },
  whisper: { color: 'rgba(255, 245, 225, 0.75)' },
  error: { color: palette.error },
  chip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
  variantText: { color: '#F5C842' },
  hand: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end' },
});
