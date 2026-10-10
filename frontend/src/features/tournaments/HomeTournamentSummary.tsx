import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette, useTableFonts } from '../../components/table/TableDecor';
import { useTournamentList } from './hooks';
import { StatusChip } from './TournamentDetailPanel';
import { useTournamentMessages } from './tournament-messages';
import {
  formatFcfa,
  formatTournamentSchedule,
  isParticipant,
  rewardedRanks,
  selectHomeTournament,
} from './tournament-state';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Résumé COMPACT du prochain tournoi pertinent (D-065), en filigrane au centre du panneau
 * Tournois de l'accueil : voile translucide vert sombre, liseré doré, l'illustration du
 * panneau reste visible derrière. Choix fait sur la liste du SERVEUR
 * (`selectHomeTournament`) : rien pendant le chargement, sans tournoi pertinent ou en erreur.
 *
 * Un appui ouvre la fiche du tournoi (inscription, état d'affectation, rejoindre) ; le
 * bouton « Rejoindre » du panneau ouvre la liste complète.
 */
export function HomeTournamentSummary({ width: w }: { width: number }) {
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const { data } = useTournamentList();
  const tournament = selectHomeTournament(data?.tournaments);
  if (!tournament) return null;

  const { date, start, end } = formatTournamentSchedule(tournament);
  const titleSize = Math.round(clamp(w * 0.058, 11, 20));
  const metaSize = Math.round(clamp(w * 0.044, 9, 15));
  const meta = [styles.meta, fontOf(fonts.button), { fontSize: metaSize }];
  const participant = isParticipant(tournament);
  const ranks = rewardedRanks(tournament);
  const facts = [
    t.entry(formatFcfa(tournament.entryFee)),
    `👥 ${tournament.registeredCount}/${tournament.minimumPlayers}`,
    ranks > 0 ? `🏆 ${t.facts.ranks(ranks)}` : undefined,
  ].filter((fact): fact is string => fact !== undefined);

  return (
    <Pressable
      testID="home-tournament-summary"
      accessibilityRole="button"
      accessibilityLabel={`${t.list.open(date)}, ${t.period(start, end)}, ${
        participant ? t.registered : t.list.notRegistered
      }`}
      onPress={() => router.push(`/tournament/${tournament.tournamentId}`)}
      style={({ pressed }) => [
        styles.watermark,
        {
          maxWidth: Math.round(w * 0.9),
          paddingHorizontal: Math.round(metaSize * 0.8),
          paddingVertical: Math.round(metaSize * 0.4),
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.row}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles.date, fontOf(fonts.button), { fontSize: titleSize }]}
        >
          {date}
        </Text>
        <StatusChip tournament={tournament} size={metaSize} fontFamily={fonts.button} />
      </View>
      <Text numberOfLines={1} style={meta}>{`🕐 ${t.period(start, end)}`}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={meta}>
        {facts.join('  ')}
      </Text>
      <Text
        numberOfLines={1}
        style={[meta, participant ? styles.registered : styles.notRegistered]}
      >
        {participant ? t.registered : t.list.notRegistered}
      </Text>
    </Pressable>
  );
}

const shadow = {
  textShadowColor: 'rgba(0, 0, 0, 0.6)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 2,
};

const styles = StyleSheet.create({
  watermark: {
    alignItems: 'center',
    gap: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.35)',
    // Voile léger : l'illustration du panneau reste visible derrière (filigrane).
    backgroundColor: 'rgba(6, 23, 13, 0.62)',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  date: {
    flexShrink: 1,
    color: tablePalette.gold,
    letterSpacing: 0.5,
    ...shadow,
  },
  meta: { color: tablePalette.cream, opacity: 0.95, ...shadow },
  registered: { color: tablePalette.gold },
  notRegistered: { opacity: 0.75 },
});
