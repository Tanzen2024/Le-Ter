import { apiRequest } from '../lib/api-client';
import type {
  ChangePasswordPayload,
  LoginPayload,
  PublicUser,
  RecoveryResetPayload,
  RecoveryVerifyPayload,
  RegisterPayload,
  ResetGrant,
  TokenPair,
} from '../types/auth';

/** Appels HTTP d'authentification. Aucun état ici : voir stores/ et features/auth/. */
export const authApi = {
  /** Le code de récupération en clair (D-135) n'arrive QUE dans cette réponse. */
  register: (payload: RegisterPayload) =>
    apiRequest<{ user: PublicUser; recoveryCode: string }>('/api/auth/register', {
      method: 'POST',
      body: payload,
    }),

  /** « Mot de passe oublié ? » : téléphone + code → autorisation temporaire. */
  verifyRecovery: (payload: RecoveryVerifyPayload) =>
    apiRequest<ResetGrant>('/api/auth/recovery/verify', { method: 'POST', body: payload }),

  /** Nouveau mot de passe ; renvoie le NOUVEAU code (l'ancien ne vaut plus rien). */
  resetPassword: (payload: RecoveryResetPayload) =>
    apiRequest<{ recoveryCode: string }>('/api/auth/recovery/reset', {
      method: 'POST',
      body: payload,
    }),

  /** Nouveau code pour le compte connecté, après son mot de passe actuel. */
  regenerateRecoveryCode: (accessToken: string, currentPassword: string) =>
    apiRequest<{ recoveryCode: string }>('/api/auth/recovery-code', {
      method: 'POST',
      body: { currentPassword },
      accessToken,
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
