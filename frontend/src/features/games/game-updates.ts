import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { RealtimeClient } from '../../lib/realtime-client';
import type { GameView } from '../../types/game';
import { realtime } from '../chat/realtime';
import { gameKeys, isGameId } from './hooks';

/**
 * Suivi temps réel d'UNE partie (D-101). Dès que le serveur accepte une commande (carte jouée,
 * tour expiré, fuite…), il signale la nouvelle version ; la vue du joueur est aussitôt relue
 * par l'API, seule source de l'état. Le tour terminé disparaît donc tout de suite sur TOUS les
 * téléphones (roulette, barres), au lieu d'attendre la relecture périodique (3 s), qui reste le
 * filet de sécurité si le temps réel est coupé.
 *
 * - Version déjà affichée (réponse de ma propre action, signal reçu deux fois) : rien.
 * - (Ré)abonnement confirmé, reconnexion comprise : relecture pour rattraper ce qui a manqué.
 * - Une relecture plus ancienne ne remplace jamais une version plus récente (`newestGame`).
 */
export function useGameUpdates(
  gameId: string,
  client: Pick<RealtimeClient, 'subscribeGame'> = realtime,
): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!isGameId(gameId)) return;
    const key = gameKeys.detail(gameId);
    const refresh = () => void queryClient.invalidateQueries({ queryKey: key, exact: true });
    return client.subscribeGame(gameId, {
      onChanged: (version) => {
        const shown = queryClient.getQueryData<GameView>(key)?.version;
        if (shown !== undefined && shown >= version) return;
        refresh();
      },
      onSubscribed: refresh,
    });
  }, [client, gameId, queryClient]);
}

/** Signal du serveur : le règlement d'une partie de tournoi est écrit (D-111). */
export const TOURNAMENT_GAME_SETTLED = 'TOURNAMENT_GAME_SETTLED';

/**
 * Partie de TOURNOI : son règlement (compte fictif) est écrit juste APRÈS la fin de partie,
 * alors que celui d'une partie ordinaire l'est avec elle. Dès que le serveur signale ce
 * règlement pour le tournoi de la partie, la vue est relue : l'écran de fin affiche le gain ou
 * la perte en même temps qu'une partie ordinaire, sans attendre la relecture périodique (qui
 * reste le filet de sécurité). Le contexte du tournoi (jetons, rang) est relu par
 * `useTournamentSignals`. Le tournoi est celui de la partie, décidé par le serveur.
 */
export function useTournamentSettlementUpdates(
  gameId: string,
  tournamentId: string | undefined,
  client: Pick<RealtimeClient, 'onNotification'> = realtime,
): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!isGameId(gameId) || !tournamentId) return;
    return client.onNotification((signal) => {
      if (signal.notificationType !== TOURNAMENT_GAME_SETTLED) return;
      if (signal.tournamentId !== tournamentId) return;
      void queryClient.invalidateQueries({ queryKey: gameKeys.detail(gameId), exact: true });
    });
  }, [client, gameId, queryClient, tournamentId]);
}
