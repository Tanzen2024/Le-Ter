import type { AlertPriority, AlertStatus } from './detection';
import type { RiskLevel, SignalType } from './detection-config';

/**
 * Administration des alertes de détection (R-36, étape 5, D-049) : règles PURES.
 *
 * Une alerte n'est jamais une accusation ; changer son statut ne déclenche AUCUNE action sur
 * le jeu, les comptes, les gains ou les résultats.
 */

export const ALERT_STATUSES: readonly AlertStatus[] = ['NEW', 'REVIEWED', 'DISMISSED', 'RESOLVED'];

/**
 * Machine d'état MINIMALE (PROVISOIRE) : NEW → REVIEWED → RESOLVED, et NEW → DISMISSED.
 * Aucune réouverture : DISMISSED et RESOLVED sont finaux. Depuis un statut donné, chaque
 * statut cible a au plus une origine : une demande périmée est refusée, jamais appliquée
 * par-dessus le travail d'un autre administrateur.
 */
export const ALERT_TRANSITIONS: Readonly<Record<AlertStatus, readonly AlertStatus[]>> = {
  NEW: ['REVIEWED', 'DISMISSED'],
  REVIEWED: ['RESOLVED'],
  DISMISSED: [],
  RESOLVED: [],
};

export function isAlertStatus(value: unknown): value is AlertStatus {
  return (ALERT_STATUSES as readonly unknown[]).includes(value);
}

export function canTransition(from: AlertStatus, to: AlertStatus): boolean {
  return ALERT_TRANSITIONS[from].includes(to);
}

/** Tris autorisés (liste blanche) : la clé reçue choisit un fragment SQL constant. */
export const ALERT_SORTS = [
  'created_at_desc',
  'created_at_asc',
  'score_desc',
  'score_asc',
  'priority',
  'level',
] as const;
export type AlertSort = (typeof ALERT_SORTS)[number];

export const ALERT_PAGE = { defaultLimit: 20, maxLimit: 100, maxPage: 10_000 } as const;

export interface AlertListQuery {
  page: number;
  limit: number;
  sort: AlertSort;
  status?: AlertStatus;
  level?: RiskLevel;
  priority?: AlertPriority;
  type?: string;
  subjectKey?: string;
  playerId?: string;
  from?: Date;
  to?: Date;
}

export class AlertNotFoundError extends Error {
  constructor(readonly alertId: string) {
    super(`Alerte introuvable : ${alertId}`);
    this.name = 'AlertNotFoundError';
  }
}

/** Transition non prévue par la machine d'état. */
export class AlertTransitionNotAllowedError extends Error {
  constructor(
    readonly from: AlertStatus,
    readonly to: AlertStatus,
  ) {
    super(`Transition d'alerte refusée : ${from} → ${to}`);
    this.name = 'AlertTransitionNotAllowedError';
  }
}

/** Le statut a changé depuis la lecture de l'administrateur (`expectedStatus`). */
export class AlertStatusConflictError extends Error {
  constructor(
    readonly expected: AlertStatus,
    readonly current: AlertStatus,
  ) {
    super(`Statut d'alerte modifié entre-temps : attendu ${expected}, actuel ${current}`);
    this.name = 'AlertStatusConflictError';
  }
}

/** Clés jamais recopiées vers l'administration, même si elles apparaissaient en base. */
const SENSITIVE_KEY =
  /^(lat|lng|lon|latitude|longitude|accuracy|accuracy_?m(eters)?|coords?|coordinates|ip|ip_?address|address|hands?|cards?|card_?id|revealed_?hands|content|message|token|password|secret|authorization)$/i;
/** Valeurs masquées : adresse IPv4/IPv6, identifiant de carte. */
const SENSITIVE_VALUE =
  /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}|(COEUR|PIQUE|TREFLE|ETOILE)-\d+)$/i;

/**
 * Représentation ADMINISTRATIVE minimisée des éléments justificatifs d'un signal :
 * compteurs, taux, durées, distances, période. Défense en profondeur : les analyses
 * n'enregistrent déjà ni coordonnée, ni IP, ni carte ; toute clé ou valeur de ce genre est
 * retirée ou masquée ici.
 */
export function adminEvidenceOf(evidence: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (Array.isArray(evidence)) {
    return evidence.map((v) => adminEvidenceOf(v, depth + 1)).filter((v) => v !== undefined);
  }
  if (evidence && typeof evidence === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(evidence)) {
      if (SENSITIVE_KEY.test(key)) continue;
      const kept = adminEvidenceOf(value, depth + 1);
      if (kept !== undefined) out[key] = kept;
    }
    return out;
  }
  if (typeof evidence === 'string') return SENSITIVE_VALUE.test(evidence) ? '[masqué]' : evidence;
  if (typeof evidence === 'number' || typeof evidence === 'boolean' || evidence === null) {
    return evidence;
  }
  return undefined;
}

/** Résumé d'un signal retenu par un score (sans élément justificatif). */
export interface ContributionSummary {
  type: SignalType;
  contribution: number;
  signalId?: string;
  sourceGameId?: string;
  signalAlgorithmVersion?: number;
}
