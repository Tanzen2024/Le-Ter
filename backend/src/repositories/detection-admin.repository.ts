import type { AlertListQuery } from '../domain/detection/alert-admin';
import type {
  AlertStatus,
  DetectionAlert,
  DetectionSignal,
  SuspicionScore,
} from '../domain/detection/detection';
import type { UserId } from '../domain/users/user';

/** Alerte vue par l'administration (avec sa dernière mise à jour). */
export type AdminAlert = DetectionAlert & { updatedAt: Date };

export interface Page<T> {
  total: number;
  items: T[];
}

/**
 * Lecture et gestion ADMINISTRATIVES de la détection (R-36, étape 5, D-049), sur les tables
 * de l'étape 4 : aucune donnée copiée, aucune table de détection parallèle. Requêtes
 * paramétrées ; le tri vient d'une liste blanche.
 */
export interface DetectionAdminRepository {
  listAlerts(query: AlertListQuery): Promise<Page<AdminAlert>>;

  findAlert(alertId: string): Promise<AdminAlert | null>;

  /** Instantané de score qui a produit l'alerte : (partie analysée, sujet). */
  scoreSnapshot(gameId: string, subjectKey: string): Promise<SuspicionScore | null>;

  /** Signaux d'un sujet créés dans [since, until] (ceux qu'a examinés un score). */
  subjectSignals(subjectKey: string, since: Date, until: Date): Promise<DetectionSignal[]>;

  /** Historique des scores d'un sujet, du plus récent au plus ancien. */
  scoreHistory(subjectKey: string, page: number, limit: number): Promise<Page<SuspicionScore>>;

  /**
   * Change le statut d'une alerte et journalise l'action, dans UNE transaction, sous
   * verrou de la ligne. Statut déjà égal à la cible : rien n'est écrit (`changed: false`).
   * Lève AlertNotFoundError, AlertStatusConflictError, AlertTransitionNotAllowedError.
   */
  changeAlertStatus(command: {
    alertId: string;
    to: AlertStatus;
    expectedStatus?: AlertStatus;
    actorId: UserId;
    auditId: string;
    now: Date;
  }): Promise<{ alert: AdminAlert; changed: boolean }>;
}
