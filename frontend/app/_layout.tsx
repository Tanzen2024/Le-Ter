import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { preloadTableFonts } from '../src/components/table/TableDecor';
import { bootstrapSession } from '../src/features/auth/session';
import { ActiveGameRestorer } from '../src/features/games/ActiveGameRestorer';
import { FontCurtain } from '../src/features/navigation/FontCurtain';
import { LaunchCurtain } from '../src/features/navigation/LaunchCurtain';
import { beginNavigationRoot } from '../src/features/navigation/last-route';
import {
  navigationTheme,
  stableStackScreenOptions,
} from '../src/features/navigation/stack-options';
import { installAppFocusManager } from '../src/lib/app-focus';
import { queryClient } from '../src/lib/query-client';
import { installSoundPlayer } from '../src/services/expo-sound-player';
import { useAuthStore } from '../src/stores/auth-store';

/**
 * Écran de secours de toute l'application : une erreur imprévue d'un écran n'affiche jamais
 * de message technique (exception, trace), seulement « Réessayer ».
 */
export { AppErrorScreen as ErrorBoundary } from '../src/features/navigation/AppErrorScreen';

/**
 * Racine de l'application. Le retour au premier plan ne la touche pas : aucun rechargement,
 * aucun remontage, aucune redirection ; seules les données périmées de l'écran affiché sont
 * relues (`app-focus`, `app-lifecycle`). Le cache (`queryClient`), la session et les stores
 * vivent au niveau du module : si Android recrée l'activité (racine React remontée, moteur
 * JavaScript vivant), ils sont conservés et le dernier écran est rouvert.
 */
export default function RootLayout() {
  // Nouvelle arborescence de navigation : décidé AVANT les effets des enfants (reprise).
  useState(beginNavigationRoot);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    // Polices prêtes avant le premier écran (aucun texte qui change de taille à l'arrivée).
    void preloadTableFonts();
    installSoundPlayer();
    // Retour au premier plan : seules les requêtes affichées et périmées sont relues.
    installAppFocusManager();
    // Sans effet si la session est déjà ouverte (racine remontée) : jamais réinitialisée.
    void bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style="light" />
        {/* Transition et fond identiques pour tous les écrans (stack-options). */}
        <Stack screenOptions={stableStackScreenOptions}>
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
            {/* Pas de balayage arrière : on ne quitte la table que par « Quitter la partie ». */}
            <Stack.Screen name="game/[gameId]" options={{ gestureEnabled: false }} />
            <Stack.Screen name="tournament/index" />
            <Stack.Screen name="tournament/propose" />
            {/* Fiche d'un tournoi depuis la liste (D-065). */}
            <Stack.Screen name="tournament/[tournamentId]" />
            {/* Résultats des tournois et classement général officiel (D-106). */}
            <Stack.Screen name="tournament/results/index" />
            <Stack.Screen name="tournament/results/[tournamentId]" />
            {/* Aide et réclamations (D-114) : assistant automatisé et dossiers du joueur. */}
            <Stack.Screen name="support/index" />
            <Stack.Screen name="support/[complaintId]" />
            {/* Administration (D-053) : aucun lien joueur ; rôle admin vérifié par le serveur. */}
            <Stack.Screen name="admin/index" />
            {/* Administration des tournois (D-054). */}
            <Stack.Screen name="admin/tournaments/index" />
            <Stack.Screen name="admin/tournaments/new" />
            <Stack.Screen name="admin/tournaments/settings" />
            <Stack.Screen name="admin/tournaments/[tournamentId]" />
          </Stack.Protected>
        </Stack>
        {/* Reprise de la partie active au lancement et au retour au premier plan. */}
        <ActiveGameRestorer />
        {/* Relancement après destruction par Android : couvre la reconstruction de la pile
          jusqu'à la réouverture du dernier écran (jamais affiché au simple retour). */}
        <LaunchCurtain />
        {/* Démarrage à froid : aucun texte en police système qui change de taille ensuite. */}
        <FontCurtain />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
