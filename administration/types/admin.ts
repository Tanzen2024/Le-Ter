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
  | 'REPORT_EXPORTED';

export type AuditTargetType =
  | 'DETECTION_ALERT'
  | 'SYSTEM_SETTING'
  | 'TOURNAMENT'
  | 'ADMIN_ACCOUNT'
  | 'ADMIN_SESSION'
  | 'USER'
  | 'PAYMENT'
  | 'REPORT';

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
  definitions: { activePlayer: string; platformRevenue: string };
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
  alerts: {
    newDetectionAlerts: number;
    pendingTournamentApprovals: number;
    stalePendingPayments: number;
    overdueTurns: number;
  };
  reconciliationAnomalies: AnomalySummary;
  series: DailyPoint[];
  recentAdminActivity: AuditEvent[];
}

// --- Joueurs ---------------------------------------------------------------------------------

export interface PlayerRow {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  createdAt: string;
  balance: number;
  reserved: number;
  gamesPlayed: number;
  lastGameAt: string | null;
}

export interface PlayerDetail extends PlayerRow {
  phoneVerified: boolean;
  updatedAt: string;
  gamesWon: number;
  activeGameId: string | null;
  activeSessionId: string | null;
  tournamentRegistrations: number;
  payments: { total: number; succeeded: number; succeededAmount: number; pending: number };
  actions: { suspend: { available: boolean; reason: string } };
}

// --- Parties ---------------------------------------------------------------------------------

export type GameStatus = 'waiting' | 'in_progress' | 'finished';
export type GameAnomaly = 'STALE_WAITING' | 'LONG_RUNNING' | 'OVERDUE_TURN';

export interface GameRow {
  id: string;
  status: GameStatus;
  sessionId: string;
  tournament: { id: string; name: string | null } | null;
  maxPlayers: number;
  stakeAmount: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  endReason: string | null;
  winner: { id: string; username: string | null } | null;
  replayOfGameId: string | null;
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

export type WalletKind = 'deposit' | 'withdrawal' | 'tournament_entry' | 'tournament_prize';
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
  entries: number;
  firstEntryAt: string | null;
  lastEntryAt: string | null;
  treasury: { integrated: boolean; label: string };
  outgoing: { supported: boolean; label: string };
  ordinaryGamesCommission: { defined: boolean; label: string };
  reconciliation: { tournamentAnomalies: number; status: 'BALANCED' | 'ANOMALIES' };
}

export interface LedgerEntry {
  id: string;
  kind: 'TOURNAMENT_PLATFORM_FEE' | 'UNALLOCATED_PRIZE';
  amount: number;
  currency: string;
  feeBps: number | null;
  createdAt: string;
  origin: { type: 'TOURNAMENT'; id: string; name: string };
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

export interface SystemInfo {
  serverTime: string;
  environment: string;
  services: {
    database: 'connected' | 'unavailable' | 'disconnected';
    redis: 'connected' | 'unavailable' | 'disconnected';
    cinetpay: { configured: boolean; mode: 'sandbox' | 'production' | null };
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

export interface TournamentResult {
  rank: number;
  username: string;
  initialTokens: number;
  remainingTokens: number;
  gamesPlayed: number;
  gamesWon: number;
  score?: number;
  prizePercent: number;
  prizeAmount: number;
  paid: boolean;
}

export interface TournamentSettings {
  platformFeePercent: number;
  initialTokensCoefficient: number;
  stakePerGameCoefficient: number;
  maximumPendingTournamentsPerPlayer: number;
  tournamentTransitionMinutes: number;
  rankingTokensWeightPercent: number;
  rankingGamesWeightPercent: number;
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
