/**
 * Client HTTP de l'API Le Ter.
 *
 * URL : EXPO_PUBLIC_API_URL (inlinée par Expo au build). Émulateur Android :
 * http://10.0.2.2:3000 ; appareil physique : l'IP du poste sur le réseau local.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

/** Erreur renvoyée par l'API : `code` stable, `message` affichable, `fields` par champ. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const NETWORK_ERROR_MESSAGE = 'Impossible de joindre le serveur. Vérifiez votre connexion.';

/**
 * L'utilisateur ne manipule que des PARTIES : la session (D-033) est un concept technique.
 * Les refus du serveur qui la nomment sont reformulés ici, à partir de leur `code` stable,
 * sans changer la règle appliquée par le serveur.
 */
const PLAYER_FACING_MESSAGES: Record<string, string> = {
  SESSION_NOT_FOUND: 'Partie introuvable.',
  NOT_A_SESSION_MEMBER: 'Vous ne participez pas à cette partie.',
  SESSION_CLOSED: 'Cette partie est terminée.',
  SESSION_GAME_IN_PROGRESS: 'Une partie est déjà en cours à cette table.',
  PLAYER_IN_ACTIVE_GAME: 'La partie est en cours : vous ne pouvez pas la quitter maintenant.',
  SESSION_FULL: 'Cette partie est complète.',
  ALREADY_IN_SESSION:
    'Vous êtes déjà dans une partie. Reprenez-la ou quittez-la avant d’en commencer une autre.',
  ALREADY_IN_ACTIVE_GAME:
    'Vous êtes déjà dans une partie. Reprenez-la ou quittez-la avant d’en commencer une autre.',
  SESSION_MAX_PLAYERS_IMMUTABLE: 'Le nombre de joueurs est fixé à la création de la partie.',
};

/** Refus « déjà dans une partie » (R-18, une table par joueur) : on propose de la reprendre. */
export function isAlreadyPlaying(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'ALREADY_IN_SESSION' || error.code === 'ALREADY_IN_ACTIVE_GAME')
  );
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH';
    body?: unknown;
    accessToken?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(options.accessToken && { Authorization: `Bearer ${options.accessToken}` }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const body = (data ?? {}) as {
      code?: string;
      message?: string;
      fields?: Record<string, string>;
    };
    throw new ApiError(
      response.status,
      body.code ?? 'HTTP_ERROR',
      PLAYER_FACING_MESSAGES[body.code ?? ''] ??
        body.message ??
        'Une erreur est survenue. Réessayez.',
      body.fields,
    );
  }
  return data as T;
}
