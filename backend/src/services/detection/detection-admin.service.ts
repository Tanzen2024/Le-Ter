import { randomUUID } from 'node:crypto';

import {
  adminEvidenceOf,
  AlertNotFoundError,
  type AlertListQuery,
} from '../../domain/detection/alert-admin';
import {
  riskLevelOf,
  type AlertStatus,
  type SuspicionScore,
} from '../../domain/detection/detection';
import { ALERT_CONFIG, algorithmIdOf } from '../../domain/detection/detection-config';
import type { UserId } from '../../domain/users/user';
import type {
  AdminAlert,
  DetectionAdminRepository,
} from '../../repositories/detection-admin.repository';
import type { Logger } from '../../utils/logger';

const DAY_MS = 24 * 60 * 60 * 1000;
const scoreAlgorithm = (version: number) => `SUSPICION_SCORE_V${version}`;

/** Ligne de la liste : aucun élément justificatif. */
function summaryOf(alert: AdminAlert) {
  return {
    alertId: alert.id,
    type: alert.type,
    level: alert.level,
    priority: alert.priority,
    status: alert.status,
    subject: { key: alert.subjectKey, scope: alert.scope, playerIds: alert.playerIds },
    score: alert.score,
    algorithmVersion: alert.scoreAlgorithmVersion,
    scoreAlgorithm: scoreAlgorithm(alert.scoreAlgorithmVersion),
    gameId: alert.gameId,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
  };
}

/** Instantané de score lisible : ancien / nouveau score et niveau, signaux retenus. */
function scoreView(score: SuspicionScore) {
  return {
    gameId: score.gameId,
    computedAt: score.computedAt.toISOString(),
    previousScore: score.previousScore,
    previousLevel: score.previousScore === null ? null : riskLevelOf(score.previousScore),
    score: score.score,
    level: score.level,
    algorithmVersion: score.algorithmVersion,
    scoreAlgorithm: scoreAlgorithm(score.algorithmVersion),
    signalCount: score.signalCount,
    signalsSince: score.signalsSince?.toISOString() ?? null,
    contributions: score.components.map((c) => ({
      type: c.type,
      contribution: c.contribution,
      signalId: c.signalId ?? null,
      sourceGameId: c.sourceGameId ?? null,
      algorithm: algorithmIdOf(c.type, c.signalAlgorithmVersion),
    })),
  };
}

/**
 * Administration de la détection (R-36, étape 5, D-049) : CONSULTATION et STATUT des
 * alertes, rien d'autre. Aucune action sur le jeu, les comptes, les gains ou les résultats ;
 * aucune modification d'un score. Réservé au rôle `admin` (contrôlé par la route, à partir de
 * la session serveur). Les vues ne contiennent ni coordonnée, ni IP, ni carte, ni main.
 */
export class DetectionAdminService {
  private readonly clock: () => Date;

  constructor(
    private readonly deps: {
      repository: DetectionAdminRepository;
      logger: Logger;
      clock?: () => Date;
    },
  ) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async listAlerts(query: AlertListQuery) {
    const { total, items } = await this.deps.repository.listAlerts(query);
    return { page: query.page, limit: query.limit, total, items: items.map(summaryOf) };
  }

  async getAlert(alertId: string) {
    const alert = await this.requireAlert(alertId);
    const snapshot = await this.deps.repository.scoreSnapshot(alert.gameId, alert.subjectKey);
    return {
      ...summaryOf(alert),
      signalTypes: alert.signalTypes,
      period: {
        start: alert.periodStart.toISOString(),
        end: new Date(
          alert.periodStart.getTime() + ALERT_CONFIG.dedupWindowDays * DAY_MS,
        ).toISOString(),
      },
      scoreAtAnalysis: snapshot && scoreView(snapshot),
    };
  }

  /**
   * Signaux examinés par le score de l'alerte (période de validité de l'instantané), avec
   * leurs éléments justificatifs en représentation ADMINISTRATIVE minimisée.
   */
  async getAlertSignals(alertId: string) {
    const alert = await this.requireAlert(alertId);
    const snapshot = await this.deps.repository.scoreSnapshot(alert.gameId, alert.subjectKey);
    const until = snapshot?.computedAt ?? alert.createdAt;
    const since = snapshot?.signalsSince ?? alert.periodStart;
    const retained = new Set(snapshot?.components.map((c) => c.signalId) ?? []);
    const signals = await this.deps.repository.subjectSignals(alert.subjectKey, since, until);
    return {
      alertId: alert.id,
      subject: { key: alert.subjectKey, scope: alert.scope },
      period: { from: since.toISOString(), to: until.toISOString() },
      signals: signals.map((s) => ({
        signalId: s.id,
        type: s.type,
        algorithm: algorithmIdOf(s.type, s.algorithmVersion),
        severity: s.severity,
        contribution: s.contribution,
        retained: retained.has(s.id),
        gameId: s.gameId,
        playerIds: s.playerIds,
        createdAt: s.createdAt.toISOString(),
        evidence: adminEvidenceOf(s.evidence ?? {}),
      })),
    };
  }

  /** Historique du score d'un sujet, en lecture seule. */
  async scoreHistory(subjectKey: string, page: number, limit: number) {
    const { total, items } = await this.deps.repository.scoreHistory(subjectKey, page, limit);
    return { subjectKey, page, limit, total, items: items.map(scoreView) };
  }

  /**
   * Change le statut d'une alerte (machine d'état minimale, transaction, audit). Requête
   * répétée vers le statut déjà atteint : réponse identique, `changed: false`, aucun audit.
   */
  async changeStatus(
    alertId: string,
    command: { status: AlertStatus; expectedStatus?: AlertStatus },
    actorId: UserId,
  ) {
    const { alert, changed } = await this.deps.repository.changeAlertStatus({
      alertId,
      to: command.status,
      ...(command.expectedStatus && { expectedStatus: command.expectedStatus }),
      actorId,
      auditId: randomUUID(),
      now: this.clock(),
    });
    if (changed) {
      // Journal technique : identifiants et statuts seulement.
      this.deps.logger.info('detection alert status changed', {
        alertId,
        actorId,
        status: alert.status,
      });
    }
    return { alert: summaryOf(alert), changed };
  }

  private async requireAlert(alertId: string): Promise<AdminAlert> {
    const alert = await this.deps.repository.findAlert(alertId);
    if (!alert) throw new AlertNotFoundError(alertId);
    return alert;
  }
}
