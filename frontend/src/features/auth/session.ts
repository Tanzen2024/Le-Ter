import { AppState } from 'react-native';

import { ApiError, logNetworkIssue } from '../../lib/api-client';
import { authApi } from '../../services/auth-api';
import { tokenStorage } from '../../services/token-storage';
import { useAuthStore } from '../../stores/auth-store';
import { forgetLastRoute } from '../navigation/last-route';
import type { TokenPair } from '../../types/auth';

/**
 * Cycle de vie de la session côté client.
 *
 * Le serveur n'accepte qu'UNE rotation par refresh token (une seconde utilisation
 * concurrente est rejetée). Toutes les rotations passent donc par une promesse
 * unique : deux écrans qui reçoivent un 401 en même temps déclenchent un seul refresh.
 */
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Refus DÉFINITIF du refresh : jeton expiré, révoqué (connexion sur un autre appareil,
 * R-32) ou mal formé (401), compte désactivé ou suspendu (403). Tout autre échec
 * (réseau, délai, 5xx, 429) est passager : la session est peut-être encore valide.
 */
function isDefinitiveRefusal(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

export async function storeSession(tokens: TokenPair): Promise<void> {
  cancelSessionRestore();
  await tokenStorage.setRefreshToken(tokens.refreshToken);
  useAuthStore.getState().signIn(tokens.accessToken);
}

/** Nouvel access token, ou null si la session n'est plus valide (déconnexion locale). */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    const refreshToken = await tokenStorage.getRefreshToken();
    // Une connexion manuelle a remplacé le jeton pendant la rotation : la nouvelle session
    // prime, sans l'écraser par l'ancienne ni l'effacer sur le refus de l'ancienne (R-32).
    const replacedMeanwhile = async () => (await tokenStorage.getRefreshToken()) !== refreshToken;
    try {
      if (!refreshToken) {
        await clearSession();
        return null;
      }
      const tokens = await authApi.refresh(refreshToken);
      if (await replacedMeanwhile()) return useAuthStore.getState().accessToken;
      await storeSession(tokens);
      return tokens.accessToken;
    } catch (err) {
      if (isDefinitiveRefusal(err)) {
        if (await replacedMeanwhile()) return useAuthStore.getState().accessToken;
        await clearSession();
        return null;
      }
      // Erreur passagère : le refresh token est conservé, l'appelant décide de la suite.
      throw err;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Restauration après une panne passagère au lancement : délais croissants, en nombre
 * borné (aucune boucle infinie). Le retour au premier plan relance une tentative.
 */
export const SESSION_RESTORE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;

let restorePending = false;
let restoreAttempt = 0;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
let foregroundSubscription: { remove(): void } | null = null;

function cancelSessionRestore(): void {
  restorePending = false;
  restoreAttempt = 0;
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = null;
  foregroundSubscription?.remove();
  foregroundSubscription = null;
}

function scheduleRestoreRetry(cause: unknown): void {
  restorePending = true;
  foregroundSubscription ??= AppState.addEventListener('change', (state) => {
    // Retour au premier plan (souvent : réseau rétabli) : tentative immédiate, budget neuf.
    if (state !== 'active' || !restorePending) return;
    restoreAttempt = 0;
    void attemptRestore();
  });
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = null;
  const delayMs = SESSION_RESTORE_RETRY_DELAYS_MS[restoreAttempt];
  logNetworkIssue('SESSION_RESTORE_DEFERRED', {
    code: cause instanceof ApiError ? cause.code : 'UNKNOWN',
    status: cause instanceof ApiError ? cause.status : undefined,
    nextRetryMs: delayMs ?? null,
  });
  // Budget épuisé : plus de minuterie, seul le retour au premier plan relancera.
  if (delayMs === undefined) return;
  restoreAttempt += 1;
  restoreTimer = setTimeout(() => {
    restoreTimer = null;
    void attemptRestore();
  }, delayMs);
}

async function attemptRestore(): Promise<void> {
  // Connecté entre-temps (connexion manuelle) : plus rien à restaurer.
  if (useAuthStore.getState().status === 'signedIn') {
    cancelSessionRestore();
    return;
  }
  try {
    // Succès : session restaurée ; jeton absent ou refusé : déconnexion et jeton effacé.
    await refreshSession();
  } catch (err) {
    // Serveur injoignable, délai dépassé, 5xx : l'écran de connexion reste disponible, mais
    // le refresh token est CONSERVÉ pour restaurer la session dès que le serveur répond.
    const { status, signOut } = useAuthStore.getState();
    if (status === 'loading') signOut();
    if (useAuthStore.getState().status !== 'signedIn') scheduleRestoreRetry(err);
  }
}

/** Au lancement : restaure la session à partir du refresh token stocké. */
export async function bootstrapSession(): Promise<void> {
  cancelSessionRestore();
  await attemptRestore();
}

/**
 * Appel authentifié : en cas de 401 (access token expiré), une rotation puis un seul
 * nouvel essai. L'identité est portée par le jeton, jamais par un champ envoyé.
 */
export async function withAccessToken<T>(call: (accessToken: string) => Promise<T>): Promise<T> {
  const current = useAuthStore.getState().accessToken;
  if (current) {
    try {
      return await call(current);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        throw err;
      }
    }
  }
  const renewed = await refreshSession();
  if (!renewed) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Connexion expirée. Veuillez vous reconnecter.');
  }
  return call(renewed);
}

export async function clearSession(): Promise<void> {
  cancelSessionRestore();
  // Session réellement close (déconnexion, refus définitif) : le prochain compte ne retrouve
  // pas l'écran du précédent. Une panne passagère n'arrive jamais ici.
  await forgetLastRoute();
  await tokenStorage.clearRefreshToken();
  useAuthStore.getState().signOut();
}

/** Déconnexion : révoque la session côté serveur, puis efface tout localement. */
export async function signOut(): Promise<void> {
  const refreshToken = await tokenStorage.getRefreshToken();
  if (refreshToken) {
    await authApi.logout(refreshToken).catch(() => undefined);
  }
  await clearSession();
}
