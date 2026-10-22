import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { sessionsApi, type NewPrivateGame } from '../../services/sessions-api';
import type { GameView } from '../../types/game';
import type { GameType, OpenTable, SessionView } from '../../types/session';
import { withAccessToken } from '../auth/session';
import { gameKeys, isGameId } from '../games/hooks';

/** Clés TanStack Query, paramétrées par sessionId : aucune « session courante » globale. */
export const sessionKeys = {
  mine: ['sessions', 'mine'] as const,
  open: ['sessions', 'open'] as const,
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
    staleTime: 0,
  });
}

/**
 * Réponse de la liste des tables ouvertes d'UN jeu (D-119), partagée par les deux hooks
 * ci-dessous. La clé commence par `sessionKeys.open` : invalider la liste les relit toutes.
 */
const openTablesQuery = (gameType: GameType = 'TER') => ({
  queryKey: gameType === 'TER' ? sessionKeys.open : [...sessionKeys.open, gameType],
  queryFn: () => withAccessToken((t) => sessionsApi.listOpen(t, gameType)),
  staleTime: 0,
  refetchInterval: SESSION_REFRESH_MS,
});

/** Tables ouvertes du jeu à rejoindre ; relues tant que la liste est affichée. */
export function useOpenTables(gameType: GameType = 'TER') {
  return useQuery({ ...openTablesQuery(gameType), select: (data) => data.tables });
}

/** Partie créée par le formulaire « Créer une partie » (D-039) : elle porte toujours un nom. */
export type PrivateGame = OpenTable & { name: string };

/**
 * Une ligne = une partie privée RÉELLEMENT créée, telle que le serveur la renvoie (en
 * attente, place libre). Les tables sans nom viennent de l'ancien écran « Nouvelle session »
 * (avant D-039) : ce ne sont pas des parties privées, on ne leur invente ni nom ni mise.
 */
export const isPrivateGame = (t: OpenTable): t is PrivateGame => t.name !== undefined;

/** Accueil : relecture lente du compteur (la liste « Rechercher » garde sa cadence de 3 s). */
const HOME_COUNT_REFRESH_MS = 15_000;

/**
 * Nombre de parties à rejoindre d'un jeu, affiché sur son panneau d'accueil : la MÊME
 * réponse serveur et le MÊME filtre que la liste « Rechercher une partie » (même clé de
 * cache : la liste ouverte, une création ou un départ le mettent à jour).
 */
export function useOpenTableCount(gameType: GameType) {
  const query = useQuery({
    ...openTablesQuery(gameType),
    refetchInterval: HOME_COUNT_REFRESH_MS,
    select: (data) => data.tables.filter(isPrivateGame).length,
  });
  // Retour sur l'accueil (fin de partie, sortie de la recherche…) : compteur relu.
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  return query;
}

/**
 * L'option « Détection anti-collusion » est-elle proposée (interrupteur global de
 * l'administration, D-053, D-081) ? Lue avec la liste des tables, relue à la même cadence.
 * Tant que la réponse n'est pas arrivée (ou si un ancien serveur ne la donne pas) : non
 * proposée, jamais affichée par défaut.
 */
export function useDetectionAvailable(): boolean {
  const { data } = useQuery({
    ...openTablesQuery(),
    select: (response) => response.detectionAvailable === true,
  });
  return data === true;
}

export function useSession(sessionId: string) {
  return useQuery({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: async () => (await withAccessToken((t) => sessionsApi.get(t, sessionId))).session,
    enabled: isSessionId(sessionId),
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.decision?.open ? DECISION_REFRESH_MS : SESSION_REFRESH_MS,
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
    void queryClient.invalidateQueries({ queryKey: sessionKeys.open });
    void queryClient.invalidateQueries({ queryKey: gameKeys.active });
  };
}

/** Nouvelle session + 1re partie ; une Idempotency-Key par intention (renvoi = même session). */
export function useCreateSession() {
  const refresh = useRefreshSession();
  const mutation = useMutation({
    mutationFn: async ({ idempotencyKey, ...input }: NewPrivateGame & { idempotencyKey: string }) =>
      withAccessToken((t) => sessionsApi.create(t, input, idempotencyKey)),
    onSuccess: ({ session, game }) => refresh(session, game),
  });
  return {
    ...mutation,
    create: (
      input: NewPrivateGame,
      options?: {
        onSuccess?: (result: { session: SessionView; game: GameView }) => void;
        onError?: (error: Error) => void;
      },
    ) => mutation.mutate({ ...input, idempotencyKey: randomUUID() }, options),
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
  const queryClient = useQueryClient();
  const refresh = useRefreshSession();
  return useMutation({
    mutationFn: async (sessionId: string) =>
      (await withAccessToken((t) => sessionsApi.leave(t, sessionId))).session,
    onSuccess: (session, sessionId) => {
      if (!session) {
        // Session supprimée (dernier départ) : plus rien à relire.
        queryClient.removeQueries({ queryKey: sessionKeys.detail(sessionId) });
      }
      refresh(session ?? undefined);
    },
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
