import { router, useLocalSearchParams } from 'expo-router';
import { memo, useMemo, useState } from 'react';
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
import { colors } from '../../constants/theme';
import { usePullToRefresh } from '../../hooks/use-pull-to-refresh';
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

/**
 * Ordre des colonnes du classement : rang, médaille, joueur, parties, jetons, score, puis le
 * gain (récompense réelle attribuée par le classement officiel, D-112), toujours en dernier.
 */
const COLUMNS = ['rank', 'medal', 'player', 'games', 'tokens', 'score', 'prize'] as const;
/** « Votre résultat » : grille de 5 colonnes alignées (5 cartes en haut, 3 + 2 en bas). */
const FACT_COLUMNS = 5;
/** Hauteur FIXE d'une ligne : un classement de centaines de joueurs défile sans à-coups. */
const ROW_HEIGHT = 40;
/** Élément de tête de la liste, épinglé en haut pendant le défilement. */
const COLUMN_HEAD = 'column-head' as const;
type RankingItem = TournamentResultView | typeof COLUMN_HEAD;

type NumericColumn = Exclude<(typeof COLUMNS)[number], 'player'>;
/** Largeurs de référence des colonnes autour du nom (écran large). */
const BASE_WIDTHS: Record<NumericColumn, number> = {
  rank: 44,
  medal: 30,
  games: 56,
  tokens: 84,
  score: 68,
  prize: 96,
};
/** La médaille (emoji) et le rang ne se réduisent pas en dessous de ces largeurs. */
const MIN_WIDTHS: Partial<Record<NumericColumn, number>> = { rank: 28, medal: 24 };
const BASE_TOTAL = Object.values(BASE_WIDTHS).reduce((sum, w) => sum + w, 0);
/** En dessous de cette largeur de tableau, l'espacement entre colonnes est réduit. */
const COMPACT_TABLE = 560;

export interface RankingLayout {
  gap: number;
  widths: Record<NumericColumn, number>;
}

/**
 * Largeurs des colonnes déduites de la largeur MESURÉE du tableau : le nom du joueur garde
 * toujours au moins ~30 % de la ligne (96 dp minimum), les colonnes chiffrées se resserrent
 * proportionnellement sur les petits écrans (leurs nombres sont réduits, jamais coupés).
 * Avant la mesure (largeur 0) : largeurs de référence.
 */
export function rankingLayout(tableWidth: number, paddingHorizontal: number): RankingLayout {
  if (tableWidth <= 0) return { gap: 8, widths: BASE_WIDTHS };
  const gap = tableWidth < COMPACT_TABLE ? 4 : 8;
  const inner = tableWidth - paddingHorizontal * 2 - gap * (COLUMNS.length - 1);
  const playerMin = Math.max(96, inner * 0.3);
  const scale = Math.max(0.5, Math.min(1, (inner - playerMin) / BASE_TOTAL));
  const widths = Object.fromEntries(
    Object.entries(BASE_WIDTHS).map(([key, w]) => [
      key,
      Math.max(MIN_WIDTHS[key as NumericColumn] ?? 0, Math.floor(w * scale)),
    ]),
  ) as Record<NumericColumn, number>;
  return { gap, widths };
}

/** Style d'une cellule : largeur calculée pour les nombres, le reste de la ligne pour le nom. */
const columnStyle = (key: (typeof COLUMNS)[number], layout: RankingLayout) =>
  key === 'player' ? cellStyle.player : [cellStyle[key], { width: layout.widths[key] }];

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
  const { data, isPending, isError, refetch, hasNextPage, fetchNextPage } = query;
  const pull = usePullToRefresh(refetch);
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
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
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
      {(area) => (
        <OfficialResults
          tournamentId={typeof tournamentId === 'string' ? tournamentId : undefined}
          initialWidth={area.width}
        />
      )}
    </TournamentFrame>
  );
}

export function OfficialResults({
  tournamentId,
  initialWidth = 0,
}: {
  tournamentId: string | undefined;
  /** Largeur de la zone de contenu, connue dès le premier rendu (aucun recalage des colonnes). */
  initialWidth?: number;
}) {
  const m = useLobbyMetrics();
  // Colonnes calculées d'emblée sur la largeur de la zone ; la mesure ne corrige que si elle
  // diffère (sinon les colonnes partaient de leur largeur de base puis se recalaient).
  const [measuredWidth, setTableWidth] = useState<number | null>(null);
  const tableWidth = measuredWidth ?? initialWidth;
  const tablePadding = Math.round(m.gap * 0.6);
  const layout = useMemo(() => rankingLayout(tableWidth, tablePadding), [tableWidth, tablePadding]);
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  useTournamentSignals();
  const { data, isPending, error, refetch } = useTournamentResults(tournamentId);
  const pull = usePullToRefresh(refetch);

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
      onLayout={(e) => setTableWidth(e.nativeEvent.layout.width)}
      refreshControl={
        <RefreshControl
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          tintColor={tablePalette.gold}
        />
      }
      ListHeaderComponent={<ResultsHeader results={data} />}
      // Réclamation sur ce classement ou sa récompense (D-114) ; accès vérifié par le serveur.
      ListFooterComponent={
        <ReportProblemLink tournamentId={tournamentId} category="TOURNAMENT_REWARD" />
      }
      renderItem={({ item }) =>
        item === COLUMN_HEAD ? (
          <ColumnHead layout={layout} />
        ) : (
          <RankingRow row={item} layout={layout} />
        )
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

function ColumnHead({ layout }: { layout: RankingLayout }) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  return (
    <View
      testID="tournament-results-columns"
      style={[styles.tableHead, { paddingHorizontal: Math.round(m.gap * 0.6), gap: layout.gap }]}
    >
      {COLUMNS.map((key) => (
        <Text
          key={key}
          numberOfLines={1}
          style={[
            styles.headCell,
            columnStyle(key, layout),
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
  // [libellé, valeur, nombre de colonnes occupées] : 5 petites cartes en haut, puis
  // « Pondérations » sur la largeur des 3 premières et « Gain » sur celle des 2 dernières.
  const facts: [string, string, number][] = [
    [
      t.results.mine.rank,
      [rewardMedal(me), `${me.rank} / ${participants}`].filter(Boolean).join(' '),
      1,
    ],
    [t.results.mine.score, me.score !== undefined ? number(t.locale, me.score) : '—', 1],
    [t.results.mine.capital, number(t.locale, me.initialTokens, 0), 1],
    [t.results.mine.remaining, number(t.locale, me.remainingTokens, 0), 1],
    [t.results.mine.games, String(me.gamesPlayed), 1],
    [
      t.results.mine.weights,
      t.results.mine.weightsValue(rules.tokensWeightPercent, rules.gamesWeightPercent),
      3,
    ],
    // Récompense RÉELLE du classement officiel (FCFA) ; 0 sans récompense.
    [t.results.mine.gain, formatFcfa(me.prizeAmount), 2],
  ];
  // Grille de FACT_COLUMNS colonnes de même largeur, déduite de la largeur mesurée : les bords
  // des cartes du bas tombent exactement sur ceux des cartes du haut.
  const gridGap = Math.round(m.gap * 0.5);
  const [gridWidth, setGridWidth] = useState(0);
  const column =
    gridWidth > 0
      ? Math.floor((gridWidth - gridGap * (FACT_COLUMNS - 1)) / FACT_COLUMNS)
      : undefined;
  const widthOf = (span: number) =>
    column !== undefined
      ? { width: column * span + gridGap * (span - 1) }
      : // Avant la mesure (un instant) : proportions approchées.
        { width: `${span * 18}%` as const };
  return (
    <View
      testID="tournament-my-result"
      style={[styles.mine, { padding: Math.round(m.gap * 0.8), gap: 6 }]}
    >
      <Text style={[styles.mineTitle, fontOf(fonts.button), { fontSize: m.bodySize }]}>
        {t.results.mine.title}
      </Text>
      <View
        testID="tournament-my-facts"
        style={[styles.facts, { gap: gridGap }]}
        onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
      >
        {facts.map(([k, v, span]) => {
          // La carte « Gain » (récompense réelle) est mise en évidence en vert clair.
          const gain = k === t.results.mine.gain;
          return (
            <View
              key={k}
              testID={gain ? 'tournament-my-gain' : undefined}
              style={[
                styles.fact,
                widthOf(span),
                { paddingVertical: 4, paddingHorizontal: 8 },
                gain && styles.factGain,
              ]}
            >
              <Text style={[label, gain && styles.factGainLabel]}>{k}</Text>
              <Text style={[value, gain && styles.factGainValue]}>{v}</Text>
            </View>
          );
        })}
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
        // Récompense RÉELLE (compte de jeu) : tout en bas de la carte, sous « Parties jouées »,
        // surlignée en vert clair, distincte des jetons fictifs.
        <Text testID="tournament-my-payout" style={[...line, styles.payout]}>
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
 * Ligne du classement : hauteur fixe, colonnes chiffrées de même largeur sur toutes les lignes
 * (calculée d'après la largeur du tableau, `rankingLayout`) autour du nom (seul à se tronquer) et nombres réduits plutôt que coupés, pour que rien ne se décale. La médaille ne
 * dépend que de la récompense attribuée, la mise en évidence de ma ligne que de `isViewer`.
 */
const RankingRow = memo(function RankingRow({
  row,
  layout,
}: {
  row: TournamentResultView;
  layout: RankingLayout;
}) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const cell = (key: keyof typeof cellStyle) => [
    styles.cell,
    columnStyle(key, layout),
    fontOf(fonts.button),
    { fontSize: m.smallSize + 1 },
  ];
  const medal = rewardMedal(row);
  // Montant officiel figé avec le classement ; tant qu'il n'est pas crédité, il est signalé
  // « en cours de versement » (jamais présenté comme versé, D-112).
  const prizePending = row.prizeAmount > 0 && !row.paid;
  const a11y = [
    `${t.results.columns.rank} ${row.rank}`,
    row.isViewer ? t.results.you : row.username,
    `${t.results.columns.games} ${row.gamesPlayed}`,
    `${t.results.columns.tokens} ${row.remainingTokens}`,
    row.score !== undefined ? `${t.results.columns.score} ${number(t.locale, row.score)}` : '',
    `${t.results.columns.prize} ${formatFcfa(row.prizeAmount)}`,
    prizePending ? t.results.prizePending : '',
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
        { paddingHorizontal: Math.round(m.gap * 0.6), height: ROW_HEIGHT, gap: layout.gap },
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
      <Text {...fit} testID={`tournament-results-prize-${row.rank}`} style={cell('prize')}>
        {prizePending ? `${formatFcfa(row.prizeAmount)} ⏳` : formatFcfa(row.prizeAmount)}
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
  rank: { textAlign: 'center' },
  medal: { textAlign: 'center' },
  player: { flex: 1, minWidth: 0, textAlign: 'left' },
  games: { textAlign: 'right' },
  tokens: { textAlign: 'right' },
  score: { textAlign: 'right' },
  prize: { textAlign: 'right' },
});

const styles = StyleSheet.create({
  payout: {
    // Pleine largeur : le texte se replie dans la carte (Android tronquait un texte
    // « flex-start » arrondi et masqué au débordement).
    alignSelf: 'stretch',
    color: colors.success,
    backgroundColor: colors.successBg,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
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
  factLabel: { color: tablePalette.cream, opacity: 0.72, textAlign: 'center' },
  factValue: { color: tablePalette.cream, textAlign: 'center' },
  factGain: { backgroundColor: '#D4F7DC', borderWidth: 1, borderColor: '#7FD99A' },
  factGainLabel: { color: '#1B5E34', opacity: 1 },
  factGainValue: { color: '#14532D', fontWeight: '700' },
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
