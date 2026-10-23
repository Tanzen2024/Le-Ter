import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../components/ui/Button';
import { colors, spacing } from '../../../constants/theme';
import type { TournamentSummary } from '../../../types/tournament';
import {
  ADMIN_STATUS_LABELS,
  adminCanCancel,
  CANCELLATION_LABELS,
} from '../../tournaments/proposal-status';
import { formatFcfa, formatTournamentPeriod } from '../../tournaments/tournament-state';
import { AdminGate } from './AdminGate';
import { AdminPage, adminStyles } from './AdminTournamentsScreen';
import {
  useAdminRegistrations,
  useAdminResults,
  useAdminTournament,
  useAdminTournamentAction,
  useExportResults,
} from './hooks';
import { userErrorMessage } from '../../../lib/api-client';

const RESULT_STATUSES: TournamentSummary['status'][] = [
  'RESULTS_VALIDATED',
  'DISTRIBUTING_PRIZES',
  'COMPLETED',
];

/** Détail d'un tournoi (route /admin/tournaments/[tournamentId]). */
export function AdminTournamentDetailScreen() {
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  return <AdminGate>{tournamentId ? <Detail id={String(tournamentId)} /> : null}</AdminGate>;
}

function Detail({ id }: { id: string }) {
  const { data: t, isPending, error } = useAdminTournament(id);
  if (isPending) {
    return (
      <AdminPage title="Tournoi" backTo="/admin/tournaments">
        <ActivityIndicator color={colors.feltLight} />
      </AdminPage>
    );
  }
  if (error || !t) {
    return (
      <AdminPage title="Tournoi" backTo="/admin/tournaments">
        <Text style={adminStyles.error}>{error ? userErrorMessage(error) : 'Tournoi introuvable.'}</Text>
      </AdminPage>
    );
  }
  const period = formatTournamentPeriod(t, 'fr-FR');
  return (
    <AdminPage title={`Tournoi du ${period.date}`} backTo="/admin/tournaments">
      <View style={adminStyles.section}>
        <Text testID="admin-tournament-status" style={adminStyles.sectionTitle}>
          {ADMIN_STATUS_LABELS[t.status]}
        </Text>
        {t.cancellationReason ? (
          <Text
            style={adminStyles.error}
          >{`Motif : ${CANCELLATION_LABELS[t.cancellationReason]}`}</Text>
        ) : null}
        <Text style={adminStyles.line}>{`${period.date} · ${period.start} — ${period.end}`}</Text>
        <Text style={adminStyles.line}>
          {`Participation : ${formatFcfa(t.entryFee)} · Joueurs : ${t.minimumPlayers}` +
            (t.maximumPlayers !== undefined ? ` à ${t.maximumPlayers}` : ' minimum')}
        </Text>
        <Text style={adminStyles.line}>
          {`Créateur : ${t.creatorType === 'ADMIN' ? 'administration' : 'joueur'}` +
            (t.registeredCount !== undefined ? ` · Inscrits : ${t.registeredCount}` : '')}
        </Text>
        <Text style={adminStyles.line}>
          {`Répartition : ${t.prizeRules.map((r) => `${r.rank}. ${r.percent} %`).join(' · ')}`}
        </Text>
        <Text style={adminStyles.line}>
          {`Jetons : ${t.initialTournamentTokens} · mise ${t.stakePerGame}` +
            (t.platformFeePercent !== undefined ? ` · Commission : ${t.platformFeePercent} %` : '')}
        </Text>
        {t.pool ? (
          <Text style={adminStyles.line}>
            {`Cagnotte : ${formatFcfa(t.pool.grossPool)} brut · commission ${formatFcfa(
              t.pool.platformFee,
            )} · gains ${formatFcfa(t.pool.prizePool)}` +
              (t.pool.unallocatedPrize
                ? ` · non attribué ${formatFcfa(t.pool.unallocatedPrize)}`
                : '')}
          </Text>
        ) : null}
      </View>
      <Actions tournament={t} />
      <Registrations id={id} />
      {RESULT_STATUSES.includes(t.status) ? <Results tournament={t} /> : null}
    </AdminPage>
  );
}

/** Actions autorisées par l'état (le serveur revérifie et refuse le reste). */
function Actions({ tournament: t }: { tournament: TournamentSummary }) {
  const action = useAdminTournamentAction(t.tournamentId);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const pending = t.status === 'PENDING_APPROVAL';
  const cancellable = adminCanCancel(t.status) && !pending;
  if (!pending && !cancellable) return null;
  return (
    <View style={adminStyles.section}>
      <Text style={adminStyles.sectionTitle}>Actions</Text>
      {pending ? (
        <Text style={adminStyles.line}>
          Préinscriptions ouvertes : approuver les conserve ; refuser les annule et libère
          leurs réservations.
        </Text>
      ) : null}
      {pending ? (
        <View style={styles.row}>
          <Button
            title="Approuver"
            loading={action.isPending && action.variables === 'approve'}
            onPress={() => action.mutate('approve')}
          />
          <Button
            title="Refuser"
            variant="secondary"
            loading={action.isPending && action.variables === 'reject'}
            onPress={() => action.mutate('reject')}
          />
        </View>
      ) : null}
      {cancellable ? (
        confirmCancel ? (
          <>
            <Text style={adminStyles.line}>
              Annuler ce tournoi ? Toutes les réservations des inscrits seront libérées.
            </Text>
            <View style={styles.row}>
              <Button
                title="Confirmer l’annulation"
                loading={action.isPending && action.variables === 'cancel'}
                onPress={() =>
                  action.mutate('cancel', { onSettled: () => setConfirmCancel(false) })
                }
              />
              <Button title="Garder" variant="secondary" onPress={() => setConfirmCancel(false)} />
            </View>
          </>
        ) : (
          <Button
            title="Annuler le tournoi"
            variant="secondary"
            onPress={() => setConfirmCancel(true)}
          />
        )
      ) : null}
      {action.error ? (
        <Text accessibilityRole="alert" style={adminStyles.error}>
          {userErrorMessage(action.error)}
        </Text>
      ) : null}
    </View>
  );
}

function Registrations({ id }: { id: string }) {
  const { data, isPending, error } = useAdminRegistrations(id);
  return (
    <View style={adminStyles.section}>
      <Text
        style={adminStyles.sectionTitle}
      >{`Inscriptions${data ? ` (${data.length})` : ''}`}</Text>
      {isPending ? <ActivityIndicator color={colors.feltLight} /> : null}
      {error ? <Text style={adminStyles.error}>{userErrorMessage(error)}</Text> : null}
      {data?.length === 0 ? <Text style={adminStyles.muted}>Aucune inscription.</Text> : null}
      {data?.map((r, index) => (
        <Text key={`${r.username}-${index}`} style={adminStyles.line}>
          {`${r.username} · ${r.status === 'REGISTERED' ? 'inscrit' : 'désinscrit'}` +
            (r.reservation
              ? ` · ${formatFcfa(r.reservation.amount)} (${RESERVATION_LABELS[r.reservation.status]})`
              : '')}
        </Text>
      ))}
    </View>
  );
}

const RESERVATION_LABELS = {
  ACTIVE: 'réservé',
  CAPTURED: 'payé',
  RELEASED: 'libéré',
  EXPIRED: 'expiré',
} as const;

function Results({ tournament: t }: { tournament: TournamentSummary }) {
  const { data, isPending, error } = useAdminResults(t.tournamentId, true);
  const exporter = useExportResults(
    t.tournamentId,
    `tournoi du ${formatTournamentPeriod(t, 'fr-FR').date}`,
  );
  return (
    <View style={adminStyles.section}>
      <Text style={adminStyles.sectionTitle}>Classement</Text>
      {isPending ? <ActivityIndicator color={colors.feltLight} /> : null}
      {error ? <Text style={adminStyles.error}>{userErrorMessage(error)}</Text> : null}
      {data?.map((r) => (
        <Text key={r.rank} testID={`admin-result-${r.rank}`} style={adminStyles.line}>
          {`${r.rank}. ${r.username} · jetons ${r.initialTokens} → ${r.remainingTokens}` +
            ` · ${r.gamesPlayed} parties, ${r.gamesWon} gagnées` +
            (r.score !== undefined ? ` · score ${r.score.toFixed(2)}` : '') +
            ` · gain ${formatFcfa(r.prizeAmount)}`}
        </Text>
      ))}
      <Button
        title="Exporter (CSV)"
        variant="secondary"
        loading={exporter.isPending}
        onPress={() => exporter.mutate()}
      />
      {exporter.error ? (
        <Text accessibilityRole="alert" style={adminStyles.error}>
          {userErrorMessage(exporter.error)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
