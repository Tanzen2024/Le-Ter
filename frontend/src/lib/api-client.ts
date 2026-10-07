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

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
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
      body.message ?? 'Une erreur est survenue. Réessayez.',
      body.fields,
    );
  }
  return data as T;
}
