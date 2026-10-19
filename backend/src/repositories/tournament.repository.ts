import type { GameId, PlayerId } from '../domain/game/game-id';
import type { GameVictoryType } from '../domain/rules/game-settlement';
import type { SessionId } from '../domain/sessions/session';
import type {
  CancellationReason,
  PrizeAllocation,
  RankingAudit,
  Tournament,
  TournamentGameTally,
  TournamentId,
  TournamentPlayerAccount,
  TournamentRegistration,
  TournamentResultRow,
  TournamentSettings,
  TournamentSettlementRule,
  TournamentStatus,
} from '../domain/tournaments/tournament';
import type { UserId } from '../domain/users/user';
import type { WalletReservation } from './wallet-reservations';
import type { TournamentLedgerFacts } from './admin-query.repository';
import type {
  TournamentPayout,
  TournamentPayoutDraft,
} from '../domain/tournaments/tournament-payouts';

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
  | 'TOURNAMENT_TABLE_CLOSED'
  // Remerciement de fin de tournoi (D-117), visible 10 s après la publication des résultats.
  | 'TOURNAMENT_THANK_YOU'
  // Avertissement de l'administration (D-079) : `payload.message` est le texte visible.
  | 'MODERATION_WARNING';

export interface NotificationDraft {
  userId: UserId;
  type: NotificationType;
  payload: Record<string, unknown>;
  /** Unicité (joueur, clé) : un même événement n'est notifié qu'une fois. */
  dedupeKey: string;
  /** Visible à partir de cet instant (D-117) ; absent : dès l'écriture. */
  availableAt?: Date;
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
  /** Règle appliquée (D-111), celle figée au démarrage du tournoi. */
  settlementRule: TournamentSettlementRule;
  /** Type de victoire du moteur commun (règle D111_ORDINARY_RULES seulement). */
  victoryType?: GameVictoryType;
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
   * soumission d'une proposition, approbation, modification). Libéré au COMMIT / ROLLBACK.
   */
  lockSchedule(): Promise<void>;
  /**
   * Tournois comptés dans la limite plateforme à `now` (`countsTowardRegistrationLimit` :
   * publiés aux inscriptions ouvertes ou à ouvrir, propositions ouvertes aux préinscriptions),
   * `excludeId` excepté (approbation : la proposition déjà comptée ne se compte pas deux fois).
   */
  countWaitingTournaments(now: Date, excludeId?: TournamentId): Promise<number>;
  /**
   * Un tournoi PUBLIÉ non terminé (`BLOCKING_STATUSES`) dont le créneau persisté
   * [début, `blocked_until`[ chevauche [startsAt, blockedUntil[ (définition de
   * `tournaments_no_overlap` : deux créneaux qui se suivent ne se chevauchent pas), `excludeId`
   * excepté ; null sinon. Contrôle préalable seulement : la garantie reste la contrainte
   * `tournaments_no_overlap` à la publication.
   */
  findOverlappingPublished(
    slot: { startsAt: Date; blockedUntil: Date },
    excludeId?: TournamentId,
  ): Promise<TournamentId | null>;
  /**
   * Fige les jetons de départ et la mise d'une proposition à sa première préinscription
   * (D-113) : valeurs écrites avec la marque `token_setup_frozen_at`. Version + 1.
   */
  freezeTokenSetup(
    id: TournamentId,
    tokens: { initialTournamentTokens: number; stakePerGame: number },
    at: Date,
  ): Promise<void>;
  /** Retire la marque (nouveau prix d'entrée sans aucun inscrit actif, D-113). */
  unfreezeTokenSetup(id: TournamentId): Promise<void>;
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
  /**
   * Dissout les comptes fictifs CLOS du tournoi (D-111) : statut DISSOLVED, rien n'est
   * supprimé, aucun mouvement du compte de jeu. Idempotent : renvoie le nombre de comptes
   * dissous par CET appel.
   */
  dissolveAccounts(id: TournamentId, now: Date): Promise<number>;
  /** Parties EN COURS rattachées au tournoi (`games.tournament_id`). */
  countActiveGames(id: TournamentId): Promise<number>;
  /** Parties terminées du tournoi dont les jetons ne sont pas encore réglés. */
  countUnsettledFinishedGames(id: TournamentId): Promise<number>;
  /**
   * Bilan par joueur des parties RÉGLÉES du tournoi, toutes tables (sessions) confondues
   * (registre `tournament_games`) : source officielle des compteurs du classement.
   */
  tallySettledGames(id: TournamentId): Promise<Map<string, TournamentGameTally>>;

  insertResults(id: TournamentId, rows: ResultDraft[], now: Date): Promise<void>;
  /** Résultats avec un gain encore non versé (verrou des lignes). */
  lockUnpaidResults(id: TournamentId): Promise<ResultDraft[]>;
  markResultPaid(id: TournamentId, rank: number, transactionId: string, now: Date): Promise<void>;

  // --- Plan de versement des récompenses réelles (D-112) ---------------------------------
  /** Plan écrit avec le classement officiel (idempotent : une ligne par rang). */
  /** Gains du classement officiel (rang, bénéficiaire, montant), dans la transaction. */
  listResultPrizes(
    id: TournamentId,
  ): Promise<{ rank: number; playerId: string; prizeAmount: number }[]>;
  insertPayouts(id: TournamentId, drafts: TournamentPayoutDraft[], now: Date): Promise<void>;
  /** Plan du tournoi, lignes verrouillées (`FOR UPDATE`), par rang. */
  lockPayouts(id: TournamentId): Promise<TournamentPayout[]>;
  /**
   * Prochain versement à tenter, verrouillé : PENDING, ou FAILED dont la dernière tentative
   * précède `retryBefore` ; le plus petit rang d'abord. Null s'il n'y en a pas.
   */
  lockNextPayout(id: TournamentId, retryBefore: Date): Promise<TournamentPayout | null>;
  /** Versement crédité : définitif (référence de la transaction du compte de jeu). */
  markPayoutCredited(
    id: TournamentId,
    rank: number,
    transactionId: string,
    now: Date,
  ): Promise<void>;
  /** Échec d'une tentative : FAILED, compteur, motif (le crédit n'a pas eu lieu). */
  recordPayoutFailure(id: TournamentId, rank: number, error: string, now: Date): Promise<void>;
  /** Faits comptables du tournoi (mêmes contrôles que la réconciliation). */
  ledgerFacts(id: TournamentId): Promise<TournamentLedgerFacts | null>;
  /** Plan validé : versements autorisés ; tout blocage antérieur est levé. */
  markPayoutPlanValidated(id: TournamentId, now: Date): Promise<void>;
  /** Versements bloqués (incohérence) ; motifs mis à jour, date du premier blocage gardée. */
  blockPayouts(id: TournamentId, reasons: string[], now: Date): Promise<void>;

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

/** Plan de versement d'un tournoi et son état de validation (D-112). */
export interface TournamentPayoutState {
  payouts: (TournamentPayout & { username: string })[];
  planValidatedAt?: Date;
  blockedAt?: Date;
  blockReasons: string[];
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
  /** Détail d'audit figé avec le rang (D-106). */
  audit?: RankingAudit;
  registeredAt?: Date;
}

/** Un tournoi terminé dans l'historique de résultats d'un joueur (D-106). */
export interface ResultsHistoryItem {
  tournament: Tournament;
  myRank: number;
  myScore?: number;
  resultsPublishedAt: Date;
}

/**
 * Persistance des tournois (D-054). PostgreSQL est la source de vérité ; les décisions sont
 * prises par TournamentService sur l'état VERROUILLÉ de `transaction`.
 */
export interface TournamentRepository {
  transaction<T>(work: (uow: TournamentUnitOfWork) => Promise<T>): Promise<T>;

  /** Plan de versement et état de validation (lecture, administration et joueur, D-112). */
  findPayoutState(id: TournamentId): Promise<TournamentPayoutState>;

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
   * Tournois de la liste des joueurs (D-065) : `current` → publiés pas encore terminés (à
   * venir, en cours, en clôture) ET propositions en attente d'approbation, ouvertes aux
   * préinscriptions (D-108), début le plus proche d'abord ; `history` → publiés terminés ou
   * annulés, le plus récent d'abord. Jamais un brouillon ni une proposition refusée ou retirée.
   * `visibleSince` (historique seulement) : terminé dont la fin PRÉVUE (`ends_at`), ou annulé
   * dont l'annulation RÉELLE (`cancelled_at`), est postérieure à cet instant. Affichage
   * seulement : aucune ligne n'est modifiée ni supprimée.
   */
  listPublished(filter: {
    scope: 'current' | 'history';
    limit: number;
    visibleSince?: Date;
  }): Promise<Tournament[]>;
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
  /** Comme `TournamentUnitOfWork.tallySettledGames`, hors transaction (lecture). */
  tallySettledGames(id: TournamentId): Promise<Map<string, TournamentGameTally>>;
  listResults(id: TournamentId): Promise<TournamentResultRow[]>;
  /**
   * Tournois aux résultats publiés où le joueur est classé, fin la plus récente d'abord, sans
   * limite de date (D-106) ; `before` : pagination sur `ends_at`.
   */
  listResultsHistory(
    userId: UserId,
    page: { limit: number; before?: Date },
  ): Promise<ResultsHistoryItem[]>;
  /**
   * Tables encore ouvertes du tournoi SANS partie en cours (partie en attente, ou partie
   * terminée et ronde Poursuivre/Quitter) : fermées à la clôture.
   */
  listIdleTables(id: TournamentId): Promise<{ sessionId: SessionId; playerIds: PlayerId[] }[]>;

  findJoinableSessions(id: TournamentId, limit: number): Promise<SessionId[]>;
  findTournamentOfSession(sessionId: SessionId): Promise<TournamentId | null>;
  /** Parties terminées d'une table de tournoi, pas encore réglées (reprise). */
  findUnsettledFinishedGames(
    limit: number,
  ): Promise<{ gameId: GameId; tournamentId: TournamentId }[]>;

  readSettings(): Promise<TournamentSettings>;

  /** Notifications déjà visibles à `now` (D-117), la plus récente d'abord. */
  listNotifications(userId: UserId, limit: number, now: Date): Promise<AppNotification[]>;
  markNotificationRead(userId: UserId, notificationId: string, now: Date): Promise<boolean>;
}

export type { CancellationReason, TournamentResultRow };
