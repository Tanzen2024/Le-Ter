import { randomUUID } from 'node:crypto';

import { GEOLOCATION_CONFIG } from '../../domain/detection/detection-config';
import {
  DetectionConsentPendingError,
  DetectionConsentRequiredError,
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
import type { Game } from '../../domain/game/game';
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
  /**
   * Distance inconnue : de qui la position récente manque, vu du joueur (`VIEWER` : la
   * sienne, `OTHER` : celle de l'autre joueur, `BOTH`). Aucune coordonnée, aucune date.
   */
  missingPosition?: MissingPosition;
}

export type MissingPosition = 'VIEWER' | 'OTHER' | 'BOTH';

/** Ce que voit un joueur : activation, cadence de collecte et ses distances. */
export type GeolocationStatus =
  | { detectionEnabled: false }
  | {
      detectionEnabled: true;
      /** Faux quand la partie est terminée : le téléphone arrête d'envoyer. */
      collecting: boolean;
      /**
       * Le joueur a consenti pour sa participation actuelle à la table (D-095). Faux : le
       * téléphone affiche l'explication et n'envoie aucune position.
       */
      consentGiven: boolean;
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
    // Aucune position avant le consentement explicite enregistré par le serveur (D-095).
    if (!access.consented) throw new DetectionConsentRequiredError(gameId, playerId);

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
      consentGiven: access.consented,
      collectionIntervalMs: GEOLOCATION_CONFIG.collection.intervalMs,
      distances: await this.distancesFor(gameId, playerId, access.playerIds, this.clock()),
    };
  }

  /**
   * Consentement EXPLICITE du joueur (bouton « Continuer », D-095), enregistré pour sa
   * participation actuelle à la table de la partie. Idempotent : un second appel ne change
   * rien. Refusé si la détection n'est pas active (409) ou la partie terminée (409).
   */
  async recordConsent(gameId: GameId, playerId: PlayerId): Promise<GeolocationStatus> {
    const access = await this.requirePlayer(gameId, playerId);
    if (!access.enabled) throw new GeolocationDisabledError(gameId);
    if (access.status === 'finished') throw new GameFinishedError(gameId);
    if (!access.consented) {
      const seated = await this.deps.repository.recordConsent(gameId, playerId, this.clock());
      // Membre de la partie mais plus assis à la table (départ concurrent) : refusé.
      if (!seated) throw new GameAccessDeniedError(gameId, playerId);
      this.deps.logger.info('DETECTION_CONSENT_GIVEN', { gameId, playerId });
    }
    return this.getStatus(gameId, playerId);
  }

  /**
   * Démarrage d'une partie (D-095) : sur une table surveillée (détection effective), refusé
   * tant qu'un de ses joueurs n'a pas consenti. Appelé par GameService sous la version lue
   * de la partie : les joueurs vérifiés sont exactement ceux qui seront servis.
   */
  async assertConsentsBeforeStart(game: Game): Promise<void> {
    if (!game.sessionId) return;
    const missing = await this.playersWithoutConsent(
      game.sessionId,
      game.players.map((p) => p.playerId),
    );
    if (missing.length > 0) throw new DetectionConsentPendingError(game.id, missing);
  }

  /** Joueurs sans consentement d'une table surveillée ; aucun si la détection est inactive. */
  async playersWithoutConsent(
    sessionId: string,
    playerIds: readonly PlayerId[],
  ): Promise<PlayerId[]> {
    if (playerIds.length === 0) return [];
    const gate = await this.deps.repository.consentGate(sessionId, playerIds);
    if (!gate.enabled || !(await this.deps.globalSwitch.isGloballyEnabled())) return [];
    return gate.missing;
  }

  /**
   * Supprime les positions dont la conservation est échue. La promesse faite aux joueurs est
   * « au plus tard 24 h après la fin de la partie » : le nettoyage passant à intervalle
   * régulier, une position est supprimée dès qu'il reste moins d'un intervalle avant 24 h
   * (donc entre 23 h et 24 h avec l'intervalle d'une heure), jamais au-delà.
   */
  async purgeExpired(): Promise<number> {
    const { afterGameEndMs, purgeIntervalMs } = GEOLOCATION_CONFIG.retention;
    const cutoff = new Date(this.clock().getTime() - (afterGameEndMs - purgeIntervalMs));
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
      .map(({ pair, meters, unavailable, missing }) => {
        const otherId = pair[0] === viewerId ? pair[1] : pair[0];
        const mine = missing.includes(viewerId);
        const theirs = missing.includes(otherId);
        const missingPosition: MissingPosition | undefined =
          mine && theirs ? 'BOTH' : mine ? 'VIEWER' : theirs ? 'OTHER' : undefined;
        return {
          playerId: otherId,
          meters: meters === null ? null : roundDistance(meters, roundingMeters),
          ...(unavailable && { unavailable }),
          ...(meters === null && missingPosition && { missingPosition }),
        };
      });
  }
}
