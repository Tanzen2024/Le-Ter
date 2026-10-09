import { ApiError } from '../../lib/api-client';
import { authApi } from '../../services/auth-api';
import { tokenStorage } from '../../services/token-storage';
import { useAuthStore } from '../../stores/auth-store';
import type { TokenPair } from '../../types/auth';

/**
 * Cycle de vie de la session côté client.
 *
 * Le serveur n'accepte qu'UNE rotation par refresh token (une seconde utilisation
 * concurrente est rejetée). Toutes les rotations passent donc par une promesse
 * unique : deux écrans qui reçoivent un 401 en même temps déclenchent un seul refresh.
 */
let refreshInFlight: Promise<string | null> | null = null;

export async function storeSession(tokens: TokenPair): Promise<void> {
  await tokenStorage.setRefreshToken(tokens.refreshToken);
  useAuthStore.getState().signIn(tokens.accessToken);
}

/** Nouvel access token, ou null si la session n'est plus valide (déconnexion locale). */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const refreshToken = await tokenStorage.getRefreshToken();
      if (!refreshToken) {
        await clearSession();
        return null;
      }
      const tokens = await authApi.refresh(refreshToken);
      await storeSession(tokens);
      return tokens.accessToken;
    } catch (err) {
      // Jeton refusé (expiré, ou révoqué par une connexion sur un autre appareil : R-32).
      // Une erreur réseau ne déconnecte pas : la session est peut-être encore valide.
      if (err instanceof ApiError && err.status === 401) {
        await clearSession();
        return null;
      }
      throw err;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Au lancement : restaure la session à partir du refresh token stocké. */
export async function bootstrapSession(): Promise<void> {
  try {
    await refreshSession();
  } catch {
    // Serveur injoignable : l'utilisateur se reconnectera.
    await clearSession();
  }
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
