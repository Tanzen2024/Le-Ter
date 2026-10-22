import type { UserId } from '../users/user';

/**
 * Administration de la plateforme (D-061). Le rôle `admin` est le seul rôle
 * d'administration (`SUPER_ADMIN` dans l'interface). Toute requête /api/admin/* exige en
 * plus une session d'administration dédiée, bornée côté serveur.
 */
export const ADMIN_SESSION_POLICY = {
  /** Durée absolue d'une session d'administration : jamais repoussée. */
  absoluteLifetimeSeconds: 8 * 3600,
  /** Expiration après 30 minutes sans requête d'administration. */
  idleTimeoutSeconds: 30 * 60,
  /** Écart minimal entre deux écritures de `last_activity_at` (limite les écritures). */
  activityWriteIntervalSeconds: 15,
} as const;

/** Connexion d'administration : tentatives par compte (IP + email) et par IP. */
export const ADMIN_LOGIN_LIMITS = {
  /** Même IP, même email : force brute ciblée. */
  perAccount: { windowMs: 15 * 60 * 1000, max: 5 },
  /** Même email, toutes IP confondues : force brute distribuée. */
  perEmail: { windowMs: 15 * 60 * 1000, max: 20 },
  perIp: { windowMs: 15 * 60 * 1000, max: 30 },
};
export type AdminLoginLimits = typeof ADMIN_LOGIN_LIMITS;

export type AdminSessionEndReason = 'LOGOUT' | 'IDLE_TIMEOUT' | 'ABSOLUTE_TIMEOUT' | 'REPLACED';

export interface AdminSession {
  sessionId: string;
  userId: UserId;
  startedAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  endReason: AdminSessionEndReason | null;
}

/** Actions du journal d'audit (liste fermée, identique au CHECK de la migration 0023). */
export const AUDIT_ACTIONS = [
  'ALERT_STATUS_CHANGED',
  'DETECTION_ENABLED',
  'DETECTION_DISABLED',
  'TOURNAMENT_CREATED',
  'TOURNAMENT_UPDATED',
  'TOURNAMENT_APPROVED',
  'TOURNAMENT_REJECTED',
  'TOURNAMENT_CANCELLED',
  'TOURNAMENT_SETTINGS_UPDATED',
  'ADMIN_LOGIN_SUCCEEDED',
  'ADMIN_LOGIN_FAILED',
  'ADMIN_LOGOUT',
  'ADMIN_SESSION_EXPIRED',
  'USER_VIEWED',
  'PAYMENT_VIEWED',
  'PAYMENT_VERIFICATION_REQUESTED',
  'REPORT_EXPORTED',
  // Barème de commission des parties (D-074, migrations 0029 et 0030).
  'GAME_COMMISSION_UPDATED',
  // Retraits Mobile Money (D-075, migration 0031).
  'WITHDRAWAL_LIMIT_UPDATED',
  'WITHDRAWAL_VIEWED',
  'WITHDRAWAL_VERIFICATION_REQUESTED',
  // Rapprochement des retraits bloqués (D-076, migration 0032).
  'WITHDRAWAL_ESCALATED',
  'WITHDRAWAL_REFUND_PROPOSED',
  'WITHDRAWAL_REFUND_APPROVED',
  'WITHDRAWAL_REFUND_REJECTED',
  // Retraits des revenus de la plateforme (D-078, migration 0033).
  'PAYOUT_BENEFICIARY_CREATED',
  'PAYOUT_BENEFICIARY_VERIFIED',
  'PAYOUT_BENEFICIARY_DISABLED',
  'TREASURY_OBSERVED',
  'PLATFORM_PAYOUT_CREATED',
  'PLATFORM_PAYOUT_APPROVED',
  'PLATFORM_PAYOUT_REJECTED',
  'PLATFORM_PAYOUT_CANCELLED',
  'PLATFORM_PAYOUT_RELEASED',
  'PLATFORM_PAYOUT_VIEWED',
  'PLATFORM_PAYOUT_RECONCILED',
  // Gestion des joueurs (D-079, migration 0034).
  'USER_DISABLED',
  'USER_ENABLED',
  'USER_SUSPENDED',
  'USER_SUSPENSION_LIFTED',
  'USER_SESSIONS_REVOKED',
  'USER_WARNED',
  'USER_CHAT_RESTRICTED',
  'USER_CHAT_RESTRICTION_LIFTED',
  'USER_NOTE_ADDED',
  'USER_NOTE_DELETED',
  // Réclamations (D-114).
  'COMPLAINT_VIEWED',
  'COMPLAINT_ATTACHMENT_VIEWED',
  'COMPLAINT_REPLIED',
  'COMPLAINT_NOTE_ADDED',
  'COMPLAINT_INFO_REQUESTED',
  'COMPLAINT_ASSIGNED',
  'COMPLAINT_STATUS_CHANGED',
  'COMPLAINT_PRIORITY_CHANGED',
  // Récupération d'un compte joueur par l'assistance (D-135, migration 0054).
  'PLAYER_ACCOUNT_RECOVERY',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_TARGET_TYPES = [
  'DETECTION_ALERT',
  'SYSTEM_SETTING',
  'TOURNAMENT',
  'ADMIN_ACCOUNT',
  'ADMIN_SESSION',
  'USER',
  'PAYMENT',
  'REPORT',
  'WITHDRAWAL',
  'PLATFORM_PAYOUT',
  'PAYOUT_BENEFICIARY',
  'TREASURY',
  'COMPLAINT',
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export type AuditOutcome = 'SUCCESS' | 'FAILURE';

/**
 * Entrée du journal. `details` ne contient JAMAIS de mot de passe, jeton, IP, email, numéro
 * de téléphone ni donnée de paiement sensible : identifiants, statuts et motifs seulement.
 */
export interface AuditEntry {
  id: string;
  actorId: UserId | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  outcome: AuditOutcome;
  details: Record<string, unknown>;
  createdAt: Date;
}

/** Pas de session d'administration pour ce jeton (connexion mobile, session terminée). */
export class AdminSessionRequiredError extends Error {
  constructor(readonly reason: string) {
    super("Session d'administration requise.");
    this.name = 'AdminSessionRequiredError';
  }
}

/** Session d'administration expirée (durée absolue ou inactivité). */
export class AdminSessionExpiredError extends Error {
  constructor(readonly reason: 'IDLE_TIMEOUT' | 'ABSOLUTE_TIMEOUT') {
    super("Session d'administration expirée.");
    this.name = 'AdminSessionExpiredError';
  }
}

/** Ressource administrative introuvable (joueur, partie, paiement…). */
export class AdminResourceNotFoundError extends Error {
  constructor(readonly resource: 'USER' | 'GAME' | 'PAYMENT') {
    super(`${resource} introuvable`);
    this.name = 'AdminResourceNotFoundError';
  }
}

/** Revérification impossible : CinetPay non configuré. */
export class PaymentProviderUnavailableError extends Error {
  constructor() {
    super('Fournisseur de paiement non configuré');
    this.name = 'PaymentProviderUnavailableError';
  }
}

/** `Idempotency-Key` réutilisée pour un autre paiement. */
export class AdminIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency-Key déjà utilisée pour une autre opération');
    this.name = 'AdminIdempotencyConflictError';
  }
}

/** Seuils d'AFFICHAGE (pas des règles métier) des anomalies et alertes. */
export const ADMIN_THRESHOLDS = {
  /** Paiement en attente « ancien ». */
  stalePendingPaymentMinutes: 30,
  /** Partie en attente de joueurs depuis longtemps. */
  staleWaitingGameHours: 24,
  /** Partie en cours depuis longtemps (5 plis × 10 s : quelques minutes en temps normal). */
  longRunningGameMinutes: 60,
  /** Échéance de tour dépassée sans traitement (minuteur bloqué ?). */
  overdueTurnSeconds: 60,
} as const;

/** Fuseau d'affichage et de regroupement par jour (valeur par défaut des tournois). */
export const ADMIN_TIMEZONE = 'Africa/Douala';
