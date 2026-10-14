/**
 * Géolocalisation de la détection anti-collusion (R-36, étape 2, D-046), telle que le
 * serveur la renvoie : jamais de coordonnées, seulement des distances calculées par lui.
 */
export interface PlayerDistance {
  playerId: string;
  /** Mètres (arrondis par le serveur), ou `null` si une position manque. */
  meters: number | null;
  /** Distance inconnue : position jamais reçue (`WAITING`) ou trop ancienne (`STALE`). */
  unavailable?: 'WAITING' | 'STALE';
  /**
   * Distance inconnue : position récente manquante, vue du joueur (`VIEWER` : la mienne,
   * `OTHER` : celle de l'autre joueur, `BOTH`). Absent d'un ancien serveur.
   */
  missingPosition?: 'VIEWER' | 'OTHER' | 'BOTH';
}

export type GeolocationStatus =
  | { detectionEnabled: false }
  | {
      detectionEnabled: true;
      /** Faux quand la partie est terminée : le téléphone n'envoie plus rien. */
      collecting: boolean;
      /**
       * Consentement enregistré par le serveur pour la participation du joueur à la table
       * (D-095). Absent (ancien serveur) : traité comme non donné.
       */
      consentGiven?: boolean;
      collectionIntervalMs: number;
      distances: PlayerDistance[];
    };

/** Position envoyée au serveur : le strict nécessaire (le gameId est dans l'URL). */
export interface PositionReport {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: number;
}
