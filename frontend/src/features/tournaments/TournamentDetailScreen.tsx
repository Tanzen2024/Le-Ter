import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fontOf, PillButton, tablePalette, useTableFonts } from '../../components/table/TableDecor';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { useTournamentDetail } from './hooks';
import { TournamentDetailPanel } from './TournamentDetailPanel';
import { TournamentFrame } from './TournamentScreen';
import { TournamentThanksNotice } from './TournamentThanksNotice';
import { useTournamentMessages } from './tournament-messages';

/**
 * Fiche d'un tournoi (liste → flèche, D-065) : informations détaillées et actions autorisées
 * par le serveur selon le statut. Ouvrir la fiche n'attribue jamais de table : seul
 * « Rejoindre le Tournoi » le demande au serveur, qui vérifie inscription et éligibilité.
 */
export function TournamentDetailScreen() {
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/tournament'));
  return (
    <TournamentFrame onBack={back} overlay={<TournamentThanksNotice />}>
      {() => (
        <Detail
          tournamentId={typeof tournamentId === 'string' ? tournamentId : undefined}
          onClose={back}
        />
      )}
    </TournamentFrame>
  );
}

function Detail({
  tournamentId,
  onClose,
}: {
  tournamentId: string | undefined;
  onClose: () => void;
}) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const { data, isPending, isError, refetch, dataUpdatedAt } = useTournamentDetail(tournamentId);

  if (isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tablePalette.gold} />
      </View>
    );
  }
  if (isError || !data) {
    return (
      <View style={[styles.center, { gap: m.gap }]}>
        <Text
          accessibilityRole="alert"
          style={[styles.text, fontOf(fonts.button), { fontSize: m.bodySize }]}
        >
          {t.list.error}
        </Text>
        <PillButton
          title={t.list.retry}
          onPress={() => void refetch()}
          height={m.controlHeight}
          fontSize={m.bodySize}
          fontFamily={fonts.button}
        />
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={[styles.panel, { padding: m.gap * 1.2 }]}>
        <TournamentDetailPanel tournament={data} receivedAt={dataUpdatedAt} />
        {/* Fermeture de la fiche : même effet que la flèche de retour du cadre. */}
        <Pressable
          testID="tournament-detail-close"
          accessibilityRole="button"
          accessibilityLabel={t.list.back}
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Text style={[styles.closeText, fontOf(fonts.button), { fontSize: m.bodySize + 4 }]}>
            ✕
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { color: tablePalette.cream, textAlign: 'center' },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  panel: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.35)',
    backgroundColor: 'rgba(8, 30, 18, 0.9)',
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(16, 48, 29, 0.94) 0%, rgba(8, 28, 17, 0.94) 100%)',
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.55)',
  },
  close: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: tablePalette.cream, opacity: 0.85 },
  pressed: { opacity: 0.6 },
});
