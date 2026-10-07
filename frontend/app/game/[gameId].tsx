import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/ui/Button';
import { colors, radius, spacing } from '../../src/constants/theme';
import { DealAnimation } from '../../src/features/games/DealAnimation';
import { DraggableCard, type DropZone } from '../../src/features/games/DraggableCard';
import {
  cardLabel,
  INSTANT_WIN_LABELS,
  playerLabel,
  STATUS_LABELS,
  tableSeat,
} from '../../src/features/games/format';
import {
  isGameId,
  MIN_PLAYERS_TO_START,
  useGame,
  useGameAction,
  useStartGame,
} from '../../src/features/games/hooks';
import { DecisionPanel } from '../../src/features/sessions/DecisionPanel';
import { useSession, useSessionDecision } from '../../src/features/sessions/hooks';
import { useServerCountdown } from '../../src/hooks/use-server-countdown';
import { ApiError } from '../../src/lib/api-client';
import { useGameUiStore } from '../../src/stores/game-ui-store';
import type { GameView } from '../../src/types/game';

/**
 * Écran d'UNE partie, identifiée par la route (D-017) : /game/abc… et /game/xyz… sont
 * deux écrans indépendants, sans « partie courante ». Paysage (D-028) : informations à
 * gauche, jeu à droite.
 *
 * Écran fonctionnel provisoire : la table de jeu graphique viendra avec les règles
 * officielles. Toute action passe par le serveur, qui décide de sa validité.
 */
export default function GameScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const valid = isGameId(gameId);
  const game = useGame(valid ? gameId : '');

  return (
    <Screen style={styles.screen}>
      <View style={styles.topBar}>
        <Button
          title={game.data?.sessionId ? '← Session' : '← Accueil'}
          variant="link"
          onPress={() =>
            game.data?.sessionId
              ? router.replace(`/session/${game.data.sessionId}`)
              : router.canGoBack()
                ? router.back()
                : router.replace('/')
          }
        />
        {game.data ? <Text style={styles.status}>{STATUS_LABELS[game.data.status]}</Text> : null}
      </View>
      {!valid ? (
        <Text style={styles.message}>Identifiant de partie invalide.</Text>
      ) : game.isPending ? (
        <ActivityIndicator color={colors.gold} size="large" />
      ) : game.error ? (
        <Text style={styles.message}>
          {game.error instanceof ApiError ? game.error.message : 'Partie indisponible.'}
        </Text>
      ) : (
        <GameContent game={game.data} receivedAt={game.dataUpdatedAt} />
      )}
    </Screen>
  );
}

function GameContent({ game, receivedAt }: { game: GameView; receivedAt: number }) {
  const act = useGameAction(game.gameId);
  const start = useStartGame(game.gameId);
  const play = game.play;
  const isCreator = game.creatorId === game.viewerId;
  // R-23 : démarrage dès 2 joueurs, sans attendre que la table soit pleine.
  const canStart = game.players.length >= MIN_PLAYERS_TO_START;
  const startFailure = start.error instanceof ApiError ? start.error.message : undefined;
  const myTurn = game.myActions.canPlayCard;
  const failure = act.error instanceof ApiError ? act.error.message : undefined;
  // Glisser-déposer (décision 48) : l'aire de jeu est mesurée dans la fenêtre ; le
  // défilement est suspendu pendant un glissé.
  const dropZoneRef = useRef<View>(null);
  const dropZone = useRef<DropZone | null>(null);
  const [dragging, setDragging] = useState(false);
  const measureDropZone = useCallback(() => {
    dropZoneRef.current?.measureInWindow((x, y, width, height) => {
      dropZone.current = { x, y, width, height };
    });
  }, []);
  const onDragChange = useCallback(
    (active: boolean) => {
      setDragging(active);
      if (active) measureDropZone();
    },
    [measureDropZone],
  );
  // Timer de tour (D-034) : affichage seulement, à partir de l'échéance du serveur.
  const secondsLeft = useServerCountdown(
    game.status === 'in_progress' && !game.turnTimedOutAt ? game.turnDeadlineAt : undefined,
    game.serverNow,
    receivedAt,
  );

  // Distribution perceptible (D-032) : rejouée une fois par partie, juste après le
  // démarrage (aucune carte encore jouée). L'état réel vient toujours du serveur.
  const dealAnimated = useGameUiStore((s) => Boolean(s.dealAnimated[game.gameId]));
  const markDealAnimated = useGameUiStore((s) => s.markDealAnimated);
  const finishDeal = useCallback(
    () => markDealAnimated(game.gameId),
    [markDealAnimated, game.gameId],
  );
  const noCardPlayed = play && play.currentTrick.length === 0 && play.completedTricks.length === 0;
  if (game.status === 'in_progress' && noCardPlayed && !dealAnimated) {
    return <DealAnimation game={game} onDone={finishDeal} />;
  }

  return (
    <View style={styles.columns}>
      <ScrollView style={styles.side} contentContainerStyle={styles.sideContent}>
        <Text style={styles.label}>Identifiant (à partager)</Text>
        <Text selectable style={styles.gameId}>
          {game.gameId}
        </Text>
        <Text style={styles.label}>Premier joueur (J1)</Text>
        <Text style={styles.player}>{playerLabel(game, game.firstPlayerId)}</Text>
        <Text style={styles.label}>
          Joueurs {game.players.length}/{game.maxPlayers}
        </Text>
        {[...game.players].sort((a, b) => tableSeat(a) - tableSeat(b)).map((p) => (
          <Text key={p.playerId} style={styles.player}>
            {playerLabel(game, p.playerId)}
            {p.fledAt ? ' (a fui)' : ''}
            {play?.controllerId === p.playerId ? ' · contrôle' : ''}
          </Text>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.main}
        contentContainerStyle={styles.mainContent}
        scrollEnabled={!dragging}
      >
        {game.status === 'waiting' ? (
          <View style={styles.waiting}>
            <Text style={styles.count}>
              {game.players.length} / {game.maxPlayers} joueurs
            </Text>
            <Text style={styles.message}>
              {isCreator
                ? canStart
                  ? 'Vous pouvez démarrer maintenant ou attendre d’autres joueurs.'
                  : 'Il faut au moins 2 joueurs pour démarrer. Partagez l’identifiant de la partie.'
                : 'En attente du lancement par le créateur de la partie.'}
            </Text>
            {startFailure ? <Text style={styles.error}>{startFailure}</Text> : null}
            {isCreator ? (
              <View style={styles.startButton}>
                <Button
                  title="Démarrer la partie"
                  onPress={start.start}
                  loading={start.isPending}
                  disabled={!canStart}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {play && game.status === 'in_progress' ? (
          <>
            <Text style={styles.info}>
              Tour {play.trickNumber}/5 ·{' '}
              {myTurn
                ? 'À vous de jouer'
                : `Au tour de ${playerLabel(game, play.nextPlayerId ?? '')}`}
            </Text>
            <View style={styles.turnRow}>
              <Text style={styles.turnInfo}>
                Contrôle : {playerLabel(game, play.controllerId)}
              </Text>
              {game.turnTimedOutAt ? (
                <Text style={styles.timeout}>
                  Temps écoulé : le coup automatique revient au serveur.
                </Text>
              ) : secondsLeft !== null ? (
                <Text
                  style={[styles.countdown, secondsLeft <= 3 && styles.countdownUrgent]}
                  accessibilityLabel={`${secondsLeft} secondes restantes pour ce tour`}
                >
                  {secondsLeft > 0 ? `${secondsLeft} s` : 'Temps écoulé — en attente du serveur'}
                </Text>
              ) : null}
            </View>
            <Text style={styles.label}>
              Ordre du tour (antihoraire) :{' '}
              {play.trickOrder.map((id) => playerLabel(game, id)).join(' → ')}
            </Text>
            <View
              ref={dropZoneRef}
              onLayout={measureDropZone}
              style={[styles.dropZone, dragging && styles.dropZoneActive]}
              accessibilityLabel="Aire de jeu"
            >
              <Text style={styles.label}>Aire de jeu — cartes jouées</Text>
              <View style={styles.cards}>
                {play.currentTrick.length === 0 ? (
                  <Text style={styles.muted}>
                    {game.myActions.canPlayCard
                      ? 'Glissez une carte ici pour la jouer.'
                      : 'Aucune carte pour ce tour.'}
                  </Text>
                ) : (
                  play.currentTrick.map((t) => (
                    <Text key={t.cardId} style={styles.playedCard}>
                      {playerLabel(game, t.playerId)} : {cardLabel(t.cardId)}
                    </Text>
                  ))
                )}
              </View>
            </View>
            <Text style={styles.label}>Ma main</Text>
            <View style={styles.cards}>
              {play.myHand.map((cardId) => (
                <DraggableCard
                  key={cardId}
                  cardId={cardId}
                  enabled={
                    !act.isPending &&
                    game.myActions.canPlayCard &&
                    game.myActions.playableCardIds.includes(cardId)
                  }
                  getDropZone={() => dropZone.current}
                  onDragChange={onDragChange}
                  onDrop={(id) => act.send({ type: 'PLAY_CARD', cardId: id }, game.version)}
                />
              ))}
            </View>
            {failure ? <Text style={styles.error}>{failure}</Text> : null}
            {game.myActions.canDeclareInstantWin || game.myActions.canFlee ? (
              <View style={styles.actions}>
                {game.myActions.canDeclareInstantWin ? (
                  <View style={styles.flex}>
                    <Button
                      title="Gagner instantanément"
                      disabled={act.isPending}
                      onPress={() => act.send({ type: 'DECLARE_WIN' }, game.version)}
                    />
                    {game.myInstantWin ? (
                      <Text style={styles.hint}>
                        {INSTANT_WIN_LABELS[game.myInstantWin.combination]} (rang{' '}
                        {game.myInstantWin.rank}) — disponible jusqu’à votre première carte.
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {game.myActions.canFlee ? (
                  <View style={styles.flex}>
                    <Button
                      title="Fuir"
                      variant="secondary"
                      disabled={act.isPending}
                      onPress={() => act.send({ type: 'FLEE' }, game.version)}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
            {play.completedTricks.length > 0 ? (
              <>
                <Text style={styles.label}>Tours terminés</Text>
                {play.completedTricks.map((t) => (
                  <Text key={t.number} style={styles.playedCard}>
                    Tour {t.number} : {t.plays.map((x) => cardLabel(x.cardId)).join(', ')} —
                    contrôle : {playerLabel(game, t.controllerId)}
                  </Text>
                ))}
              </>
            ) : null}
          </>
        ) : null}

        {game.status === 'finished' ? <GameOutcome game={game} /> : null}
      </ScrollView>
    </View>
  );
}

/**
 * Fin de partie, telle que le serveur l'a décidée : gagnant (5e tour joué automatiquement,
 * ou victoire instantanée, toujours simple), égalité de priorité (partie rejouée aussitôt
 * dans la session), ou arrêt administratif.
 *
 * La session est relue ici : la ronde Poursuivre/Quitter (10 s) s'affiche sur cet écran,
 * et la partie qui rejoue une égalité est ouverte dès que le serveur l'a créée.
 */
function GameOutcome({ game }: { game: GameView }) {
  const session = useSession(game.sessionId ?? '');
  const decision = useSessionDecision(game.sessionId ?? '');
  const tie = game.endReason === 'INSTANT_WIN_TIE';
  const replayId = tie ? session.data?.currentGame?.gameId : undefined;

  // Reprise immédiate (D-035) : la nouvelle donne remplace cet écran, sans étape.
  useEffect(() => {
    if (replayId && replayId !== game.gameId) {
      router.replace(`/game/${replayId}`);
    }
  }, [replayId, game.gameId]);

  if (tie) {
    return (
      <View style={styles.outcome}>
        <Text style={styles.info}>Égalité de priorité des mains instantanées</Text>
        <Text style={styles.message}>
          Aucun gagnant : la partie est rejouée immédiatement, avec le même premier joueur, les
          mêmes sièges et une nouvelle distribution.
        </Text>
        {game.sessionId ? (
          <Button
            title="Voir la nouvelle donne"
            onPress={() =>
              router.replace(replayId ? `/game/${replayId}` : `/session/${game.sessionId}`)
            }
          />
        ) : null}
      </View>
    );
  }
  const round =
    session.data?.decision?.open && session.data.decision.gameId === game.gameId
      ? session.data
      : null;
  const decisionFailure = decision.error instanceof ApiError ? decision.error.message : undefined;
  const result = game.result;
  if (!result) {
    return <Text style={styles.message}>Partie arrêtée.</Text>;
  }
  const detail =
    result.method === 'INSTANT_WIN'
      ? `Victoire instantanée${result.automatic ? ' (attribuée automatiquement)' : ''} : ${
          result.instantWinCombination ? INSTANT_WIN_LABELS[result.instantWinCombination] : ''
        } — victoire simple.`
      : 'Contrôle conservé à la fin du 5e tour (joué automatiquement).';
  return (
    <View style={styles.outcome}>
      <Text style={styles.info}>Gagnant : {playerLabel(game, result.winnerId)}</Text>
      <Text style={styles.message}>{detail}</Text>
      {decisionFailure ? <Text style={styles.error}>{decisionFailure}</Text> : null}
      {round ? (
        <DecisionPanel
          session={round}
          receivedAt={session.dataUpdatedAt}
          viewerId={game.viewerId}
          pending={decision.isPending}
          onDecide={(choice) =>
            decision.mutate(choice, {
              onSuccess: () =>
                router.replace(choice === 'leave' ? '/' : `/session/${game.sessionId}`),
            })
          }
        />
      ) : null}
      {game.sessionId ? (
        <Button
          title="Retour à la session"
          variant={round ? 'link' : undefined}
          onPress={() => router.replace(`/session/${game.sessionId}`)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dropZone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.feltLight,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.xs,
    minHeight: 96,
  },
  dropZoneActive: { borderColor: colors.gold },
  hint: { color: colors.textOnFelt, fontSize: 12, marginTop: spacing.xs },
  outcome: { gap: spacing.sm, padding: spacing.md },
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
  gameId: { color: colors.textOnFelt, fontSize: 12, fontFamily: 'monospace' },
  player: { color: colors.textOnFelt, fontSize: 15 },
  info: { color: colors.textOnFelt, fontSize: 18, fontWeight: '700' },
  turnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  turnInfo: { color: colors.textOnFelt, fontSize: 15 },
  countdown: { color: colors.gold, fontSize: 22, fontWeight: '800' },
  countdownUrgent: { color: colors.surface },
  timeout: { color: colors.gold, fontSize: 14, flexShrink: 1 },
  message: { color: colors.textOnFelt, fontSize: 16, lineHeight: 22, padding: spacing.md },
  muted: { color: colors.textOnFelt, opacity: 0.7 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    minWidth: 64,
    minHeight: 88,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  cardDisabled: { opacity: 0.6 },
  cardText: { fontSize: 20, fontWeight: '800', color: colors.text },
  playedCard: { color: colors.textOnFelt, fontSize: 15 },
  pressed: { opacity: 0.7 },
  error: { color: colors.gold, fontSize: 14 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  waiting: { gap: spacing.sm },
  count: { color: colors.gold, fontSize: 28, fontWeight: '800', paddingHorizontal: spacing.md },
  startButton: { maxWidth: 320, paddingHorizontal: spacing.md },
  flex: { flex: 1 },
});
