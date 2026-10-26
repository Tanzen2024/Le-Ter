import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import {
  fontOf,
  tablePalette as palette,
  useTableFonts,
} from '../../../components/table/TableDecor';
import { useServerCountdown } from '../../../hooks/use-server-countdown';
import { ApiError, userErrorMessage } from '../../../lib/api-client';
import type { GameView } from '../../../types/game';
import { useLobbyMetrics } from '../../lobby/lobby-metrics';
import { PanelButton } from '../../lobby/LobbyUi';
import { useLeaveSession } from '../../sessions/hooks';
import type { useStartGame } from '../hooks';
import { tournamentWaitingState } from '../waiting-state';

/** Départ refusé : la partie a démarré entre-temps (D-037), la vue passe « en cours ». */
const IN_ACTIVE_GAME = 'PLAYER_IN_ACTIVE_GAME';

/**
 * Table de tournoi en attente (D-065) : seul, on attend un 2e joueur (aucun compte à
 * rebours) ; dès 2 joueurs, l'échéance du SERVEUR s'affiche, le premier joueur affecté
 * (créateur de la partie) voit « Démarrer la partie », les autres attendent. À l'échéance,
 * c'est le serveur qui démarre : l'écran ne fait qu'afficher son état.
 *
 * « Annuler la recherche » réutilise le départ de session existant (D-037) : la place est
 * libérée sans toucher l'inscription au tournoi ni sa réservation, puis la liste des
 * tournois s'ouvre avec une confirmation.
 */
export function TournamentTableWaiting({
  game,
  receivedAt,
  start,
}: {
  game: GameView;
  receivedAt: number;
  start: ReturnType<typeof useStartGame>;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const text = [styles.centerText, fontOf(fonts.button), { fontSize: m.bodySize * 1.1 }];
  const small = [styles.smallText, { fontSize: m.smallSize - 1 }];
  const seconds = useServerCountdown(game.startDeadlineAt, game.serverNow, receivedAt);
  const waiting = tournamentWaitingState(game);
  const startFailure = start.error instanceof ApiError ? start.error.message : undefined;
  const leave = useLeaveSession();
  const cancelFailure =
    leave.error instanceof ApiError && leave.error.code === IN_ACTIVE_GAME
      ? undefined
      : userErrorMessage(leave.error);

  const sessionId = game.sessionId;
  const cancel = sessionId ? (
    <>
      <PanelButton
        title="Annuler la recherche"
        loading={leave.isPending}
        onPress={() =>
          leave.mutate(sessionId, {
            onSuccess: () =>
              router.dismissTo({ pathname: '/tournament', params: { searchCancelled: '1' } }),
          })
        }
      />
      {cancelFailure ? (
        <Text accessibilityRole="alert" style={[small, styles.error]}>
          {cancelFailure}
        </Text>
      ) : null}
    </>
  ) : null;

  if (waiting.kind === 'alone') {
    return (
      <>
        <Text style={text}>En attente d’un autre joueur…</Text>
        <Text style={small}>Le compte à rebours démarre à l’arrivée d’un deuxième joueur.</Text>
        {cancel}
      </>
    );
  }
  return (
    <>
      <Text style={text}>Partie prête à démarrer.</Text>
      <Text style={small}>{`${game.players.length}/${game.maxPlayers} joueurs`}</Text>
      <Text accessibilityLiveRegion="polite" style={[text, styles.countdown]}>
        {seconds !== null && seconds > 0 ? `Démarrage automatique dans ${seconds} s` : 'Démarrage…'}
      </Text>
      {waiting.canStartManually ? (
        <PanelButton title="Démarrer la partie" loading={start.isPending} onPress={start.start} />
      ) : (
        <Text style={small}>Le premier joueur peut lancer la partie avant la fin du délai.</Text>
      )}
      {startFailure ? <Text style={[small, styles.error]}>{startFailure}</Text> : null}
      {cancel}
    </>
  );
}

const styles = StyleSheet.create({
  centerText: { color: '#FFFFFF', textAlign: 'center' },
  smallText: { color: 'rgba(255, 255, 255, 0.78)', textAlign: 'center' },
  countdown: { color: palette.gold },
  error: { color: palette.error },
});
