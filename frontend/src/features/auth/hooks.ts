import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authApi } from '../../services/auth-api';
import { useAuthStore } from '../../stores/auth-store';
import type {
  ChangePasswordPayload,
  LoginPayload,
  PublicUser,
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

/** Inscription, puis connexion automatique avec les mêmes identifiants. */
export function useRegister() {
  const login = useLogin();
  return useMutation({
    mutationFn: async (payload: RegisterPayload) => {
      await authApi.register(payload);
      await login.mutateAsync({
        email: payload.email,
        password: payload.password,
      });
    },
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
