import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { bootstrapSession } from '../src/features/auth/session';
import { installSoundPlayer } from '../src/services/expo-sound-player';
import { useAuthStore } from '../src/stores/auth-store';

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }),
  );
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    installSoundPlayer();
    void bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        {/* Documents légaux (Réglages) : lisibles connecté ou non. */}
        <Stack.Screen name="legal/[document]" />
        {/* Retour de la page de paiement CinetPay (leter://payment/return, D-050). HORS garde :
            ouvert à froid par le lien pendant la restauration de la session, une garde fausse
            redirigerait vers l'accueil et perdrait le lien. L'écran attend la session, renvoie
            vers la connexion si besoin, et le serveur ne montre un paiement qu'à son titulaire. */}
        <Stack.Screen name="payment/return" />
        {/* Écrans de connexion : inaccessibles une fois connecté (retour à l'accueil). */}
        <Stack.Protected guard={status !== 'signedIn'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* Parties et tournois : réservés aux comptes connectés (R-10, aucun mode invité). */}
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="game/[gameId]" />
          <Stack.Screen name="tournament/index" />
          <Stack.Screen name="tournament/propose" />
          {/* Fiche d'un tournoi depuis la liste (D-065). */}
          <Stack.Screen name="tournament/[tournamentId]" />
          {/* Administration (D-053) : aucun lien joueur ; rôle admin vérifié par le serveur. */}
          <Stack.Screen name="admin/index" />
          {/* Administration des tournois (D-054). */}
          <Stack.Screen name="admin/tournaments/index" />
          <Stack.Screen name="admin/tournaments/new" />
          <Stack.Screen name="admin/tournaments/settings" />
          <Stack.Screen name="admin/tournaments/[tournamentId]" />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}
