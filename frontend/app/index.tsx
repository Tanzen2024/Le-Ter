import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../src/components/Screen';
import { Button } from '../src/components/ui/Button';
import { TextField } from '../src/components/ui/TextField';
import { colors, radius, spacing } from '../src/constants/theme';
import { useCurrentUser, useLogout } from '../src/features/auth/hooks';
import { STATUS_LABELS } from '../src/features/games/format';
import { MAX_PLAYER_CHOICES, useActiveGames } from '../src/features/games/hooks';
import {
  isSessionId,
  useCreateSession,
  useJoinSession,
  useMySessions,
} from '../src/features/sessions/hooks';
import { ApiError } from '../src/lib/api-client';
import { useAuthStore } from '../src/stores/auth-store';

/**
 * Accueil connecté, en paysage (D-028) : à gauche créer une SESSION (avec sa première
 * partie) ou rejoindre une session par son identifiant ; à droite mes sessions et ma
 * partie active (R-18). Le lobby public attend R-22 (parties privées, invitations).
 */
export default function Home() {
  const status = useAuthStore((s) => s.status);

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }
  if (status === 'signedOut') {
    return <Redirect href="/login" />;
  }
  return <SignedInHome />;
}

function SignedInHome() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const games = useActiveGames();
  const sessions = useMySessions();
  const create = useCreateSession();
  const join = useJoinSession();
  const [joinId, setJoinId] = useState('');
  const [joinError, setJoinError] = useState<string>();

  const openGame = (gameId: string) => router.push(`/game/${gameId}`);
  const openSession = (sessionId: string) => router.push(`/session/${sessionId}`);
  const failure = [create.error, join.error].find((e) => e instanceof ApiError)?.message;
  // R-18 : une seule partie active à la fois. Le serveur l'impose ; l'écran l'annonce.
  const activeGame = games.data?.[0];

  const submitJoin = () => {
    const id = joinId.trim().toLowerCase();
    if (!isSessionId(id)) {
      setJoinError('Identifiant de session invalide.');
      return;
    }
    setJoinError(undefined);
    join.mutate(id, { onSuccess: (session) => openSession(session.sessionId) });
  };

  return (
    <Screen style={styles.screen}>
      <View style={styles.columns}>
        <ScrollView style={styles.left} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>LE TER</Text>
          <Text style={styles.title}>
            {user ? `Bienvenue, ${user.username} 👋` : 'Bienvenue 👋'}
          </Text>

          <View style={styles.card}>
            {activeGame ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Vous avez déjà une partie active. Terminez-la avant d’en créer ou d’en rejoindre
                  une autre.
                </Text>
                <Button title="Reprendre ma partie" onPress={() => openGame(activeGame.gameId)} />
              </View>
            ) : null}
            <Text style={styles.cardTitle}>Nouvelle session</Text>
            <Text style={styles.hint}>
              Ouvre une table et sa première partie (vous êtes le premier joueur). Nombre maximal de
              joueurs, démarrage possible dès 2.
            </Text>
            {failure ? <Text style={styles.error}>{failure}</Text> : null}
            <View style={styles.row}>
              {MAX_PLAYER_CHOICES.map((n) => (
                <View key={n} style={styles.flex}>
                  <Button
                    title={`${n} joueurs`}
                    loading={create.isPending && create.variables?.maxPlayers === n}
                    disabled={create.isPending || Boolean(activeGame)}
                    onPress={() =>
                      create.create(n, {
                        onSuccess: ({ session }) => openSession(session.sessionId),
                      })
                    }
                  />
                </View>
              ))}
            </View>

            <Text style={[styles.cardTitle, styles.spaced]}>Rejoindre une session</Text>
            <View style={styles.row}>
              <View style={styles.flex}>
                <TextField
                  label="Identifiant de la session"
                  value={joinId}
                  onChangeText={(v) => {
                    setJoinId(v);
                    setJoinError(undefined);
                  }}
                  error={joinError}
                  autoCapitalize="none"
                  placeholder="ex. 3f2b…"
                  returnKeyType="go"
                  onSubmitEditing={submitJoin}
                />
              </View>
              <View style={styles.joinButton}>
                <Button title="Rejoindre" onPress={submitJoin} loading={join.isPending} />
              </View>
            </View>
          </View>

          <Button
            title="Se déconnecter"
            variant="link"
            loading={logout.isPending}
            onPress={() => logout.mutate()}
          />
        </ScrollView>

        <View style={styles.right}>
          {/* Une seule session active par joueur (D-034). */}
          <Text style={styles.sectionTitle}>Ma session</Text>
          <ScrollView contentContainerStyle={styles.list}>
            {sessions.data?.length === 0 ? (
              <Text style={styles.empty}>Aucune session ouverte.</Text>
            ) : null}
            {sessions.data?.map((s) => (
              <Pressable
                key={s.sessionId}
                onPress={() => openSession(s.sessionId)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.gameItem, pressed && styles.pressed]}
              >
                <Text style={styles.gameTitle}>
                  Session · {s.seats.filter((seat) => seat.playerId).length}/{s.maxPlayers}{' '}
                  places occupées
                </Text>
                <Text style={styles.gameMeta}>
                  Ouverte le {new Date(s.createdAt).toLocaleDateString()}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={[styles.sectionTitle, styles.spaced]}>Ma partie active</Text>
          <ScrollView contentContainerStyle={styles.list}>
            {games.isPending ? <ActivityIndicator color={colors.gold} /> : null}
            {games.data?.length === 0 ? (
              <Text style={styles.empty}>Aucune partie active. Créez-en une !</Text>
            ) : null}
            {games.data?.map((game) => (
              <Pressable
                key={game.gameId}
                onPress={() => openGame(game.gameId)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.gameItem, pressed && styles.pressed]}
              >
                <Text style={styles.gameTitle}>Partie à {game.maxPlayers} joueurs</Text>
                <Text style={styles.gameMeta}>
                  {STATUS_LABELS[game.status]} · {game.players.length}/{game.maxPlayers} joueurs
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.felt },
  screen: { backgroundColor: colors.felt },
  columns: { flex: 1, flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  left: { flex: 3 },
  right: {
    flex: 2,
    backgroundColor: colors.feltLight,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  brand: { color: colors.gold, fontWeight: '800', letterSpacing: 4, fontSize: 13 },
  title: {
    color: colors.textOnFelt,
    fontSize: 24,
    fontWeight: '800',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  spaced: { marginTop: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
  joinButton: { marginTop: 22, minWidth: 130 },
  error: { color: colors.danger, marginBottom: spacing.sm },
  hint: { color: colors.textMuted, fontSize: 13, marginTop: -spacing.xs, marginBottom: spacing.sm },
  notice: {
    backgroundColor: colors.successBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  noticeText: { color: colors.text, fontSize: 14 },
  sectionTitle: {
    color: colors.textOnFelt,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  list: { gap: spacing.sm },
  empty: { color: colors.textOnFelt, opacity: 0.8 },
  gameItem: { backgroundColor: colors.felt, borderRadius: radius.md, padding: spacing.md },
  pressed: { opacity: 0.7 },
  gameTitle: { color: colors.textOnFelt, fontWeight: '700', fontSize: 15 },
  gameMeta: { color: colors.textOnFelt, opacity: 0.8, marginTop: spacing.xs },
});
