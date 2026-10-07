import { create } from 'zustand';

/**
 * État d'authentification MINIMAL (état client) : statut et access token en mémoire.
 * L'utilisateur courant est un état serveur : il vit dans TanStack Query
 * (['auth', 'me']), pas ici. Le refresh token est dans le stockage sécurisé.
 */
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  signIn(accessToken: string): void;
  signOut(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  accessToken: null,
  signIn: (accessToken) => set({ status: 'signedIn', accessToken }),
  signOut: () => set({ status: 'signedOut', accessToken: null }),
}));
