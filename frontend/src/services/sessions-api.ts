import { apiRequest } from '../lib/api-client';
import type { GameView, GaramVariant } from '../types/game';
import type { GameType, OpenTable, SessionGameSummary, SessionView } from '../types/session';

type MaxPlayers = 2 | 3 | 4;

/** Partie privée à créer (D-039) : le mot de passe part en clair sur HTTPS, haché par le serveur. */
export interface NewPrivateGame {
  maxPlayers: MaxPlayers;
  /** Jeu de la table (D-119) ; absent : Le Ter. */
  gameType?: GameType;
  /** GARAM TIA : variante choisie par le joueur, obligatoire (D-127). */
  garamVariant?: GaramVariant;
  name?: string;
  stakeAmount?: number;
  password?: string;
  /** Détection anti-collusion (D-043) : désactivée par défaut, immuable ensuite. */
  suspicionDetectionEnabled?: boolean;
}

/**
 * Appels HTTP des sessions (D-033). Aucun identifiant de joueur n'est envoyé : le serveur
 * identifie le joueur par son access token. Les créations portent une Idempotency-Key.
 */
export const sessionsApi = {
  /** Nouvelle session et sa première partie (le créateur est J1). */
  create: (accessToken: string, input: NewPrivateGame, idempotencyKey: string) =>
    apiRequest<{ session: SessionView; game: GameView }>('/api/sessions', {
      method: 'POST',
      body: input,
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  /** Tables ouvertes d'UN jeu (D-119), à rejoindre (partie en attente, place libre). */
  listOpen: (accessToken: string, gameType: GameType = 'TER') =>
    apiRequest<{ tables: OpenTable[]; detectionAvailable?: boolean }>(
      gameType === 'TER' ? '/api/sessions/open' : `/api/sessions/open?gameType=${gameType}`,
      { accessToken },
    ),

  listMine: (accessToken: string) =>
    apiRequest<{ sessions: SessionView[] }>('/api/sessions/me/active', { accessToken }),

  get: (accessToken: string, sessionId: string) =>
    apiRequest<{ session: SessionView }>(`/api/sessions/${sessionId}`, { accessToken }),

  join: (accessToken: string, sessionId: string, password?: string) =>
    apiRequest<{ session: SessionView }>(`/api/sessions/${sessionId}/join`, {
      method: 'POST',
      body: password ? { password } : {},
      accessToken,
    }),

  /**
   * Quitter la session (R-19, D-037). `session: null` : le dernier joueur est parti et la
   * session, sans partie terminée, a été supprimée.
   */
  leave: (accessToken: string, sessionId: string) =>
    apiRequest<{ session: SessionView | null }>(`/api/sessions/${sessionId}/leave`, {
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
};
