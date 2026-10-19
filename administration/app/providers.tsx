'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';

import { ApiError } from '@/lib/api/errors';

/**
 * Cache des données de l'administration. AUCUNE requête automatique en arrière-plan par
 * défaut (`refetchInterval`, retour sur l'onglet) : chaque requête /api/admin/* compte comme une
 * activité côté serveur ; seules les actions de l'administrateur doivent prolonger sa
 * session (expiration après 30 minutes d'inactivité). Seule exception : les points d'attention
 * (`features/attention`, D-116), relus en lecture PASSIVE, qui ne comptent pas comme activité.
 */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster position="top-right" richColors closeButton toastOptions={{ duration: 5000 }} />
    </QueryClientProvider>
  );
}
