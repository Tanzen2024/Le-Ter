import type { PaymentStatus } from '../domain/payments/payment';
import type { TournamentStatus } from '../domain/tournaments/tournament';
import type { UserRole, UserStatus } from '../domain/users/user';

/**
 * Lectures de l'administration (D-061) : LECTURE SEULE, SQL paramétré, colonnes en liste
 * blanche. `games.state` (mains, paquet) n'est JAMAIS sélectionné.
 */

export interface Page {
  page: number;
  limit: number;
}

export interface Period {
  from: Date;
  to: Date;
}

// --- Joueurs ----------------------------------------------------------------------------------

export const USER_SORTS = ['created_desc', 'created_asc', 'username_asc'] as const;
export type UserSort = (typeof USER_SORTS)[number];

export interface UserListQuery extends Page {
  q?: string;
  status?: UserStatus;
  role?: UserRole;
  sort: UserSort;
}

export interface AdminUserRow {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  phoneVerified: boolean;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  balance: number;
  reserved: number;
  gamesPlayed: number;
  lastGameAt: Date | null;
}

export interface AdminUserDetail extends AdminUserRow {
  updatedAt: Date;
  gamesWon: number;
  activeGameId: string | null;
  activeSessionId: string | null;
  tournamentRegistrations: number;
  payments: { total: number; succeeded: number; succeededAmount: number; pending: number };
}

// --- Parties ----------------------------------------------------------------------------------

export const GAME_ANOMALIES = ['STALE_WAITING', 'LONG_RUNNING', 'OVERDUE_TURN'] as const;
export type GameAnomaly = (typeof GAME_ANOMALIES)[number];
export const GAME_STATUSES = ['waiting', 'in_progress', 'finished'] as const;
export type AdminGameStatus = (typeof GAME_STATUSES)[number];

export interface GameListQuery extends Page {
  status?: AdminGameStatus;
  from?: Date;
  to?: Date;
  playerId?: string;
  sessionId?: string;
  tournamentId?: string;
  gameId?: string;
  anomaly?: GameAnomaly;
}

export interface AdminGamePlayer {
  playerId: string;
  username: string;
  seat: number;
  joinedAt: string;
  fledAt: string | null;
}

export interface AdminGameRow {
  id: string;
  status: AdminGameStatus;
  sessionId: string;
  tournamentId: string | null;
  tournamentName: string | null;
  maxPlayers: number;
  stakeAmount: number | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  turnDeadlineAt: Date | null;
  endReason: string | null;
  winnerId: string | null;
  winnerUsername: string | null;
  replayOfGameId: string | null;
  players: AdminGamePlayer[];
}

export interface AdminGameDetail extends AdminGameRow {
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
}

// --- Finances ---------------------------------------------------------------------------------

export const WALLET_KINDS = [
  'deposit',
  'withdrawal',
  'tournament_entry',
  'tournament_prize',
] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];
export const WALLET_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];

export interface WalletTransactionQuery extends Page {
  kind?: WalletKind;
  status?: WalletStatus;
  userId?: string;
  from?: Date;
  to?: Date;
  /** Référence exacte : identifiant, référence fournisseur ou identifiant marchand. */
  q?: string;
}

export interface AdminWalletTransaction {
  id: string;
  userId: string;
  username: string;
  kind: WalletKind;
  status: WalletStatus;
  tokens: number;
  failureCode: string | null;
  providerReference: string | null;
  createdAt: Date;
  completedAt: Date | null;
  paymentId: string | null;
  tournamentId: string | null;
}

export const PAYMENT_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'] as const;

export interface PaymentQuery extends Page {
  status?: PaymentStatus;
  userId?: string;
  from?: Date;
  to?: Date;
  minAmount?: number;
  maxAmount?: number;
  q?: string;
}

export interface AdminPaymentRow {
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
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  walletTransactionId: string;
  walletTransactionStatus: WalletStatus;
  tokens: number;
}

export interface AdminPaymentDetail extends AdminPaymentRow {
  /** Motif d'échec d'initialisation, s'il y en a un (`payments.metadata.failure`). */
  initializationFailure: string | null;
  /** Anomalie relevée au règlement (`payments.metadata.anomaly`). */
  settlementAnomaly: string | null;
}

export interface StatusAmount {
  status: string;
  count: number;
  amount: number;
}

export interface FinanceOverview {
  purchases: StatusAmount[];
  walletMovements: { kind: WalletKind; status: WalletStatus; count: number; tokens: number }[];
  liabilities: { wallets: number; balance: number; reserved: number };
  platformRevenue: { kind: string; count: number; amount: number }[];
}

// --- Compte financier de la plateforme -------------------------------------------------------

export const LEDGER_KINDS = ['TOURNAMENT_PLATFORM_FEE', 'UNALLOCATED_PRIZE'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export interface LedgerQuery extends Page {
  kind?: LedgerKind;
  from?: Date;
  to?: Date;
  tournamentId?: string;
}

export interface LedgerEntry {
  id: string;
  tournamentId: string;
  tournamentName: string;
  kind: LedgerKind;
  amount: number;
  feeBps: number | null;
  currency: string;
  createdAt: Date;
  participants: number | null;
  grossPool: number | null;
}

export interface LedgerSummary {
  byKind: { kind: LedgerKind; count: number; amount: number }[];
  total: number;
  entries: number;
  firstEntryAt: Date | null;
  lastEntryAt: Date | null;
  currency: string;
}

// --- Rapprochement ----------------------------------------------------------------------------

export interface PaymentReconciliationRow {
  paymentId: string;
  merchantTransactionId: string;
  providerReference: string | null;
  userId: string;
  username: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  createdAt: Date;
  walletTransactionId: string;
  walletTransactionStatus: WalletStatus;
  tokens: number;
}

export interface OrphanDepositRow {
  walletTransactionId: string;
  userId: string;
  username: string;
  tokens: number;
  status: WalletStatus;
  createdAt: Date;
}

export interface TournamentLedgerFacts {
  id: string;
  name: string;
  status: TournamentStatus;
  startedAt: Date | null;
  entryFee: number;
  participants: number | null;
  platformFeeBps: number | null;
  grossPool: number | null;
  platformFee: number | null;
  prizePool: number | null;
  unallocatedPrize: number | null;
  capturedReservations: number;
  capturedEntryTokens: number;
  capturedEntryTransactions: number;
  feeEntryAmount: number | null;
  unallocatedEntryAmount: number | null;
  resultsCount: number;
  resultsPrizeTotal: number;
  /** Résultats avec gain > 0 sans transaction de gain réussie du même montant. */
  unpaidPrizes: number;
  prizeRules: { rank: number; shareBps: number }[];
}

// --- Tableau de bord et rapports --------------------------------------------------------------

export interface DashboardFacts {
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

export interface TournamentReportRow {
  id: string;
  name: string;
  status: TournamentStatus;
  startsAt: Date;
  endsAt: Date;
  entryFee: number;
  participants: number | null;
  registered: number;
  grossPool: number | null;
  platformFee: number | null;
  prizePool: number | null;
}

export interface AdminQueryRepository {
  listUsers(query: UserListQuery): Promise<{ total: number; items: AdminUserRow[] }>;
  findUser(id: string): Promise<AdminUserDetail | null>;
  listGames(query: GameListQuery, now: Date): Promise<{ total: number; items: AdminGameRow[] }>;
  findGame(id: string): Promise<AdminGameDetail | null>;
  listWalletTransactions(
    query: WalletTransactionQuery,
  ): Promise<{ total: number; items: AdminWalletTransaction[] }>;
  listPayments(query: PaymentQuery): Promise<{ total: number; items: AdminPaymentRow[] }>;
  findPayment(id: string): Promise<AdminPaymentDetail | null>;
  financeOverview(period: Period): Promise<FinanceOverview>;
  ledgerSummary(period?: Period): Promise<LedgerSummary>;
  listLedger(query: LedgerQuery): Promise<{ total: number; items: LedgerEntry[] }>;
  /**
   * Paiements candidats au rapprochement : statut incohérent avec l'achat, montant ≠ jetons,
   * montant hors barème, ou en attente depuis plus de `staleMinutes`.
   */
  paymentReconciliation(options: {
    now: Date;
    staleMinutes: number;
    allowedAmounts: readonly number[];
    tokensPerUnit: number;
    limit: number;
  }): Promise<PaymentReconciliationRow[]>;
  orphanDeposits(limit: number): Promise<OrphanDepositRow[]>;
  tournamentLedgerFacts(): Promise<TournamentLedgerFacts[]>;
  dashboard(period: Period, now: Date): Promise<DashboardFacts>;
  daily(period: Period, timezone: string): Promise<DailyPoint[]>;
  tournamentsInPeriod(period: Period): Promise<TournamentReportRow[]>;
}
