import { router, useLocalSearchParams } from 'expo-router';
import { memo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fontOf, PillButton, tablePalette, useTableFonts } from '../../components/table/TableDecor';
import { ApiError } from '../../lib/api-client';
import type {
  MyTournamentResult,
  OfficialTournamentResults,
  RankingRulesView,
  TournamentResultView,
  TournamentResultsHistoryItem,
} from '../../types/tournament';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import {
  isResultsPending,
  useTournamentResults,
  useTournamentResultsHistory,
  useTournamentSignals,
} from './hooks';
import { ReportProblemLink } from '../complaints/ReportProblemLink';
import { TournamentFrame } from './TournamentScreen';
import { useTournamentMessages, type TournamentMessages } from './tournament-messages';
import { formatFcfa, formatTournamentPeriod, rewardMedal } from './tournament-state';

/** Ordre des colonnes du classement : rang, médaille, joueur, parties, jetons, score. */
const COLUMNS = ['rank', 'medal', 'player', 'games', 'tokens', 'score'] as const;
/** Hauteur FIXE d'une ligne : un classement de centaines de joueurs défile sans à-coups. */
const ROW_HEIGHT = 40;
/** Élément de tête de la liste, épinglé en haut pendant le défilement. */
const COLUMN_HEAD = 'column-head' as const;
type RankingItem = TournamentResultView | typeof COLUMN_HEAD;

const back = (fallback: string) => () =>
  router.canGoBack() ? router.back() : router.replace(fallback as never);

/**
 * Rubrique « Résultats des tournois » (D-106) : mes tournois terminés dont le classement
 * officiel est publié, sans la limite de 7 jours de la liste principale (D-072). Chaque
 * tournoi ouvre son classement général complet. Tout est lu sur le serveur : disponible après
 * une déconnexion, des notifications manquées ou des semaines plus tard.
 */
export function TournamentResultsHistoryScreen() {
  return <TournamentFrame onBack={back('/tournament')}>{() => <HistoryList />}</TournamentFrame>;
}

function HistoryList() {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  useTournamentSignals();
  const query = useTournamentResultsHistory();
  const { data, isPending, isError, refetch, isRefetching, hasNextPage, fetchNextPage } = query;
  const items = data?.pages.flatMap((p) => p.tournaments) ?? [];
  const text = [styles.text, fontOf(fonts.button), { fontSize: m.bodySize }];

  if (isPending) return <Loading />;
  if (isError && items.length === 0) {
    return <Failure message={t.results.error} onRetry={() => void refetch()} />;
  }
  return (
    <FlatList
      testID="tournament-results-history"
      data={items}
      keyExtractor={(item) => item.tournamentId}
      contentContainerStyle={{
        gap: Math.round(m.gap * 0.7),
        paddingBottom: m.gap,
      }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={tablePalette.gold}
        />
      }
      ListHeaderComponent={
        <Text
          accessibilityRole="header"
          style={[styles.section, fontOf(fonts.button), { fontSize: m.smallSize }]}
        >
          {t.results.title}
        </Text>
      }
      ListEmptyComponent={
        <View style={[styles.box, { padding: m.gap * 1.5 }]}>
          <Text style={{ fontSize: Math.round(m.bodySize * 1.8) }}>🏆</Text>
          <Text style={text}>{t.results.empty}</Text>
        </View>
      }
      ListFooterComponent={
        hasNextPage ? (
          <PillButton
            title={t.results.more}
            onPress={() => void fetchNextPage()}
            height={m.controlHeight}
            fontSize={m.bodySize}
            fontFamily={fonts.button}
          />
        ) : null
      }
      renderItem={({ item }) => <HistoryCard item={item} />}
    />
  );
}

function HistoryCard({ item }: { item: TournamentResultsHistoryItem }) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const period = formatTournamentPeriod(item, t.locale);
  const published = formatTournamentPeriod(
    { startsAt: item.resultsPublishedAt, endsAt: item.resultsPublishedAt },
    t.locale,
  );
  const meta = [styles.meta, fontOf(fonts.button), { fontSize: m.smallSize }];
  return (
    <Pressable
      testID={`tournament-results-${item.tournamentId}`}
      accessibilityRole="button"
      accessibilityLabel={t.results.open(period.date)}
      onPress={() => router.push(`/tournament/results/${item.tournamentId}`)}
      style={({ pressed }) => [
        styles.card,
        { padding: Math.round(m.gap * 0.8), gap: 3 },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.row}>
        <Text
          numberOfLines={1}
          style={[styles.date, fontOf(fonts.button), { fontSize: m.bodySize + 2 }]}
        >
          {t.results.tournamentOf(period.date)}
        </Text>
        <Text style={[styles.rankBadge, fontOf(fonts.button), { fontSize: m.smallSize }]}>
          {t.results.myRank(item.myRank, item.participants)}
        </Text>
      </View>
      <Text style={meta}>{`🕐 ${t.period(period.start, period.end)} · ${t.status.COMPLETED}`}</Text>
      <Text style={meta}>{t.results.item(item.participants, published.date)}</Text>
    </Pressable>
  );
}

/**
 * Classement général OFFICIEL d'un tournoi (D-106) : tous les participants classés, dans
 * l'ordre officiel enregistré par le serveur (jamais retrié ici), ma ligne mise en évidence, et
 * le détail de MON score. Pendant la publication : un état explicite, relu automatiquement.
 */
export function TournamentOfficialResultsScreen() {
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  return (
    <TournamentFrame onBack={back('/tournament/results')}>
      {() => (
        <OfficialResults
          tournamentId={typeof tournamentId === 'string' ? tournamentId : undefined}
        />
      )}
    </TournamentFrame>
  );
}

export function OfficialResults({ tournamentId }: { tournamentId: string | undefined }) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  useTournamentSignals();
  const { data, isPending, error, refetch, isRefetching } = useTournamentResults(tournamentId);

  if (isPending) return <Loading />;
  if (isResultsPending(error)) {
    return (
      <View testID="tournament-results-pending" style={[styles.center, { gap: m.gap }]}>
        <ActivityIndicator color={tablePalette.gold} />
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.text, fontOf(fonts.button), { fontSize: m.bodySize }]}
        >
          {t.results.pending}
        </Text>
      </View>
    );
  }
  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Failure
        message={notFound ? t.results.notFound : t.results.error}
        onRetry={notFound ? undefined : () => void refetch()}
      />
    );
  }
  // L'en-tête des colonnes est le premier élément de la liste : il reste épinglé (index 1, après
  // le ListHeaderComponent) pendant que le titre et « Votre résultat » défilent hors de l'écran.
  const items: RankingItem[] = [COLUMN_HEAD, ...data.results];
  return (
    <FlatList<RankingItem>
      testID="tournament-official-results"
      data={items}
      keyExtractor={(item) => (item === COLUMN_HEAD ? item : String(item.rank))}
      stickyHeaderIndices={[1]}
      initialNumToRender={20}
      maxToRenderPerBatch={20}
      windowSize={7}
      contentContainerStyle={{ paddingBottom: m.gap * 2 }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={tablePalette.gold}
        />
      }
      ListHeaderComponent={<ResultsHeader results={data} />}
      // Réclamation sur ce classement ou sa récompense (D-114) ; accès vérifié par le serveur.
      ListFooterComponent={<ReportProblemLink tournamentId={tournamentId} category="TOURNAMENT_REWARD" />}
      renderItem={({ item }) =>
        item === COLUMN_HEAD ? <ColumnHead /> : <RankingRow row={item} />
      }
    />
  );
}

function ResultsHeader({ results }: { results: OfficialTournamentResults }) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const period = formatTournamentPeriod(results.tournament, t.locale);
  const meta = [styles.meta, fontOf(fonts.button), { fontSize: m.smallSize }];
  const published = results.publishedAt
    ? formatTournamentPeriod(
        { startsAt: results.publishedAt, endsAt: results.publishedAt },
        t.locale,
      )
    : undefined;
  return (
    <View
      style={{
        gap: Math.round(m.gap * 0.7),
        marginBottom: Math.round(m.gap * 0.5),
      }}
    >
      <View style={styles.titleBlock}>
        <Text
          accessibilityRole="header"
          style={[styles.date, fontOf(fonts.button), { fontSize: m.bodySize + 4 }]}
        >
          {`${t.results.officialTitle} · ${t.results.tournamentOf(period.date)}`}
        </Text>
        <Text style={meta}>
          {[
            `🕐 ${t.period(period.start, period.end)}`,
            t.results.participants(results.participants),
            published ? t.results.published(published.date) : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {results.me ? (
        <MyResultCard me={results.me} rules={results.rules} participants={results.participants} />
      ) : (
        <Text style={meta}>{t.results.mine.notParticipant}</Text>
      )}
    </View>
  );
}

function ColumnHead() {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  return (
    <View
      testID="tournament-results-columns"
      style={[styles.tableHead, { paddingHorizontal: Math.round(m.gap * 0.6) }]}
    >
      {COLUMNS.map((key) => (
        <Text
          key={key}
          numberOfLines={1}
          style={[
            styles.headCell,
            cellStyle[key],
            fontOf(fonts.button),
            { fontSize: m.smallSize - 1 },
          ]}
        >
          {key === 'medal' ? '' : t.results.columns[key]}
        </Text>
      ))}
    </View>
  );
}

const number = (locale: string, value: number, digits = 2) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
const percent = (locale: string, ratio: number) =>
  new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(ratio);

/** Mon résultat : rang, score, capital, jetons, parties, pondérations et détail du score. */
function MyResultCard({
  me,
  rules,
  participants,
}: {
  me: MyTournamentResult;
  rules: RankingRulesView;
  participants: number;
}) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const label = [styles.factLabel, fontOf(fonts.button), { fontSize: m.smallSize - 1 }];
  const value = [styles.factValue, fontOf(fonts.button), { fontSize: m.bodySize + 1 }];
  const line = [styles.meta, fontOf(fonts.button), { fontSize: m.smallSize }];
  const facts: [string, string][] = [
    [t.results.mine.rank, [rewardMedal(me), `${me.rank} / ${participants}`].filter(Boolean).join(' ')],
    [t.results.mine.score, me.score !== undefined ? number(t.locale, me.score) : '—'],
    [t.results.mine.capital, number(t.locale, me.initialTokens, 0)],
    [t.results.mine.remaining, number(t.locale, me.remainingTokens, 0)],
    [t.results.mine.games, String(me.gamesPlayed)],
    [
      t.results.mine.weights,
      t.results.mine.weightsValue(rules.tokensWeightPercent, rules.gamesWeightPercent),
    ],
  ];
  return (
    <View
      testID="tournament-my-result"
      style={[styles.mine, { padding: Math.round(m.gap * 0.8), gap: 6 }]}
    >
      <Text style={[styles.mineTitle, fontOf(fonts.button), { fontSize: m.bodySize }]}>
        {t.results.mine.title}
      </Text>
      <View style={[styles.facts, { gap: Math.round(m.gap * 0.5) }]}>
        {facts.map(([k, v]) => (
          <View key={k} style={[styles.fact, { paddingVertical: 4, paddingHorizontal: 8 }]}>
            <Text style={label}>{k}</Text>
            <Text style={value}>{v}</Text>
          </View>
        ))}
      </View>
      <Text style={line}>{t.results.mine.fictionalTokens}</Text>
      <Text style={line}>
        {t.results.mine.tokensCriterion(
          percent(t.locale, me.tokensRatio),
          number(t.locale, me.tokensPoints),
        )}
      </Text>
      <Text style={line}>
        {t.results.mine.gamesCriterion(me.gamesPlayed, number(t.locale, me.gamesPoints))}
      </Text>
      {me.tieBreak ? <Text style={line}>{`⚖️ ${t.results.tieBreakA11y[me.tieBreak]}`}</Text> : null}
      {me.payout ? (
        <Text testID="tournament-my-payout" style={line}>
          {me.payout.status === 'CREDITED'
            ? t.results.mine.payoutCredited(formatFcfa(me.payout.amount))
            : t.results.mine.payoutPending(formatFcfa(me.payout.amount))}
        </Text>
      ) : me.prizeAmount > 0 ? (
        <Text style={line}>{t.results.mine.prize(formatFcfa(me.prizeAmount))}</Text>
      ) : null}
    </View>
  );
}

/**
 * Ligne du classement : hauteur fixe, colonnes de largeur fixe autour du nom (seul à se
 * tronquer) et nombres réduits plutôt que coupés, pour que rien ne se décale. La médaille ne
 * dépend que de la récompense attribuée, la mise en évidence de ma ligne que de `isViewer`.
 */
const RankingRow = memo(function RankingRow({ row }: { row: TournamentResultView }) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const cell = (key: keyof typeof cellStyle) => [
    styles.cell,
    cellStyle[key],
    fontOf(fonts.button),
    { fontSize: m.smallSize + 1 },
  ];
  const medal = rewardMedal(row);
  const a11y = [
    `${t.results.columns.rank} ${row.rank}`,
    row.isViewer ? t.results.you : row.username,
    `${t.results.columns.games} ${row.gamesPlayed}`,
    `${t.results.columns.tokens} ${row.remainingTokens}`,
    row.score !== undefined ? `${t.results.columns.score} ${number(t.locale, row.score)}` : '',
    row.tieBreak ? t.results.tieBreakA11y[row.tieBreak] : '',
  ]
    .filter(Boolean)
    .join(', ');
  const fit = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.6 } as const;
  return (
    <View
      testID={row.isViewer ? 'tournament-results-me' : `tournament-results-row-${row.rank}`}
      accessible
      accessibilityLabel={a11y}
      style={[
        styles.tableRow,
        { paddingHorizontal: Math.round(m.gap * 0.6), height: ROW_HEIGHT },
        medal !== undefined && styles.rewardedRow,
        row.isViewer && styles.meRow,
      ]}
    >
      <Text {...fit} style={[cell('rank'), row.isViewer && styles.meText]}>
        {row.rank}
      </Text>
      <Text testID={`tournament-results-medal-${row.rank}`} style={[cell('medal'), styles.medal]}>
        {medal ?? ''}
      </Text>
      <View style={[cellStyle.player, styles.playerCell]}>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[cell('player'), styles.playerName, row.isViewer && styles.meText]}
        >
          {row.username}
        </Text>
        {row.isViewer ? (
          <Text numberOfLines={1} style={[cell('player'), styles.meText, styles.suffix]}>
            {` (${t.results.you})`}
          </Text>
        ) : null}
        {row.tieBreak ? <Text style={[cell('player'), styles.suffix]}> ⚖️</Text> : null}
      </View>
      <Text {...fit} style={cell('games')}>
        {row.gamesPlayed}
      </Text>
      <Text {...fit} style={cell('tokens')}>
        {number(t.locale, row.remainingTokens, 0)}
      </Text>
      <Text {...fit} style={cell('score')}>
        {row.score !== undefined ? number(t.locale, row.score) : '—'}
      </Text>
    </View>
  );
});

function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={tablePalette.gold} />
    </View>
  );
}

function Failure({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const m = useLobbyMetrics();
  const t: TournamentMessages = useTournamentMessages();
  const fonts = useTableFonts();
  return (
    <View style={[styles.center, { gap: m.gap }]}>
      <Text
        accessibilityRole="alert"
        style={[styles.text, fontOf(fonts.button), { fontSize: m.bodySize }]}
      >
        {message}
      </Text>
      {onRetry ? (
        <PillButton
          title={t.results.retry}
          onPress={onRetry}
          height={m.controlHeight}
          fontSize={m.bodySize}
          fontFamily={fonts.button}
        />
      ) : null}
    </View>
  );
}

const cellStyle = StyleSheet.create({
  rank: { width: 44, textAlign: 'center' },
  medal: { width: 30, textAlign: 'center' },
  player: { flex: 1, minWidth: 0, textAlign: 'left' },
  games: { width: 56, textAlign: 'right' },
  tokens: { width: 84, textAlign: 'right' },
  score: { width: 68, textAlign: 'right' },
});

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  text: { color: tablePalette.cream, textAlign: 'center' },
  section: {
    color: tablePalette.gold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    opacity: 0.9,
  },
  box: {
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.22)',
    backgroundColor: 'rgba(8, 30, 18, 0.7)',
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.35)',
    backgroundColor: 'rgba(8, 30, 18, 0.88)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45)',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  date: { flexShrink: 1, color: tablePalette.gold, letterSpacing: 0.5 },
  rankBadge: { marginLeft: 'auto', color: tablePalette.cream },
  meta: { color: tablePalette.cream, opacity: 0.92 },
  titleBlock: { alignItems: 'center', gap: 2 },
  mine: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tablePalette.gold,
    backgroundColor: 'rgba(23, 128, 110, 0.28)',
  },
  mineTitle: { color: tablePalette.gold },
  facts: { flexDirection: 'row', flexWrap: 'wrap' },
  fact: {
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    alignItems: 'center',
  },
  factLabel: { color: tablePalette.cream, opacity: 0.72 },
  factValue: { color: tablePalette.cream },
  tableHead: {
    flexDirection: 'row',
    // Opaque : les lignes défilent SOUS l'en-tête épinglé.
    backgroundColor: 'rgba(42, 7, 5, 0.96)',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(242, 196, 81, 0.35)',
  },
  headCell: { color: tablePalette.gold, opacity: 0.85 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(247, 241, 225, 0.15)',
  },
  cell: { color: tablePalette.cream },
  playerCell: { flexDirection: 'row', alignItems: 'center' },
  playerName: { flex: 0, flexShrink: 1 },
  suffix: { flex: 0, flexShrink: 0 },
  medal: { fontSize: 18 },
  rewardedRow: { backgroundColor: 'rgba(242, 196, 81, 0.08)' },
  meRow: {
    backgroundColor: 'rgba(31, 122, 76, 0.55)',
    borderLeftWidth: 3,
    borderLeftColor: tablePalette.gold,
  },
  meText: { color: '#FFFFFF', fontWeight: '700' },
});
