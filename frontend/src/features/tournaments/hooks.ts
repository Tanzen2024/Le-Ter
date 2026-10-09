import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';

import { tournamentsApi } from '../../services/tournaments-api';
import { useAuthStore } from '../../stores/auth-store';
import type {
  NextTournament,
  TournamentList,
  TournamentProposalInput,
  TournamentView,
} from '../../types/tournament';
import { withAccessToken } from '../auth/session';
import { gameKeys } from '../games/hooks';
import { sessionKeys } from '../sessions/hooks';
import { walletKey } from '../wallet/hooks';
import { nextRefreshDelayMs } from './tournament-state';

export const tournamentKeys = {
  list: ['tournaments', 'list'] as const,
  active: ['tournaments', 'active'] as const,
  next: ['tournaments', 'next'] as const,
  detail: (tournamentId: string) => ['tournaments', 'detail', tournamentId] as const,
  notifications: ['notifications'] as const,
};

/** Relecture au plus tard toutes les 24 h (limite de setTimeout et dérive d'horloge). */
const MAX_NEXT_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Prochain tournoi à venir auquel le joueur est inscrit (D-059), choisi par le SERVEUR (son
 * horloge, ses statuts). Relu au retour sur l'écran, après une inscription ou une
 * désinscription (invalidation), et à son heure de début (il n'est alors plus « à venir »).
 */
export function useNextRegisteredTournament() {
  const status = useAuthStore((s) => s.status);
  const query = useQuery({
    queryKey: tournamentKeys.next,
    queryFn: async (): Promise<NextTournament | null> =>
      (await withAccessToken((t) => tournamentsApi.next(t))).tournament,
    enabled: status === 'signedIn',
  });
  const { data, refetch } = query;

  useFocusEffect(
    useCallback(() => {
      if (status === 'signedIn') void refetch();
    }, [refetch, status]),
  );

  const startsAt = data ? Date.parse(data.startsAt) : NaN;
  useEffect(() => {
    if (Number.isNaN(startsAt)) return;
    const delay = Math.min(Math.max(0, startsAt - Date.now()) + 1000, MAX_NEXT_REFRESH_MS);
    const handle = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(handle);
  }, [startsAt, refetch]);

  return query;
}

/**
 * Liste des tournois (D-065), telle que le serveur la voit (statuts, dates, inscriptions).
 * Relue au retour sur l'écran et à la prochaine échéance du tournoi le plus proche (horloge
 * du serveur), sans polling agressif.
 */
export function useTournamentList() {
  const status = useAuthStore((s) => s.status);
  const query = useQuery({
    queryKey: tournamentKeys.list,
    queryFn: (): Promise<TournamentList> => withAccessToken((t) => tournamentsApi.list(t)),
    enabled: status === 'signedIn',
  });
  const { data, refetch } = query;

  useFocusEffect(
    useCallback(() => {
      if (status === 'signedIn') void refetch();
    }, [refetch, status]),
  );

  const delays = (data?.tournaments ?? [])
    .map((t) => nextRefreshDelayMs(t))
    .filter((d): d is number => d !== null);
  const delay = delays.length > 0 ? Math.min(...delays) : null;
  useEffect(() => {
    if (delay === null) return;
    const handle = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(handle);
  }, [delay, data, refetch]);

  return query;
}

/**
 * Détail d'un tournoi (fiche, D-065), tel que le serveur le voit ; relu au retour sur
 * l'écran et à sa prochaine échéance.
 */
export function useTournamentDetail(tournamentId: string | undefined) {
  const status = useAuthStore((s) => s.status);
  const enabled = status === 'signedIn' && tournamentId !== undefined;
  const query = useQuery({
    queryKey: tournamentKeys.detail(tournamentId ?? ''),
    queryFn: async (): Promise<TournamentView> =>
      (await withAccessToken((t) => tournamentsApi.get(t, tournamentId as string))).tournament,
    enabled,
  });
  const { data, refetch } = query;

  useFocusEffect(
    useCallback(() => {
      if (enabled) void refetch();
    }, [refetch, enabled]),
  );

  const delay = nextRefreshDelayMs(data);
  useEffect(() => {
    if (delay === null) return;
    const handle = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(handle);
  }, [delay, data, refetch]);

  return query;
}

/**
 * Tournoi à afficher, tel que le serveur le voit (statut décidé par lui, D-054). Rafraîchi
 * sans polling agressif : au retour sur l'écran, et à la prochaine échéance (fermeture,
 * début, fin) mesurée sur l'horloge du serveur.
 */
export function useActiveTournament() {
  const status = useAuthStore((s) => s.status);
  const query = useQuery({
    queryKey: tournamentKeys.active,
    queryFn: async (): Promise<TournamentView | null> =>
      (await withAccessToken((t) => tournamentsApi.active(t))).tournament,
    enabled: status === 'signedIn',
  });
  const { data, refetch } = query;

  useFocusEffect(
    useCallback(() => {
      if (status === 'signedIn') void refetch();
    }, [refetch, status]),
  );

  const delay = nextRefreshDelayMs(data);
  useEffect(() => {
    if (delay === null) return;
    const handle = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(handle);
  }, [delay, data, refetch]);

  return query;
}

/**
 * Détail du prochain tournoi inscrit (prix d'entrée, joueurs, rangs, statut), tel que le
 * serveur le voit. Relu à chaque changement de `tournamentId` et avec le prochain tournoi.
 */
export function useNextTournamentDetail(tournamentId: string | undefined) {
  const status = useAuthStore((s) => s.status);
  const enabled = status === 'signedIn' && tournamentId !== undefined;
  const query = useQuery({
    queryKey: tournamentKeys.detail(tournamentId ?? ''),
    queryFn: async (): Promise<TournamentView> =>
      (await withAccessToken((t) => tournamentsApi.get(t, tournamentId as string))).tournament,
    enabled,
  });
  const { refetch } = query;

  useFocusEffect(
    useCallback(() => {
      if (enabled) void refetch();
    }, [refetch, enabled]),
  );

  return query;
}

/** Après une inscription : le disponible du compte de jeu a changé (réservation). */
function useAfterReservationChange() {
  const queryClient = useQueryClient();
  return (tournament?: TournamentView) => {
    if (tournament) {
      queryClient.setQueryData(tournamentKeys.active, tournament);
      queryClient.setQueryData(tournamentKeys.detail(tournament.tournamentId), tournament);
    } else void queryClient.invalidateQueries({ queryKey: tournamentKeys.active });
    void queryClient.invalidateQueries({ queryKey: tournamentKeys.list });
    void queryClient.invalidateQueries({ queryKey: tournamentKeys.next });
    void queryClient.invalidateQueries({ queryKey: ['tournaments', 'detail'] });
    void queryClient.invalidateQueries({ queryKey: walletKey });
    void queryClient.invalidateQueries({
      queryKey: tournamentKeys.notifications,
    });
  };
}

/** Inscription : le prix d'entrée est RÉSERVÉ par le serveur (aucun débit avant le début). */
export function useRegisterTournament() {
  const refresh = useAfterReservationChange();
  return useMutation({
    mutationFn: async (tournamentId: string) =>
      (await withAccessToken((t) => tournamentsApi.register(t, tournamentId))).tournament,
    onSuccess: (tournament) => refresh(tournament),
    // Refus (déjà inscrit, solde insuffisant, fermé) : on relit l'état réel.
    onError: () => refresh(),
  });
}

/** Désinscription avant la fermeture : la réservation est libérée. */
export function useUnregisterTournament() {
  const refresh = useAfterReservationChange();
  return useMutation({
    mutationFn: async (tournamentId: string) =>
      (await withAccessToken((t) => tournamentsApi.unregister(t, tournamentId))).tournament,
    onSuccess: (tournament) => refresh(tournament),
    onError: () => refresh(),
  });
}

/**
 * Rejoindre le tournoi en cours : le SERVEUR vérifie la participation, la période, les
 * jetons et la session, puis attribue la table. L'écran de jeu existant s'ouvre sur le
 * `gameId` renvoyé, sauf si la recherche a été annulée entre-temps (`cancelled`) : l'appelant
 * libère alors la place attribuée.
 */
export function useJoinTournament({ cancelled }: { cancelled?: () => boolean } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tournamentId: string) =>
      withAccessToken((t) => tournamentsApi.join(t, tournamentId)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tournamentKeys.active });
      void queryClient.invalidateQueries({ queryKey: tournamentKeys.list });
      void queryClient.invalidateQueries({
        queryKey: ['tournaments', 'detail'],
      });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.mine });
      void queryClient.invalidateQueries({ queryKey: gameKeys.active });
    },
    onSuccess: ({ gameId }) => {
      if (!cancelled?.()) router.replace(`/game/${gameId}`);
    },
  });
}

/** Notifications dans l'application (pas de push) : relues au retour sur l'écran. */
export function useNotifications() {
  const status = useAuthStore((s) => s.status);
  const query = useQuery({
    queryKey: tournamentKeys.notifications,
    queryFn: () => withAccessToken((t) => tournamentsApi.notifications(t)),
    enabled: status === 'signedIn',
  });
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      if (status === 'signedIn') void refetch();
    }, [refetch, status]),
  );
  return query;
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      withAccessToken((t) => tournamentsApi.markNotificationRead(t, notificationId)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: tournamentKeys.notifications }),
  });
}

export const proposalKeys = { mine: ['tournaments', 'mine'] as const };

/** Mes propositions, telles que le serveur les voit (statut décidé par lui). */
export function useMyTournaments() {
  const status = useAuthStore((s) => s.status);
  return useQuery({
    queryKey: proposalKeys.mine,
    queryFn: async () => (await withAccessToken((t) => tournamentsApi.mine(t))).tournaments,
    enabled: status === 'signedIn',
  });
}

/**
 * Proposer un tournoi : enregistré en brouillon par le serveur, puis (si `submit`) soumis à
 * l'approbation. Les deux étapes restent visibles : un brouillon non soumis peut l'être plus
 * tard depuis « Mes propositions ».
 */
export function useProposeTournament() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, submit }: { input: TournamentProposalInput; submit: boolean }) => {
      const { tournament } = await withAccessToken((t) => tournamentsApi.propose(t, input));
      if (!submit) return tournament;
      return (await withAccessToken((t) => tournamentsApi.submit(t, tournament.tournamentId)))
        .tournament;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: proposalKeys.mine }),
  });
}

/** Soumettre ou retirer une proposition existante. */
export function useProposalAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tournamentId,
      action,
    }: {
      tournamentId: string;
      action: 'submit' | 'withdraw';
    }) =>
      withAccessToken((t) =>
        action === 'submit'
          ? tournamentsApi.submit(t, tournamentId)
          : tournamentsApi.withdraw(t, tournamentId),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: proposalKeys.mine }),
  });
}
