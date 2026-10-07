import { apiRequest } from '../lib/api-client';
import type { GameAction, GameView } from '../types/game';

/**
 * Appels HTTP des parties. Aucun identifiant de joueur n'est jamais envoyé : le
 * serveur identifie le joueur par son access token.
 */
export const gamesApi = {
  listActive: (accessToken: string) =>
    apiRequest<{ games: GameView[] }>('/api/games/me/active', { accessToken }),

  get: (accessToken: string, gameId: string) =>
    apiRequest<{ game: GameView }>(`/api/games/${gameId}`, { accessToken }),

  join: (accessToken: string, gameId: string) =>
    apiRequest<{ game: GameView }>(`/api/games/${gameId}/join`, {
      method: 'POST',
      body: {},
      accessToken,
    }),

  /** Démarrer : réservé au créateur, dès 2 joueurs (le serveur décide). */
  start: (accessToken: string, gameId: string, commandId: string) =>
    apiRequest<{ game: GameView }>(`/api/games/${gameId}/start`, {
      method: 'POST',
      body: { commandId },
      accessToken,
    }),

  act: (
    accessToken: string,
    gameId: string,
    command: { commandId: string; expectedVersion?: number; action: GameAction },
  ) => {
    const { action, ...meta } = command;
    const { type, ...payload } = action;
    return apiRequest<{ game: GameView }>(`/api/games/${gameId}/actions`, {
      method: 'POST',
      body: { ...meta, type, payload },
      accessToken,
    });
  },
};
