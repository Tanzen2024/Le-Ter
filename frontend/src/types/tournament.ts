/** Statut d'un tournoi, décidé par le serveur (D-054) ; le client ne le déduit jamais. */
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

export type TournamentCancellationReason =
  | 'INSUFFICIENT_PLAYERS'
  | 'ADMIN_CANCELLED'
  | 'SYSTEM_ERROR'
  | 'PAYMENT_ERROR'
  | 'APPROVAL_REJECTED'
  | 'CREATOR_CANCELLED';

/** Une ligne du classement (en direct ou final). */
export interface TournamentResultView {
  rank: number;
  username: string;
  initialTokens: number;
  remainingTokens: number;
  gamesPlayed: number;
  gamesWon: number;
  /** Score pondéré sur 100 (D-062), figé avec le résultat ; absent d'un classement antérieur. */
  score?: number;
  prizePercent: number;
  /** En jetons du compte de jeu (1 jeton = 1 FCFA). */
  prizeAmount: number;
  paid: boolean;
  /** Critère qui a départagé un score exactement égal (D-106). */
  tieBreak?: RankingTieBreak;
  /** Ma ligne (classement officiel, D-106). */
  isViewer?: boolean;
}

export type RankingTieBreak = 'GAMES_WON' | 'REGISTRATION_ORDER' | 'PLAYER_ID';

/** Règles de classement FIGÉES du tournoi (D-062, D-106). */
export interface RankingRulesView {
  method: 'D062_SATURATING' | 'D106_CAPITAL_RATIO';
  tokensWeightPercent: number;
  gamesWeightPercent: number;
  gamesReference: number;
}

/** Détail de MON score (classement officiel), jamais celui d'un autre joueur. */
export interface MyTournamentResult {
  rank: number;
  score?: number;
  initialTokens: number;
  remainingTokens: number;
  gamesPlayed: number;
  gamesWon: number;
  tokensRatio: number;
  gamesRatio: number;
  tokensPoints: number;
  gamesPoints: number;
  prizeAmount: number;
  paid: boolean;
  tieBreak?: RankingTieBreak;
  /**
   * Récompense RÉELLE (compte de jeu, FCFA) et état de son versement (D-112) ; null sans gain.
   * « CREDITED » seulement après l'écriture réussie ; sinon « PENDING » (en cours ou repris).
   */
  payout?: { amount: number; status: 'PENDING' | 'CREDITED'; creditedAt?: string } | null;
}

/** Classement général officiel d'un tournoi (GET /api/tournaments/:id/results, D-106). */
export interface OfficialTournamentResults {
  tournament: TournamentSummary;
  publishedAt: string | null;
  participants: number;
  rules: RankingRulesView;
  results: TournamentResultView[];
  me: MyTournamentResult | null;
  share: string;
}

/** Un tournoi terminé de mon historique de résultats (GET /api/tournaments/results). */
export interface TournamentResultsHistoryItem {
  tournamentId: string;
  status: TournamentStatus;
  timezone: string;
  startsAt: string;
  endsAt: string;
  participants: number;
  resultsPublishedAt: string;
  myRank: number;
  myScore?: number;
}

export interface TournamentResultsHistoryPage {
  tournaments: TournamentResultsHistoryItem[];
  nextBefore: string | null;
}

/** MON contexte dans un tournoi (HUD de la table) : jetons de CE tournoi seulement. */
export interface TournamentContext {
  tournamentId: string;
  status: TournamentStatus;
  startsAt: string;
  endsAt: string;
  serverNow: string;
  participation: 'ACTIVE' | 'OUT_OF_TOKENS' | 'FINISHED';
  tokensAllocatedAtStart: number;
  tokensRemaining: number;
  gamesPlayed: number;
  gamesWon: number;
  stakePerGame: number;
  rank: number;
  rankIsOfficial: boolean;
  participants: number;
  score: number;
  rules: RankingRulesView;
}

/** Vue d'un tournoi pour le joueur connecté (GET /api/tournaments/…). */
/**
 * Prochain tournoi à venir auquel le joueur est inscrit (D-059), choisi par le serveur sur son
 * horloge : seulement ce que l'accueil affiche. Instants ISO 8601 (UTC).
 */
/**
 * Règles de création d'un tournoi réglées dans les Paramètres des tournois (D-103, D-104),
 * lues sur le serveur (GET /api/tournaments/rules). `maximumPlayers` `null` = aucun plafond.
 */
export interface TournamentCreationRules {
  minimumPlayers: number;
  maximumPlayers: number | null;
  minimumDurationMinutes: number;
  maximumDurationMinutes: number;
  /** Prix d'entrée minimal réglé (FCFA, D-105, 500 par défaut) et maximal de la plateforme. */
  minimumEntryFee: number;
  maximumEntryFee: number;
}

export interface NextTournament {
  tournamentId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}

export interface TournamentView {
  tournamentId: string;
  status: TournamentStatus;
  creatorType: 'ADMIN' | 'PLAYER';
  timezone: string;
  /** Instants ISO 8601 (UTC). */
  startsAt: string;
  endsAt: string;
  registrationClosesAt: string;
  /** Prix d'entrée, réservé à l'inscription, débité au démarrage. */
  entryFee: number;
  currency: 'XAF';
  minimumPlayers: number;
  maximumPlayers?: number;
  platformFeePercent?: number;
  /** Poids du classement copiés à la publication (D-062), en %. */
  rankingWeights?: { tokensPercent: number; gamesPercent: number };
  initialTournamentTokens: number;
  stakePerGame: number;
  prizeRules: { rank: number; percent: number }[];
  cancellationReason?: TournamentCancellationReason;
  pool?: {
    participants: number;
    grossPool: number;
    platformFee: number;
    prizePool: number;
    unallocatedPrize?: number;
  };
  registeredCount: number;
  registration: {
    status: 'REGISTERED';
    registeredAt: string;
    reservation?: {
      amount: number;
      currency: 'XAF';
      status: 'ACTIVE' | 'CAPTURED' | 'RELEASED' | 'EXPIRED';
    };
  } | null;
  /** Compte temporaire dans le tournoi (jetons de tournoi), dès le démarrage. */
  account: {
    currentTokens: number;
    initialTokens: number;
    gamesPlayed: number;
    gamesWon: number;
    status: 'ACTIVE' | 'OUT_OF_TOKENS';
    rank?: number;
    prizeAmount: number;
  } | null;
  /** Les trois premiers, dès que les résultats sont validés. */
  podium: TournamentResultView[];
  /** Indications d'affichage du serveur ; chaque action reste revérifiée par lui. */
  canRegister: boolean;
  canUnregister: boolean;
  canJoin: boolean;
  /** Heure du serveur au moment de la réponse (compte à rebours, échéances). */
  serverNow: string;
}

/**
 * Liste des tournois (GET /api/tournaments, D-065) : publiés à venir ou en cours (début le
 * plus proche d'abord), puis l'historique récent ; chacun avec MON inscription.
 */
export interface TournamentList {
  tournaments: TournamentView[];
  history: TournamentView[];
  serverNow: string;
}

/** Table attribuée par le serveur : l'écran de jeu s'ouvre sur `gameId`. */
export interface TournamentSeat {
  tournamentId: string;
  sessionId: string;
  gameId: string;
}

export interface TournamentResults {
  results: TournamentResultView[];
  /** Résumé à partager (WhatsApp…) : la source officielle reste Le Ter. */
  share: string;
}

export type AppNotificationType =
  | 'TOURNAMENT_APPROVED'
  | 'TOURNAMENT_REGISTRATION_CONFIRMED'
  | 'TOURNAMENT_CANCELLED'
  | 'TOURNAMENT_STARTED'
  | 'TOURNAMENT_RESULTS_AVAILABLE'
  | 'TOURNAMENT_PRIZE_CREDITED'
  | 'TOURNAMENT_TABLE_CLOSED'
  /** Avertissement de l'administration (D-079) : `payload.message` est le texte à afficher. */
  | 'MODERATION_WARNING';

export interface AppNotification {
  id: string;
  type: AppNotificationType;
  payload: {
    tournamentId?: string;
    /** Début du tournoi (ISO 8601) : les tournois n'ont plus de nom (D-060). */
    startsAt?: string;
    reason?: TournamentCancellationReason;
    amount?: number;
    rank?: number;
    reservedAmount?: number;
    prizeAmount?: number;
    score?: number;
    /** Avertissement (D-079) : message rédigé par l'administration, en texte brut. */
    message?: string;
    /** Approbation reçue par un préinscrit, pas par le créateur (D-108). */
    preRegistered?: boolean;
  };
  createdAt: string;
  readAt?: string;
}

/** Tournoi tel que le renvoient les listes (mes propositions, administration). */
export type TournamentSummary = Omit<
  TournamentView,
  | 'registration'
  | 'account'
  | 'podium'
  | 'canRegister'
  | 'canUnregister'
  | 'canJoin'
  | 'serverNow'
  | 'registeredCount'
> & {
  /** Administration : inscrits actifs, pseudo du créateur, date de création. */
  registeredCount?: number;
  creatorName?: string;
  createdAt?: string;
};

/** Corps accepté par POST /api/tournaments et POST /api/admin/tournaments. */
export interface TournamentProposalInput {
  timezone?: string;
  /** ISO 8601 avec fuseau. */
  startsAt: string;
  endsAt: string;
  entryFee: number;
  minimumPlayers: number;
  maximumPlayers?: number;
  prizeRules: { rank: number; percent: number }[];
}

/** Paramètres plateforme (rôle admin). */
export interface TournamentSettings {
  platformFeePercent: number;
  /** Jetons de départ = prix d'entrée × coefficient (D-071), calculés par le serveur. */
  initialTokensCoefficient: number;
  /** Mise par partie = prix d'entrée × coefficient (D-071), calculée par le serveur. */
  stakePerGameCoefficient: number;
  maximumPendingTournamentsPerPlayer: number;
  tournamentTransitionMinutes: number;
  /** Poids du classement (D-062), en % ; somme exactement 100 (vérifiée par le serveur). */
  rankingTokensWeightPercent: number;
  rankingGamesWeightPercent: number;
  /** Prix d'entrée minimal pour créer un tournoi, en FCFA (D-105, 500 par défaut). */
  tournamentMinimumEntryFee: number;
}

/** Inscription vue par l'administration. */
export interface AdminRegistration {
  username: string;
  status: 'REGISTERED' | 'CANCELLED';
  registeredAt: string;
  cancelledAt?: string;
  reservation?: {
    amount: number;
    status: 'ACTIVE' | 'CAPTURED' | 'RELEASED' | 'EXPIRED';
  };
}
