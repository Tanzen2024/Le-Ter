import { useIsMutating } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/**
 * Au-delà de ce délai, une action envoyée au serveur (mutation TanStack Query) sans réponse
 * est signalée par « Traitement en cours… » (le seuil d'apparition de l'indicateur s'y ajoute :
 * environ 1 s en tout) ; en deçà, l'attente reste imperceptible.
 */
export const LONG_ACTION_MS = 600;

/**
 * Vrai tant qu'au moins une action envoyée au serveur attend sa réponse depuis plus de
 * `LONG_ACTION_MS`. Lu sur l'état réel des requêtes, jamais estimé ; ne bloque rien.
 */
export function useLongPendingAction(): boolean {
  const pending = useIsMutating() > 0;
  const [long, setLong] = useState(false);
  if (!pending && long) setLong(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setLong(true), LONG_ACTION_MS);
    return () => clearTimeout(timer);
  }, [pending]);
  return pending && long;
}
