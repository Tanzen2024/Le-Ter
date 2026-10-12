import { randomUUID } from 'node:crypto';

import { GEOLOCATION_CONFIG } from '../../domain/detection/detection-config';
import {
  type DistanceUnavailable,
  GeolocationDisabledError,
  pairDistances,
  roundCoordinate,
  roundDistance,
} from '../../domain/detection/geo';
import {
  GameAccessDeniedError,
  GameFinishedError,
  GameNotFoundError,
} from '../../domain/game/game-errors';
import type { GameId, PlayerId } from '../../domain/game/game-id';
import type {
  GeolocationAccess,
  GeolocationRepository,
} from '../../repositories/geolocation.repository';
import type { Logger } from '../../utils/logger';
import { ValidationError } from '../../validators/validation-error';
import type { DetectionGlobalSwitch } from './detection-settings.service';

/** Position envoyée par le téléphone, déjà validée dans sa forme. */
export interface PositionInput {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: Date;
}

/** Distance entre le joueur connecté et UN autre joueur : jamais de coordonnées. */
export interface PlayerDistanceView {
  playerId: PlayerId;
  /** Mètres (arrondis), ou `null` si une des deux positions manque ou est trop ancienne. */
  meters: number | null;
  /**
   * Distance inconnue : `WAITING` (une position n'est jamais arrivée) ou `STALE` (position
   * trop ancienne). Absent quand la distance est connue. Jamais de coordonnée ni d'âge précis.
   */
  unavailable?: DistanceUnavailable;
}

/** Ce que voit un joueur : activation, cadence de collecte et ses distances. */
export type GeolocationStatus =
  | { detectionEnabled: false }
  | {
      detectionEnabled: true;
      /** Faux quand la partie est terminée : le téléphone arrête d'envoyer. */
      collecting: boolean;
      collectionIntervalMs: number;
      distances: PlayerDistanceView[];
    };

export interface GeolocationServiceDependencies {
  repository: GeolocationRepository;
  /** Interrupteur GLOBAL (D-053) : désactivé, aucune position acceptée ni demandée. */
  globalSwitch: DetectionGlobalSwitch;
  logger: Logger;
  clock?: () => Date;
}

/**
 * Couche géographique de la détection de potentielle collusion (R-36, étape 2, D-046).
 *
 * - Indépendante de GameService : elle ne lit que l'appartenance et le statut de la partie,
 *   ne verrouille jamais une partie et ne modifie aucun état de jeu.
 * - L'identité vient TOUJOURS du JWT (contrôleur) ; le `gameId` de l'URL est vérifié
 *   (partie existante, joueur membre, détection activée) avant toute écriture.
 * - Détection désactivée : aucune position acceptée, aucune distance calculée.
 * - Coordonnées arrondies avant stockage ; les joueurs ne reçoivent que des distances.
 */
export class GeolocationService {
  private readonly clock: () => Date;

  constructor(private readonly deps: GeolocationServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Enregistre la position du joueur et renvoie ses distances aux autres joueurs. */
  async recordPosition(
    gameId: GameId,
    playerId: PlayerId,
    input: PositionInput,
  ): Promise<PlayerDistanceView[]> {
    const access = await this.requirePlayer(gameId, playerId);
    if (!access.enabled) throw new GeolocationDisabledError(gameId);
    if (access.status === 'finished') throw new GameFinishedError(gameId);

    const now = this.clock();
    const { maxAgeMs, maxClockAheadMs } = GEOLOCATION_CONFIG.validation;
    const age = now.getTime() - input.capturedAt.getTime();
    if (age > maxAgeMs || age < -maxClockAheadMs) {
      throw new ValidationError({ capturedAt: 'Position trop ancienne ou datée dans le futur.' });
    }
    const decimals = GEOLOCATION_CONFIG.storage.coordinateDecimals;
    await this.deps.repository.insertPosition({
      id: randomUUID(),
      gameId,
      playerId,
      latitude: roundCoordinate(input.latitude, decimals),
      longitude: roundCoordinate(input.longitude, decimals),
      accuracyMeters: input.accuracyMeters,
      // Une horloge de téléphone légèrement en avance ne date jamais une position du futur.
      capturedAt: age < 0 ? now : input.capturedAt,
      receivedAt: now,
    });
    return this.distancesFor(gameId, playerId, access.playerIds, now);
  }

  /** État de la géolocalisation pour un joueur de la partie (aucun calcul si désactivée). */
  async getStatus(gameId: GameId, playerId: PlayerId): Promise<GeolocationStatus> {
    const access = await this.requirePlayer(gameId, playerId);
    if (!access.enabled) return { detectionEnabled: false };
    return {
      detectionEnabled: true,
      collecting: access.status !== 'finished',
      collectionIntervalMs: GEOLOCATION_CONFIG.collection.intervalMs,
      distances: await this.distancesFor(gameId, playerId, access.playerIds, this.clock()),
    };
  }

  /** Supprime les positions dont la conservation (24 h après la fin de partie) est échue. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(this.clock().getTime() - GEOLOCATION_CONFIG.retention.afterGameEndMs);
    return this.deps.repository.purgeExpired(cutoff);
  }

  /**
   * Nettoyage automatique : immédiatement, puis à intervalle régulier. Une panne est
   * journalisée et le nettoyage suivant réessaie. Renvoie la fonction d'arrêt.
   */
  startRetention(intervalMs: number = GEOLOCATION_CONFIG.retention.purgeIntervalMs): () => void {
    const purge = () => {
      this.purgeExpired().then(
        (deleted) => {
          if (deleted > 0) this.deps.logger.info('detection positions purged', { deleted });
        },
        (err: unknown) =>
          this.deps.logger.error('detection positions purge failed', {
            error: err instanceof Error ? err.message : String(err),
          }),
      );
    };
    purge();
    const timer = setInterval(purge, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  private async requirePlayer(gameId: GameId, playerId: PlayerId): Promise<GeolocationAccess> {
    const access = await this.deps.repository.findAccess(gameId, playerId);
    if (!access) throw new GameNotFoundError(gameId);
    if (!access.isPlayer) throw new GameAccessDeniedError(gameId, playerId);
    // Activation effective = table surveillée (D-043) ET interrupteur global (D-053). Le
    // joueur reçoit la même réponse dans les deux cas : il ne sait pas lequel est désactivé.
    const enabled = access.enabled && (await this.deps.globalSwitch.isGloballyEnabled());
    return { ...access, enabled };
  }

  private async distancesFor(
    gameId: GameId,
    viewerId: PlayerId,
    playerIds: readonly PlayerId[],
    now: Date,
  ): Promise<PlayerDistanceView[]> {
    const { freshnessMs, roundingMeters } = GEOLOCATION_CONFIG.display;
    const latest = await this.deps.repository.latestPositions(gameId);
    return pairDistances(playerIds, latest, now, freshnessMs)
      .filter(({ pair }) => pair.includes(viewerId))
      .map(({ pair, meters, unavailable }) => ({
        playerId: pair[0] === viewerId ? pair[1] : pair[0],
        meters: meters === null ? null : roundDistance(meters, roundingMeters),
        ...(unavailable && { unavailable }),
      }));
  }
}
