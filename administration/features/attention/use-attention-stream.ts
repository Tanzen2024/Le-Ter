'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { ATTENTION_KEY } from './api';

const EVENTS_URL = '/api/admin/events';
/** Réouverture après une fermeture annoncée par le serveur (jeton expiré, redémarrage). */
const REOPEN_MS = 2_000;
/** Réouverture après un refus (401, backend injoignable…) : la relecture périodique couvre. */
const RETRY_MS = 30_000;

/**
 * Flux temps réel des points d'attention (D-116), ouvert une fois pour toute l'interface.
 * Il ne transporte aucune donnée : chaque signal (et chaque (re)connexion, pour rattraper un
 * signal perdu) relit les compteurs par `GET /api/admin/attention`, seule source.
 *
 * Le relais du flux ne renouvelle jamais l'access token : après une fermeture ou un refus, les
 * compteurs sont d'abord relus par le relais ordinaire (qui renouvelle le jeton, ou renvoie à
 * la connexion si la session est close), puis le flux est rouvert.
 */
export function useAttentionStream(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const refresh = () => queryClient.invalidateQueries({ queryKey: ATTENTION_KEY });
    const reopen = (delayMs: number) => {
      source?.close();
      source = null;
      clearTimeout(timer);
      if (stopped) return;
      void refresh().finally(() => {
        if (!stopped) timer = setTimeout(open, delayMs);
      });
    };
    function open() {
      if (stopped) return;
      const current = new EventSource(EVENTS_URL);
      source = current;
      current.addEventListener('ready', () => void refresh());
      current.addEventListener('attention', () => void refresh());
      current.addEventListener('end', () => reopen(REOPEN_MS));
      current.onerror = () => {
        // CONNECTING : coupure réseau, le navigateur se reconnecte seul. CLOSED : refus.
        if (current.readyState === EventSource.CLOSED && source === current) reopen(RETRY_MS);
      };
    }

    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [queryClient]);
}
