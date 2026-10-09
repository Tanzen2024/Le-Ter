import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Share } from 'react-native';

import { adminTournamentsApi } from '../../../services/admin-tournaments-api';
import type {
  TournamentProposalInput,
  TournamentSettings,
  TournamentStatus,
} from '../../../types/tournament';
import { withAccessToken } from '../../auth/session';

export const adminTournamentKeys = {
  all: ['admin', 'tournaments'] as const,
  list: (statuses: readonly TournamentStatus[] | undefined) =>
    ['admin', 'tournaments', 'list', statuses?.join(',') ?? 'all'] as const,
  detail: (id: string) => ['admin', 'tournaments', id] as const,
  registrations: (id: string) => ['admin', 'tournaments', id, 'registrations'] as const,
  results: (id: string) => ['admin', 'tournaments', id, 'results'] as const,
  settings: ['admin', 'tournaments', 'settings'] as const,
};

export function useAdminTournaments(statuses?: readonly TournamentStatus[]) {
  return useQuery({
    queryKey: adminTournamentKeys.list(statuses),
    queryFn: async () =>
      (
        await withAccessToken((t) =>
          adminTournamentsApi.list(t, statuses ? [...statuses] : undefined),
        )
      ).tournaments,
  });
}

export function useAdminTournament(id: string) {
  return useQuery({
    queryKey: adminTournamentKeys.detail(id),
    queryFn: async () => (await withAccessToken((t) => adminTournamentsApi.get(t, id))).tournament,
  });
}

export function useAdminRegistrations(id: string) {
  return useQuery({
    queryKey: adminTournamentKeys.registrations(id),
    queryFn: async () =>
      (await withAccessToken((t) => adminTournamentsApi.registrations(t, id))).registrations,
  });
}

/** Résultats figés : seulement quand le serveur les a validés (`enabled`). */
export function useAdminResults(id: string, enabled: boolean) {
  return useQuery({
    queryKey: adminTournamentKeys.results(id),
    queryFn: async () => (await withAccessToken((t) => adminTournamentsApi.results(t, id))).results,
    enabled,
  });
}

export function useCreateTournament() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TournamentProposalInput) =>
      (await withAccessToken((t) => adminTournamentsApi.create(t, input))).tournament,
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminTournamentKeys.all }),
  });
}

/** Approuver, refuser, annuler : le serveur vérifie la transition et l'audite. */
export function useAdminTournamentAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: 'approve' | 'reject' | 'cancel') =>
      (await withAccessToken((t) => adminTournamentsApi[action](t, id))).tournament,
    onSuccess: (tournament) => queryClient.setQueryData(adminTournamentKeys.detail(id), tournament),
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminTournamentKeys.all }),
  });
}

/** Export CSV : le fichier vient du serveur ; l'application le partage tel quel. */
export function useExportResults(id: string, label: string) {
  return useMutation({
    mutationFn: async () => {
      const csv = await withAccessToken((t) => adminTournamentsApi.exportCsv(t, id));
      await Share.share({ title: `Classement — ${label}.csv`, message: csv });
      return csv;
    },
  });
}

export function useTournamentSettings() {
  return useQuery({
    queryKey: adminTournamentKeys.settings,
    queryFn: async () => (await withAccessToken((t) => adminTournamentsApi.settings(t))).settings,
  });
}

export function useUpdateTournamentSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<TournamentSettings>) =>
      (await withAccessToken((t) => adminTournamentsApi.updateSettings(t, patch))).settings,
    onSuccess: (settings) => queryClient.setQueryData(adminTournamentKeys.settings, settings),
  });
}
