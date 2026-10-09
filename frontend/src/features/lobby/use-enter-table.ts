import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { ApiError } from '../../lib/api-client';
import { gamesApi } from '../../services/games-api';
import { sessionsApi } from '../../services/sessions-api';
import type { OpenTable } from '../../types/session';
import { withAccessToken } from '../auth/session';
import { gameKeys } from '../games/hooks';
import { sessionKeys } from '../sessions/hooks';

/**
 * Entrer dans une partie : l'utilisateur ne manipule que des PARTIES ; la session (D-033)
 * reste un concept technique, jamais affiché ni traversé par un écran. Chaque action se
 * termine dans l'aire de jeu de la bonne partie (`/game/:gameId`).
 */
export type EnterTarget =
  /** Rejoindre une table ouverte : arriver dans la session, puis dans sa partie. */
  | { kind: 'join'; table: OpenTable; password?: string }
  /** Retrouver sa propre table (session où le joueur est présent). */
  | { kind: 'resume'; sessionId: string };

/** Le joueur reste à la table, mais une partie est en cours sans lui (D-035). */
export class NoGameToEnterError extends Error {}

async function joinGameIfWaiting(gameId: string) {
  try {
    await withAccessToken((t) => gamesApi.join(t, gameId));
  } catch (err) {
    // Déjà joueur de cette partie : on y entre simplement.
    if (!(err instanceof ApiError && err.code === 'ALREADY_JOINED')) throw err;
  }
}

/**
 * Résout la partie à ouvrir pour une table où le joueur est présent :
 * - partie active dont il est joueur → elle ;
 * - partie en attente sans lui → il la rejoint, puis elle ;
 * - partie en cours sans lui → il jouera la suivante (erreur explicite) ;
 * - aucune partie active → la dernière partie (résultat, Poursuivre/Quitter, suivante).
 */
async function resolveGame(sessionId: string, viewerId: string): Promise<string> {
  const { session } = await withAccessToken((t) => sessionsApi.get(t, sessionId));
  const current = session.currentGame;
  if (current?.playerIds.includes(viewerId)) return current.gameId;
  if (current?.status === 'waiting') {
    await joinGameIfWaiting(current.gameId);
    return current.gameId;
  }
  if (current) {
    throw new NoGameToEnterError(
      'Une partie est en cours à cette table : vous jouerez la suivante.',
    );
  }
  const { games } = await withAccessToken((t) => sessionsApi.listGames(t, sessionId));
  const last = games.pop();
  if (!last) throw new NoGameToEnterError('Aucune partie à cette table pour le moment.');
  return last.gameId;
}

export function useEnterTable(viewerId: string | undefined, onEntered?: () => void) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (target: EnterTarget) => {
      if (!viewerId) throw new NoGameToEnterError('Profil en cours de chargement.');
      if (target.kind === 'join') {
        await withAccessToken((t) => sessionsApi.join(t, target.table.sessionId, target.password));
        return resolveGame(target.table.sessionId, viewerId);
      }
      return resolveGame(target.sessionId, viewerId);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.mine });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.open });
      void queryClient.invalidateQueries({ queryKey: gameKeys.active });
    },
    onSuccess: (gameId) => {
      onEntered?.();
      router.push(`/game/${gameId}`);
    },
  });
  const error = mutation.error;
  return {
    /** Le serveur a refusé le mot de passe (absent ou incorrect). */
    passwordRejected: error instanceof ApiError && error.code === 'TABLE_PASSWORD_INVALID',
    reset: mutation.reset,
    enter: (target: EnterTarget) => mutation.mutate(target),
    pending: mutation.isPending,
    pendingTarget: mutation.isPending ? mutation.variables : undefined,
    message:
      error instanceof ApiError || error instanceof NoGameToEnterError ? error.message : undefined,
  };
}
