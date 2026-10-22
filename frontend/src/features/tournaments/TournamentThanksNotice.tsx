import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { tablePalette } from '../../components/table/TableDecor';
import { ExclusiveOverlay } from '../../components/ui/ExclusiveOverlay';
import { useMarkNotificationRead, useNotifications, useTournamentSignals } from './hooks';
import { useTournamentMessages } from './tournament-messages';
import { formatTournamentPeriod } from './tournament-state';

/**
 * Remerciement de fin de tournoi (D-117). Le SERVEUR décide quand il apparaît : la notification
 * est écrite avec le classement officiel et n'est renvoyée par l'API que 10 s après sa
 * publication (horloge du serveur) ; aucun minuteur ici. Le signal temps réel ou le retour sur
 * l'écran la font apparaître, même après une absence ou un redémarrage. Les deux actions la
 * marquent lue côté serveur : elle ne revient plus. « Voir les résultats du tournoi » ouvre le
 * classement officiel de CE tournoi (route existante), déjà publié.
 */
export function TournamentThanksNotice() {
  const t = useTournamentMessages();
  useTournamentSignals();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const thanks = (data?.notifications ?? [])
    .filter((n) => n.type === 'TOURNAMENT_THANK_YOU' && !n.readAt)
    .at(-1);
  if (!thanks) return null;

  const { tournamentId, startsAt } = thanks.payload;
  const date = startsAt
    ? formatTournamentPeriod({ startsAt, endsAt: startsAt }, t.locale).date
    : undefined;
  return (
    <ExclusiveOverlay testID="tournament-thanks" style={styles.backdrop}>
      <View style={styles.card} accessibilityRole="alert">
        <Text style={styles.title}>🏆 {t.thanks.title}</Text>
        <Text style={styles.message}>{t.thanks.message(date ?? '')}</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={markRead.isPending}
            onPress={() => markRead.mutate(thanks.id)}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>{t.thanks.close}</Text>
          </Pressable>
          {tournamentId ? (
            <Pressable
              accessibilityRole="button"
              disabled={markRead.isPending}
              onPress={() => {
                markRead.mutate(thanks.id);
                router.push(`/tournament/results/${tournamentId}`);
              }}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            >
              <Text style={styles.buttonText}>{t.thanks.viewResults}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </ExclusiveOverlay>
  );
}

const styles = StyleSheet.create({
  backdrop: { padding: 16 },
  card: {
    maxWidth: 480,
    width: '100%',
    borderRadius: 16,
    padding: 20,
    gap: 12,
    backgroundColor: tablePalette.backdrop,
    borderWidth: 1,
    borderColor: tablePalette.gold,
  },
  title: { color: tablePalette.gold, fontSize: 18, fontWeight: '700' },
  message: { color: '#fff', fontSize: 15, lineHeight: 21 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 10,
  },
  button: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: tablePalette.gold,
  },
  secondary: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: tablePalette.gold,
  },
  pressed: { opacity: 0.8 },
  buttonText: { color: tablePalette.backdrop, fontWeight: '700' },
  secondaryText: { color: tablePalette.gold, fontWeight: '700' },
});
