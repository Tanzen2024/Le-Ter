import type { GameId, PlayerId } from '../domain/game/game-id';
import type { SessionId } from '../domain/sessions/session';
import type {
  CancellationReason,
  PrizeAllocation,
  Tournament,
  TournamentId,
  TournamentPlayerAccount,
  TournamentRegistration,
  TournamentResultRow,
  TournamentSettings,
  TournamentStatus,
} from '../domain/tournaments/tournament';
import type { UserId } from '../domain/users/user';
import type { WalletReservation } from './wallet-reservations';

/** Ligne de la liste d'administration. */
export interface AdminTournamentListItem {
  tournament: Tournament;
  registeredCount: number;
  /** Pseudo du créateur (admin ou joueur), si connu. */
  creatorName?: string;
}

/** Inscription vue par l'administration (avec pseudo et réservation). */
export interface RegistrationListItem {
  registration: TournamentRegistration;
  username: string;
  reservation?: Pick<WalletReservation, 'id' | 'amount' | 'status'>;
}

/** Inscription active avec sa réservation vivante (capture ou libération). */
export interface ActiveRegistration {
  registration: TournamentRegistration;
  reservation: WalletReservation | null;
}

export type NotificationType =
  | 'TOURNAMENT_APPROVED'
  | 'TOURNAMENT_REGISTRATION_CONFIRMED'
  | 'TOURNAMENT_CANCELLED'
  | 'TOURNAMENT_STARTED'
  | 'TOURNAMENT_RESULTS_AVAILABLE'
  | 'TOURNAMENT_PRIZE_CREDITED'
  | 'TOURNAMENT_TABLE_CLOSED';

export interface NotificationDraft {
  userId: UserId;
  type: NotificationType;
  payload: Record<string, unknown>;
  /** Unicité (joueur, clé) : un même événement n'est notifié qu'une fois. */
  dedupeKey: string;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  createdAt: Date;
  readAt?: Date;
}

/** Règlement des jetons d'une partie (une ligne par gameId). */
export interface TournamentGameSettlement {
  gameId: GameId;
  tournamentId: TournamentId;
  sessionId: SessionId;
  status: 'SETTLED' | 'VOID';
  winnerId?: UserId;
  stake: number;
  pot: number;
  transfers: Record<string, number>;
  voidReason?: string;
  settledAt: Date;
}

/**
 * Opérations SOUS VERROU, dans UNE transaction PostgreSQL (D-054) : le tournoi, ses
 * inscriptions, les réservations du compte de jeu, la cagnotte, les comptes de tournoi, les
 * résultats et les notifications sont validés ou annulés ensemble.
 */
export interface TournamentUnitOfWork {
  /** Verrou `FOR UPDATE` de la ligne du tournoi ; null s'il n'existe pas. */
  lockTournament(id: TournamentId): Promise<Tournament | null>;
  insertTournament(tournament: Tournament): Promise<void>;
  /** Enregistre l'état (version + 1) ; lève TournamentOverlapError sur chevauchement. */
  saveTournament(tournament: Tournament): Promise<Tournament>;
  countActiveRegistrations(id: TournamentId): Promise<number>;
  countPendingByCreator(creatorId: UserId): Promise<number>;
  /**
   * Verrou transactionnel de la PLANIFICATION (D-059) : sérialise, sur toutes les instances,
   * les transactions qui ajoutent un tournoi en attente de démarrage (création admin,
   * approbation). Libéré au COMMIT / ROLLBACK.
   */
  lockSchedule(): Promise<void>;
  /** Tournois en attente de démarrage (WAITING_STATUSES), toute la plateforme. */
  countWaitingTournaments(): Promise<number>;
  findRegistration(id: TournamentId, userId: UserId): Promise<TournamentRegistration | null>;
  /** Nouvelle inscription, ou réactivation de la ligne existante (désinscrit). */
  upsertRegistration(registration: TournamentRegistration): Promise<TournamentRegistration>;
  cancelRegistration(registrationId: string, now: Date): Promise<void>;
  listActiveRegistrations(id: TournamentId): Promise<ActiveRegistration[]>;

  reserve(input: {
    userId: UserId;
    tournamentId: TournamentId;
    registrationId: string;
    amount: number;
    now: Date;
  }): Promise<WalletReservation>;
  release(reservationId: string, now: Date): Promise<boolean>;
  /** Réservations du tournoi déjà CAPTURÉES (paiements définitifs). */
  countCapturedReservations(id: TournamentId): Promise<number>;
  capture(reservationId: string, now: Date): Promise<boolean>;
  creditPrize(input: {
    userId: UserId;
    amount: number;
    idempotencyKey: string;
    now: Date;
  }): Promise<{ transactionId: string; credited: boolean }>;

  recordPlatformEntry(entry: {
    tournamentId: TournamentId;
    kind: 'TOURNAMENT_PLATFORM_FEE' | 'UNALLOCATED_PRIZE';
    amount: number;
    feeBps?: number;
    now: Date;
  }): Promise<void>;

  insertAccounts(accounts: TournamentPlayerAccount[], now: Date): Promise<void>;
  lockAccounts(id: TournamentId, playerIds: readonly string[]): Promise<TournamentPlayerAccount[]>;
  listAccounts(id: TournamentId): Promise<TournamentPlayerAccount[]>;
  updateAccount(account: TournamentPlayerAccount, now: Date): Promise<void>;

  /** false : cette partie a déjà été réglée (idempotence). */
  insertGameSettlement(settlement: TournamentGameSettlement): Promise<boolean>;
  /** Parties en cours d'une table du tournoi, commencées avant `before`. */
  countActiveGames(id: TournamentId, before: Date): Promise<number>;

  insertResults(id: TournamentId, rows: ResultDraft[], now: Date): Promise<void>;
  /** Résultats avec un gain encore non versé (verrou des lignes). */
  lockUnpaidResults(id: TournamentId): Promise<ResultDraft[]>;
  markResultPaid(id: TournamentId, rank: number, transactionId: string, now: Date): Promise<void>;

  notify(notifications: NotificationDraft[], now: Date): Promise<void>;

  readSettings(): Promise<TournamentSettings>;
  writeSettings(settings: TournamentSettings, actorId: UserId, now: Date): Promise<void>;
  audit(entry: {
    actorId: UserId;
    action:
      | 'TOURNAMENT_CREATED'
      | 'TOURNAMENT_UPDATED'
      | 'TOURNAMENT_APPROVED'
      | 'TOURNAMENT_REJECTED'
      | 'TOURNAMENT_CANCELLED'
      | 'TOURNAMENT_SETTINGS_UPDATED';
    tournamentId?: TournamentId;
    details: Record<string, unknown>;
    now: Date;
  }): Promise<void>;
}

/** Résultat à écrire (calculé par le domaine). */
export interface ResultDraft extends PrizeAllocation {
  playerId: UserId;
  initialTokens: number;
  remainingTokens: number;
  gamesPlayed: number;
  gamesWon: number;
  /** Score pondéré figé (D-062) ; absent des résultats classés avant D-062. */
  score?: number;
}

/**
 * Persistance des tournois (D-054). PostgreSQL est la source de vérité ; les décisions sont
 * prises par TournamentService sur l'état VERROUILLÉ de `transaction`.
 */
export interface TournamentRepository {
  transaction<T>(work: (uow: TournamentUnitOfWork) => Promise<T>): Promise<T>;

  findById(id: TournamentId): Promise<Tournament | null>;
  /**
   * Tournoi à mettre en avant : en cours (ou en clôture), sinon le prochain publié, sinon le
   * dernier terminé ou annulé après `recentSince`.
   */
  findFeatured(now: Date, recentSince: Date): Promise<Tournament | null>;
  list(filter: {
    statuses?: TournamentStatus[];
    creatorId?: UserId;
    limit: number;
  }): Promise<Tournament[]>;
  /**
   * Tournois PUBLIÉS pour la liste des joueurs (D-065) : `current` → pas encore terminés
   * (à venir, en cours, en clôture), début le plus proche d'abord ; `history` → terminés ou
   * annulés, le plus récent d'abord. Jamais un brouillon ni une proposition non publiée.
   */
  listPublished(filter: { scope: 'current' | 'history'; limit: number }): Promise<Tournament[]>;
  /**
   * Prochain tournoi auquel le joueur est INSCRIT (inscription active), publié, ni annulé ni
   * terminé, qui n'a pas commencé (`starts_at > now`) : le plus proche, ou null.
   */
  findNextRegistered(userId: UserId, now: Date): Promise<Tournament | null>;
  /** Liste d'administration : chaque tournoi avec son créateur et ses inscrits actifs. */
  listForAdmin(filter: {
    statuses?: TournamentStatus[];
    limit: number;
  }): Promise<AdminTournamentListItem[]>;
  /** Tournois dont une transition peut être due à `now` (planificateur). */
  findDue(now: Date): Promise<TournamentId[]>;

  countActiveRegistrations(id: TournamentId): Promise<number>;
  findRegistration(
    id: TournamentId,
    userId: UserId | PlayerId,
  ): Promise<TournamentRegistration | null>;
  findActiveReservation(registrationId: string): Promise<WalletReservation | null>;
  listRegistrations(id: TournamentId): Promise<RegistrationListItem[]>;

  findAccount(
    id: TournamentId,
    playerId: UserId | PlayerId,
  ): Promise<TournamentPlayerAccount | null>;
  listAccountsWithNames(
    id: TournamentId,
  ): Promise<(TournamentPlayerAccount & { username: string })[]>;
  listResults(id: TournamentId): Promise<TournamentResultRow[]>;

  findJoinableSessions(id: TournamentId, limit: number): Promise<SessionId[]>;
  findTournamentOfSession(sessionId: SessionId): Promise<TournamentId | null>;
  /** Parties terminées d'une table de tournoi, pas encore réglées (reprise). */
  findUnsettledFinishedGames(
    limit: number,
  ): Promise<{ gameId: GameId; tournamentId: TournamentId }[]>;

  readSettings(): Promise<TournamentSettings>;

  listNotifications(userId: UserId, limit: number): Promise<AppNotification[]>;
  markNotificationRead(userId: UserId, notificationId: string, now: Date): Promise<boolean>;
}

export type { CancellationReason, TournamentResultRow };
