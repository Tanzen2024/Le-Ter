import { apiRequest } from '../lib/api-client';
import type { GameView } from '../types/game';
import type { SessionGameSummary, SessionView } from '../types/session';

type MaxPlayers = 2 | 3 | 4;

/**
 * Appels HTTP des sessions (D-033). Aucun identifiant de joueur n'est envoyé : le serveur
 * identifie le joueur par son access token. Les créations portent une Idempotency-Key.
 */
export const sessionsApi = {
  /** Nouvelle session et sa première partie (le créateur est J1). */
  create: (accessToken: string, maxPlayers: MaxPlayers, idempotencyKey: string) =>
    apiRequest<{ session: SessionView; game: GameView }>('/api/sessions', {
      method: 'POST',
      body: { maxPlayers },
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  listMine: (accessToken: string) =>
    apiRequest<{ sessions: SessionView[] }>('/api/sessions/me/active', { accessToken }),

  get: (accessToken: string, sessionId: string) =>
    apiRequest<{ session: SessionView }>(`/api/sessions/${sessionId}`, { accessToken }),

  join: (accessToken: string, sessionId: string) =>
    apiRequest<{ session: SessionView }>(`/api/sessions/${sessionId}/join`, {
      method: 'POST',
      body: {},
      accessToken,
    }),

  leave: (accessToken: string, sessionId: string) =>
    apiRequest<{ session: SessionView }>(`/api/sessions/${sessionId}/leave`, {
      method: 'POST',
      body: {},
      accessToken,
    }),

  /** Poursuivre ou Quitter pendant la ronde de décision (10 s). */
  decide: (accessToken: string, sessionId: string, choice: 'continue' | 'leave') =>
    apiRequest<{ session: SessionView }>(`/api/sessions/${sessionId}/decision`, {
      method: 'POST',
      body: { choice },
      accessToken,
    }),

  listGames: (accessToken: string, sessionId: string) =>
    apiRequest<{ games: SessionGameSummary[] }>(`/api/sessions/${sessionId}/games`, {
      accessToken,
    }),

  /**
   * Partie suivante de la session : capacité de la session (immuable), J1 calculé par le
   * serveur.
   */
  createGame: (accessToken: string, sessionId: string, idempotencyKey: string) =>
    apiRequest<{ game: GameView }>(`/api/sessions/${sessionId}/games`, {
      method: 'POST',
      body: {},
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
};
