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

/** Filtre d'état d'un compte : statut (`users.status`) ou suspension en cours (D-079). */
export type UserStatusFilter = UserStatus | 'suspended';

export interface UserListQuery extends Page {
  q?: string;
  status?: UserStatusFilter;
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
  /** Suspension en cours (D-079) ; `endsAt` null : indéterminée. */
  suspension: { endsAt: Date | null } | null;
  /** Restriction du chat en cours (D-079). */
  chatRestriction: { endsAt: Date | null } | null;
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
  /** Échéance de tour dépassée (TURN_TIMEOUT), coup automatique en attente. */
  turnTimedOutAt: Date | null;
  endReason: string | null;
  winnerId: string | null;
  winnerUsername: string | null;
  replayOfGameId: string | null;
  /** Partie qui rejoue celle-ci après une égalité de priorité (INSTANT_WIN_TIE). */
  replayedByGameId: string | null;
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
  // Partie ordinaire (D-074) : mise consommée, gain net du gagnant.
  'game_stake',
  'game_winnings',
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

export type ReservationStatus = 'ACTIVE' | 'CAPTURED' | 'RELEASED' | 'EXPIRED';

export interface FinanceOverview {
  purchases: StatusAmount[];
  /**
   * Mouvements des comptes de jeu par nature et statut. `withoutPayment` sépare les achats
   * (`deposit`) sans paiement CinetPay rattaché (tentative refusée avant l'appel au
   * fournisseur) des achats CinetPay : toujours `false` pour les autres natures.
   */
  walletMovements: {
    kind: WalletKind;
    status: WalletStatus;
    withoutPayment: boolean;
    count: number;
    tokens: number;
  }[];
  /** Réservations de tournoi créées sur la période (jamais des débits). */
  reservations: { status: ReservationStatus; count: number; amount: number }[];
  liabilities: { wallets: number; balance: number; reserved: number };
  platformRevenue: { kind: string; count: number; amount: number }[];
}

// --- Compte financier de la plateforme -------------------------------------------------------

export const LEDGER_KINDS = [
  'TOURNAMENT_PLATFORM_FEE',
  'UNALLOCATED_PRIZE',
  // Commission sur le gain d'une partie ordinaire (D-074).
  'GAME_COMMISSION',
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export interface LedgerQuery extends Page {
  kind?: LedgerKind;
  from?: Date;
  to?: Date;
  tournamentId?: string;
}

export interface LedgerEntry {
  id: string;
  /** Origine : un tournoi (commission, rang non attribué) OU une partie (D-074). */
  tournamentId: string | null;
  tournamentName: string | null;
  gameId: string | null;
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
  alerts: AttentionCounts;
}

/** Points d'attention de l'administration (cloche, tableau de bord), calculés à `now`. */
export interface AttentionCounts {
  newDetectionAlerts: number;
  pendingTournamentApprovals: number;
  stalePendingPayments: number;
  overdueTurns: number;
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
  listUsers(query: UserListQuery, now: Date): Promise<{ total: number; items: AdminUserRow[] }>;
  findUser(id: string, now: Date): Promise<AdminUserDetail | null>;
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
   * montant hors des limites d'achat (D-085), ou en attente depuis plus de `staleMinutes`.
   */
  paymentReconciliation(options: {
    now: Date;
    staleMinutes: number;
    depositLimits: { min: number; max: number };
    tokensPerUnit: number;
    limit: number;
  }): Promise<PaymentReconciliationRow[]>;
  orphanDeposits(limit: number): Promise<OrphanDepositRow[]>;
  tournamentLedgerFacts(): Promise<TournamentLedgerFacts[]>;
  dashboard(period: Period, now: Date): Promise<DashboardFacts>;
  attention(now: Date): Promise<AttentionCounts>;
  daily(period: Period, timezone: string): Promise<DailyPoint[]>;
  tournamentsInPeriod(period: Period): Promise<TournamentReportRow[]>;
}
