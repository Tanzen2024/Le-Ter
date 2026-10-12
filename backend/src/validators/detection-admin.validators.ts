import {
  ALERT_PAGE,
  ALERT_SORTS,
  isAlertStatus,
  type AlertListQuery,
  type AlertSort,
} from '../domain/detection/alert-admin';
import type { AlertPriority, AlertStatus } from '../domain/detection/detection';
import { ALERT_CONFIG, RISK_LEVELS, type RiskLevel } from '../domain/detection/detection-config';
import {
  commissionScheduleError,
  type GameCommissionTier,
} from '../domain/rules/game-settlement';
import { ValidationError } from './validation-error';

/**
 * Entrées de l'administration de la détection (D-049). Tout est validé avant d'atteindre le
 * dépôt : valeurs de listes fermées, UUID, dates ISO, bornes de pagination. Un paramètre
 * inconnu ou répété est refusé (400).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LIST_KEYS = new Set([
  'page',
  'limit',
  'sort',
  'status',
  'level',
  'priority',
  'type',
  'subject',
  'playerId',
  'from',
  'to',
]);
const LEVELS: readonly string[] = RISK_LEVELS.map((l) => l.level);
const PRIORITIES: readonly string[] = ['NORMAL', 'PRIORITY'];

type Query = Record<string, unknown>;

function single(query: Query, key: string, fields: Record<string, string>): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    fields[key] = 'Valeur invalide.';
    return undefined;
  }
  return value;
}

function integer(
  raw: string | undefined,
  key: string,
  bounds: { min: number; max: number; fallback: number },
  fields: Record<string, string>,
): number {
  if (raw === undefined) return bounds.fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < bounds.min || value > bounds.max) {
    fields[key] = `Entier attendu entre ${bounds.min} et ${bounds.max}.`;
    return bounds.fallback;
  }
  return value;
}

function date(raw: string | undefined, key: string, fields: Record<string, string>) {
  if (raw === undefined) return undefined;
  const value = new Date(raw);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(value.getTime())) {
    fields[key] = 'Date ISO 8601 attendue.';
    return undefined;
  }
  return value;
}

/** Sujet canonique : 1 à 4 identifiants de joueurs, triés, sans doublon, joints par « | ». */
export function parseSubjectKey(value: unknown): string {
  const ids = typeof value === 'string' ? value.split('|') : [];
  const canonical = [...new Set(ids)].sort().join('|');
  if (
    ids.length < 1 ||
    ids.length > 4 ||
    !ids.every((id) => UUID.test(id)) ||
    canonical !== value
  ) {
    throw new ValidationError({
      subject: 'Sujet invalide (identifiants triés, séparés par « | »).',
    });
  }
  return value;
}

export function parseAlertId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new ValidationError({ alertId: "Identifiant d'alerte invalide." });
  }
  return value;
}

export function parsePagination(query: Query): { page: number; limit: number } {
  const fields: Record<string, string> = {};
  for (const key of Object.keys(query)) {
    if (key !== 'page' && key !== 'limit') fields[key] = 'Paramètre inconnu.';
  }
  const page = integer(
    single(query, 'page', fields),
    'page',
    {
      min: 1,
      max: ALERT_PAGE.maxPage,
      fallback: 1,
    },
    fields,
  );
  const limit = integer(
    single(query, 'limit', fields),
    'limit',
    {
      min: 1,
      max: ALERT_PAGE.maxLimit,
      fallback: ALERT_PAGE.defaultLimit,
    },
    fields,
  );
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return { page, limit };
}

export function parseAlertListQuery(query: Query): AlertListQuery {
  const fields: Record<string, string> = {};
  for (const key of Object.keys(query)) {
    if (!LIST_KEYS.has(key)) fields[key] = 'Paramètre inconnu.';
  }
  const page = integer(
    single(query, 'page', fields),
    'page',
    {
      min: 1,
      max: ALERT_PAGE.maxPage,
      fallback: 1,
    },
    fields,
  );
  const limit = integer(
    single(query, 'limit', fields),
    'limit',
    {
      min: 1,
      max: ALERT_PAGE.maxLimit,
      fallback: ALERT_PAGE.defaultLimit,
    },
    fields,
  );

  const sort = single(query, 'sort', fields) ?? 'created_at_desc';
  if (!(ALERT_SORTS as readonly string[]).includes(sort)) fields.sort = 'Tri non autorisé.';
  const status = single(query, 'status', fields);
  if (status !== undefined && !isAlertStatus(status)) fields.status = 'Statut inconnu.';
  const level = single(query, 'level', fields);
  if (level !== undefined && !LEVELS.includes(level)) fields.level = 'Niveau inconnu.';
  const priority = single(query, 'priority', fields);
  if (priority !== undefined && !PRIORITIES.includes(priority))
    fields.priority = 'Priorité inconnue.';
  const type = single(query, 'type', fields);
  if (type !== undefined && type !== ALERT_CONFIG.type) fields.type = "Type d'alerte inconnu.";
  const playerId = single(query, 'playerId', fields);
  if (playerId !== undefined && !UUID.test(playerId)) fields.playerId = 'Identifiant invalide.';
  let subjectKey = single(query, 'subject', fields);
  if (subjectKey !== undefined) {
    try {
      subjectKey = parseSubjectKey(subjectKey);
    } catch {
      fields.subject = 'Sujet invalide (identifiants triés, séparés par « | »).';
    }
  }
  const from = date(single(query, 'from', fields), 'from', fields);
  const to = date(single(query, 'to', fields), 'to', fields);
  if (from && to && from >= to) fields.to = 'La date de fin doit suivre la date de début.';

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return {
    page,
    limit,
    sort: sort as AlertSort,
    ...(status && { status: status as AlertStatus }),
    ...(level && { level: level as RiskLevel }),
    ...(priority && { priority: priority as AlertPriority }),
    ...(type && { type }),
    ...(subjectKey && { subjectKey }),
    ...(playerId && { playerId }),
    ...(from && { from }),
    ...(to && { to }),
  };
}

export function parseStatusChange(body: unknown): {
  status: AlertStatus;
  expectedStatus?: AlertStatus;
} {
  const source = (typeof body === 'object' && body !== null ? body : {}) as Query;
  const fields: Record<string, string> = {};
  const { status, expectedStatus } = source;
  if (!isAlertStatus(status))
    fields.status = 'Statut attendu : NEW, REVIEWED, DISMISSED ou RESOLVED.';
  if (expectedStatus !== undefined && !isAlertStatus(expectedStatus)) {
    fields.expectedStatus = 'Statut attendu : NEW, REVIEWED, DISMISSED ou RESOLVED.';
  }
  for (const key of Object.keys(source)) {
    if (key !== 'status' && key !== 'expectedStatus') fields[key] = 'Champ inconnu.';
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return {
    status: status as AlertStatus,
    ...(expectedStatus !== undefined && { expectedStatus: expectedStatus as AlertStatus }),
  };
}

/** Interrupteur global (D-053) : `{ enabled: boolean }`, rien d'autre. */
export function parseDetectionSettingChange(body: unknown): { enabled: boolean } {
  const source = (typeof body === 'object' && body !== null ? body : {}) as Query;
  const fields: Record<string, string> = {};
  if (typeof source.enabled !== 'boolean') fields.enabled = 'Booléen attendu : true ou false.';
  for (const key of Object.keys(source)) {
    if (key !== 'enabled') fields[key] = 'Champ inconnu.';
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return { enabled: source.enabled as boolean };
}

/**
 * Barème de commission des parties (D-074) : `{ tiers: [{ minStake, maxStake, percent }] }`,
 * tranches contiguës depuis 1, la dernière sans plafond (`maxStake: null`), taux de 0 à 100 % (D-080)
 * à 2 décimales au plus. Chaîne, null, NaN ou Infinity refusés : jamais convertis en 0.
 */
export function parseGameCommissionChange(body: unknown): { tiers: GameCommissionTier[] } {
  const source = (typeof body === 'object' && body !== null ? body : {}) as Query;
  const fields: Record<string, string> = {};
  const error = commissionScheduleError(source.tiers);
  if (error) fields.tiers = error;
  for (const key of Object.keys(source)) {
    if (key !== 'tiers') fields[key] = 'Champ inconnu.';
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return { tiers: source.tiers as GameCommissionTier[] };
}
