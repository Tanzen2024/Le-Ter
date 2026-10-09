import { GEOLOCATION_CONFIG } from '../domain/detection/detection-config';
import type { GameId } from '../domain/game/game-id';
import type { PositionInput } from '../services/detection/geolocation.service';
import { ValidationError } from './validation-error';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Position envoyée par le téléphone (R-36, étape 2, D-046) :
 * `{ latitude, longitude, accuracy, capturedAt }` (capturedAt : millisecondes epoch ou
 * date ISO). L'identité du joueur ne vient JAMAIS du corps : un `playerId` reçu est ignoré.
 * Un `gameId` reçu doit être celui de l'URL (seul `gameId` utilisé).
 */
export function parsePositionInput(body: unknown, gameId: GameId): PositionInput {
  const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const { latitude, longitude, accuracy, capturedAt } = source;

  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
    fields.latitude = 'Latitude attendue entre -90 et 90.';
  }
  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
    fields.longitude = 'Longitude attendue entre -180 et 180.';
  }
  const maxAccuracy = GEOLOCATION_CONFIG.validation.maxAcceptedAccuracyMeters;
  if (!isFiniteNumber(accuracy) || accuracy <= 0 || accuracy > maxAccuracy) {
    fields.accuracy = `Précision attendue entre 0 et ${maxAccuracy} m.`;
  }
  const date =
    isFiniteNumber(capturedAt) || typeof capturedAt === 'string' ? new Date(capturedAt) : null;
  if (!date || Number.isNaN(date.getTime())) {
    fields.capturedAt = 'Date de la position invalide.';
  }
  if (source.gameId !== undefined && source.gameId !== gameId) {
    fields.gameId = "La partie ne correspond pas à l'adresse.";
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  return {
    latitude: latitude as number,
    longitude: longitude as number,
    accuracyMeters: accuracy as number,
    capturedAt: date as Date,
  };
}
