/// <reference types="jest" />
import { AppState, type AppStateStatus } from 'react-native';

import { ApiError } from '../../lib/api-client';
import { authApi } from '../../services/auth-api';
import { useAuthStore } from '../../stores/auth-store';
import {
  bootstrapSession,
  clearSession,
  refreshSession,
  SESSION_RESTORE_RETRY_DELAYS_MS,
  storeSession,
  withAccessToken,
} from './session';
import { forgetLastRoute } from '../navigation/last-route';

/**
 * Restauration de la session : une panne passagère (réseau, délai, 503) ne supprime jamais
 * le refresh token ; seul un refus explicite du serveur (401/403) l'efface.
 */

let mockStoredToken: string | null = null;
jest.mock('../../services/token-storage', () => ({
  tokenStorage: {
    getRefreshToken: jest.fn(() => Promise.resolve(mockStoredToken)),
    setRefreshToken: jest.fn((token: string) => {
      mockStoredToken = token;
      return Promise.resolve();
    }),
    clearRefreshToken: jest.fn(() => {
      mockStoredToken = null;
      return Promise.resolve();
    }),
  },
}));
jest.mock('../../services/auth-api', () => ({
  authApi: { refresh: jest.fn(), logout: jest.fn() },
}));
jest.mock('../navigation/last-route', () => ({ forgetLastRoute: jest.fn(() => Promise.resolve()) }));

const refresh = authApi.refresh as jest.Mock;
let foreground: ((state: AppStateStatus) => void) | undefined;
jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
  foreground = handler as (state: AppStateStatus) => void;
  return { remove: () => (foreground = undefined) } as ReturnType<typeof AppState.addEventListener>;
});
jest.spyOn(console, 'warn').mockImplementation(() => undefined);

const networkError = () => new ApiError(0, 'NETWORK_ERROR', 'Impossible de joindre le serveur.');
const timeoutError = () => new ApiError(0, 'TIMEOUT', 'Le serveur ne répond pas.');
const unavailable = () =>
  new ApiError(503, 'SERVICE_TEMPORARILY_UNAVAILABLE', 'Service momentanément indisponible.');
const invalidToken = () =>
  new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Session expirée. Veuillez vous reconnecter.');
const tokens = (n: number) => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}` });

beforeEach(async () => {
  jest.useFakeTimers();
  await clearSession(); // annule toute restauration programmée par un test précédent
  mockStoredToken = 'refresh-0';
  refresh.mockReset();
  (forgetLastRoute as jest.Mock).mockClear();
  useAuthStore.setState({ status: 'loading', accessToken: null });
});
afterEach(() => jest.useRealTimers());

it('restauration réussie : session ouverte, jeton renouvelé', async () => {
  refresh.mockResolvedValueOnce(tokens(1));
  await bootstrapSession();

  expect(refresh).toHaveBeenCalledWith('refresh-0');
  expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', accessToken: 'access-1' });
  expect(mockStoredToken).toBe('refresh-1');
});

it('aucun jeton stocké : déconnecté, aucune requête', async () => {
  mockStoredToken = null;
  await bootstrapSession();

  expect(refresh).not.toHaveBeenCalled();
  expect(useAuthStore.getState().status).toBe('signedOut');
});

it.each([
  ['backend injoignable', networkError],
  ['délai dépassé', timeoutError],
  ['503 service indisponible', unavailable],
])('%s : écran de connexion, mais refresh token CONSERVÉ', async (_label, error) => {
  refresh.mockRejectedValueOnce(error());
  await bootstrapSession();

  expect(useAuthStore.getState().status).toBe('signedOut');
  expect(mockStoredToken).toBe('refresh-0');
});

it('refresh token invalide (401) : jeton effacé, aucune nouvelle tentative', async () => {
  refresh.mockRejectedValueOnce(invalidToken());
  await bootstrapSession();

  expect(useAuthStore.getState().status).toBe('signedOut');
  expect(mockStoredToken).toBeNull();
  await jest.advanceTimersByTimeAsync(SESSION_RESTORE_RETRY_DELAYS_MS.reduce<number>((a, b) => a + b, 0));
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('compte désactivé (403) : refus définitif, jeton effacé', async () => {
  refresh.mockRejectedValueOnce(new ApiError(403, 'ACCOUNT_DISABLED', 'Compte désactivé.'));
  await bootstrapSession();
  expect(mockStoredToken).toBeNull();
});

it('réseau rétabli : la tentative programmée restaure la session', async () => {
  refresh.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(tokens(2));
  await bootstrapSession();
  expect(useAuthStore.getState().status).toBe('signedOut');

  await jest.advanceTimersByTimeAsync(SESSION_RESTORE_RETRY_DELAYS_MS[0]);

  expect(refresh).toHaveBeenCalledTimes(2);
  expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', accessToken: 'access-2' });
  expect(mockStoredToken).toBe('refresh-2');
});

it('retour au premier plan : tentative immédiate sans attendre la minuterie', async () => {
  refresh.mockRejectedValueOnce(timeoutError()).mockResolvedValueOnce(tokens(3));
  await bootstrapSession();

  // Retour RÉEL : l'application était passée en arrière-plan (`inactive` seul ne compte pas).
  foreground?.('inactive');
  foreground?.('active');
  await jest.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(1);

  foreground?.('background');
  foreground?.('active');
  await jest.advanceTimersByTimeAsync(0);

  expect(refresh).toHaveBeenCalledTimes(2);
  expect(useAuthStore.getState().status).toBe('signedIn');
});

it('session valide au retour : aucune réinitialisation, aucune requête', async () => {
  refresh.mockResolvedValueOnce(tokens(4));
  await bootstrapSession();
  expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', accessToken: 'access-4' });

  // Racine remontée (activité recréée) puis plusieurs retours : la session reste ouverte.
  await bootstrapSession();
  foreground?.('background');
  foreground?.('active');
  await jest.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', accessToken: 'access-4' });
});

it('nouvelles tentatives BORNÉES : délais croissants puis arrêt (aucune boucle infinie)', async () => {
  refresh.mockRejectedValue(networkError());
  await bootstrapSession();

  for (const delay of SESSION_RESTORE_RETRY_DELAYS_MS) {
    await jest.advanceTimersByTimeAsync(delay);
  }
  const attempts = 1 + SESSION_RESTORE_RETRY_DELAYS_MS.length;
  expect(refresh).toHaveBeenCalledTimes(attempts);
  await jest.advanceTimersByTimeAsync(10 * 60_000);
  expect(refresh).toHaveBeenCalledTimes(attempts);
  expect(mockStoredToken).toBe('refresh-0');
});

it('connexion manuelle pendant la panne : plus aucune tentative de restauration', async () => {
  refresh.mockRejectedValueOnce(networkError());
  await bootstrapSession();

  await storeSession(tokens(4)); // login réussi
  await jest.advanceTimersByTimeAsync(SESSION_RESTORE_RETRY_DELAYS_MS[0] * 10);

  expect(refresh).toHaveBeenCalledTimes(1);
  expect(mockStoredToken).toBe('refresh-4');
});

it('refus de l’ANCIEN jeton après une connexion manuelle : la nouvelle session est gardée', async () => {
  let reject!: (err: unknown) => void;
  refresh.mockReturnValueOnce(new Promise((_resolve, r) => (reject = r)));
  const pending = refreshSession();

  await storeSession(tokens(5)); // login pendant la rotation (R-32 révoque l'ancienne)
  reject(invalidToken());

  await expect(pending).resolves.toBe('access-5');
  expect(mockStoredToken).toBe('refresh-5');
  expect(useAuthStore.getState().status).toBe('signedIn');
});

it('appels simultanés : un seul refresh envoyé, même résultat pour tous', async () => {
  refresh.mockResolvedValueOnce(tokens(6));
  const results = await Promise.all([refreshSession(), refreshSession(), bootstrapSession()]);

  expect(refresh).toHaveBeenCalledTimes(1);
  expect(results.slice(0, 2)).toEqual(['access-6', 'access-6']);
});

describe('retour au premier plan avec une session ouverte', () => {
  it('jeton expiré et serveur injoignable : erreur passagère, session et jeton CONSERVÉS', async () => {
    useAuthStore.getState().signIn('access-expire');
    refresh.mockRejectedValueOnce(networkError());
    const call = jest.fn().mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'expiré'));

    await expect(withAccessToken(call)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    // Aucune déconnexion : l'écran affiché (et sa navigation) reste en place.
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn' });
    expect(mockStoredToken).toBe('refresh-0');
    expect(forgetLastRoute).not.toHaveBeenCalled();
  });

  it('session valide : aucun renouvellement ni réauthentification', async () => {
    useAuthStore.getState().signIn('access-valide');
    const call = jest.fn().mockResolvedValue('ok');
    await expect(withAccessToken(call)).resolves.toBe('ok');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refus définitif confirmé par le serveur : session close, dernier écran oublié', async () => {
    useAuthStore.getState().signIn('access-expire');
    refresh.mockRejectedValueOnce(invalidToken());
    const call = jest.fn().mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'expiré'));

    await expect(withAccessToken(call)).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().status).toBe('signedOut');
    expect(mockStoredToken).toBeNull();
    expect(forgetLastRoute).toHaveBeenCalled();
  });
});