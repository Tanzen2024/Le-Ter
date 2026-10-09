import { useMemo } from 'react';

import type { GameView } from '../../../types/game';
import { useGeolocationStatus } from '../../geolocation/hooks';

/**
 * Distances entre le joueur connecté et les autres joueurs de la table.
 *
 * SOURCE UNIQUE : le serveur (D-046), qui les calcule à partir des positions des parties
 * surveillées (`GET /api/games/:gameId/geolocation`, puis la réponse de chaque position
 * envoyée). Le téléphone ne calcule jamais de distance et ne reçoit jamais de coordonnées.
 * Partie non surveillée, position absente ou refus de localisation : aucune distance,
 * l'interface affiche « — », jamais une valeur inventée ni « 0 m ».
 */
export type PlayerDistances = Readonly<Record<string, number>>;

/** Référence stable : aucune distance connue (pas de nouveau calcul à chaque rendu). */
const NO_DISTANCES: PlayerDistances = Object.freeze({});

/**
 * Distance (en mètres) de chaque AUTRE joueur de la partie, si le serveur la connaît ;
 * jamais le joueur connecté. Recalculée seulement quand la réponse du serveur change.
 */
export function usePlayerDistances(game: GameView): PlayerDistances {
  const { data } = useGeolocationStatus(game.gameId);
  return useMemo(() => {
    if (!data?.detectionEnabled) return NO_DISTANCES;
    const known: Record<string, number> = {};
    for (const { playerId, meters } of data.distances) {
      if (meters !== null) known[playerId] = meters;
    }
    return Object.freeze(known);
  }, [data]);
}

/**
 * Libellé court : mètres sous 1 km (« 850 m »), kilomètres au-delà avec une décimale et la
 * virgule française (« 1,2 km », « 12,4 km »), sans décimale à partir de 100 km. Valeur
 * absente ou invalide : « — » (jamais « 0 m » par défaut).
 */
export function formatDistance(meters: number | undefined): string {
  if (meters === undefined || !Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return km >= 100 ? `${Math.round(km)} km` : `${km.toFixed(1).replace('.', ',')} km`;
}
