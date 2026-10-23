import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../components/ui/Button';
import { colors, radius, spacing } from '../../../constants/theme';
import type { TournamentStatus, TournamentSummary } from '../../../types/tournament';
import { ADMIN_STATUS_LABELS, CANCELLATION_LABELS } from '../../tournaments/proposal-status';
import { formatFcfa, formatTournamentPeriod } from '../../tournaments/tournament-state';
import { AdminGate, adminBack } from './AdminGate';
import { useAdminTournaments } from './hooks';
import { userErrorMessage } from '../../../lib/api-client';

/** Filtres de la liste : groupes de statuts serveur (aucun filtrage côté application). */
export const ADMIN_FILTERS: { key: string; label: string; statuses?: TournamentStatus[] }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'pending', label: 'À approuver', statuses: ['PENDING_APPROVAL'] },
  {
    key: 'upcoming',
    label: 'Programmés',
    statuses: ['SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'STARTING'],
  },
  { key: 'live', label: 'En cours', statuses: ['IN_PROGRESS'] },
  {
    key: 'done',
    label: 'Terminés',
    statuses: ['CALCULATING_RESULTS', 'RESULTS_VALIDATED', 'DISTRIBUTING_PRIZES', 'COMPLETED'],
  },
  { key: 'cancelled', label: 'Annulés', statuses: ['CANCELLED'] },
  { key: 'drafts', label: 'Brouillons', statuses: ['DRAFT'] },
];

/** Administration → Tournois (route /admin/tournaments, D-054). */
export function AdminTournamentsScreen() {
  return (
    <AdminGate>
      <AdminTournamentList />
    </AdminGate>
  );
}

function AdminTournamentList() {
  const [filter, setFilter] = useState(ADMIN_FILTERS[0]!);
  const { data, isPending, error } = useAdminTournaments(filter.statuses);
  return (
    <AdminPage title="Tournois">
      <View style={styles.actions}>
        <Button title="Créer un tournoi" onPress={() => router.push('/admin/tournaments/new')} />
        <Button
          title="Paramètres"
          variant="secondary"
          onPress={() => router.push('/admin/tournaments/settings')}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View accessibilityRole="tablist" style={styles.filters}>
          {ADMIN_FILTERS.map((f) => (
            <Pressable
              key={f.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: f.key === filter.key }}
              onPress={() => setFilter(f)}
              style={[styles.filter, f.key === filter.key && styles.filterSelected]}
            >
              <Text style={[styles.filterText, f.key === filter.key && styles.filterTextSelected]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      {isPending ? (
        <ActivityIndicator color={colors.feltLight} />
      ) : error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {userErrorMessage(error)}
        </Text>
      ) : !data?.length ? (
        <Text style={styles.muted}>Aucun tournoi.</Text>
      ) : (
        data.map((t) => <TournamentRow key={t.tournamentId} tournament={t} />)
      )}
    </AdminPage>
  );
}

function TournamentRow({ tournament: t }: { tournament: TournamentSummary }) {
  const period = formatTournamentPeriod(t, 'fr-FR');
  const players =
    t.maximumPlayers !== undefined
      ? `${t.minimumPlayers}–${t.maximumPlayers}`
      : `${t.minimumPlayers}+`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Tournoi du ${period.date}, ${period.start} — ${period.end}`}
      onPress={() => router.push(`/admin/tournaments/${t.tournamentId}`)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.name}>{period.date}</Text>
        <Text style={styles.status}>{ADMIN_STATUS_LABELS[t.status]}</Text>
      </View>
      <Text style={styles.line}>
        {`${period.start} — ${period.end} · ${formatFcfa(t.entryFee)}`}
      </Text>
      <Text style={styles.line}>
        {`Créateur : ${t.creatorName ?? '—'} (${t.creatorType === 'ADMIN' ? 'admin' : 'joueur'})` +
          ` · Inscrits : ${t.registeredCount ?? 0} · Joueurs : ${players}` +
          (t.platformFeePercent !== undefined ? ` · Commission : ${t.platformFeePercent} %` : '')}
      </Text>
      {t.createdAt ? (
        <Text
          style={styles.muted}
        >{`Créé le ${new Date(t.createdAt).toLocaleString('fr-FR')}`}</Text>
      ) : null}
      {t.cancellationReason ? (
        <Text style={styles.error}>{CANCELLATION_LABELS[t.cancellationReason]}</Text>
      ) : null}
    </Pressable>
  );
}

/** Mise en page commune des écrans d'administration (même style que /admin). */
export function AdminPage({
  title,
  children,
  backTo = '/admin',
}: {
  title: string;
  children: ReactNode;
  backTo?: string;
}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {children}
      <Button title="Retour" variant="link" onPress={() => adminBack(backTo)} />
    </ScrollView>
  );
}

export const adminStyles = StyleSheet.create({
  section: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  line: { fontSize: 14, color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  error: { fontSize: 14, color: colors.danger },
  success: { fontSize: 14, color: colors.success },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.xl * 2, gap: spacing.md },
  heading: { fontSize: 24, fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filters: { flexDirection: 'row', gap: spacing.sm },
  filter: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterSelected: { backgroundColor: colors.feltLight, borderColor: colors.feltLight },
  filterText: { color: colors.text, fontWeight: '600' },
  filterTextSelected: { color: colors.textOnFelt },
  card: { ...adminStyles.section },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  name: { fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1 },
  status: { fontSize: 13, fontWeight: '700', color: colors.feltLight },
  line: adminStyles.line,
  muted: adminStyles.muted,
  error: adminStyles.error,
  pressed: { opacity: 0.75 },
});
