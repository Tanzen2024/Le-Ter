import { apiRequest } from '../lib/api-client';
import type {
  ChangePasswordPayload,
  LoginPayload,
  PublicUser,
  RegisterPayload,
  TokenPair,
} from '../types/auth';

/** Appels HTTP d'authentification. Aucun état ici : voir stores/ et features/auth/. */
export const authApi = {
  register: (payload: RegisterPayload) =>
    apiRequest<{ user: PublicUser }>('/api/auth/register', {
      method: 'POST',
      body: payload,
    }),

  login: (payload: LoginPayload) =>
    apiRequest<TokenPair & { user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: payload,
    }),

  refresh: (refreshToken: string) =>
    apiRequest<TokenPair>('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    }),

  logout: (refreshToken: string) =>
    apiRequest<void>('/api/auth/logout', {
      method: 'POST',
      body: { refreshToken },
    }),

  me: (accessToken: string) => apiRequest<{ user: PublicUser }>('/api/auth/me', { accessToken }),

  /** 204 : mot de passe changé ; la session courante reste ouverte. */
  changePassword: (accessToken: string, payload: ChangePasswordPayload) =>
    apiRequest<void>('/api/auth/password', {
      method: 'POST',
      body: payload,
      accessToken,
    }),
};
