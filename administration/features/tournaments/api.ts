import { queryOptions } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type {
  TournamentRegistration,
  TournamentResult,
  TournamentSettings,
  TournamentSummary,
} from '@/types/admin';

/** Routes EXISTANTES /api/admin/tournaments (D-054, D-055) : aucune règle recopiée ici. */
export function tournamentsQuery(status?: string) {
  return queryOptions({
    queryKey: ['admin', 'tournaments', status ?? 'all'],
    queryFn: () =>
      api.get<{ tournaments: TournamentSummary[] }>('tournaments', status ? { status } : undefined),
  });
}

export function tournamentQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'tournament', id],
    queryFn: () => api.get<{ tournament: TournamentSummary }>(`tournaments/${id}`),
  });
}

export function registrationsQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'tournament', id, 'registrations'],
    queryFn: () =>
      api.get<{ registrations: TournamentRegistration[] }>(`tournaments/${id}/registrations`),
  });
}

/** Statuts dont le classement est figé (le serveur refuse les résultats avant). */
export const RESULT_STATUSES: readonly TournamentSummary['status'][] = [
  'RESULTS_VALIDATED',
  'DISTRIBUTING_PRIZES',
  'COMPLETED',
];

export function resultsQuery(id: string, enabled = true) {
  return queryOptions({
    enabled,
    queryKey: ['admin', 'tournament', id, 'results'],
    queryFn: () =>
      api.get<{ tournament: TournamentSummary; results: TournamentResult[] }>(
        `tournaments/${id}/results`,
      ),
  });
}

export function tournamentSettingsQuery() {
  return queryOptions({
    queryKey: ['admin', 'tournament-settings'],
    queryFn: () => api.get<{ settings: TournamentSettings }>('tournaments/settings'),
  });
}

export type TournamentAction = 'approve' | 'reject' | 'cancel';

export function runTournamentAction(id: string, action: TournamentAction) {
  return api.post<{ tournament: TournamentSummary }>(`tournaments/${id}/${action}`);
}

/** Libellé d'un tournoi : les tournois n'ont pas de nom, ils sont désignés par leur début. */
export function tournamentLabel(t: Pick<TournamentSummary, 'startsAt' | 'timezone'>): string {
  const when = new Intl.DateTimeFormat('fr-FR', {
    timeZone: t.timezone || 'Africa/Douala',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(t.startsAt));
  return `Tournoi du ${when}`;
}

/**
 * Actions proposées selon l'état (le serveur revérifie toujours). L'annulation, permise par
 * le serveur jusqu'au démarrage, n'est pas proposée pendant `STARTING` : un démarrage en
 * cours n'est jamais perturbé depuis l'administration.
 */
export function availableActions(status: TournamentSummary['status']): TournamentAction[] {
  if (status === 'PENDING_APPROVAL') return ['approve', 'reject'];
  if (['SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(status)) return ['cancel'];
  return [];
}
