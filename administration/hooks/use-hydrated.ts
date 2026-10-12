'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * `false` au rendu serveur ET au rendu d'hydratation, `true` dès la fin de l'hydratation (React
 * relit alors le snapshot client et rend à nouveau). Sert aux vues dont les données viennent
 * d'un cache partagé : une requête déjà résolue par un composant hydraté plus tôt (la `Topbar`,
 * hors du `<Suspense>` de la page) ne doit pas changer le premier rendu client, qui doit être
 * identique au HTML du serveur (rendu sans données).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
