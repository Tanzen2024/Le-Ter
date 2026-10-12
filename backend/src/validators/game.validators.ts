import { isGameId, type GameId } from '../domain/game/game-id';
import { ALLOWED_MAX_PLAYERS } from '../domain/game/game';
import { isValidGameStake } from '../domain/rules/stake';
import { BCRYPT_MAX_PASSWORD_BYTES } from '../services/auth/password.service';
import { ValidationError } from './validation-error';

/**
 * Validation des entrées HTTP des parties (D-030). Ces fonctions vérifient la FORME
 * des requêtes ; les règles du jeu restent dans le moteur et GameService.
 *
 * Aucun champ d'identité n'est lu : `playerId`, `userId` ou `creatorId` envoyés par le
 * client sont ignorés. Le joueur est toujours celui du JWT.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_ID_MAX_LENGTH = 16;

export interface CreateGameInput {
  /** Capacité maximale : 2, 3 ou 4 (R-23). Ce n'est pas un minimum pour démarrer. */
  maxPlayers: number;
  /**
   * Mise en jetons, entier > 0 (D-073) ; aucun mouvement de jetons n'existe encore (R-13).
   * Son absence et le solde (≥ 2 × mise) sont refusés par la politique de mise du serveur.
   */
  stakeAmount?: number;
}

/**
 * En-tête `Idempotency-Key` de POST /api/games, obligatoire : une même intention de
 * création (double clic, renvoi après une coupure) ne crée qu'une partie. Le client
 * génère une clé par intention, typiquement un UUID.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ValidationError({
      idempotencyKey: 'En-tête Idempotency-Key requis (8 à 128 caractères, ex. un UUID).',
    });
  }
  return value;
}

export interface JoinGameInput {
  commandId?: string;
}

/** Actions de jeu exposées. START, LEAVE : règles non tranchées (R-23, R-19). */
export const GAME_ACTION_TYPES = ['PLAY_CARD', 'DECLARE_WIN', 'FLEE'] as const;
export type GameActionType = (typeof GAME_ACTION_TYPES)[number];

export type GameAction =
  { type: 'PLAY_CARD'; cardId: string } | { type: 'DECLARE_WIN' } | { type: 'FLEE' };

export interface GameActionInput {
  /** Obligatoire : un renvoi (réseau instable) n'est appliqué qu'une fois. */
  commandId: string;
  expectedVersion?: number;
  action: GameAction;
}

/** `:gameId` de l'URL : un UUID en minuscules (D-023), sinon 400. */
export function parseGameIdParam(value: unknown): GameId {
  if (!isGameId(value)) {
    throw new ValidationError({ gameId: 'Identifiant de partie invalide.' });
  }
  return value;
}

export function parseCreateGameInput(body: unknown): CreateGameInput {
  const source = asRecord(body);
  const fields: Record<string, string> = {};
  const { maxPlayers, stakeAmount } = source;

  if (
    typeof maxPlayers !== 'number' ||
    !(ALLOWED_MAX_PLAYERS as readonly number[]).includes(maxPlayers)
  ) {
    fields.maxPlayers = `Nombre maximal de joueurs : ${ALLOWED_MAX_PLAYERS.join(', ')}.`;
  }
  // null, chaîne, 0, négatif, décimal, NaN/Infinity (null en JSON) ou trop grand : refusés.
  if (stakeAmount !== undefined && !isValidGameStake(stakeAmount)) {
    fields.stakeAmount = 'La mise doit être un nombre entier supérieur à zéro.';
  }
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields);
  }
  return {
    maxPlayers: maxPlayers as number,
    ...(stakeAmount !== undefined && { stakeAmount: stakeAmount as number }),
  };
}

/** Nom d'une partie privée (D-039) : 1 à 40 caractères visibles, espaces de bord retirés. */
export const TABLE_NAME_MAX_LENGTH = 40;
/** Mot de passe de partie (D-039) : 4 caractères minimum, 72 octets au plus (bcrypt). */
export const TABLE_PASSWORD_MIN_LENGTH = 4;
// Caractères de contrôle (sauts de ligne, tabulations…) refusés dans un nom affiché.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export interface CreateSessionInput extends CreateGameInput {
  name?: string;
  password?: string;
  /** Détection anti-collusion (D-043) : booléen facultatif, faux par défaut. */
  suspicionDetectionEnabled?: boolean;
}

function parseTablePassword(value: unknown, fields: Record<string, string>): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (
    typeof value !== 'string' ||
    value.length < TABLE_PASSWORD_MIN_LENGTH ||
    Buffer.byteLength(value, 'utf8') > BCRYPT_MAX_PASSWORD_BYTES
  ) {
    fields.password = `Le mot de passe doit contenir au moins ${TABLE_PASSWORD_MIN_LENGTH} caractères (72 octets au plus).`;
    return undefined;
  }
  return value;
}

/**
 * Création d'une partie privée (POST /api/sessions) : capacité et mise comme une partie,
 * plus le nom et le mot de passe facultatif de la table (D-039).
 */
export function parseCreateSessionInput(body: unknown): CreateSessionInput {
  const source = asRecord(body);
  const fields: Record<string, string> = {};
  let base: CreateGameInput | undefined;
  try {
    base = parseCreateGameInput(source);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    Object.assign(fields, err.fields);
  }
  let name: string | undefined;
  if (source.name !== undefined && source.name !== null) {
    const trimmed = typeof source.name === 'string' ? source.name.trim() : '';
    if (
      trimmed.length < 1 ||
      trimmed.length > TABLE_NAME_MAX_LENGTH ||
      CONTROL_CHARACTERS.test(trimmed)
    ) {
      fields.name = `Le nom de la partie doit contenir de 1 à ${TABLE_NAME_MAX_LENGTH} caractères.`;
    } else {
      name = trimmed;
    }
  }
  const password = parseTablePassword(source.password, fields);
  const { suspicionDetectionEnabled } = source;
  if (suspicionDetectionEnabled !== undefined && typeof suspicionDetectionEnabled !== 'boolean') {
    fields.suspicionDetectionEnabled = 'Valeur attendue : vrai ou faux.';
  }
  if (Object.keys(fields).length > 0 || !base) {
    throw new ValidationError(fields);
  }
  return {
    ...base,
    ...(name !== undefined && { name }),
    ...(password !== undefined && { password }),
    ...(typeof suspicionDetectionEnabled === 'boolean' && { suspicionDetectionEnabled }),
  };
}

/** Arrivée dans une partie privée (POST /api/sessions/:id/join) : mot de passe éventuel. */
export function parseJoinSessionInput(body: unknown): { password?: string } {
  const { password } = asRecord(body);
  if (password === undefined || password === null || password === '') return {};
  if (
    typeof password !== 'string' ||
    Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_PASSWORD_BYTES
  ) {
    throw new ValidationError({ password: 'Mot de passe invalide.' });
  }
  return { password };
}

/**
 * Partie suivante d'une session (POST /api/sessions/:id/games) : la capacité est celle de
 * la session (immuable). `maxPlayers` est facultatif ; s'il est envoyé, il doit être
 * valide (et SessionService vérifie qu'il est identique à celui de la session).
 */
export function parseNextGameInput(body: unknown): Partial<CreateGameInput> {
  const source = asRecord(body);
  if (source.maxPlayers === undefined) {
    const { stakeAmount } = parseCreateGameInput({ ...source, maxPlayers: 2 });
    return stakeAmount !== undefined ? { stakeAmount } : {};
  }
  return parseCreateGameInput(source);
}

export type SessionDecisionChoice = 'continue' | 'leave';

/** Choix Poursuivre / Quitter (POST /api/sessions/:id/decision). */
export function parseSessionDecisionInput(body: unknown): { choice: SessionDecisionChoice } {
  const { choice } = asRecord(body);
  if (choice !== 'continue' && choice !== 'leave') {
    throw new ValidationError({ choice: 'Choix attendu : « continue » ou « leave ».' });
  }
  return { choice };
}

/** Démarrer (POST /:gameId/start) : même corps facultatif que rejoindre. */
export const parseStartGameInput = (body: unknown): JoinGameInput => parseJoinGameInput(body);

export function parseJoinGameInput(body: unknown): JoinGameInput {
  const { commandId } = asRecord(body);
  if (commandId === undefined) {
    return {};
  }
  return { commandId: parseCommandId(commandId) };
}

export function parseGameActionInput(body: unknown): GameActionInput {
  const source = asRecord(body);
  const fields: Record<string, string> = {};

  let commandId = '';
  try {
    commandId = parseCommandId(source.commandId);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    Object.assign(fields, err.fields);
  }

  const { expectedVersion } = source;
  if (
    expectedVersion !== undefined &&
    (typeof expectedVersion !== 'number' ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1)
  ) {
    fields.expectedVersion = 'Version attendue : entier supérieur ou égal à 1.';
  }

  const type = source.type;
  const payload = asRecord(source.payload);
  let action: GameAction | undefined;
  if (type === 'PLAY_CARD') {
    const { cardId } = payload;
    if (typeof cardId !== 'string' || cardId === '' || cardId.length > CARD_ID_MAX_LENGTH) {
      fields.cardId = 'Carte manquante ou invalide.';
    } else {
      action = { type, cardId };
    }
  } else if (type === 'DECLARE_WIN' || type === 'FLEE') {
    action = { type };
  } else {
    fields.type = `Action inconnue. Actions possibles : ${GAME_ACTION_TYPES.join(', ')}.`;
  }

  if (Object.keys(fields).length > 0 || !action) {
    throw new ValidationError(fields);
  }
  return {
    commandId,
    ...(expectedVersion !== undefined && { expectedVersion: expectedVersion as number }),
    action,
  };
}

function parseCommandId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError({ commandId: 'commandId requis (UUID généré par le client).' });
  }
  return value.toLowerCase();
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}
