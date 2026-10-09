import type { GameId, PlayerId } from '../game/game-id';
import {
  ALERT_CONFIG,
  MAX_SUSPICION_SCORE,
  RISK_LEVELS,
  SIGNAL_RULES,
  SIGNAL_SEVERITIES,
  SIGNAL_TYPES,
  type RiskLevel,
  type SignalSeverity,
  type SignalType,
} from './detection-config';

/**
 * Modèle du système de détection de potentielle collusion (R-36, D-044), fonctions PURES.
 *
 * Un SUJET est un joueur seul ou un groupe (une paire le plus souvent : la collusion se joue
 * à plusieurs). Sa clé est stable : identifiants triés, joints par « | ».
 */

/** Signal proposé par une analyse, avant enregistrement. */
export interface SignalDraft {
  type: SignalType;
  severity: SignalSeverity;
  /** Contribution au score (0 à MAX_SUSPICION_SCORE), traçable. */
  contribution: number;
  /** Joueurs de la partie concernés (1 ou plus). */
  playerIds: PlayerId[];
  /** Explication technique (JAMAIS de coordonnées GPS ni d'IP). Réservée à l'administration. */
  evidence?: Record<string, unknown>;
}

/** Signal enregistré, rattaché à UNE partie. */
export interface DetectionSignal extends SignalDraft {
  id: string;
  gameId: GameId;
  algorithmVersion: number;
  createdAt: Date;
}

/** Portée d'un sujet : joueur seul, paire, groupe (aucun signal de groupe aujourd'hui). */
export type SubjectScope = 'PLAYER' | 'PAIR' | 'GROUP';

export function scopeOf(playerIds: readonly PlayerId[]): SubjectScope {
  const count = new Set(playerIds).size;
  return count > 2 ? 'GROUP' : count === 2 ? 'PAIR' : 'PLAYER';
}

/** Signal pris en compte par un score : un par type au plus (explicabilité, D-048). */
export interface ScoreComponent {
  type: SignalType;
  /** Contribution retenue (plafonnée par type). */
  contribution: number;
  signalId?: string;
  /** Partie où le signal a été observé (source explicite de l'historique). */
  sourceGameId?: GameId;
  signalAlgorithmVersion?: number;
}

/**
 * Score de RISQUE d'un sujet, calculé lors de l'analyse d'UNE partie (`gameId`) à partir de
 * ses signaux valides. Indicateur statistique : jamais une preuve de triche.
 */
export interface SuspicionScore {
  gameId: GameId;
  subjectKey: string;
  playerIds: PlayerId[];
  scope: SubjectScope;
  score: number;
  level: RiskLevel;
  /** Dernier score du sujet calculé lors d'une AUTRE partie (null : premier calcul). */
  previousScore: number | null;
  /** Signaux valides examinés (dont ceux non retenus car un même type ne compte qu'une fois). */
  signalCount: number;
  components: ScoreComponent[];
  /** Début de la période de validité des signaux pris en compte. */
  signalsSince: Date | null;
  algorithmVersion: number;
  computedAt: Date;
}

/** Signal utilisable par le calcul (les champs d'enregistrement sont facultatifs en test). */
export type ScorableSignal = SignalDraft & {
  id?: string;
  gameId?: GameId;
  algorithmVersion?: number;
  createdAt?: Date;
};

/** Alerte INTERNE : « plusieurs signaux justifient une analyse ». Jamais une accusation. */
export type AlertStatus = 'NEW' | 'REVIEWED' | 'DISMISSED' | 'RESOLVED';
export type AlertPriority = 'NORMAL' | 'PRIORITY';

export interface DetectionAlert {
  id: string;
  /** Partie dont l'analyse a produit le score. */
  gameId: GameId;
  type: typeof ALERT_CONFIG.type;
  subjectKey: string;
  playerIds: PlayerId[];
  scope: SubjectScope;
  level: RiskLevel;
  priority: AlertPriority;
  score: number;
  scoreAlgorithmVersion: number;
  /** Types de signaux qui composent le score (aucun élément justificatif recopié). */
  signalTypes: SignalType[];
  /** Début de la période de déduplication. */
  periodStart: Date;
  dedupeKey: string;
  status: AlertStatus;
  createdAt: Date;
}

/** Signal refusé (type inconnu ou désactivé, contribution hors bornes, joueurs invalides). */
export class InvalidSignalError extends Error {
  constructor(reason: string) {
    super(`Signal de détection invalide : ${reason}`);
    this.name = 'InvalidSignalError';
  }
}

/** Le signal référence un joueur qui n'appartient pas à la partie (isolation par partie). */
export class SignalOutsideGameError extends Error {
  constructor(readonly gameId: GameId) {
    super(`Signal de détection hors de la partie ${gameId}`);
    this.name = 'SignalOutsideGameError';
  }
}

/**
 * Identité d'un signal dans une partie : type, joueurs (dans l'ordre donné par l'analyse,
 * qui le rend déterministe) et version d'algorithme. Base de l'idempotence.
 */
export function signalKeyOf(
  signal: Pick<DetectionSignal, 'type' | 'playerIds' | 'algorithmVersion'>,
): string {
  return `${signal.type}|${signal.playerIds.join(',')}|${signal.algorithmVersion}`;
}

/** Plafonne un score entre 0 et MAX_SUSPICION_SCORE (entier). */
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.min(MAX_SUSPICION_SCORE, Math.max(0, score)));
}

/** Niveau de risque d'un score, d'après les bornes de la configuration. */
export function riskLevelOf(score: number): RiskLevel {
  const value = clampScore(score);
  let level: RiskLevel = RISK_LEVELS[0].level;
  for (const step of RISK_LEVELS) {
    if (value >= step.min) level = step.level;
  }
  return level;
}

/** Clé stable d'un sujet (joueur ou groupe), indépendante de l'ordre. */
export function subjectKeyOf(playerIds: readonly PlayerId[]): string {
  return [...new Set(playerIds)].sort().join('|');
}

/** Valide un signal proposé ; lève InvalidSignalError. */
export function assertValidSignal(draft: SignalDraft): void {
  if (!(SIGNAL_TYPES as readonly string[]).includes(draft.type)) {
    throw new InvalidSignalError(`type inconnu « ${String(draft.type)} »`);
  }
  if (!SIGNAL_RULES[draft.type].enabled) {
    throw new InvalidSignalError(`type désactivé « ${draft.type} »`);
  }
  if (!(SIGNAL_SEVERITIES as readonly string[]).includes(draft.severity)) {
    throw new InvalidSignalError(`gravité inconnue « ${String(draft.severity)} »`);
  }
  if (
    typeof draft.contribution !== 'number' ||
    !Number.isFinite(draft.contribution) ||
    draft.contribution < 0 ||
    draft.contribution > MAX_SUSPICION_SCORE
  ) {
    throw new InvalidSignalError('contribution hors bornes');
  }
  if (!Array.isArray(draft.playerIds) || draft.playerIds.length === 0) {
    throw new InvalidSignalError('aucun joueur concerné');
  }
  if (new Set(draft.playerIds).size !== draft.playerIds.length) {
    throw new InvalidSignalError('joueur en double');
  }
}

/**
 * Score V2 d'UN sujet (D-048), déterministe et explicable :
 * 1. chaque signal compte au plus une fois (identité unique en base) ;
 * 2. par type, seule la PLUS FORTE contribution est retenue (un même constat répété dans
 *    plusieurs parties n'est pas compté plusieurs fois), plafonnée par `SIGNAL_RULES` ;
 * 3. score = somme des contributions retenues, plafonnée à 100 (entier).
 * Départage à contribution égale : signal le plus récent, puis identifiant.
 */
export function aggregateSubjectScore(
  gameId: GameId,
  signals: readonly ScorableSignal[],
  options: {
    algorithmVersion: number;
    computedAt: Date;
    previousScore?: number | null;
    signalsSince?: Date | null;
  },
): SuspicionScore {
  const playerIds = [...new Set(signals.flatMap((s) => s.playerIds))].sort();
  const best = new Map<SignalType, ScorableSignal>();
  for (const signal of signals) {
    const current = best.get(signal.type);
    const newer =
      current &&
      signal.contribution === current.contribution &&
      ((signal.createdAt?.getTime() ?? 0) > (current.createdAt?.getTime() ?? 0) ||
        ((signal.createdAt?.getTime() ?? 0) === (current.createdAt?.getTime() ?? 0) &&
          (signal.id ?? '') > (current.id ?? '')));
    if (!current || signal.contribution > current.contribution || newer) {
      best.set(signal.type, signal);
    }
  }
  const components: ScoreComponent[] = [...best.values()]
    .sort((a, b) => a.type.localeCompare(b.type))
    .map((s) => ({
      type: s.type,
      contribution: Math.min(s.contribution, SIGNAL_RULES[s.type].maxContribution),
      ...(s.id && { signalId: s.id }),
      ...(s.gameId && { sourceGameId: s.gameId }),
      ...(s.algorithmVersion && { signalAlgorithmVersion: s.algorithmVersion }),
    }));
  const score = clampScore(components.reduce((sum, c) => sum + c.contribution, 0));
  return {
    gameId,
    subjectKey: subjectKeyOf(playerIds),
    playerIds,
    scope: scopeOf(playerIds),
    score,
    level: riskLevelOf(score),
    previousScore: options.previousScore ?? null,
    signalCount: signals.length,
    components,
    signalsSince: options.signalsSince ?? null,
    algorithmVersion: options.algorithmVersion,
    computedAt: options.computedAt,
  };
}

/** Scores de chaque sujet présent dans ces signaux (un sujet = joueurs triés, sans doublon). */
export function computeScores(
  gameId: GameId,
  signals: readonly ScorableSignal[],
  algorithmVersion: number,
  computedAt: Date,
): SuspicionScore[] {
  const bySubject = new Map<string, ScorableSignal[]>();
  for (const signal of signals) {
    const key = subjectKeyOf(signal.playerIds);
    bySubject.set(key, [...(bySubject.get(key) ?? []), signal]);
  }
  return [...bySubject.values()].map((subjectSignals) =>
    aggregateSubjectScore(gameId, subjectSignals, { algorithmVersion, computedAt }),
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Alerte interne qu'appelle un score, ou `null` (D-048) : seulement aux niveaux configurés
 * (HIGH, VERY_HIGH) ET avec plusieurs types de signaux distincts — un signal isolé n'est
 * jamais une alerte. Clé de déduplication : type, sujet, niveau, version, période.
 */
export function alertFor(
  score: SuspicionScore,
  id: string,
): Omit<DetectionAlert, 'status' | 'createdAt'> | null {
  const priority = ALERT_CONFIG.levels[score.level];
  const signalTypes = score.components.filter((c) => c.contribution > 0).map((c) => c.type);
  if (!priority || signalTypes.length < ALERT_CONFIG.minDistinctSignalTypes) return null;
  const windowMs = ALERT_CONFIG.dedupWindowDays * DAY_MS;
  const periodStart = new Date(Math.floor(score.computedAt.getTime() / windowMs) * windowMs);
  return {
    id,
    gameId: score.gameId,
    type: ALERT_CONFIG.type,
    subjectKey: score.subjectKey,
    playerIds: score.playerIds,
    scope: score.scope,
    level: score.level,
    priority,
    score: score.score,
    scoreAlgorithmVersion: score.algorithmVersion,
    signalTypes,
    periodStart,
    dedupeKey: [
      ALERT_CONFIG.type,
      score.subjectKey,
      score.level,
      `v${score.algorithmVersion}`,
      periodStart.toISOString().slice(0, 10),
    ].join('|'),
  };
}
