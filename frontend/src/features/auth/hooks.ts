import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authApi } from '../../services/auth-api';
import { useAuthStore } from '../../stores/auth-store';
import type {
  ChangePasswordPayload,
  LoginPayload,
  PublicUser,
  RecoveryResetPayload,
  RecoveryVerifyPayload,
  RegisterPayload,
} from '../../types/auth';
import { signOut, storeSession, withAccessToken } from './session';

/** Clé TanStack Query de l'utilisateur courant (état serveur). */
export const currentUserKey = ['auth', 'me'] as const;

export function useCurrentUser() {
  const status = useAuthStore((s) => s.status);
  return useQuery({
    queryKey: currentUserKey,
    queryFn: async (): Promise<PublicUser> =>
      (await withAccessToken((token) => authApi.me(token))).user,
    enabled: status === 'signedIn',
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LoginPayload) => authApi.login(payload),
    onSuccess: async ({ user, accessToken, refreshToken }) => {
      queryClient.setQueryData(currentUserKey, user);
      await storeSession({ accessToken, refreshToken });
    },
  });
}

/**
 * Inscription SANS connexion immédiate (D-135) : l'écran montre d'abord le code de
 * récupération reçu, puis connecte le joueur (`useLogin`) quand il l'a enregistré. Le code
 * reste en mémoire de l'écran seulement, jamais dans un stockage.
 */
export function useRegister() {
  return useMutation({
    mutationFn: (payload: RegisterPayload) => authApi.register(payload),
  });
}

/** « Mot de passe oublié ? », étape code → autorisation temporaire (D-135). */
export function useVerifyRecovery() {
  return useMutation({
    mutationFn: (payload: RecoveryVerifyPayload) => authApi.verifyRecovery(payload),
  });
}

/** Nouveau mot de passe → nouveau code de récupération (affiché une fois). */
export function useResetPassword() {
  return useMutation({
    mutationFn: (payload: RecoveryResetPayload) => authApi.resetPassword(payload),
  });
}

/** Nouveau code pour le compte connecté (Profil), après son mot de passe actuel. */
export function useRegenerateRecoveryCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (currentPassword: string) =>
      withAccessToken((token) => authApi.regenerateRecoveryCode(token, currentPassword)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: currentUserKey }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSettled: () => queryClient.clear(),
  });
}

/** Changement du mot de passe du compte connecté ; la session reste ouverte. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: ChangePasswordPayload) =>
      withAccessToken((token) => authApi.changePassword(token, payload)),
  });
}
