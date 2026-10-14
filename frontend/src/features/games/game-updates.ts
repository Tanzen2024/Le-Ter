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
