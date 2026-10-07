import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/ui/Button';
import { colors, radius, spacing } from '../../src/constants/theme';
import { useCurrentUser } from '../../src/features/auth/hooks';
import { STATUS_LABELS } from '../../src/features/games/format';
import { DecisionPanel } from '../../src/features/sessions/DecisionPanel';
import { useJoinGame } from '../../src/features/games/hooks';
import {
  isSessionId,
  useCreateNextGame,
  useLeaveSession,
  useSession,
  useSessionDecision,
  useSessionGames,
} from '../../src/features/sessions/hooks';
import { ApiError } from '../../src/lib/api-client';
import type { SessionGameSummary, SessionView } from '../../src/types/session';

/**
 * Écran d'UNE session (D-033, D-034), identifiée par la route : sièges FIXES (places
 * vacantes comprises), partie en cours, décision Poursuivre/Quitter entre deux parties,
 * historique. Paysage (D-028). Tout est décidé par le serveur (J1, sièges, départs
 * automatiques) : l'écran affiche son état et n'envoie que les choix du joueur.
 */
export default function SessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const valid = isSessionId(sessionId);
  const session = useSession(valid ? sessionId : '');
  const games = useSessionGames(valid ? sessionId : '');

  return (
    <Screen style={styles.screen}>
      <View style={styles.topBar}>
        <Button
          title="← Accueil"
          variant="link"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
        {session.data ? (
          <Text style={styles.status}>
            Session {session.data.status === 'open' ? 'ouverte' : 'fermée'} ·{' '}
            {session.data.maxPlayers} places
          </Text>
        ) : null}
      </View>
      {!valid ? (
        <Text style={styles.message}>Identifiant de session invalide.</Text>
      ) : session.isPending ? (
        <ActivityIndicator color={colors.gold} size="large" />
      ) : session.error ? (
        <Text style={styles.message}>
          {session.error instanceof ApiError ? session.error.message : 'Session indisponible.'}
        </Text>
      ) : (
        <SessionContent
          session={session.data}
          receivedAt={session.dataUpdatedAt}
          games={games.data ?? []}
        />
      )}
    </Screen>
  );
}

/** « Vous » ou « Joueur N » selon le siège (les pseudos attendent R-12). */
function seatLabel(session: SessionView, playerId: string | undefined, viewerId?: string) {
  if (!playerId) return '—';
  if (playerId === viewerId) return 'Vous';
  const seat = session.players.find((p) => p.playerId === playerId)?.seat;
  return seat === undefined ? 'Joueur' : `Joueur ${seat + 1}`;
}

function SessionContent({
  session,
  receivedAt,
  games,
}: {
  session: SessionView;
  receivedAt: number;
  games: SessionGameSummary[];
}) {
  const { data: me } = useCurrentUser();
  const viewerId = me?.id;
  const leave = useLeaveSession();
  const next = useCreateNextGame(session.sessionId);
  const joinGame = useJoinGame();
  const decision = useSessionDecision(session.sessionId);
  const history = games.filter((g) => g.status === 'finished').reverse();
  const current = session.currentGame;
  const isOpen = session.status === 'open';
  const amPresent = session.seats.some((s) => s.playerId === viewerId);
  const round = session.decision?.open ? session.decision : null;
  const failure = [leave.error, next.error, joinGame.error, decision.error].find(
    (e) => e instanceof ApiError,
  )?.message;
  const label = (id?: string) => seatLabel(session, id, viewerId);

  return (
    <View style={styles.columns}>
      <ScrollView style={styles.side} contentContainerStyle={styles.sideContent}>
        <Text style={styles.label}>Identifiant de la session (à partager)</Text>
        <Text selectable style={styles.mono}>
          {session.sessionId}
        </Text>
        <Text style={styles.label}>Sièges (sens antihoraire)</Text>
        {session.seats.map((s) => (
          <Text key={s.seat} style={[styles.player, !s.playerId && styles.vacant]}>
            Siège {s.seat + 1} :{' '}
            {s.playerId
              ? `${label(s.playerId)}${s.playerId === session.creatorId ? ' · créateur' : ''}`
              : 'vacant'}
          </Text>
        ))}
        {isOpen && amPresent && !round ? (
          <View style={styles.leave}>
            <Button
              title="Quitter la session"
              variant="secondary"
              loading={leave.isPending}
              onPress={() =>
                leave.mutate(session.sessionId, { onSuccess: () => router.replace('/') })
              }
            />
          </View>
        ) : null}
      </ScrollView>

      <ScrollView style={styles.main} contentContainerStyle={styles.mainContent}>
        {failure ? <Text style={styles.error}>{failure}</Text> : null}

        {round ? (
          <DecisionPanel
            session={session}
            receivedAt={receivedAt}
            viewerId={viewerId}
            pending={decision.isPending}
            onDecide={(choice) =>
              decision.mutate(choice, {
                onSuccess: () => (choice === 'leave' ? router.replace('/') : undefined),
              })
            }
          />
        ) : current ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Partie en cours · {STATUS_LABELS[current.status]}</Text>
            <Text style={styles.cardText}>
              {current.playerIds.length} / {session.maxPlayers} joueurs
              {viewerId && !current.playerIds.includes(viewerId)
                ? current.status === 'waiting'
                  ? ' · vous pouvez la rejoindre'
                  : ' · vous jouerez la partie suivante'
                : ''}
            </Text>
            <View style={styles.row}>
              {viewerId && !current.playerIds.includes(viewerId) && current.status === 'waiting' ? (
                <View style={styles.flex}>
                  <Button
                    title="Rejoindre la partie"
                    loading={joinGame.isPending}
                    onPress={() =>
                      joinGame.mutate(current.gameId, {
                        onSuccess: (g) => router.push(`/game/${g.gameId}`),
                      })
                    }
                  />
                </View>
              ) : null}
              {viewerId && current.playerIds.includes(viewerId) ? (
                <View style={styles.flex}>
                  <Button
                    title="Ouvrir la partie"
                    variant="secondary"
                    onPress={() => router.push(`/game/${current.gameId}`)}
                  />
                </View>
              ) : null}
            </View>
          </View>
        ) : isOpen && amPresent ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nouvelle partie</Text>
            <Text style={styles.cardText}>
              {session.maxPlayers} places au plus, démarrage possible dès 2 joueurs. Le premier
              joueur est décidé par le serveur : le gagnant de la partie précédente, ou le
              suivant présent.
            </Text>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button title="Créer la partie" loading={next.isPending} onPress={next.create} />
              </View>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Historique</Text>
        {history.length === 0 ? <Text style={styles.muted}>Aucune partie terminée.</Text> : null}
        {history.map((g, i) => (
          <Pressable
            key={g.gameId}
            onPress={() => router.push(`/game/${g.gameId}`)}
            style={({ pressed }) => [styles.historyItem, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.historyText}>
              Partie {history.length - i} · premier joueur : {label(g.firstPlayerId)} ·{' '}
              {g.endReason === 'INSTANT_WIN_TIE'
                ? 'égalité de priorité, rejouée'
                : g.winnerId
                  ? `gagnant : ${label(g.winnerId)}${g.endReason === 'INSTANT_WIN' ? ' (victoire instantanée)' : ''}`
                  : 'arrêtée sans gagnant'}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.felt },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  status: { color: colors.gold, fontWeight: '700' },
  columns: { flex: 1, flexDirection: 'row', gap: spacing.md, padding: spacing.md, paddingTop: 0 },
  side: { flex: 2, backgroundColor: colors.feltLight, borderRadius: radius.lg },
  sideContent: { padding: spacing.md, gap: spacing.xs },
  main: { flex: 5 },
  mainContent: { gap: spacing.sm },
  label: { color: colors.textOnFelt, opacity: 0.75, fontSize: 13, marginTop: spacing.sm },
  mono: { color: colors.textOnFelt, fontSize: 12, fontFamily: 'monospace' },
  player: { color: colors.textOnFelt, fontSize: 15 },
  vacant: { opacity: 0.5, fontStyle: 'italic' },
  leave: { marginTop: spacing.md },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  cardText: { fontSize: 14, color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  sectionTitle: {
    color: colors.textOnFelt,
    fontSize: 18,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  muted: { color: colors.textOnFelt, opacity: 0.7 },
  historyItem: { backgroundColor: colors.feltLight, borderRadius: radius.md, padding: spacing.md },
  historyText: { fontSize: 14, color: colors.textOnFelt },
  pressed: { opacity: 0.7 },
  message: { color: colors.textOnFelt, fontSize: 16, padding: spacing.md },
  error: { color: colors.gold, fontSize: 14 },
});
