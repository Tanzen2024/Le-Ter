import Constants from 'expo-constants';
import { LogBox } from 'react-native';

import {
  isSystemFailure,
  playerFacingApiMessage,
  playerFacingFieldMessages,
} from './user-facing-error';

/** Port du backend en développement (`backend/.env`, `PORT`). */
const DEV_API_PORT = 3000;

/**
 * URL de l'API :
 * - `EXPO_PUBLIC_API_URL` explicite (inlinée par Expo au build : après l'avoir changée, relancer
 *   `npx expo start --clear`). Émulateur Android : http://10.0.2.2:3000 ; appareil physique :
 *   l'IP du poste sur le réseau local (jamais `localhost`, qui désigne alors le téléphone) ;
 * - `auto` ou absente, en DÉVELOPPEMENT : l'hôte du serveur Metro (`Constants.expoConfig.hostUri`,
 *   présent seulement avec @expo/cli, SDK 57), c'est-à-dire le PC qui sert aussi le backend, port
 *   3000. L'adresse suit ainsi le réseau du PC (Wi-Fi, partage de connexion) sans rien modifier ;
 * - sinon `http://localhost:3000`.
 */
export function resolveApiUrl(envValue: string | undefined, hostUri: string | undefined): string {
  const explicit = envValue?.trim();
  if (explicit && explicit.toLowerCase() !== 'auto') return explicit.replace(/\/$/, '');
  const host = hostUri?.split(':')[0];
  return host ? `http://${host}:${DEV_API_PORT}` : `http://localhost:${DEV_API_PORT}`;
}

export const API_URL = resolveApiUrl(
  process.env.EXPO_PUBLIC_API_URL,
  __DEV__ ? Constants.expoConfig?.hostUri : undefined,
);

/**
 * Délai maximal d'une requête : au-delà, `TIMEOUT` plutôt qu'une attente indéfinie (adresse
 * injoignable, Wi-Fi qui isole les appareils). Large, car certaines opérations attendent un
 * prestataire côté serveur ; l'abandon côté téléphone n'annule rien côté serveur.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Destination journalisée : origine et chemin seulement (aucune requête, jeton ni en-tête). */
const destination = (url: string) => url.split(/[?#]/)[0];

/**
 * Diagnostic réseau en développement seulement : catégorie, méthode, destination, cause
 * technique. Jamais d'en-tête Authorization, de jeton, de corps ni de donnée personnelle.
 */
export function logNetworkIssue(category: string, details: Record<string, unknown>): void {
  if (__DEV__) console.warn(`[réseau] ${category}`, details);
}

if (__DEV__) {
  // Diagnostics gardés dans le journal (terminal Metro), jamais affichés par-dessus l'écran :
  // le joueur ne voit que l'indicateur de connexion (D-152), sans URL ni JSON.
  LogBox.ignoreLogs(['[réseau]']);
  console.info(`[réseau] API : ${API_URL}`);
  if (/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(API_URL)) {
    console.warn(
      '[réseau] EXPO_PUBLIC_API_URL désigne localhost : sur un téléphone, c’est le téléphone ' +
        'lui-même. Utilisez l’adresse du PC sur le réseau, puis `npx expo start --clear`.',
    );
  }
}

/**
 * Erreur renvoyée par l'API : `code` stable, `message` affichable, `fields` par champ. Le
 * message et les champs sont toujours lisibles par le joueur : un texte technique du serveur
 * (ou d'un proxy) est remplacé à la construction (`user-facing-error.ts`).
 */
export class ApiError extends Error {
  readonly fields: Record<string, string>;

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    fields: Record<string, string> = {},
  ) {
    super(playerFacingApiMessage(status, code, message));
    this.name = 'ApiError';
    this.fields = playerFacingFieldMessages(fields ?? {});
  }
}

/**
 * Texte d'erreur à montrer au joueur, ou `undefined` : rien à afficher (D-168).
 * - refus 4xx de l'API : son message (déjà filtré), sinon `fallback` (phrase métier de l'écran) ;
 * - erreur système (réseau, délai, 5xx) ou erreur JavaScript quelconque : `undefined`, jamais
 *   de message ni de texte de secours.
 */
export function userErrorMessage(error: unknown, fallback?: string): string | undefined {
  if (!(error instanceof ApiError) || isSystemFailure(error.status)) return undefined;
  return error.message || fallback;
}

/**
 * `fetch` vers l'API avec délai maximal. Sans réponse HTTP, une `ApiError` de statut 0 :
 * `NETWORK_ERROR` (serveur injoignable : arrêté, mauvaise adresse, réseau coupé) ou `TIMEOUT`
 * (aucune réponse dans le délai). Toute réponse HTTP, même 401 ou 5xx, est rendue telle
 * quelle : une erreur d'authentification n'est jamais présentée comme une erreur réseau.
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const timedOut = controller.signal.aborted;
    logNetworkIssue(timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', {
      method: init.method ?? 'GET',
      url: destination(url),
      cause: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    throw timedOut
      ? new ApiError(0, 'TIMEOUT', '')
      : new ApiError(0, 'NETWORK_ERROR', '');
  } finally {
    clearTimeout(timer);
  }
}

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
  const method = options.method ?? 'GET';
  const response = await apiFetch(`${API_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
      ...(options.accessToken && { Authorization: `Bearer ${options.accessToken}` }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

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
    if (response.status >= 500) {
      // 503 : service momentanément indisponible (base injoignable…), distinct d'une panne.
      logNetworkIssue(response.status === 503 ? 'SERVICE_UNAVAILABLE' : 'SERVER_ERROR', {
        method,
        url: destination(`${API_URL}${path}`),
        status: response.status,
        code: body.code,
      });
    }
    throw new ApiError(
      response.status,
      body.code ?? 'HTTP_ERROR',
      PLAYER_FACING_MESSAGES[body.code ?? ''] ?? body.message ?? '',
      body.fields,
    );
  }
  return data as T;
}
