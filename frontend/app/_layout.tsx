import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { bootstrapSession } from '../src/features/auth/session';
import { useAuthStore } from '../src/stores/auth-store';

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }),
  );
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        {/* Écrans de connexion : inaccessibles une fois connecté (retour à l'accueil). */}
        <Stack.Protected guard={status !== 'signedIn'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* Parties : réservées aux comptes connectés (R-10, aucun mode invité). */}
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="game/[gameId]" />
          <Stack.Screen name="session/[sessionId]" />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}
