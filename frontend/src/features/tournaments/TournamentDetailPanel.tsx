import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { fontOf, PillButton, tablePalette, useTableFonts } from '../../components/table/TableDecor';
import { ApiError } from '../../lib/api-client';
import type { TournamentView } from '../../types/tournament';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { useLeaveSession } from '../sessions/hooks';
import {
  useJoinTournament,
  useMarkNotificationRead,
  useNotifications,
  useRegisterTournament,
  useUnregisterTournament,
} from './hooks';
import {
  formatDuration,
  useTournamentMessages,
  type TournamentMessages,
} from './tournament-messages';
import {
  formatFcfa,
  formatTournamentDuration,
  formatTournamentPeriod,
  hasResults,
  isFull,
  remainingBeforeStartMs,
  rewardedRanks,
  tournamentStatusKey,
  tournamentWidgetState,
  type TournamentWidgetState,
} from './tournament-state';

/** Le compte à rebours avant le début n'a pas besoin d'être plus fin. */
const COUNTDOWN_TICK_MS = 30_000;
const MEDALS = ['🥇', '🥈', '🥉'];
/** Notifications non lues montrées dans la fiche. */
const NOTICES_SHOWN = 3;
/** Code de l'API quand la capacité maximale est atteinte (seule erreur traitée ainsi). */
const FULL = 'TOURNAMENT_FULL';
/** Départ refusé : la partie de la table a démarré (D-037) ; le joueur y est attendu. */
const IN_ACTIVE_GAME = 'PLAYER_IN_ACTIVE_GAME';

type PanelState = Exclude<TournamentWidgetState, 'NO_TOURNAMENT'>;

/**
 * Fiche d'un tournoi (D-054, D-065) : date, horaires, statut, participation, inscrits, rangs
 * récompensés, état de MON inscription, et les actions que le SERVEUR autorise (s'inscrire,
 * se désinscrire, rejoindre). Aucune règle n'est décidée ici : chaque action est revérifiée
 * par le serveur (inscription, éligibilité, seuil de jetons, table attribuée).
 *
 * Rejoindre ouvre la recherche de table (« Recherche d'une partie en cours… ») tant que la
 * requête est en cours, puis l'écran de jeu de la table attribuée par le serveur.
 *
 * « Annuler la recherche » : si le serveur a déjà attribué une place, elle est libérée par le
 * départ de session existant (`useLeaveSession`, D-037) ; l'inscription et la réservation ne
 * sont pas touchées. Si la partie a démarré entre-temps, le serveur refuse le départ et
 * l'écran de jeu s'ouvre : l'écran suit toujours l'état réel du serveur.
 */
export function TournamentDetailPanel({
  tournament,
  receivedAt,
}: {
  tournament: TournamentView;
  receivedAt: number;
}) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const register = useRegisterTournament();
  const unregister = useUnregisterTournament();
  const cancelRequested = useRef(false);
  const join = useJoinTournament({ cancelled: () => cancelRequested.current });
  const leave = useLeaveSession();
  const [cancelling, setCancelling] = useState(false);
  const [searchCancelled, setSearchCancelled] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
  const state = tournamentWidgetState(tournament, {
    justRegistered,
  }) as PanelState;
  const actionError = register.error ?? unregister.error;
  const error = toDisplayError(actionError);
  const period = formatTournamentPeriod(tournament, t.locale);
  const small = [styles.meta, fontOf(fonts.button), { fontSize: m.smallSize }];
  const body = [
    styles.detailText,
    fontOf(fonts.button),
    { fontSize: m.bodySize, lineHeight: Math.round(m.bodySize * 1.45) },
  ];
  const noteSize = m.smallSize + 1;
  const busy = register.isPending || unregister.isPending;
  const joinable = state === 'IN_PROGRESS' && tournament.canJoin;
  /** Espace entre les groupes (en-tête, informations, inscription, frais, action). */
  const sectionGap = Math.round(m.gap * 1.2);
  const showReservation = state === 'UPCOMING' && tournament.canRegister && !isFull(tournament);
  const details = tournamentDetails({
    tournament,
    state,
    receivedAt,
    messages: t,
    fullNoticeShown: error?.code === FULL,
    textStyle: body,
  });

  // Recherche annulée avant la réponse : place attribuée → libérée ; échec → rien à libérer.
  const startSearch = () => {
    cancelRequested.current = false;
    setSearchCancelled(false);
    join.mutate(tournament.tournamentId, {
      onSuccess: (seat) => {
        if (cancelRequested.current) releaseSeat(seat);
      },
      onError: () => {
        if (cancelRequested.current) finishCancel();
      },
    });
  };
  const finishCancel = () => {
    cancelRequested.current = false;
    setCancelling(false);
    join.reset();
    leave.reset();
    setSearchCancelled(true);
  };
  const releaseSeat = (seat: { sessionId: string; gameId: string }) =>
    leave.mutate(seat.sessionId, {
      onSuccess: finishCancel,
      onError: (err) => {
        if (err instanceof ApiError && err.code === IN_ACTIVE_GAME) {
          cancelRequested.current = false;
          router.replace(`/game/${seat.gameId}`);
        }
      },
    });
  const cancelSearch = () => {
    cancelRequested.current = true;
    setCancelling(true);
  };
  const seat = join.data;

  if (cancelling || join.isPending || join.isSuccess || join.isError) {
    const cancelFailed =
      cancelling &&
      leave.isError &&
      !(leave.error instanceof ApiError && leave.error.code === IN_ACTIVE_GAME);
    const phase = cancelling
      ? 'cancelling'
      : join.isError
        ? 'failed'
        : join.isSuccess
          ? 'found'
          : 'searching';
    return (
      <Matchmaking
        phase={phase}
        error={toDisplayError(join.error)}
        cancelFailed={cancelFailed}
        onRetry={startSearch}
        onBack={() => join.reset()}
        onCancel={cancelFailed && seat ? () => releaseSeat(seat) : cancelSearch}
      />
    );
  }

  const canRegisterNow = state === 'UPCOMING' && tournament.canRegister;
  const errorNotice =
    error?.code === FULL ? (
      // Capacité atteinte : information conviviale, pas une alerte (D-057).
      <FullNotice variant="register" />
    ) : error ? (
      <Text
        accessibilityRole="alert"
        style={[styles.error, fontOf(fonts.button), { fontSize: m.smallSize }]}
      >
        {errorText(error, t)}
      </Text>
    ) : null;

  return (
    <View testID="tournament-details" style={{ gap: sectionGap }}>
      {/* A. En-tête : la date domine, le statut l'accompagne, l'horaire sur sa ligne. */}
      <View style={[styles.summary, { gap: Math.round(m.gap * 0.4) }]}>
        <View style={styles.row}>
          <Text
            numberOfLines={1}
            style={[styles.date, fontOf(fonts.button), { fontSize: m.bodySize + 4 }]}
          >
            {period.date}
          </Text>
          <StatusChip tournament={tournament} size={m.smallSize} fontFamily={fonts.button} />
        </View>
        <Text style={small}>{`🕐 ${t.period(period.start, period.end)}`}</Text>
      </View>
      {/* B. Informations essentielles, chacune avec un libellé explicite. */}
      <TournamentFacts tournament={tournament} />
      {/* C. État de MON inscription, séparé des caractéristiques du tournoi. */}
      {details ? (
        <View
          testID="tournament-registration-state"
          style={[styles.status, { paddingTop: sectionGap, gap: Math.round(m.gap * 0.6) }]}
        >
          {details}
        </View>
      ) : null}
      {/* D. Engagement financier (secondaire mais lisible), puis l'action. */}
      {showReservation ? (
        <View
          style={[
            styles.reservation,
            { paddingVertical: m.gap, paddingHorizontal: Math.round(m.gap * 1.4) },
          ]}
        >
          <Text
            style={[
              styles.reservationText,
              fontOf(fonts.button),
              { fontSize: noteSize, lineHeight: Math.round(noteSize * 1.55) },
            ]}
          >
            {t.reservationInfo(formatFcfa(tournament.entryFee))}
          </Text>
        </View>
      ) : null}
      {/* Échec d'inscription : juste au-dessus du bouton, visible sans défiler. */}
      {canRegisterNow ? errorNotice : null}
      {canRegisterNow && (
        <PillButton
          style={{ marginTop: Math.round(m.gap * 0.4) }}
          title={t.register}
          onPress={() =>
            register.mutate(tournament.tournamentId, {
              onSuccess: () => setJustRegistered(true),
            })
          }
          loading={busy}
          height={Math.max(44, m.controlHeight)}
          fontSize={m.bodySize + 2}
          fontFamily={fonts.button}
        />
      )}
      {(state === 'WAITING' || state === 'REGISTERED') && tournament.canUnregister && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() =>
            unregister.mutate(tournament.tournamentId, {
              onSuccess: () => setJustRegistered(false),
            })
          }
          style={styles.linkButton}
        >
          <Text style={[styles.link, fontOf(fonts.button), { fontSize: m.smallSize }]}>
            {t.unregister}
          </Text>
        </Pressable>
      )}
      {joinable && (
        <PillButton
          title={t.join}
          onPress={startSearch}
          height={m.controlHeight}
          fontSize={m.bodySize + 2}
          fontFamily={fonts.button}
        />
      )}
      {searchCancelled ? (
        <Text accessibilityLiveRegion="polite" style={[small, styles.centerText]}>
          {t.matchmaking.cancelled}
        </Text>
      ) : null}
      {canRegisterNow ? null : errorNotice}
      <TournamentNotices textStyle={small} />
    </View>
  );
}

interface DisplayError {
  code?: string;
  message: string;
}

function toDisplayError(error: Error | null | undefined): DisplayError | undefined {
  if (!error) return undefined;
  return error instanceof ApiError
    ? { code: error.code, message: error.message }
    : { message: error.message };
}

function errorText(error: DisplayError, t: TournamentMessages): string {
  if (error.code === 'ALREADY_IN_SESSION' || error.code === 'ALREADY_IN_ACTIVE_GAME') {
    return t.alreadyPlaying;
  }
  if (error.code === 'INSUFFICIENT_BALANCE') return t.insufficientBalance;
  return error.message;
}

/**
 * Recherche d'une table (D-065) : le message principal reste affiché tant que le serveur
 * cherche ; le message secondaire suit l'état RÉEL de la requête (en cours, table trouvée,
 * échec). Aucun pourcentage, aucun nombre de joueurs inventé : la table et ses joueurs sont
 * montrés par l'écran de jeu, avec l'état du serveur.
 */
function Matchmaking({
  phase,
  error,
  cancelFailed = false,
  onRetry,
  onBack,
  onCancel,
}: {
  phase: 'searching' | 'found' | 'failed' | 'cancelling';
  error?: DisplayError;
  /** Départ de la table non confirmé (réseau) : la place est peut-être encore attribuée. */
  cancelFailed?: boolean;
  onRetry: () => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const pulse = usePulse(phase !== 'failed' && !cancelFailed);
  const failed = phase === 'failed';
  const link = [styles.link, fontOf(fonts.button), { fontSize: m.smallSize }];
  return (
    <View
      testID="tournament-matchmaking"
      accessibilityLiveRegion="polite"
      style={[styles.matchmaking, { gap: m.gap, paddingVertical: m.gap * 1.5 }]}
    >
      {failed || cancelFailed ? null : (
        <Animated.View style={[styles.radar, pulse]}>
          <ActivityIndicator color={tablePalette.gold} />
        </Animated.View>
      )}
      <Text
        accessibilityRole="header"
        style={[styles.matchTitle, fontOf(fonts.button), { fontSize: m.bodySize + 4 }]}
      >
        {failed ? t.matchmaking.failed : t.matchmaking.title}
      </Text>
      {failed ? (
        <>
          {error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.error, fontOf(fonts.button), { fontSize: m.smallSize }]}
            >
              {errorText(error, t)}
            </Text>
          ) : null}
          <PillButton
            title={t.matchmaking.retry}
            onPress={onRetry}
            height={m.controlHeight}
            fontSize={m.bodySize + 2}
            fontFamily={fonts.button}
          />
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.linkButton}>
            <Text style={link}>{t.list.back}</Text>
          </Pressable>
        </>
      ) : cancelFailed ? (
        <>
          <Text
            accessibilityRole="alert"
            style={[styles.error, fontOf(fonts.button), { fontSize: m.smallSize }]}
          >
            {t.matchmaking.cancelFailed}
          </Text>
          <Pressable accessibilityRole="button" onPress={onCancel} style={styles.linkButton}>
            <Text style={link}>{t.matchmaking.cancel}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[styles.meta, fontOf(fonts.button), { fontSize: m.bodySize }]}>
            {phase === 'cancelling'
              ? t.matchmaking.cancelling
              : phase === 'found'
                ? t.matchmaking.found
                : t.matchmaking.searching}
          </Text>
          {phase === 'searching' ? (
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.linkButton}>
              <Text style={link}>{t.matchmaking.cancel}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

/** Battement lent et discret de l'indicateur de recherche. */
function usePulse(active: boolean) {
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!active) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, value]);
  return {
    opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
    transform: [
      {
        scale: value.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.12],
        }),
      },
    ],
  };
}

/**
 * Tournoi complet (D-057) : bloc informatif, ton positif, sans couleur d'erreur.
 * `register` : l'inscription vient d'être refusée ; `join` : le tournoi est déjà complet.
 */
function FullNotice({ variant }: { variant: 'register' | 'join' }) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  return (
    <View testID="tournament-full" accessibilityLiveRegion="polite" style={styles.fullNotice}>
      <Text style={[styles.fullTitle, fontOf(fonts.button), { fontSize: m.bodySize + 1 }]}>
        {t.full.title}
      </Text>
      <Text style={[styles.detailText, fontOf(fonts.button), { fontSize: m.smallSize + 1 }]}>
        {t.full[variant]}
      </Text>
    </View>
  );
}

/**
 * Contenu du groupe « mon inscription », selon l'état RÉEL renvoyé par le serveur ; `null`
 * quand il n'y a rien à dire (le groupe n'est alors pas affiché). Fonction et non composant :
 * le panneau doit savoir si le groupe est vide.
 */
function tournamentDetails({
  tournament,
  state,
  receivedAt,
  messages: t,
  textStyle,
  fullNoticeShown = false,
}: {
  tournament: TournamentView;
  state: PanelState;
  receivedAt: number;
  messages: TournamentMessages;
  textStyle: StyleProp<TextStyle>;
  /** Le refus « complet » est déjà affiché : pas de second bloc. */
  fullNoticeShown?: boolean;
}): ReactNode {
  const account = tournament.account;
  switch (state) {
    case 'UPCOMING':
      if (isFull(tournament)) return fullNoticeShown ? null : <FullNotice variant="join" />;
      return <Text style={textStyle}>{t.notRegistered}</Text>;
    case 'REGISTERED':
    case 'WAITING':
      return (
        <>
          {state === 'REGISTERED' && <Text style={textStyle}>{t.registeredNow}</Text>}
          <Text style={textStyle}>
            {`${t.registered} · ${t.reserved(
              formatFcfa(tournament.registration?.reservation?.amount ?? tournament.entryFee),
            )}`}
          </Text>
          <Text style={textStyle}>{t.waiting}</Text>
          <StartCountdown tournament={tournament} receivedAt={receivedAt} style={textStyle} />
        </>
      );
    case 'IN_PROGRESS':
      if (!account) {
        return isFull(tournament) ? (
          <FullNotice variant="join" />
        ) : (
          <Text style={textStyle}>{t.closed}</Text>
        );
      }
      return (
        <>
          <Text style={textStyle}>{t.tokens(account.currentTokens, account.gamesPlayed)}</Text>
          {account.status === 'OUT_OF_TOKENS' && <Text style={textStyle}>{t.outOfTokens}</Text>}
        </>
      );
    case 'COMPLETED':
      if (tournament.status === 'CANCELLED') {
        return (
          <>
            <Text style={textStyle}>{t.cancelled}</Text>
            {tournament.cancellationReason && (
              <Text style={textStyle}>{t.cancelReasons[tournament.cancellationReason]}</Text>
            )}
          </>
        );
      }
      if (!hasResults(tournament)) return <Text style={textStyle}>{t.closing}</Text>;
      return (
        <>
          <Text style={textStyle}>{t.completed}</Text>
          {tournament.podium.map((row) => (
            <Text key={row.rank} style={textStyle}>
              {`${MEDALS[row.rank - 1] ?? `${row.rank}.`} ${row.username} — ${formatFcfa(row.prizeAmount)}`}
            </Text>
          ))}
          {account?.rank !== undefined && (
            <Text style={textStyle}>
              {t.myResult(account.rank, formatFcfa(account.prizeAmount))}
            </Text>
          )}
        </>
      );
  }
}

/** Au-delà de cette largeur, les quatre informations tiennent sur une seule rangée. */
const FACTS_ONE_ROW_WIDTH = 520;

/**
 * Informations essentielles (groupe B) : participation, inscrits / capacité (et le minimum
 * requis), durée réelle, rangs récompensés. Une grille 2 × 2 sur un écran étroit, une rangée
 * de 4 sinon ; chaque valeur porte son libellé, sans abréviation ambiguë.
 */
function TournamentFacts({ tournament }: { tournament: TournamentView }) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const [width, setWidth] = useState(0);
  const gap = Math.round(m.gap * 0.6);
  const columns = width >= FACTS_ONE_ROW_WIDTH ? 4 : 2;
  const tileWidth = width > 0 ? Math.floor((width - gap * (columns - 1)) / columns) : '48%';
  const ranks = rewardedRanks(tournament);
  const facts: { key: string; label: string; value: string; detail?: string }[] = [
    { key: 'entry', label: t.facts.entry, value: formatFcfa(tournament.entryFee) },
    {
      key: 'players',
      label: t.facts.players,
      value: t.facts.registered(tournament.registeredCount, tournament.maximumPlayers),
      detail: t.facts.minimum(tournament.minimumPlayers),
    },
    { key: 'duration', label: t.facts.duration, value: formatTournamentDuration(tournament) },
  ];
  if (ranks > 0)
    facts.push({ key: 'rewards', label: t.facts.rewards, value: t.facts.ranks(ranks) });
  const label = [styles.factLabel, fontOf(fonts.button), { fontSize: m.smallSize }];
  return (
    <View
      testID="tournament-facts"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.facts, { rowGap: gap, columnGap: gap }]}
    >
      {facts.map((fact) => (
        <View
          key={fact.key}
          testID={`tournament-fact-${fact.key}`}
          accessible
          accessibilityLabel={[fact.label, fact.value, fact.detail].filter(Boolean).join(' : ')}
          style={[
            styles.fact,
            {
              width: tileWidth,
              paddingVertical: Math.round(m.gap * 0.7),
              paddingHorizontal: Math.round(m.gap * 0.6),
            },
          ]}
        >
          <Text style={label}>{fact.label}</Text>
          <Text
            style={[
              styles.factValue,
              fontOf(fonts.button),
              { fontSize: m.bodySize + 1, lineHeight: Math.round((m.bodySize + 1) * 1.3) },
            ]}
          >
            {fact.value}
          </Text>
          {fact.detail ? <Text style={label}>{fact.detail}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * Notifications non lues (dans l'application, sans push) ; un appui les marque lues.
 * L'approbation d'une proposition n'y figure plus : son initiateur la voit sur la carte du
 * tournoi dans la liste (« ✓ Proposition approuvée »).
 */
function TournamentNotices({ textStyle }: { textStyle: StyleProp<TextStyle> }) {
  const t = useTournamentMessages();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const unread = (data?.notifications ?? [])
    .filter((n) => !n.readAt && n.type !== 'TOURNAMENT_APPROVED')
    .slice(0, NOTICES_SHOWN);
  if (unread.length === 0) return null;
  return (
    <View style={styles.notices} accessibilityLabel={t.notifications}>
      {unread.map((n) => (
        <Pressable
          key={n.id}
          accessibilityRole="button"
          onPress={() => markRead.mutate(n.id)}
          style={styles.notice}
        >
          <Text style={textStyle}>{`🔔 ${t.notification(n)}`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** « Début dans 1 h 05 » : visuel seulement, aligné sur l'horloge du serveur. */
function StartCountdown({
  tournament,
  receivedAt,
  style,
}: {
  tournament: TournamentView;
  receivedAt: number;
  style: StyleProp<TextStyle>;
}) {
  const t = useTournamentMessages();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(handle);
  }, []);
  const remaining = remainingBeforeStartMs(tournament, receivedAt || now, now);
  return remaining > 0 ? <Text style={style}>{t.startsIn(formatDuration(remaining))}</Text> : null;
}

/** Badge de statut discret, libellé fidèle au statut du serveur (D-065). */
export function StatusChip({
  tournament,
  size,
  fontFamily,
}: {
  tournament: Pick<TournamentView, 'status' | 'startsAt' | 'serverNow'>;
  size: number;
  fontFamily?: string;
}) {
  const t = useTournamentMessages();
  const key = tournamentStatusKey(tournament);
  return (
    <View
      testID="tournament-status"
      style={[
        styles.chip,
        (key === 'IN_PROGRESS' || key === 'OPEN') && styles.chipLive,
        key === 'CANCELLED' && styles.chipMuted,
      ]}
    >
      <Text numberOfLines={1} style={[styles.chipText, fontOf(fontFamily), { fontSize: size - 1 }]}>
        {t.status[key]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { alignItems: 'center' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  fact: { alignItems: 'center', gap: 2, borderRadius: 10, backgroundColor: 'rgba(0, 0, 0, 0.2)' },
  factLabel: { color: tablePalette.cream, opacity: 0.72, textAlign: 'center' },
  factValue: { color: tablePalette.cream, textAlign: 'center' },
  /** Filet discret : sépare MON inscription des caractéristiques du tournoi. */
  status: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tablePalette.panelBorder },
  reservation: {
    alignSelf: 'center',
    maxWidth: 560,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  reservationText: { color: tablePalette.cream, opacity: 0.88, textAlign: 'center' },
  centerText: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  date: { flexShrink: 1, color: tablePalette.gold, letterSpacing: 0.5 },
  meta: { color: tablePalette.cream, opacity: 0.92, textAlign: 'center' },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(247, 241, 225, 0.12)',
  },
  chipLive: { backgroundColor: 'rgba(31, 122, 76, 0.75)' },
  chipMuted: { backgroundColor: 'rgba(212, 42, 51, 0.35)' },
  chipText: { color: tablePalette.cream },
  detailText: { color: tablePalette.cream, textAlign: 'center' },
  error: { color: tablePalette.error, textAlign: 'center' },
  fullNotice: {
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.45)',
    backgroundColor: 'rgba(242, 196, 81, 0.10)',
  },
  fullTitle: { color: tablePalette.gold, textAlign: 'center' },
  linkButton: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  link: { color: tablePalette.gold, textDecorationLine: 'underline' },
  notices: {
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: tablePalette.panelBorder,
    paddingTop: 6,
  },
  notice: { paddingVertical: 2 },
  matchmaking: { alignItems: 'center', justifyContent: 'center' },
  radar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.55)',
    backgroundColor: 'rgba(31, 122, 76, 0.35)',
  },
  matchTitle: {
    color: tablePalette.gold,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});
