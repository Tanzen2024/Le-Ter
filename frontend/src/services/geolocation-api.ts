import { apiRequest } from '../lib/api-client';
import type { GeolocationStatus, PlayerDistance, PositionReport } from '../types/geolocation';

/**
 * Appels HTTP de la géolocalisation (D-046). Aucun identifiant de joueur n'est envoyé : le
 * serveur identifie le joueur par son access token et vérifie qu'il est dans la partie.
 */
export const geolocationApi = {
  status: (accessToken: string, gameId: string) =>
    apiRequest<GeolocationStatus>(`/api/games/${gameId}/geolocation`, {
      accessToken,
    }),

  /** Consentement explicite (« Continuer », D-095) ; renvoie l'état relu par le serveur. */
  consent: (accessToken: string, gameId: string) =>
    apiRequest<GeolocationStatus>(`/api/games/${gameId}/geolocation/consent`, {
      method: 'POST',
      body: {},
      accessToken,
    }),

  sendPosition: (accessToken: string, gameId: string, position: PositionReport) =>
    apiRequest<{ distances: PlayerDistance[] }>(`/api/games/${gameId}/position`, {
      method: 'POST',
      body: position,
      accessToken,
    }),
};
