import { useEffect, useState } from 'react';

const TICK_MS = 250;

/**
 * Délais de jeu (D-098) : le serveur accorde 13 s (tour, Poursuivre/Quitter, démarrage d'une
 * table de tournoi) mais les écrans n'en montrent que 10. Les 3 dernières secondes sont une
 * marge invisible (latence du réseau mobile) : le compte à rebours affiché atteint 0 trois
 * secondes avant l'échéance du serveur, qui reste seul juge.
 */
export const DISPLAYED_DELAY_MS = 10_000;
export const HIDDEN_MARGIN_MS = 3_000;

/** Échéance AFFICHÉE d'une échéance du serveur (ms) : 3 s plus tôt. */
export function displayedDeadline(serverDeadlineMs: number): number {
  return serverDeadlineMs - HIDDEN_MARGIN_MS;
}

/**
 * Temps restant AFFICHÉ (ms) avant une échéance FIXÉE PAR LE SERVEUR (D-034 : tour de jeu,
 * décision Poursuivre/Quitter), marge invisible de D-098 déduite. Purement visuel : il n'envoie rien et ne décide jamais qu'une
 * échéance est atteinte ; seul le serveur le fait, et l'écran affiche ensuite son état.
 *
 * L'horloge du téléphone peut être décalée : `serverNow` (heure du serveur dans la
 * réponse) et `receivedAt` (heure locale de réception, `dataUpdatedAt` de TanStack Query)
 * donnent ce décalage, appliqué au calcul.
 *
 * Renvoie les millisecondes restantes (≥ 0), ou `null` sans échéance.
 */
export function useServerRemainingMs(
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
  return Math.max(0, displayedDeadline(Date.parse(deadlineAt)) - (now + offset));
}

/** Secondes restantes (arrondies au-dessus) avant l'échéance serveur, ou `null` sans échéance. */
export function useServerCountdown(
  deadlineAt: string | undefined,
  serverNow: string | undefined,
  receivedAt: number,
): number | null {
  const remainingMs = useServerRemainingMs(deadlineAt, serverNow, receivedAt);
  return remainingMs === null ? null : Math.ceil(remainingMs / 1000);
}
