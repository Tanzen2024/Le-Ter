import { API_URL, ApiError, apiFetch, apiRequest } from '../lib/api-client';
import type {
  AdminRegistration,
  TournamentProposalInput,
  TournamentResultView,
  TournamentSettings,
  TournamentStatus,
  TournamentSummary,
} from '../types/tournament';

const base = '/api/admin/tournaments';
const path = (tournamentId: string, action = '') =>
  `${base}/${encodeURIComponent(tournamentId)}${action}`;

/**
 * Administration des tournois (D-054), rôle `admin` : le serveur refuse tout autre compte
 * (403) et audite chaque action. Aucune règle n'est appliquée ici.
 */
export const adminTournamentsApi = {
  list: (accessToken: string, statuses?: TournamentStatus[]) =>
    apiRequest<{ tournaments: TournamentSummary[] }>(
      statuses?.length ? `${base}?status=${statuses.join(',')}` : base,
      { accessToken },
    ),

  get: (accessToken: string, tournamentId: string) =>
    apiRequest<{ tournament: TournamentSummary }>(path(tournamentId), { accessToken }),

  /** Création PUBLIÉE directement (commission copiée des paramètres par le serveur). */
  create: (accessToken: string, input: TournamentProposalInput) =>
    apiRequest<{ tournament: TournamentSummary }>(base, {
      method: 'POST',
      accessToken,
      body: input,
    }),

  approve: (accessToken: string, tournamentId: string) =>
    apiRequest<{ tournament: TournamentSummary }>(path(tournamentId, '/approve'), {
      method: 'POST',
      accessToken,
    }),

  reject: (accessToken: string, tournamentId: string) =>
    apiRequest<{ tournament: TournamentSummary }>(path(tournamentId, '/reject'), {
      method: 'POST',
      accessToken,
    }),

  /** Annulation avant démarrage : le serveur libère toutes les réservations. */
  cancel: (accessToken: string, tournamentId: string) =>
    apiRequest<{ tournament: TournamentSummary }>(path(tournamentId, '/cancel'), {
      method: 'POST',
      accessToken,
    }),

  registrations: (accessToken: string, tournamentId: string) =>
    apiRequest<{ registrations: AdminRegistration[] }>(path(tournamentId, '/registrations'), {
      accessToken,
    }),

  results: (accessToken: string, tournamentId: string) =>
    apiRequest<{ tournament: TournamentSummary; results: TournamentResultView[] }>(
      path(tournamentId, '/results'),
      { accessToken },
    ),

  /** Export CSV produit par le SERVEUR (aucun calcul côté application). */
  async exportCsv(accessToken: string, tournamentId: string): Promise<string> {
    const response = await apiFetch(`${API_URL}${path(tournamentId, '/results.csv')}`, {
      headers: { Accept: 'text/csv', Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
      throw new ApiError(
        response.status,
        body.code ?? 'HTTP_ERROR',
        body.message ?? 'Export impossible. Réessayez.',
      );
    }
    return response.text();
  },

  settings: (accessToken: string) =>
    apiRequest<{ settings: TournamentSettings }>(`${base}/settings`, { accessToken }),

  updateSettings: (accessToken: string, patch: Partial<TournamentSettings>) =>
    apiRequest<{ settings: TournamentSettings }>(`${base}/settings`, {
      method: 'PATCH',
      accessToken,
      body: patch,
    }),
};
