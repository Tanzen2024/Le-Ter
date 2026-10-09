'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, sessionApi } from '@/lib/api/client';
import type { SessionResponse } from '@/types/admin';

export const SESSION_KEY = ['admin', 'session'] as const;

/** Compte et session du super administrateur connecté (contrôlés par le backend). */
export function useAdminSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api.get<SessionResponse>('auth/session'),
    staleTime: 60_000,
  });
}

/** Déconnexion effective (session terminée côté serveur), puis retour à la connexion. */
export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => sessionApi.logout(),
    onSettled: () => {
      client.clear();
      // Rechargement complet : aucune donnée de la session ne reste en mémoire.
      window.location.replace(new URL('/connexion?session=deconnectee', window.location.origin));
    },
  });
}
