import { useSyncExternalStore } from 'react';

import { API_URL } from '../../lib/api-client';
import { useAppForeground } from '../../lib/app-lifecycle';
import {
  RealtimeClient,
  realtimeUrl,
  type RealtimeStatus,
  type WebSocketLike,
} from '../../lib/realtime-client';
import { useAuthStore } from '../../stores/auth-store';
import { refreshSession } from '../auth/session';

/** Connexion temps réel unique de l'application (D-045). */
export const realtime = new RealtimeClient({
  url: realtimeUrl(API_URL),
  // Le WebSocket standard ; seuls les membres de WebSocketLike sont utilisés.
  createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
  getToken: () => useAuthStore.getState().accessToken,
  refreshToken: refreshSession,
});

export function useRealtimeStatus(client: RealtimeClient = realtime): RealtimeStatus {
  return useSyncExternalStore(
    (onChange) => client.onStatus(onChange),
    () => client.getStatus(),
  );
}

/** Au retour au premier plan, la connexion coupée par le système est rétablie aussitôt. */
export function useRealtimeWake(): void {
  useAppForeground(() => realtime.wake());
}
