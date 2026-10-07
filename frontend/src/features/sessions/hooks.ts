import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import { sessionsApi } from '../../services/sessions-api';
import type { GameView } from '../../types/game';
import type { SessionView } from '../../types/session';
import { withAccessToken } from '../auth/session';
import { gameKeys, isGameId, type MaxPlayers } from '../games/hooks';

/** Clés TanStack Query, paramétrées par sessionId : aucune « session courante » globale. */
export const sessionKeys = {
  mine: ['sessions', 'mine'] as const,
  detail: (sessionId: string) => ['sessions', sessionId] as const,
  games: (sessionId: string) => ['sessions', sessionId, 'games'] as const,
};

/** Un identifiant de session (UUID) venant d'une route ou d'une saisie. */
export const isSessionId = isGameId;

/**
 * Sans temps réel (phase D), l'état est relu régulièrement tant que l'écran est monté ;
 * plus souvent pendant une ronde Poursuivre/Quitter, dont l'issue (départs automatiques)
 * n'est connue que du serveur.
 */
const SESSION_REFRESH_MS = 3_000;
const DECISION_REFRESH_MS = 1_000;

export function useMySessions() {
  return useQuery({
    queryKey: sessionKeys.mine,
    queryFn: async () => (await withAccessToken((t) => sessionsApi.listMine(t))).sessions,
  });
}

export function useSession(sessionId: string) {
  return useQuery({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: async () => (await withAccessToken((t) => sessionsApi.get(t, sessionId))).session,
    enabled: isSessionId(sessionId),
    refetchInterval: (query) =>
      query.state.data?.decision?.open ? DECISION_REFRESH_MS : SESSION_REFRESH_MS,
  });
}

export function useSessionGames(sessionId: string) {
  return useQuery({
    queryKey: sessionKeys.games(sessionId),
    queryFn: async () => (await withAccessToken((t) => sessionsApi.listGames(t, sessionId))).games,
    enabled: isSessionId(sessionId),
    refetchInterval: SESSION_REFRESH_MS,
  });
}

function useRefreshSession() {
  const queryClient = useQueryClient();
  return (session?: SessionView, game?: GameView) => {
    if (session) {
      queryClient.setQueryData(sessionKeys.detail(session.sessionId), session);
      void queryClient.invalidateQueries({ queryKey: sessionKeys.games(session.sessionId) });
    }
    if (game) {
      queryClient.setQueryData(gameKeys.detail(game.gameId), game);
      if (game.sessionId) {
        void queryClient.invalidateQueries({ queryKey: sessionKeys.games(game.sessionId) });
      }
    }
    void queryClient.invalidateQueries({ queryKey: sessionKeys.mine });
    void queryClient.invalidateQueries({ queryKey: gameKeys.active });
  };
}

/** Nouvelle session + 1re partie ; une Idempotency-Key par intention (renvoi = même session). */
export function useCreateSession() {
  const refresh = useRefreshSession();
  const mutation = useMutation({
    mutationFn: async (input: { maxPlayers: MaxPlayers; idempotencyKey: string }) =>
      withAccessToken((t) => sessionsApi.create(t, input.maxPlayers, input.idempotencyKey)),
    onSuccess: ({ session, game }) => refresh(session, game),
  });
  return {
    ...mutation,
    create: (
      maxPlayers: MaxPlayers,
      options?: { onSuccess?: (result: { session: SessionView; game: GameView }) => void },
    ) => mutation.mutate({ maxPlayers, idempotencyKey: randomUUID() }, options),
  };
}

export function useJoinSession() {
  const refresh = useRefreshSession();
  return useMutation({
    mutationFn: async (sessionId: string) =>
      (await withAccessToken((t) => sessionsApi.join(t, sessionId))).session,
    onSuccess: (session) => refresh(session),
  });
}

export function useLeaveSession() {
  const refresh = useRefreshSession();
  return useMutation({
    mutationFn: async (sessionId: string) =>
      (await withAccessToken((t) => sessionsApi.leave(t, sessionId))).session,
    onSuccess: (session) => refresh(session),
  });
}

/** Poursuivre / Quitter : le serveur enregistre le choix ; il décide seul des départs automatiques. */
export function useSessionDecision(sessionId: string) {
  const refresh = useRefreshSession();
  return useMutation({
    mutationFn: async (choice: 'continue' | 'leave') =>
      (await withAccessToken((t) => sessionsApi.decide(t, sessionId, choice))).session,
    onSuccess: (session) => refresh(session),
  });
}

/** Partie suivante de la session (capacité de la session ; J1 décidé par le serveur). */
export function useCreateNextGame(sessionId: string) {
  const refresh = useRefreshSession();
  const mutation = useMutation({
    mutationFn: async (idempotencyKey: string) =>
      (await withAccessToken((t) => sessionsApi.createGame(t, sessionId, idempotencyKey))).game,
    onSuccess: (game) => refresh(undefined, game),
  });
  return { ...mutation, create: () => mutation.mutate(randomUUID()) };
}
