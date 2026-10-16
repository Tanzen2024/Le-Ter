import { QueryClient } from '@tanstack/react-query';

/**
 * Fraîcheur par défaut d'une donnée serveur. En deçà, ni un retour au premier plan, ni un
 * nouvel affichage ne la relisent : des allers-retours rapprochés entre applications ne
 * déclenchent aucune requête. Les données vivantes (partie, solde, sessions, contexte de
 * tournoi) ont leur propre relecture périodique ou une fraîcheur nulle.
 */
export const DEFAULT_STALE_TIME_MS = 30_000;

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: DEFAULT_STALE_TIME_MS } },
  });
}

/**
 * Cache UNIQUE pour toute la vie du processus JavaScript. Il ne vit pas dans un composant :
 * si Android recrée l'activité (le moteur JavaScript, lui, reste en vie), la racine React est
 * remontée mais le cache, la session et les stores sont conservés ; seules les données
 * périmées sont relues.
 */
export const queryClient = createAppQueryClient();
