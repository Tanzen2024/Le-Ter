/**
 * Contrats des API d'administration (miroir des réponses du backend, D-061). Pas de code
 * partagé avec `backend/` (AGENTS.md : pas de dossier `shared/` sans décision).
 * Dates : instants ISO 8601 (UTC). Montants : entiers en XAF (1 FCFA = 1 jeton).
 */

export interface Paged<T> {
  page: number;
  limit: number;
  total: number;
  items: T[];
}

// --- Session ---------------------------------------------------------------------------------

export interface AdminUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  phone: string;
  phoneVerified: boolean;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface AdminSessionInfo {
  startedAt: string;
  expiresAt: string;
  lastActivityAt: string;
  idleExpiresAt: string;
  absoluteLifetimeSeconds: number;
  idleTimeoutSeconds: number;
}

export interface SessionResponse {
  user: AdminUser;
  displayRole: 'SUPER_ADMIN';
  session: AdminSessionInfo;
}

// --- Journal d'audit -------------------------------------------------------------------------

export type AuditAction =
  | 'ALERT_STATUS_CHANGED'
  | 'DETECTION_ENABLED'
  | 'DETECTION_DISABLED'
  | 'TOURNAMENT_CREATED'
  | 'TOURNAMENT_UPDATED'
  | 'TOURNAMENT_APPROVED'
  | 'TOURNAMENT_REJECTED'
  | 'TOURNAMENT_CANCELLED'
  | 'TOURNAMENT_SETTINGS_UPDATED'
  | 'ADMIN_LOGIN_SUCCEEDED'
  | 'ADMIN_LOGIN_FAILED'
  | 'ADMIN_LOGOUT'
  | 'ADMIN_SESSION_EXPIRED'
  | 'USER_VIEWED'
  | 'PAYMENT_VIEWED'
  | 'PAYMENT_VERIFICATION_REQUESTED'
  | 'REPORT_EXPORTED'
  | 'GAME_COMMISSION_UPDATED'
  | 'WITHDRAWAL_LIMIT_UPDATED'
  | 'WITHDRAWAL_VIEWED'
  | 'WITHDRAWAL_VERIFICATION_REQUESTED'
  | 'WITHDRAWAL_ESCALATED'
  | 'WITHDRAWAL_REFUND_PROPOSED'
  | 'WITHDRAWAL_REFUND_APPROVED'
  | 'WITHDRAWAL_REFUND_REJECTED'
  | 'USER_DISABLED'
  | 'USER_ENABLED'
  | 'USER_SUSPENDED'
  | 'USER_SUSPENSION_LIFTED'
  | 'USER_SESSIONS_REVOKED'
  | 'USER_WARNED'
  | 'USER_CHAT_RESTRICTED'
  | 'USER_CHAT_RESTRICTION_LIFTED'
  | 'USER_NOTE_ADDED'
  | 'USER_NOTE_DELETED';

export type AuditTargetType =
  | 'DETECTION_ALERT'
  | 'SYSTEM_SETTING'
  | 'TOURNAMENT'
  | 'ADMIN_ACCOUNT'
  | 'ADMIN_SESSION'
  | 'USER'
  | 'PAYMENT'
  | 'REPORT'
  | 'WITHDRAWAL';

export interface AuditEvent {
  id: string;
  action: AuditAction;
  outcome: 'SUCCESS' | 'FAILURE';
  actor: { id: string; username: string | null } | null;
  target: { type: AuditTargetType; id: string | null };
  details: Record<string, unknown>;
  createdAt: string;
}

// --- Tableau de bord -------------------------------------------------------------------------

export interface StatusAmount {
  status: string;
  count: number;
  amount: number;
}

export interface DailyPoint {
  day: string;
  newPlayers: number;
  activePlayers: number;
  gamesStarted: number;
  paymentsSucceeded: number;
  paymentsAmount: number;
  platformRevenue: number;
}

export interface Dashboard {
  period: { from: string; to: string; timezone: string };
  generatedAt: string;
  definitions: { activePlayer: string; platformRevenue: string; commissions?: string };
  players: { total: number; newInPeriod: number; active: number; admins: number };
  games: {
    waiting: number;
    inProgress: number;
    createdInPeriod: number;
    finishedInPeriod: number;
    byStatusInPeriod: { status: string; count: number }[];
  };
  tournaments: { status: TournamentStatus; count: number }[];
  payments: StatusAmount[];
  platformRevenue: number;
  /** Recettes de la période par origine (D-120) ; `source` : filtre appliqué. */
  commissions: { source?: LedgerSource; total: number; entries: number; bySource: SourceAmount[] };
  /** Solde comptable de la caisse UNIQUE (tout l'historique, indépendant de la période). */
  platformAccountBalance: number;
  alerts: AttentionCounts;
  reconciliationAnomalies: AnomalySummary;
  series: DailyPoint[];
  recentAdminActivity: AuditEvent[];
}

/** Points d'attention (cloche, bloc « Alertes »), calculés par le serveur. */
export interface AttentionCounts {
  newDetectionAlerts: number;
  pendingTournamentApprovals: number;
  stalePendingPayments: number;
  overdueTurns: number;
}

/** `GET /api/admin/attention` (D-116) : points d'attention seuls, relus automatiquement. */
export interface Attention {
  generatedAt: string;
  alerts: AttentionCounts;
  reconciliationAnomalies: AnomalySummary;
}

// --- Joueurs ---------------------------------------------------------------------------------

export interface PlayerRow {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  /** Facultatif pour un joueur (D-135). */
  email: string | null;
  phone: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  createdAt: string;
  balance: number;
  reserved: number;
  gamesPlayed: number;
  lastGameAt: string | null;
  /** Suspension en cours (D-079) ; `endsAt` null : indéterminée. */
  suspension: { endsAt: string | null } | null;
  /** Restriction du chat en cours (D-079). */
  chatRestriction: { endsAt: string | null } | null;
}

export interface PlayerDetail extends PlayerRow {
  phoneVerified: boolean;
  updatedAt: string;
  /** Victoires par jeu, jamais additionnées entre Fap-Fap et Garam Tia (D-126). */
  gamesWon: { fapFap: number; garamTia: number };
  activeGameId: string | null;
  activeSessionId: string | null;
  tournamentRegistrations: number;
  payments: { total: number; succeeded: number; succeededAmount: number; pending: number };
}

// --- Gestion des joueurs (D-079) -------------------------------------------------------------

export type SanctionKind = 'SUSPENSION' | 'CHAT_RESTRICTION' | 'WARNING';
export type SanctionState = 'ACTIVE' | 'EXPIRED' | 'LIFTED' | 'RECORDED';

export interface Sanction {
  id: string;
  kind: SanctionKind;
  state: SanctionState;
  reason: string;
  comment: string | null;
  playerMessage: string | null;
  /** Avertissement : notification enregistrée dans l'application du joueur ; sinon null. */
  delivered: boolean | null;
  startsAt: string;
  endsAt: string | null;
  createdBy: { id: string; username: string | null };
  createdAt: string;
  lifted: { at: string; by: { id: string; username: string | null }; reason: string } | null;
}

export interface AdminNote {
  id: string;
  /** null : note supprimée (le texte n'est plus renvoyé). */
  body: string | null;
  author: { id: string; username: string | null };
  createdAt: string;
  deleted: { at: string; by: { id: string; username: string | null }; reason: string } | null;
}

export interface ModerationLimits {
  reason: { min: number; max: number };
  comment: { max: number };
  playerMessage: { max: number };
  note: { max: number };
  maxDurationDays: number;
  minDurationMinutes: number;
}

export interface PlayerModeration {
  serverTime: string;
  suspension: Sanction | null;
  chatRestriction: Sanction | null;
  security: {
    lastLoginAt: string | null;
    lastSessionActivityAt: string | null;
    activeSessions: number;
  };
  /** Fiche de l'administrateur connecté : actions qui retirent l'accès interdites. */
  isSelf: boolean;
  limits: ModerationLimits;
}

// --- Parties ---------------------------------------------------------------------------------

export type GameStatus = 'waiting' | 'in_progress' | 'finished';
export type GameAnomaly = 'STALE_WAITING' | 'LONG_RUNNING' | 'OVERDUE_TURN';

export interface GameRow {
  id: string;
  /** Jeu de la partie (D-126) : 'TER' (Fap-Fap) ou 'GARAM' (Garam Tia). */
  gameType: 'TER' | 'GARAM';
  /** GARAM TIA : variante 15, 16, 17 ou 18 (D-127) ; null pour Fap-Fap. */
  garamVariant?: number | null;
  status: GameStatus;
  sessionId: string;
  tournament: { id: string; name: string | null } | null;
  maxPlayers: number;
  stakeAmount: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  /** Échéance de tour dépassée (TURN_TIMEOUT), coup automatique en attente. */
  turnTimedOutAt: string | null;
  endReason: string | null;
  winner: { id: string; username: string | null } | null;
  replayOfGameId: string | null;
  /** Partie qui rejoue celle-ci après une égalité de priorité. */
  replayedByGameId: string | null;
  players: {
    playerId: string;
    username: string;
    seat: number;
    joinedAt: string;
    fledAt: string | null;
  }[];
  anomalies: GameAnomaly[];
}

export interface GameDetail extends GameRow {
  session: {
    id: string;
    status: string;
    name: string | null;
    maxPlayers: number | null;
    creatorUsername: string | null;
    suspicionDetectionEnabled: boolean;
    gamesCount: number;
  };
  creatorUsername: string | null;
  firstPlayerUsername: string | null;
  chatMessages: number;
  detectionAlerts: number;
  privacy: string;
}

// --- Finances --------------------------------------------------------------------------------

export type WalletKind =
  | 'deposit'
  | 'withdrawal'
  | 'tournament_entry'
  | 'tournament_prize'
  | 'game_stake'
  | 'game_winnings';
export type WalletStatus = 'pending' | 'succeeded' | 'failed';
export type ReservationStatus = 'ACTIVE' | 'CAPTURED' | 'RELEASED' | 'EXPIRED';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

export interface WalletTransaction {
  id: string;
  userId: string;
  username: string;
  kind: WalletKind;
  status: WalletStatus;
  tokens: number;
  failureCode: string | null;
  providerReference: string | null;
  createdAt: string;
  completedAt: string | null;
  paymentId: string | null;
  tournamentId: string | null;
}

export interface PaymentRow {
  id: string;
  userId: string;
  username: string;
  merchantTransactionId: string;
  providerReference: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  providerStatus: string | null;
  paymentMethod: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  walletTransaction: { id: string; status: WalletStatus; tokens: number };
}

export interface PaymentDetail extends PaymentRow {
  initializationFailure: string | null;
  settlementAnomaly: string | null;
  verification: { available: boolean; providerConfigured: boolean; history: AuditEvent[] };
}

export interface VerificationResult {
  replayed: boolean;
  outcome: 'settled' | 'already_processed' | 'pending' | 'already_final' | 'error';
  status?: PaymentStatus;
  reason?: string;
}

export interface UnsupportedOperation {
  operation: string;
  label: string;
  reason: string;
}

export interface FinanceOverview {
  period: { from: string; to: string };
  currency: 'XAF';
  purchases: { label: string; byStatus: StatusAmount[] };
  /** `withoutPayment` : achat (`deposit`) sans paiement CinetPay rattaché ; `false` sinon. */
  walletMovements: {
    kind: WalletKind;
    status: WalletStatus;
    withoutPayment: boolean;
    count: number;
    tokens: number;
  }[];
  /** Réservations de tournoi créées sur la période : jamais des débits. */
  reservations: { status: ReservationStatus; count: number; amount: number }[];
  playerBalances: { label: string; wallets: number; balance: number; reserved: number };
  platformRevenue: {
    label: string;
    byKind: { kind: string; count: number; amount: number }[];
    total: number;
  };
  platformAccountBalance: number;
  unsupported: UnsupportedOperation[];
}

// --- Rapprochement et compte plateforme ------------------------------------------------------

export interface Anomaly {
  type: string;
  severity: 'CRITICAL' | 'WARNING';
  domain: 'PAYMENT' | 'TOURNAMENT';
  reference: { kind: 'PAYMENT' | 'WALLET_TRANSACTION' | 'TOURNAMENT'; id: string; label: string };
  date: string;
  amount: number | null;
  currency: 'XAF';
  compared: { label: string; expected: string | number | null; actual: string | number | null }[];
  explanation: string;
  state: 'OPEN';
}

export interface AnomalySummary {
  total: number;
  critical: number;
  warning: number;
  byType: Record<string, number>;
}

export interface Reconciliation {
  generatedAt: string;
  summary: AnomalySummary;
  checked: { tournaments: number; paymentCandidates: number; limitPerControl: number };
  thresholds: { stalePendingPaymentMinutes: number };
  guaranteedByDatabase: readonly { control: string; guarantee: string }[];
  items: Anomaly[];
}

export interface PlatformAccount {
  name: string;
  technicalId: string;
  nature: string;
  currency: 'XAF';
  computedBalance: { amount: number; label: string };
  byKind: { kind: string; count: number; amount: number; description: string }[];
  /** Mêmes écritures par origine (D-120) : leur somme est le solde calculé. */
  bySource: SourceAmount[];
  entries: number;
  firstEntryAt: string | null;
  lastEntryAt: string | null;
  treasury: { integrated: boolean; label: string };
  outgoing: { supported: boolean; label: string };
  ordinaryGamesCommission: { defined: boolean; label: string };
  reconciliation: { tournamentAnomalies: number; status: 'BALANCED' | 'ANOMALIES' };
}

/** Origine d'une recette de la caisse unique (D-120). */
export type LedgerSource = 'FAP_FAP' | 'TOURNAMENT' | 'GARAM_TIA';

/** Recettes par source sur une période (les trois sources, montants à 0 compris). */
export interface SourceAmount {
  source: LedgerSource;
  count: number;
  amount: number;
}

export interface LedgerEntry {
  id: string;
  kind: 'TOURNAMENT_PLATFORM_FEE' | 'UNALLOCATED_PRIZE' | 'GAME_COMMISSION';
  source: LedgerSource;
  amount: number;
  currency: string;
  feeBps: number | null;
  createdAt: string;
  /** Tournoi (commission, part non attribuée) ou partie ordinaire (commission, D-074). */
  origin: { type: 'TOURNAMENT' | 'GAME'; id: string; name: string; sessionId?: string | null };
  participants: number | null;
  grossPool: number | null;
}

// --- Rapports et système ---------------------------------------------------------------------

export type ReportName =
  | 'players'
  | 'games'
  | 'tournaments'
  | 'payments'
  | 'commissions'
  | 'reconciliation'
  | 'admin-activity';

export interface Report {
  report: ReportName;
  period: { from: string; to: string; timezone: string };
  generatedAt: string;
  criteria: string;
  columns: string[];
  rows: Record<string, string | number | null>[];
}

export interface WithdrawalServiceState {
  mode: 'unavailable' | 'sandbox' | 'live';
  reason?: string;
  warnings: string[];
}

export interface SystemInfo {
  serverTime: string;
  environment: string;
  services: {
    database: 'connected' | 'unavailable' | 'disconnected';
    redis: 'connected' | 'unavailable' | 'disconnected';
    cinetpay: { configured: boolean; mode: 'sandbox' | 'production' | null };
    /** Nouveaux retraits (D-077) ; absent sur un serveur antérieur. */
    withdrawals?: WithdrawalServiceState;
  };
  sessionPolicy: { absoluteLifetimeSeconds: number; idleTimeoutSeconds: number };
  thresholds: Record<string, number>;
  timezone: string;
  maintenance: { available: boolean; label: string };
}

// --- Tournois (routes existantes /api/admin/tournaments) -------------------------------------

export type TournamentStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'SCHEDULED'
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSED'
  | 'STARTING'
  | 'IN_PROGRESS'
  | 'CALCULATING_RESULTS'
  | 'RESULTS_VALIDATED'
  | 'DISTRIBUTING_PRIZES'
  | 'COMPLETED'
  | 'CANCELLED';

export interface TournamentSummary {
  tournamentId: string;
  status: TournamentStatus;
  creatorType: 'ADMIN' | 'PLAYER';
  /** Jeu du tournoi (D-124) : 'TER' (Fap-Fap) ou 'GARAM' (GARAM TIA). */
  gameType: 'TER' | 'GARAM';
  /** GARAM TIA : variante des parties du tournoi (D-127). */
  garamVariant?: number;
  timezone: string;
  startsAt: string;
  endsAt: string;
  registrationClosesAt: string;
  entryFee: number;
  currency: 'XAF';
  minimumPlayers: number;
  maximumPlayers?: number;
  platformFeePercent?: number;
  rankingWeights?: { tokensPercent: number; gamesPercent: number };
  /** Calculés par le serveur : prix d'entrée × coefficient des paramètres (D-071). */
  initialTournamentTokens: number;
  stakePerGame: number;
  /**
   * Détail admin, tournoi non publié (D-071) : coefficients en vigueur du calcul. Absent une
   * fois publié : les valeurs sont figées.
   */
  tokenCoefficients?: { initialTokensCoefficient: number; stakePerGameCoefficient: number };
  prizeRules: { rank: number; percent: number }[];
  cancellationReason?: string;
  pool?: {
    participants: number;
    grossPool: number;
    platformFee: number;
    prizePool: number;
    unallocatedPrize?: number;
  };
  registeredCount?: number;
  creatorName?: string;
  createdAt?: string;
}

export interface TournamentRegistration {
  username: string;
  status: 'REGISTERED' | 'CANCELLED';
  registeredAt: string;
  cancelledAt?: string;
  reservation?: { amount: number; status: 'ACTIVE' | 'CAPTURED' | 'RELEASED' | 'EXPIRED' };
}

/** Règles de classement figées du tournoi, renvoyées avec le classement officiel (D-106). */
export interface TournamentRankingRules {
  method: 'D062_SATURATING' | 'D106_CAPITAL_RATIO';
  tokensWeightPercent: number;
  gamesWeightPercent: number;
  /** Nombre de parties de référence figé au démarrage du tournoi. */
  gamesReference: number;
}

export interface TournamentResult {
  rank: number;
  username: string;
  initialTokens: number;
  remainingTokens: number;
  gamesPlayed: number;
  gamesWon: number;
  score?: number;
  /** Critère qui a départagé un score exactement égal (D-106). */
  tieBreak?: 'GAMES_WON' | 'REGISTRATION_ORDER' | 'PLAYER_ID';
  prizePercent: number;
  prizeAmount: number;
  paid: boolean;
}

// --- Barème de commission des parties (D-074) -----------------------------------------------

/** Tranche : mises de `minStake` à `maxStake` inclus ; `maxStake` null = sans plafond. */
export interface GameCommissionTier {
  minStake: number;
  maxStake: number | null;
  percent: number;
}

/** `GET|PATCH /api/admin/settings/game-commission` (le PATCH ajoute `changed`). */
export interface GameCommissionSettings {
  tiers: GameCommissionTier[];
  updatedAt: string | null;
  /** Bornes du taux d'une tranche (%). */
  limits: { min: number; max: number };
  maxTiers: number;
  /** Multiplicateur de la perte de chaque perdant en victoire par Kora (le taux ne change pas, D-080). */
  koraLossMultiplier: number;
  appliesTo: 'GAMES_STARTED_AFTER_CHANGE';
  changed?: boolean;
}

export interface TournamentSettings {
  platformFeePercent: number;
  initialTokensCoefficient: number;
  stakePerGameCoefficient: number;
  maximumPendingTournamentsPerPlayer: number;
  tournamentTransitionMinutes: number;
  rankingTokensWeightPercent: number;
  rankingGamesWeightPercent: number;
  /** Bornes du nombre de joueurs à la création d'un tournoi ; maximum `null` = illimité (∞). */
  tournamentMinimumPlayers: number;
  tournamentMaximumPlayers: number | null;
  /** Durée d'un tournoi en minutes, bornes incluses (D-104). */
  tournamentMinimumDurationMinutes: number;
  tournamentMaximumDurationMinutes: number;
  /** Prix d'entrée minimal pour créer un tournoi, en FCFA (D-105, 500 par défaut). */
  tournamentMinimumEntryFee: number;
}

// --- Anti-collusion (routes existantes /api/admin/detection) ---------------------------------

export type AlertStatus = 'NEW' | 'REVIEWED' | 'DISMISSED' | 'RESOLVED';

export interface AlertSummary {
  alertId: string;
  type: string;
  level: 'high' | 'very_high';
  priority: 'NORMAL' | 'PRIORITY';
  status: AlertStatus;
  subject: { key: string; scope: 'PLAYER' | 'PAIR' | 'GROUP'; playerIds: string[] };
  score: number;
  algorithmVersion: number;
  scoreAlgorithm: string;
  gameId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertDetail extends AlertSummary {
  signalTypes: string[];
  period: { start: string; end: string };
  scoreAtAnalysis: {
    computedAt: string;
    previousScore: number | null;
    score: number;
    level: string;
    signalCount: number;
    contributions: { type: string; contribution: number; algorithm: string }[];
  } | null;
}

export interface AlertSignals {
  alertId: string;
  period: { from: string; to: string };
  signals: {
    signalId: string;
    type: string;
    algorithm: string;
    severity: string;
    contribution: number;
    retained: boolean;
    gameId: string | null;
    playerIds: string[];
    createdAt: string;
    evidence: unknown;
  }[];
}

export interface DetectionSetting {
  enabled: boolean;
  updatedAt: string | null;
}

// --- Retraits Mobile Money (D-075) -----------------------------------------------------------

/**
 * CREATED : jetons débités, transfert non encore accepté (ou issue d'envoi inconnue) ;
 * PROCESSING : accepté par CinetPay ; SUCCEEDED / FAILED : statut final relu chez CinetPay.
 */
export type WithdrawalStatus = 'CREATED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';

export interface WithdrawalRow {
  id: string;
  reference: string;
  providerReference: string | null;
  user: { id: string; username: string | null };
  operator: 'OM_CM' | 'MTN_CM';
  operatorLabel: string;
  /** Numéro destinataire masqué. */
  msisdn: string;
  tokens: number;
  amount: number;
  currency: 'XAF';
  /** Frais annoncés par CinetPay (compte marchand), s'ils ont été renvoyés. */
  providerFee: number | null;
  status: WithdrawalStatus;
  providerStatus: string | null;
  failureCode: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WithdrawalDetail extends WithdrawalRow {
  walletTransaction: { id: string; status: WalletStatus };
  submission: { attempts: number; lastAttemptAt: string | null; lastCheckedAt: string | null };
  verification: {
    available: boolean;
    providerConfigured: boolean;
    history: AuditEvent[];
  };
  reconciliation: WithdrawalReconciliation;
}

export type RefundRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface WithdrawalRefundRequest {
  id: string;
  status: RefundRequestStatus;
  providerTicket: string;
  justification: string;
  proposedBy: { id: string; username: string | null };
  proposedAt: string;
  providerStatusAtProposal: string;
  decidedBy: { id: string; username: string | null } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  providerStatusAtDecision: string | null;
}

/** Rapprochement d'un retrait bloqué (D-076) : remboursement à double validation, escalades. */
export interface WithdrawalReconciliation {
  open: boolean;
  refundEligibleFrom: string;
  canProposeRefund: boolean;
  newTransfersEnabled: boolean;
  refundRequests: WithdrawalRefundRequest[];
  events: AuditEvent[];
}

export interface WithdrawalVerificationResult {
  replayed: boolean;
  outcome: 'settled' | 'processing' | 'unresolved' | 'already_final' | 'error';
  status?: WithdrawalStatus;
  reason?: string;
}

/** Quota de retraits : `null` = illimité (∞). */
export interface WithdrawalLimitSetting {
  count: number | null;
  periodMinutes: number | null;
  updatedAt: string | null;
  bounds: { maxCount: number; maxPeriodMinutes: number };
  countedStatuses: WithdrawalStatus[];
}

// --- Retraits des revenus de la plateforme (D-078) --------------------------------------------

export type PlatformPayoutStatus =
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'CANCELLED'
  | 'RESERVED'
  | 'READY'
  | 'SUBMITTING'
  | 'PROCESSING'
  | 'UNCERTAIN'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'RECONCILIATION_REQUIRED';

export type TreasuryState = 'UNKNOWN' | 'UNAVAILABLE' | 'STALE' | 'CONFIRMED';

export interface TreasuryObservation {
  id: string;
  source: 'CINETPAY_API';
  environment: 'test' | 'live';
  status: 'VALID' | 'INVALID' | 'ERROR';
  availableAmount?: number;
  currency?: string;
  errorCode?: string;
  requestedBy?: string;
  observedAt: string;
}

export interface PlatformFinanceOverview {
  currency: 'XAF';
  generatedAt: string;
  revenue: {
    validatedRevenue: number;
    charges: { playerTransferFees: number; executedPayouts: number; executedPayoutFees: number };
    reserved: number;
    distributable: number;
    rawDistributable: number;
    lastUpdatedAt: string | null;
    anomalies: string[];
  };
  treasury: {
    state: TreasuryState;
    lastObservation: TreasuryObservation | null;
    lastValidObservation: TreasuryObservation | null;
    /** null : non confirmée (jamais 0 par défaut). */
    confirmedAvailable: number | null;
    obligations: {
      walletBalances: number;
      openWithdrawals: number;
      tournamentFundsHeld: number;
      total: number;
    };
    reservedPayouts: number;
    free: number | null;
    rawFree: number | null;
    freshUntil: string | null;
    anomalies: string[];
    providerConfigured: boolean;
  };
  fees: {
    configured: boolean;
    bps: number | null;
    fixed: number | null;
    estimateForWithdrawable: number | null;
  };
  withdrawable: { amount: number | null; ceiling: number | null; blockers: string[] };
  execution: { enabled: boolean; reason?: string; mode: 'disabled' | 'sandbox' | 'live' };
  reconciliationRequired: number;
}

export interface PayoutBeneficiary {
  id: string;
  label: string;
  operator: 'MTN_CM';
  /** Toujours masqué : le numéro complet ne quitte jamais le serveur. */
  msisdn: string;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'DISABLED';
  createdBy: PayoutActor;
  createdAt: string;
  verifiedBy: PayoutActor | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  disabledAt: string | null;
}

export interface PayoutActor {
  id: string;
  username: string | null;
}

export interface PlatformPayoutRow {
  id: string;
  reference: string;
  providerReference: string | null;
  beneficiary: { id: string; label: string; msisdn: string };
  operator: 'MTN_CM';
  amount: number;
  currency: 'XAF';
  estimatedFee: number;
  finalAmount: number | null;
  finalFee: number | null;
  purpose: string;
  status: PlatformPayoutStatus;
  providerStatus: string | null;
  initiatedBy: PayoutActor;
  approvedBy: PayoutActor | null;
  releasedBy: PayoutActor | null;
  decidedBy: PayoutActor | null;
  decisionNote: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  reconciliationResult: string | null;
  submissionAttempts: number;
  notFoundChecks: number;
  lastCheckedAt: string | null;
  createdAt: string;
  approvedAt: string | null;
  releasedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface PayoutAction {
  allowed: boolean;
  reason: string | null;
}

export interface PlatformPayoutDetail extends PlatformPayoutRow {
  actions: Record<'approve' | 'reject' | 'cancel' | 'release' | 'check', PayoutAction>;
  events: {
    id: string;
    event: string;
    fromStatus: PlatformPayoutStatus | null;
    toStatus: PlatformPayoutStatus | null;
    actor: PayoutActor | null;
    details: Record<string, unknown>;
    createdAt: string;
  }[];
}

// --- Versements des récompenses réelles des tournois (D-112) ---------------------------------

export type TournamentFinancialState =
  | 'NOT_STARTED'
  | 'CANCELLED'
  | 'IN_PROGRESS'
  | 'PLAN_PENDING_VALIDATION'
  | 'BLOCKED'
  | 'PAYING'
  | 'PAYMENT_FAILED'
  | 'FINALIZED';

/** Une ligne du plan de versement (GET /api/admin/tournaments/:id/payouts). */
export interface TournamentPayout {
  rank: number;
  username: string;
  amount: number;
  status: 'PENDING' | 'CREDITED' | 'FAILED';
  /** Référence unique du crédit (clé d’idempotence de la transaction du compte de jeu). */
  reference: string;
  walletTransactionId: string | null;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  creditedAt: string | null;
}

export interface TournamentPayoutReport {
  tournamentId: string;
  status: TournamentSummary['status'];
  financialState: TournamentFinancialState;
  pool: {
    participants: number;
    grossPool: number;
    platformFee: number;
    platformFeePercent: number;
    prizePool: number;
    unallocatedPrize: number;
  };
  prizeRules: { rank: number; percent: number }[];
  planValidatedAt: string | null;
  blocked: { at: string; reasons: string[] } | null;
  dueTotal: number;
  creditedTotal: number;
  payouts: TournamentPayout[];
}
