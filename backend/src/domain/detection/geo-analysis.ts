import type { PlayerId } from '../game/game-id';
import { DETECTION_THRESHOLDS, GEOLOCATION_CONFIG } from './detection-config';
import { haversineMeters, type PositionSample } from './geo';

/**
 * Analyses géographiques PURES (R-36, étape 2, D-046). Elles ne voient que les positions
 * qu'on leur donne (celles d'UNE partie) et ne concluent jamais à une triche : elles
 * décrivent des faits mesurés, que le service transforme en signaux.
 *
 * Imprécision du GPS : les positions moins précises que `maxAccuracyMeters` sont ignorées,
 * et les rayons d'incertitude sont retranchés des déplacements.
 */

const A = GEOLOCATION_CONFIG.analysis;
const P = DETECTION_THRESHOLDS.proximity;

export function usableSamples(samples: readonly PositionSample[]): PositionSample[] {
  return samples
    .filter((s) => s.accuracyMeters <= A.maxAccuracyMeters)
    .sort((x, y) => x.capturedAt.getTime() - y.capturedAt.getTime());
}

function samplesOf(samples: readonly PositionSample[], playerId: PlayerId): PositionSample[] {
  return usableSamples(samples.filter((s) => s.playerId === playerId));
}

const median = (values: number[]) => {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

export interface ProximityFinding {
  pair: [PlayerId, PlayerId];
  strength: 'strong' | 'significant';
  /** Durée de l'épisode de proximité le plus long (ms). */
  durationMs: number;
  samples: number;
  medianMeters: number;
  minMeters: number;
}

/**
 * Proximité d'une paire : mesures des deux joueurs prises à moins de `pairingWindowMs`
 * l'une de l'autre, regroupées en épisodes de mesures proches (< seuil significatif).
 * Un épisode ne compte qu'avec au moins `minProximitySamples` mesures ET la durée minimale :
 * une seule mesure ne suffit jamais. Forte si la distance médiane est sous le seuil fort.
 */
export function findProximity(
  samples: readonly PositionSample[],
  pair: [PlayerId, PlayerId],
): ProximityFinding | null {
  const first = samplesOf(samples, pair[0]);
  const second = samplesOf(samples, pair[1]);
  const matches: { at: number; meters: number }[] = [];
  for (const a of first) {
    let best: PositionSample | undefined;
    for (const b of second) {
      const gap = Math.abs(a.capturedAt.getTime() - b.capturedAt.getTime());
      if (gap > A.pairingWindowMs) continue;
      if (!best || gap < Math.abs(a.capturedAt.getTime() - best.capturedAt.getTime())) {
        best = b;
      }
    }
    if (best) {
      matches.push({
        at: Math.max(a.capturedAt.getTime(), best.capturedAt.getTime()),
        meters: haversineMeters(a, best),
      });
    }
  }
  matches.sort((x, y) => x.at - y.at);

  const episodes: { at: number; meters: number }[][] = [];
  let current: { at: number; meters: number }[] | undefined;
  for (const match of matches) {
    if (match.meters >= P.moderateMeters) {
      current = undefined;
      continue;
    }
    const last = current?.[current.length - 1];
    if (current && last && match.at - last.at <= A.maxEpisodeGapMs) {
      current.push(match);
    } else {
      current = [match];
      episodes.push(current);
    }
  }

  let found: ProximityFinding | null = null;
  for (const episode of episodes) {
    const durationMs = episode[episode.length - 1]!.at - episode[0]!.at;
    if (episode.length < A.minProximitySamples || durationMs < P.minDurationMs) continue;
    if (found && found.durationMs >= durationMs) continue;
    const distances = episode.map((m) => m.meters);
    const medianMeters = median(distances);
    found = {
      pair,
      strength: medianMeters < P.strongMeters ? 'strong' : 'significant',
      durationMs,
      samples: episode.length,
      medianMeters,
      minMeters: Math.min(...distances),
    };
  }
  return found;
}

export interface ImpossibleTravelFinding {
  playerId: PlayerId;
  occurrences: number;
  maxSpeedKmh: number;
  /** Déplacement retenu (après marge de précision) et durée, pour la vitesse maximale. */
  distanceMeters: number;
  elapsedMs: number;
}

/**
 * Déplacement impossible : entre deux positions successives d'un même joueur, la vitesse
 * estimée (distance moins les deux rayons d'incertitude, sur le temps écoulé) dépasse le
 * seuil configuré. Les petits déplacements (< `minTravelMeters`) ne sont jamais jugés.
 */
export function findImpossibleTravel(
  samples: readonly PositionSample[],
  playerId: PlayerId,
): ImpossibleTravelFinding | null {
  const own = samplesOf(samples, playerId);
  let found: ImpossibleTravelFinding | null = null;
  let occurrences = 0;
  for (let i = 1; i < own.length; i += 1) {
    const from = own[i - 1]!;
    const to = own[i]!;
    const distanceMeters = haversineMeters(from, to) - from.accuracyMeters - to.accuracyMeters;
    if (distanceMeters < A.minTravelMeters) continue;
    const elapsedMs = Math.max(
      to.capturedAt.getTime() - from.capturedAt.getTime(),
      A.minTravelIntervalMs,
    );
    const speedKmh = (distanceMeters / (elapsedMs / 1000)) * 3.6;
    if (speedKmh <= DETECTION_THRESHOLDS.travel.impossibleSpeedKmh) continue;
    occurrences += 1;
    if (!found || speedKmh > found.maxSpeedKmh) {
      found = { playerId, occurrences: 0, maxSpeedKmh: speedKmh, distanceMeters, elapsedMs };
    }
  }
  return found && { ...found, occurrences };
}

export interface IncoherentLocationFinding {
  playerId: PlayerId;
  occurrences: number;
  maxJumpMeters: number;
}

/**
 * Localisation incohérente, critère unique : un saut géographique important (aller) suivi
 * d'un retour au point de départ, en peu de temps (p1 → p2 loin → p3 ≈ p1). Les rayons
 * d'incertitude élargissent toujours la marge en faveur du joueur.
 *
 * Le second critère prévu (position identique entre appareils) n'est PAS établissable :
 * les positions sont arrondies à ~11 m avant tout stockage (D-046).
 */
export function findIncoherentLocation(
  samples: readonly PositionSample[],
  playerId: PlayerId,
): IncoherentLocationFinding | null {
  const own = samplesOf(samples, playerId);
  let occurrences = 0;
  let maxJumpMeters = 0;
  for (let i = 2; i < own.length; i += 1) {
    const [p1, p2, p3] = [own[i - 2]!, own[i - 1]!, own[i]!];
    if (p3.capturedAt.getTime() - p1.capturedAt.getTime() > A.incoherentWindowMs) continue;
    const out = haversineMeters(p1, p2) - p1.accuracyMeters - p2.accuracyMeters;
    const back = haversineMeters(p2, p3) - p2.accuracyMeters - p3.accuracyMeters;
    const home = haversineMeters(p1, p3) - p1.accuracyMeters - p3.accuracyMeters;
    if (out >= A.incoherentJumpMeters && back >= A.incoherentJumpMeters) {
      if (home <= A.incoherentReturnMeters) {
        occurrences += 1;
        maxJumpMeters = Math.max(maxJumpMeters, out, back);
      }
    }
  }
  return occurrences > 0 ? { playerId, occurrences, maxJumpMeters } : null;
}
