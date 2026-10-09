import type { GameId, PlayerId } from '../game/game-id';

/**
 * Géométrie de la détection (R-36, étape 2, D-046) : fonctions PURES, sans framework.
 *
 * Une seule formule de distance : Haversine, sur une Terre sphérique de rayon moyen.
 */

/** Rayon terrestre moyen (m), utilisé par Haversine. */
export const EARTH_RADIUS_METERS = 6_371_000;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Position d'un joueur dans UNE partie, telle qu'enregistrée (précision limitée). */
export interface PositionSample extends Coordinates {
  gameId: GameId;
  playerId: PlayerId;
  /** Rayon d'incertitude annoncé par le téléphone (m). */
  accuracyMeters: number;
  capturedAt: Date;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Distance orthodromique entre deux points, en mètres (formule de Haversine). */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Arrondit une coordonnée au nombre de décimales conservées (jamais la valeur brute). */
export function roundCoordinate(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Toutes les paires distinctes de joueurs : 2 → 1, 3 → 3, 4 → 6. Ordre stable. */
export function playerPairs(playerIds: readonly PlayerId[]): [PlayerId, PlayerId][] {
  const unique = [...new Set(playerIds)];
  const pairs: [PlayerId, PlayerId][] = [];
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      pairs.push([unique[i]!, unique[j]!]);
    }
  }
  return pairs;
}

export interface PairDistance {
  pair: [PlayerId, PlayerId];
  /** Distance en mètres, ou `null` si l'une des deux positions manque ou est trop ancienne. */
  meters: number | null;
}

/**
 * Distance de chaque paire de joueurs de LA partie, d'après la dernière position de chacun.
 * Seuls les joueurs listés sont pris en compte : un échantillon d'un autre joueur est ignoré.
 */
export function pairDistances(
  playerIds: readonly PlayerId[],
  latest: readonly PositionSample[],
  now: Date,
  freshnessMs: number,
): PairDistance[] {
  const fresh = new Map<PlayerId, PositionSample>();
  for (const sample of latest) {
    if (now.getTime() - sample.capturedAt.getTime() > freshnessMs) continue;
    const known = fresh.get(sample.playerId);
    if (!known || known.capturedAt < sample.capturedAt) fresh.set(sample.playerId, sample);
  }
  return playerPairs(playerIds).map(([a, b]) => {
    const pa = fresh.get(a);
    const pb = fresh.get(b);
    return { pair: [a, b], meters: pa && pb ? haversineMeters(pa, pb) : null };
  });
}

/** Arrondit une distance affichée (jamais une coordonnée) au pas configuré. */
export function roundDistance(meters: number, stepMeters: number): number {
  return Math.round(meters / stepMeters) * stepMeters;
}

/** La détection est désactivée pour cette partie : aucune position n'est acceptée. */
export class GeolocationDisabledError extends Error {
  constructor(readonly gameId: GameId) {
    super(`Détection désactivée pour la partie ${gameId}`);
    this.name = 'GeolocationDisabledError';
  }
}
