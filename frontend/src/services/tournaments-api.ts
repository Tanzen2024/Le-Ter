import { apiRequest } from '../lib/api-client';
import type {
  AppNotification,
  NextTournament,
  TournamentCreationRules,
  TournamentProposalInput,
  TournamentSummary,
  TournamentList,
  OfficialTournamentResults,
  TournamentContext,
  TournamentResultsHistoryPage,
  TournamentSeat,
  TournamentView,
} from '../types/tournament';

const path = (tournamentId: string, action = '') =>
  `/api/tournaments/${encodeURIComponent(tournamentId)}${action}`;

/**
 * Appels HTTP des tournois (D-054). Aucun identifiant de joueur n'est envoyé : le serveur
 * identifie le joueur par son access token et décide seul du statut, de la réservation, de
 * la table attribuée et des gains.
 */
export const tournamentsApi = {
  /** Tous les tournois publiés (à venir, en cours, historique récent), D-065. */
  list: (accessToken: string) => apiRequest<TournamentList>('/api/tournaments', { accessToken }),
  /** Tournoi à afficher (en cours, sinon à venir, sinon terminé récemment), ou null. */
  active: (accessToken: string) =>
    apiRequest<{ tournament: TournamentView | null; serverNow: string }>(
      '/api/tournaments/active',
      { accessToken },
    ),

  /** Prochain tournoi à venir auquel je suis inscrit (date, début, fin), ou null. */
  next: (accessToken: string) =>
    apiRequest<{ tournament: NextTournament | null }>('/api/tournaments/next', { accessToken }),

  /** Règles de création réglées par l'administration (joueurs, durée), D-103, D-104. */
  rules: (accessToken: string) =>
    apiRequest<{ rules: TournamentCreationRules }>('/api/tournaments/rules', { accessToken }),

  /** Détail d'un tournoi vu par moi (statut, prix d'entrée, joueurs, rangs, inscription). */
  get: (accessToken: string, tournamentId: string) =>
    apiRequest<{ tournament: TournamentView }>(path(tournamentId), { accessToken }),

  /** Inscription : le prix d'entrée est RÉSERVÉ (débité seulement au démarrage). */
  register: (accessToken: string, tournamentId: string) =>
    apiRequest<{ tournament: TournamentView }>(path(tournamentId, '/register'), {
      method: 'POST',
      accessToken,
    }),

  join: (accessToken: string, tournamentId: string) =>
    apiRequest<TournamentSeat>(path(tournamentId, '/join'), { method: 'POST', accessToken }),

  /** Classement général OFFICIEL (tous les participants) et le détail de MON score. */
  results: (accessToken: string, tournamentId: string) =>
    apiRequest<OfficialTournamentResults>(path(tournamentId, '/results'), {
      accessToken,
    }),

  /** Mes tournois terminés aux résultats publiés (sans limite de date), page par page. */
  resultsHistory: (accessToken: string, before?: string) =>
    apiRequest<TournamentResultsHistoryPage>(
      `/api/tournaments/results${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      { accessToken },
    ),

  /** MON contexte dans le tournoi (jetons de CE tournoi, parties, rang provisoire). */
  myContext: (accessToken: string, tournamentId: string) =>
    apiRequest<{ context: TournamentContext }>(path(tournamentId, '/me'), {
      accessToken,
    }),

  /** Proposition d'un joueur : enregistrée en BROUILLON (rien n'est publié ni réservé). */
  propose: (accessToken: string, input: TournamentProposalInput) =>
    apiRequest<{ tournament: TournamentSummary }>('/api/tournaments', {
      method: 'POST',
      accessToken,
      body: input,
    }),

  /** Mes propositions (tous statuts). */
  mine: (accessToken: string) =>
    apiRequest<{ tournaments: TournamentSummary[] }>('/api/tournaments/mine', { accessToken }),

  /** Soumettre mon brouillon à l'approbation de l'administration. */
  submit: (accessToken: string, tournamentId: string) =>
    apiRequest<{ tournament: TournamentSummary }>(path(tournamentId, '/submit'), {
      method: 'POST',
      accessToken,
    }),

  /** Retirer ma proposition (brouillon ou en attente). */
  withdraw: (accessToken: string, tournamentId: string) =>
    apiRequest<{ tournament: TournamentSummary }>(path(tournamentId, '/withdraw'), {
      method: 'POST',
      accessToken,
    }),

  notifications: (accessToken: string) =>
    apiRequest<{ notifications: AppNotification[]; unread: number }>('/api/notifications', {
      accessToken,
    }),

  markNotificationRead: (accessToken: string, notificationId: string) =>
    apiRequest<{ read: true }>(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'POST',
      accessToken,
    }),
};
