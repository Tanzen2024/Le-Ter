import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  BRAND_INITIAL,
  DecorativeCards,
  fontOf,
  PillButton,
  tablePalette,
  useTableFonts,
} from '../../components/table/TableDecor';
import { usePullToRefresh } from '../../hooks/use-pull-to-refresh';
import type { TournamentView } from '../../types/tournament';
import { useLobbyMetrics, type LobbyMetrics } from '../lobby/lobby-metrics';
import { LobbyShell } from '../lobby/LobbyShell';
import { useMyTournaments, useTournamentList } from './hooks';
import { StatusChip } from './TournamentDetailPanel';
import { TournamentThanksNotice } from './TournamentThanksNotice';
import { groupTournaments } from './tournament-groups';
import { useTournamentMessages } from './tournament-messages';
import {
  formatFcfa,
  formatTournamentPeriod,
  isActionable,
  rewardedRanks,
} from './tournament-state';

/**
 * Écran Tournois (Accueil → Tournois → Rejoindre, D-065) : la LISTE des tournois publiés,
 * en quatre groupes (inscriptions ouvertes, clôturées ou complet, en cours, historique),
 * déduits du statut du serveur (`tournament-groups.ts`), le début le plus proche d'abord. Chaque
 * carte résume le tournoi et se termine, à l'extrême droite, par une flèche qui ouvre sa
 * fiche (`/tournament/[tournamentId]`) : l'inscription et l'accès à une table se font
 * depuis la fiche, après les contrôles du serveur.
 */
export function TournamentScreen() {
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <TournamentFrame
      onBack={back}
      action={
        <View style={styles.actions}>
          <ResultsLink />
          <ProposeLink />
        </View>
      }
      overlay={<TournamentThanksNotice />}
    >
      {(area) => <TournamentList area={area} />}
    </TournamentFrame>
  );
}

/** Zone de contenu sous le bandeau, entre les cartes décoratives. */
export interface TournamentArea {
  top: number;
  bottom: number;
  width: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function computeFrame(m: LobbyMetrics) {
  const bannerHeight = Math.round(clamp(m.height * 0.11, 30, 72));
  // Les petites cartes du bandeau dépassent au-dessus de lui.
  const bannerTop = m.safe.top + bannerHeight * 0.45;
  const contentTop = Math.round(bannerTop + bannerHeight + m.gap * 0.8);
  // Colonne centrale : ~19 % de la largeur de chaque côté reste aux cartes et aux boutons.
  const width = Math.round(Math.min(m.availableWidth * 0.62, 780));
  return { bannerHeight, bannerTop, contentTop, width };
}

/**
 * Cadre commun de la liste et de la fiche : coquille (HUD, boutons, retour), cartes
 * décoratives, bandeau « Tournois », et une zone centrale de contenu qui ne chevauche ni le
 * HUD, ni le bandeau, ni les boutons du bas.
 */
export function TournamentFrame({
  onBack,
  action,
  overlay,
  children,
}: {
  onBack: () => void;
  /** Lien facultatif sous le bandeau, aligné à droite (ex. « Proposer un tournoi »). */
  action?: ReactNode;
  /** Message affiché par-dessus tout l'écran (ex. remerciement de fin de tournoi, D-117). */
  overlay?: ReactNode;
  children: (area: TournamentArea) => ReactNode;
}) {
  return (
    <LobbyShell decor={<TournamentDecor />} onBack={onBack}>
      <FrameContent action={action}>{children}</FrameContent>
      {overlay}
    </LobbyShell>
  );
}

function FrameContent({
  action,
  children,
}: {
  action?: ReactNode;
  children: (area: TournamentArea) => ReactNode;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const { bannerHeight, bannerTop, contentTop, width } = computeFrame(m);
  const [appear] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [appear]);

  const actionHeight = action ? Math.round(clamp(m.height * 0.075, 30, 44)) : 0;
  const top = contentTop + (action ? actionHeight + m.gap * 0.5 : 0);
  const bottom = m.safe.bottom + Math.round(m.gap * 0.5);
  const left = Math.round((m.width - width) / 2);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: appear }]} pointerEvents="box-none">
      <View style={[styles.bannerRow, { top: bannerTop }]}>
        <View
          style={[
            styles.banner,
            {
              width: Math.round(width * 0.7),
              height: bannerHeight,
              paddingHorizontal: bannerHeight,
            },
          ]}
        >
          <BannerOrnament size={bannerHeight} side="left" fontFamily={fonts.button} />
          <BannerOrnament size={bannerHeight} side="right" fontFamily={fonts.button} />
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[
              styles.bannerTitle,
              fontOf(fonts.button),
              // Même taille que le titre des panneaux Fap-Fap et Garam Tia (LobbyPanel).
              { fontSize: m.panelTitleSize },
            ]}
          >
            Tournois
          </Text>
        </View>
      </View>
      {action ? (
        <View
          style={[styles.actionRow, { top: contentTop, left, width, height: actionHeight }]}
          pointerEvents="box-none"
        >
          {action}
        </View>
      ) : null}
      <View style={[styles.content, { top, bottom, left, width }]} pointerEvents="box-none">
        {children({ top, bottom, width })}
      </View>
    </Animated.View>
  );
}

function TournamentDecor() {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const { width } = computeFrame(m);
  const sideSpace = (m.width - width) / 2;
  return (
    <DecorativeCards
      cardWidth={Math.round(clamp(Math.min(m.height * 0.24, sideSpace * 0.6), 40, 200))}
      sideSpace={sideSpace}
      fontFamily={fonts.title}
    />
  );
}

/** « + Proposer un tournoi » : parcours de proposition existant (/tournament/propose). */
function ProposeLink() {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push('/tournament/propose')}
      hitSlop={8}
      style={({ pressed }) => [styles.proposeLink, pressed && styles.pressed]}
    >
      <Text style={[styles.proposeText, fontOf(fonts.button), { fontSize: m.smallSize + 1 }]}>
        ＋ Proposer un tournoi
      </Text>
    </Pressable>
  );
}

/**
 * « Résultats des tournois » (D-106) : mes tournois terminés et leur classement officiel,
 * consultables sans limite de date (la liste ci-dessous ne garde l'historique que 7 jours).
 */
function ResultsLink() {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  return (
    <Pressable
      testID="tournament-results-link"
      accessibilityRole="link"
      onPress={() => router.push('/tournament/results')}
      hitSlop={8}
      style={({ pressed }) => [styles.proposeLink, pressed && styles.pressed]}
    >
      <Text style={[styles.proposeText, fontOf(fonts.button), { fontSize: m.smallSize + 1 }]}>
        {t.results.entry}
      </Text>
    </Pressable>
  );
}

function TournamentList({ area }: { area: TournamentArea }) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const { data, isPending, isError, refetch } = useTournamentList();
  const pull = usePullToRefresh(refetch);
  // Mes propositions (GET /api/tournaments/mine : créateur = identité du jeton, côté serveur).
  // Un simple inscrit n'y figure pas ; la liste publique n'expose jamais le créateur.
  const myProposals = useMyTournaments();
  const proposedByMe = new Set(myProposals.data?.map((p) => p.tournamentId));
  // Retour d'une table de tournoi après « Annuler la recherche ».
  const { searchCancelled } = useLocalSearchParams<{ searchCancelled?: string }>();
  const label = [styles.section, fontOf(fonts.button), { fontSize: m.smallSize }];

  if (isPending) {
    return (
      <View style={styles.centerFill}>
        <ActivityIndicator color={tablePalette.gold} />
      </View>
    );
  }
  if (isError || !data) {
    return (
      <View style={[styles.centerFill, { gap: m.gap }]}>
        <Text
          accessibilityRole="alert"
          style={[styles.emptyText, fontOf(fonts.button), { fontSize: m.bodySize }]}
        >
          {t.list.error}
        </Text>
        <PillButton
          title={t.list.retry}
          onPress={() => void refetch()}
          height={m.controlHeight}
          fontSize={m.bodySize}
          fontFamily={fonts.button}
          style={{ minWidth: area.width * 0.4 }}
        />
      </View>
    );
  }
  const groups = groupTournaments(data);
  const upcoming = groups.filter((g) => g.key !== 'history');
  return (
    <ScrollView
      testID="tournament-list"
      style={styles.scroll}
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
    >
      {searchCancelled === '1' ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.notice, fontOf(fonts.button), { fontSize: m.smallSize }]}
        >
          {t.matchmaking.cancelled}
        </Text>
      ) : null}
      {upcoming.length === 0 ? (
        <View style={[styles.emptyBox, { padding: m.gap * 1.5 }]}>
          <Text style={{ fontSize: Math.round(m.bodySize * 1.8) }}>🏆</Text>
          <Text style={[styles.emptyText, fontOf(fonts.button), { fontSize: m.bodySize }]}>
            {t.list.empty}
          </Text>
        </View>
      ) : null}
      {groups.map((group, index) => (
        <View
          key={group.key}
          testID={`tournament-group-${group.key}`}
          style={{ gap: Math.round(m.gap * 0.7), marginTop: index > 0 ? m.gap * 0.5 : 0 }}
        >
          <Text accessibilityRole="header" style={label}>
            {t.list.groups[group.key]}
          </Text>
          {group.tournaments.map((tournament) => (
            <TournamentCard
              key={tournament.tournamentId}
              tournament={tournament}
              muted={group.key === 'history'}
              proposedByMe={proposedByMe.has(tournament.tournamentId)}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * Carte d'un tournoi : date et statut, horaires, participation, inscrits / capacité et
 * minimum, rangs récompensés, mon inscription ; flèche à l'extrême droite (zone tactile de
 * 44 dp au moins). Toute la carte ouvre aussi la fiche. Les tournois où le joueur peut agir
 * (s'inscrire, rejoindre, inscrit) sont mis en valeur par un liseré doré.
 *
 * `proposedByMe` : le joueur connecté est l'initiateur de la proposition (d'après ses
 * propositions relues sur le serveur). Lui seul voit alors « ✓ Proposition approuvée » en haut
 * à droite : la liste ne contient que des tournois publiés, donc approuvés.
 */
export function TournamentCard({
  tournament,
  muted = false,
  proposedByMe = false,
}: {
  tournament: TournamentView;
  muted?: boolean;
  proposedByMe?: boolean;
}) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const period = formatTournamentPeriod(tournament, t.locale);
  const meta = [styles.meta, fontOf(fonts.button), { fontSize: m.smallSize }];
  const highlighted = !muted && isActionable(tournament);
  const registered = tournament.registration !== null || tournament.account !== null;
  const approvedProposal =
    proposedByMe && tournament.status !== 'DRAFT' && tournament.status !== 'PENDING_APPROVAL';
  const arrow = Math.max(44, Math.round(m.controlHeight));
  const open = () => router.push(`/tournament/${tournament.tournamentId}`);
  const facts = [
    t.entry(formatFcfa(tournament.entryFee)),
    t.list.registeredCount(
      tournament.registeredCount,
      tournament.minimumPlayers,
      tournament.maximumPlayers,
    ),
    rewardedRanks(tournament) > 0 ? t.ranks(rewardedRanks(tournament)) : undefined,
  ].filter((fact): fact is string => fact !== undefined);

  return (
    <Pressable
      testID={`tournament-card-${tournament.tournamentId}`}
      accessibilityRole="button"
      accessibilityLabel={`${t.list.open(period.date)}, ${t.period(period.start, period.end)}`}
      onPress={open}
      style={({ pressed }) => [
        styles.card,
        { padding: Math.round(m.gap * 0.8), gap: m.gap },
        highlighted && styles.cardHighlighted,
        muted && styles.cardMuted,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.cardBody}>
        <View style={styles.row}>
          <Text
            numberOfLines={1}
            style={[styles.date, fontOf(fonts.button), { fontSize: m.bodySize + 2 }]}
          >
            {period.date}
          </Text>
          <StatusChip tournament={tournament} size={m.smallSize} fontFamily={fonts.button} />
          <View style={[styles.badge, registered ? styles.badgeOn : styles.badgeOff]}>
            <Text
              numberOfLines={1}
              style={[styles.badgeText, fontOf(fonts.button), { fontSize: m.smallSize - 1 }]}
            >
              {registered ? t.registered : t.list.notRegistered}
            </Text>
          </View>
          {approvedProposal ? (
            <View
              testID={`tournament-approved-proposal-${tournament.tournamentId}`}
              style={[styles.badge, styles.approvedBadge]}
            >
              <Text
                numberOfLines={1}
                style={[styles.approvedText, fontOf(fonts.button), { fontSize: m.smallSize - 1 }]}
              >
                {t.list.approvedProposal}
              </Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={meta}>{`🕐 ${t.period(period.start, period.end)}`}</Text>
        <View style={[styles.facts, { columnGap: m.gap }]}>
          {facts.map((fact) => (
            <Text key={fact} numberOfLines={1} style={meta}>
              {fact}
            </Text>
          ))}
        </View>
      </View>
      <Pressable
        testID={`tournament-open-${tournament.tournamentId}`}
        accessibilityRole="button"
        accessibilityLabel={t.list.open(period.date)}
        onPress={open}
        hitSlop={6}
        style={({ pressed }) => [
          styles.arrow,
          { width: arrow, height: arrow, borderRadius: arrow / 2 },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.arrowGlyph, { fontSize: Math.round(arrow * 0.55) }]}>›</Text>
      </Pressable>
    </Pressable>
  );
}

/** Carte bleue inclinée et jeton violet aux extrémités du bandeau. */
function BannerOrnament({
  size,
  side,
  fontFamily,
}: {
  size: number;
  side: 'left' | 'right';
  fontFamily?: string;
}) {
  const card = size * 0.78;
  const chip = size * 0.62;
  const left = side === 'left';
  const anchor = left ? { left: -card * 0.15 } : { right: -card * 0.15 };
  return (
    <View
      style={[
        styles.ornament,
        anchor,
        { top: -size * 0.55, width: card + chip * 0.6, height: card * 1.6 },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.blueCard,
          {
            width: card,
            height: card * 1.36,
            borderRadius: card * 0.1,
            borderWidth: Math.max(1.5, card * 0.06),
            transform: [{ rotate: left ? '-14deg' : '14deg' }],
          },
          left ? { left: 0 } : { right: 0 },
        ]}
      >
        <Text
          allowFontScaling={false}
          style={[styles.blueLetter, fontOf(fontFamily), { fontSize: card * 0.55 }]}
        >
          {BRAND_INITIAL}
        </Text>
      </View>
      <View
        style={[
          styles.chip,
          {
            width: chip,
            height: chip,
            borderRadius: chip / 2,
            borderWidth: Math.max(2, chip * 0.14),
            top: card * 0.78,
          },
          left ? { left: card * 0.62 } : { right: card * 0.62 },
        ]}
      >
        <View
          style={[
            styles.chipCenter,
            {
              width: chip * 0.46,
              height: chip * 0.46,
              borderRadius: chip * 0.23,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bannerRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  banner: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: 'rgba(8, 14, 8, 0.72)',
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.45)',
  },
  bannerTitle: { color: '#FFFFFF' },
  actionRow: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  content: { position: 'absolute' },
  scroll: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  proposeLink: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: tablePalette.gold,
    backgroundColor: '#06170D',
  },
  proposeText: { color: tablePalette.gold },
  actions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  section: {
    color: tablePalette.gold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    opacity: 0.9,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.22)',
    backgroundColor: 'rgba(8, 30, 18, 0.88)',
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(16, 48, 29, 0.92) 0%, rgba(8, 28, 17, 0.92) 100%)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45)',
  },
  cardHighlighted: { borderColor: 'rgba(242, 196, 81, 0.75)' },
  cardMuted: { opacity: 0.78 },
  cardBody: { flex: 1, gap: 3, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  date: { flexShrink: 1, color: tablePalette.gold, letterSpacing: 0.5 },
  meta: { color: tablePalette.cream, opacity: 0.92 },
  facts: { flexDirection: 'row', flexWrap: 'wrap' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeOn: {
    borderColor: 'rgba(242, 196, 81, 0.7)',
    backgroundColor: 'rgba(242, 196, 81, 0.14)',
  },
  badgeOff: { borderColor: 'rgba(247, 241, 225, 0.25)' },
  badgeText: { color: tablePalette.cream },
  // Ton « Approuvé » de Mes propositions (jade), liseré doré : lisible au premier regard.
  approvedBadge: {
    marginLeft: 'auto',
    borderColor: tablePalette.gold,
    backgroundColor: tablePalette.jade,
  },
  approvedText: { color: '#FFFFFF', fontWeight: '700' },
  arrow: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.6)',
    backgroundColor: 'rgba(242, 196, 81, 0.12)',
  },
  arrowGlyph: { color: tablePalette.gold, fontWeight: '700', marginTop: -2 },
  emptyBox: {
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.22)',
    backgroundColor: 'rgba(8, 30, 18, 0.7)',
  },
  emptyText: { color: tablePalette.cream, textAlign: 'center' },
  notice: { color: tablePalette.cream, opacity: 0.85, textAlign: 'center' },
  ornament: { position: 'absolute' },
  blueCard: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#E8F1FF',
    backgroundColor: '#2C64B8',
    experimental_backgroundImage: 'linear-gradient(160deg, #4D8FE0 0%, #2C64B8 55%, #1B4588 100%)',
    boxShadow: '0 3px 6px rgba(0, 0, 0, 0.5)',
  },
  blueLetter: { color: '#E8F1FF', includeFontPadding: false },
  chip: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
    borderColor: '#F1E4FA',
    backgroundColor: '#7B3FA6',
    boxShadow: '0 2px 5px rgba(0, 0, 0, 0.5)',
  },
  chipCenter: {
    backgroundColor: '#E2B23F',
    borderWidth: 1,
    borderColor: '#5B2580',
  },
});
