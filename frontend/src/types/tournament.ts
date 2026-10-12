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
}

/** Vue d'un tournoi pour le joueur connecté (GET /api/tournaments/…). */
/**
 * Prochain tournoi à venir auquel le joueur est inscrit (D-059), choisi par le serveur sur son
 * horloge : seulement ce que l'accueil affiche. Instants ISO 8601 (UTC).
 */
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
    /** Avertissement (D-079) : message rédigé par l'administration, en texte brut. */
    message?: string;
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
