/**
 * Session (D-033, D-034) telle que l'API l'envoie : une table de jeu sur laquelle se
 * succèdent plusieurs parties. Types d'affichage seulement : le serveur décide de tout
 * (J1, sièges, ouverture, fermeture, départs automatiques).
 */
import type { GaramVariant } from './game';

export type SessionStatus = 'open' | 'closed';

export interface SessionPlayer {
  playerId: string;
  /** Siège FIXE (0 … maxPlayers-1) ; l'ordre croissant est le sens antihoraire du jeu. */
  seat: number;
  active: boolean;
  joinedAt: string;
  leftAt?: string;
}

/** Un siège de la table : son occupant, ou `null` s'il est vacant. */
export interface SessionSeat {
  seat: number;
  playerId: string | null;
}

export type DecisionChoice = 'continue' | 'leave' | 'auto_leave';

/** Ronde Poursuivre / Quitter après une partie (10 s, décidée par le serveur). */
export interface SessionDecision {
  gameId: string;
  deadlineAt: string;
  open: boolean;
  resolvedAt?: string;
  decisions: { playerId: string; choice: DecisionChoice; decidedAt: string }[];
  pendingPlayerIds: string[];
  /**
   * Pour le joueur qui lit la vue, réponse attendue : « Poursuivre » permis par le serveur
   * (solde disponible ≥ 2 × mise, D-073). Absent : non vérifié ; « Poursuivre » n'est pas proposé.
   */
  canContinue?: boolean;
}

export interface SessionView {
  sessionId: string;
  /** Jeu de la table (D-119) ; absent : Le Ter. */
  gameType?: GameType;
  /** GARAM TIA : variante de la table (D-127). */
  garamVariant?: GaramVariant;
  version: number;
  status: SessionStatus;
  creatorId: string;
  /** 2, 3 ou 4, fixé à la création, immuable. */
  maxPlayers: number;
  /** Nom de la partie privée (D-039). */
  name?: string;
  /** Protégée par un mot de passe (le mot de passe ne revient jamais du serveur). */
  hasPassword: boolean;
  /** Réglage « détection anti-collusion » choisi à la création, immuable (D-043). */
  suspicionDetectionEnabled: boolean;
  seats: SessionSeat[];
  /** Tous les joueurs passés par la session (présents d'abord). */
  players: SessionPlayer[];
  currentGame: { gameId: string; status: 'waiting' | 'in_progress'; playerIds: string[] } | null;
  decision: SessionDecision | null;
  createdAt: string;
  closedAt?: string;
  /** Heure du serveur à la réponse : aligne les comptes à rebours sur son horloge. */
  serverNow: string;
}

/** Une partie de l'historique d'une session (aucune carte). */
export interface SessionGameSummary {
  gameId: string;
  status: 'waiting' | 'in_progress' | 'finished';
  creatorId: string;
  firstPlayerId?: string;
  winnerId?: string;
  endReason?:
    | 'INSTANT_WIN'
    | 'CONTROL_AFTER_LAST_TRICK'
    | 'OPPONENT_FLED'
    | 'INSTANT_WIN_TIE'
    | 'ADMIN_STOP';
  replayOfGameId?: string;
  maxPlayers: number;
  playerIds: string[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * Table ouverte à rejoindre (liste « Rechercher une partie ») : une partie en attente avec
 * une place libre. L'utilisateur n'y voit qu'une PARTIE : l'identifiant de session reste
 * technique et n'est jamais affiché.
 */
/** Jeu d'une table (D-119) : Le Ter (absent ou 'TER') ou GARAM TIA. */
export type GameType = 'TER' | 'GARAM';

export interface OpenTable {
  sessionId: string;
  /** Jeu de la table ; absent : Le Ter. */
  gameType?: GameType;
  /** GARAM TIA : variante de la table (D-127). */
  garamVariant?: GaramVariant;
  gameId: string;
  /**
   * Nom choisi à la création (D-039). Absent pour les tables de l'ancien écran « Nouvelle
   * session » : elles ne sont pas des parties privées et ne sont pas listées.
   */
  name?: string;
  /** Pseudo du créateur de la partie. */
  creatorName: string;
  /** Mise indicative (R-13 : aucun mouvement de jetons n'existe encore). */
  stakeAmount?: number;
  /** 🔒 : un mot de passe est demandé pour rejoindre. */
  hasPassword: boolean;
  /** 🛡️ : réglage « détection anti-collusion » de la partie, valeur du serveur (D-043). */
  suspicionDetectionEnabled: boolean;
  /** Ma propre partie (à reprendre, pas à rejoindre). */
  mine: boolean;
  maxPlayers: number;
  playerCount: number;
  createdAt: string;
}
