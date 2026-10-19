import { queryOptions } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { Attention } from '@/types/admin';

export const ATTENTION_KEY = ['admin', 'attention'] as const;

/** Relecture de secours : compteurs liés au temps (paiements anciens, échéances dépassées). */
export const ATTENTION_REFRESH_MS = 60_000;

/**
 * Points d'attention (D-116), en lecture PASSIVE : relus à chaque signal du flux temps réel
 * (`useAttentionStream`), à la reconnexion, au retour sur l'onglet et chaque minute, sans
 * jamais prolonger la session d'administration. Onglet masqué : aucune relecture périodique.
 */
export function attentionQuery() {
  return queryOptions({
    queryKey: ATTENTION_KEY,
    queryFn: () => api.get<Attention>('attention', undefined, { passive: true }),
    refetchInterval: ATTENTION_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}
