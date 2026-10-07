import { useEffect, useState } from 'react';

const TICK_MS = 250;

/**
 * Compte à rebours vers une échéance FIXÉE PAR LE SERVEUR (D-034 : tour de jeu, décision
 * Poursuivre/Quitter). Purement visuel : il n'envoie rien et ne décide jamais qu'une
 * échéance est atteinte ; seul le serveur le fait, et l'écran affiche ensuite son état.
 *
 * L'horloge du téléphone peut être décalée : `serverNow` (heure du serveur dans la
 * réponse) et `receivedAt` (heure locale de réception, `dataUpdatedAt` de TanStack Query)
 * donnent ce décalage, appliqué au calcul.
 *
 * Renvoie les secondes restantes (arrondies au-dessus), ou `null` sans échéance.
 */
export function useServerCountdown(
  deadlineAt: string | undefined,
  serverNow: string | undefined,
  receivedAt: number,
): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineAt) {
      return;
    }
    const handle = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(handle);
  }, [deadlineAt]);

  if (!deadlineAt) {
    return null;
  }
  const offset = serverNow && receivedAt ? Date.parse(serverNow) - receivedAt : 0;
  const remainingMs = Date.parse(deadlineAt) - (now + offset);
  return Math.max(0, Math.ceil(remainingMs / 1000));
}
