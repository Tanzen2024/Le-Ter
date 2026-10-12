import { useMemo } from 'react';

import { useGameUiStore, type LocalGpsState } from '../../../stores/game-ui-store';
import type { GameView } from '../../../types/game';
import { useGeolocationStatus } from '../../geolocation/hooks';

/**
 * Distances entre le joueur connecté et les autres joueurs de la table.
 *
 * SOURCE UNIQUE : le serveur (D-046), qui les calcule à partir des positions des parties
 * surveillées (`GET /api/games/:gameId/geolocation`, relu à la cadence de collecte, puis la
 * réponse de chaque position envoyée). Le téléphone ne calcule jamais de distance et ne
 * reçoit jamais de coordonnées. Une distance inconnue n'est jamais « 0 m » : elle porte sa
 * cause (localisation refusée, GPS indisponible, en attente, position obsolète).
 */
export type DistanceView =
  | { kind: 'known'; meters: number }
  /** Ce téléphone n'a pas donné sa position : refus du joueur ou du système. */
  | { kind: 'refused' }
  /** Ce téléphone ne parvient pas à lire sa position (GPS coupé, délai dépassé). */
  | { kind: 'gps-unavailable' }
  /** Une des deux positions n'est jamais arrivée au serveur. */
  | { kind: 'waiting' }
  /** Une des deux positions est trop ancienne pour être comparée. */
  | { kind: 'stale' };

/**
 * Distances de la table, ou `null` quand la partie n'est pas surveillée (option de table
 * désactivée OU interrupteur global désactivé, D-053) : rien n'est alors affiché.
 */
export type PlayerDistances = { of(playerId: string): DistanceView } | null;

/** Cause d'une distance inconnue : la situation de CE téléphone passe avant celle du serveur. */
function unknownDistance(
  local: LocalGpsState | undefined,
  server: 'WAITING' | 'STALE' | undefined,
): DistanceView {
  if (local === 'refused') return { kind: 'refused' };
  if (local === 'unavailable') return { kind: 'gps-unavailable' };
  return server === 'STALE' ? { kind: 'stale' } : { kind: 'waiting' };
}

/**
 * Distances de la table selon le serveur, recalculées seulement quand sa réponse ou l'état
 * GPS de ce téléphone changent. Un joueur absent de la réponse : en attente.
 */
export function usePlayerDistances(game: GameView): PlayerDistances {
  const { data } = useGeolocationStatus(game.gameId);
  const local = useGameUiStore((s) => s.localGps[game.gameId]);
  return useMemo(() => {
    if (!data?.detectionEnabled) return null;
    const views = new Map<string, DistanceView>();
    for (const { playerId, meters, unavailable } of data.distances) {
      views.set(
        playerId,
        meters !== null && Number.isFinite(meters) && meters >= 0
          ? { kind: 'known', meters }
          : unknownDistance(local, unavailable),
      );
    }
    const missing = unknownDistance(local, undefined);
    return { of: (playerId: string) => views.get(playerId) ?? missing };
  }, [data, local]);
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

/** Texte affiché pour une distance, connue ou non (cause explicite, jamais de valeur inventée). */
export function distanceLabel(view: DistanceView): string {
  switch (view.kind) {
    case 'known':
      return formatDistance(view.meters);
    case 'refused':
      return 'Localisation refusée';
    case 'gps-unavailable':
      return 'GPS indisponible';
    case 'waiting':
      return 'En attente de position';
    case 'stale':
      return 'Position obsolète';
  }
}
