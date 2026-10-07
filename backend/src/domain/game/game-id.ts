import { randomUUID } from 'node:crypto';

/**
 * Identifiant unique d'une partie : un UUID v4 en minuscules, clé primaire
 * `uuid` de la table PostgreSQL `games` (voir docs/decisions.md, D-023).
 *
 * Le type « marqué » empêche de passer par erreur un identifiant de joueur
 * ou une chaîne non validée là où un GameId est attendu.
 */
export type GameId = string & { readonly __brand: 'GameId' };

/** Identifiant d'un utilisateur (joueur ou observateur). */
export type PlayerId = string & { readonly __brand: 'PlayerId' };

/** Forme canonique produite par PostgreSQL et par crypto.randomUUID (minuscules). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Valide une valeur venant de l'extérieur (URL, message WebSocket). */
export function parseGameId(value: unknown): GameId {
  if (!isGameId(value)) {
    throw new InvalidGameIdError(value);
  }
  return value;
}

/** Nouvel identifiant de partie, généré sans coordination avec la base. */
export function newGameId(): GameId {
  return randomUUID() as GameId;
}

export function toPlayerId(value: string): PlayerId {
  if (value.length === 0) {
    throw new Error('PlayerId vide');
  }
  return value as PlayerId;
}

export class InvalidGameIdError extends Error {
  constructor(value: unknown) {
    super(`gameId invalide : ${JSON.stringify(value)}`);
    this.name = 'InvalidGameIdError';
  }
}
