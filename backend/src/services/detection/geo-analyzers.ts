import type { SignalDraft } from '../../domain/detection/detection';
import { DETECTION_THRESHOLDS, GEOLOCATION_CONFIG } from '../../domain/detection/detection-config';
import { playerPairs, type PositionSample } from '../../domain/detection/geo';
import {
  findImpossibleTravel,
  findIncoherentLocation,
  findProximity,
} from '../../domain/detection/geo-analysis';
import type { GeolocationRepository } from '../../repositories/geolocation.repository';
import type { DetectionAnalyzer, DetectionContext } from './detection.service';

/**
 * Analyseurs géographiques (R-36, étape 2, D-046), branchés sur le socle (D-044). Chacun
 * ne lit que les positions de LA partie analysée (`context.gameId`), et seulement celles de
 * ses joueurs. Un joueur sans position (refus de localisation, GPS coupé) ne produit aucun
 * signal : l'absence de données n'est jamais un élément de suspicion.
 *
 * Les éléments justificatifs ne contiennent JAMAIS de coordonnées : des distances, des
 * durées, des vitesses et des compteurs.
 */

const C = GEOLOCATION_CONFIG.contributions;
const round = (value: number) => Math.round(value);

/** Positions d'une analyse, lues une seule fois pour tous les analyseurs. */
class PositionsOfContext {
  private readonly cache = new WeakMap<DetectionContext, Promise<PositionSample[]>>();

  constructor(private readonly repository: GeolocationRepository) {}

  load(context: DetectionContext): Promise<PositionSample[]> {
    let pending = this.cache.get(context);
    if (!pending) {
      const players = new Set(context.playerIds);
      pending = this.repository
        .listPositions(context.gameId)
        .then((all) => all.filter((s) => s.gameId === context.gameId && players.has(s.playerId)));
      this.cache.set(context, pending);
    }
    return pending;
  }
}

export class ProximityAnalyzer implements DetectionAnalyzer {
  readonly name = 'proximity';
  constructor(private readonly positions: PositionsOfContext) {}

  async analyze(context: DetectionContext): Promise<SignalDraft[]> {
    const samples = await this.positions.load(context);
    return playerPairs(context.playerIds).flatMap((pair) => {
      const found = findProximity(samples, pair);
      if (!found) return [];
      return [
        {
          type: 'PROXIMITY' as const,
          severity: found.strength === 'strong' ? ('high' as const) : ('medium' as const),
          contribution: C.PROXIMITY[found.strength],
          playerIds: [...pair],
          evidence: {
            strength: found.strength,
            durationMs: found.durationMs,
            samples: found.samples,
            medianMeters: round(found.medianMeters),
            minMeters: round(found.minMeters),
          },
        },
      ];
    });
  }
}

export class RepeatedProximityAnalyzer implements DetectionAnalyzer {
  readonly name = 'repeated-proximity';
  constructor(
    private readonly positions: PositionsOfContext,
    private readonly repository: GeolocationRepository,
    private readonly repeatedGames: number = DETECTION_THRESHOLDS.proximity.repeatedGames,
  ) {}

  async analyze(context: DetectionContext): Promise<SignalDraft[]> {
    const { repeatedWindowDays } = DETECTION_THRESHOLDS.proximity;
    const since = new Date(context.now.getTime() - repeatedWindowDays * 24 * 60 * 60 * 1000);
    const samples = await this.positions.load(context);
    const drafts: SignalDraft[] = [];
    for (const pair of playerPairs(context.playerIds)) {
      // Proximité dans CETTE partie d'abord : sans elle, aucun historique n'est lu.
      if (!findProximity(samples, pair)) continue;
      const others = await this.repository.countOtherProximityGames(context.gameId, pair, since);
      const games = others + 1;
      if (games < this.repeatedGames) continue;
      drafts.push({
        type: 'REPEATED_PROXIMITY',
        severity: 'high',
        contribution: C.REPEATED_PROXIMITY,
        playerIds: [...pair],
        evidence: { gamesWithProximity: games, windowDays: repeatedWindowDays },
      });
    }
    return drafts;
  }
}

export class ImpossibleTravelAnalyzer implements DetectionAnalyzer {
  readonly name = 'impossible-travel';
  constructor(private readonly positions: PositionsOfContext) {}

  async analyze(context: DetectionContext): Promise<SignalDraft[]> {
    const samples = await this.positions.load(context);
    return context.playerIds.flatMap((playerId) => {
      const found = findImpossibleTravel(samples, playerId);
      if (!found) return [];
      return [
        {
          type: 'IMPOSSIBLE_TRAVEL' as const,
          severity: 'medium' as const,
          contribution: C.IMPOSSIBLE_TRAVEL,
          playerIds: [playerId],
          evidence: {
            occurrences: found.occurrences,
            maxSpeedKmh: round(found.maxSpeedKmh),
            distanceMeters: round(found.distanceMeters),
            elapsedMs: found.elapsedMs,
          },
        },
      ];
    });
  }
}

export class IncoherentLocationAnalyzer implements DetectionAnalyzer {
  readonly name = 'incoherent-location';
  constructor(private readonly positions: PositionsOfContext) {}

  async analyze(context: DetectionContext): Promise<SignalDraft[]> {
    const samples = await this.positions.load(context);
    return context.playerIds.flatMap((playerId) => {
      const found = findIncoherentLocation(samples, playerId);
      if (!found) return [];
      return [
        {
          type: 'INCOHERENT_LOCATION' as const,
          severity: 'medium' as const,
          contribution: C.INCOHERENT_LOCATION,
          playerIds: [playerId],
          evidence: {
            criterion: 'jump_and_return',
            occurrences: found.occurrences,
            maxJumpMeters: round(found.maxJumpMeters),
          },
        },
      ];
    });
  }
}

/**
 * Les quatre analyseurs géographiques, partageant la lecture des positions. Seuils de la
 * configuration centralisée ; `repeatedGames` n'est remplacé que par les tests.
 */
export function createGeoAnalyzers(
  repository: GeolocationRepository,
  options: { repeatedGames?: number } = {},
): DetectionAnalyzer[] {
  const positions = new PositionsOfContext(repository);
  return [
    new ProximityAnalyzer(positions),
    new RepeatedProximityAnalyzer(positions, repository, options.repeatedGames),
    new ImpossibleTravelAnalyzer(positions),
    new IncoherentLocationAnalyzer(positions),
  ];
}
