/**
 * Session (D-033, D-034) telle que l'API l'envoie : une table de jeu sur laquelle se
 * succèdent plusieurs parties. Types d'affichage seulement : le serveur décide de tout
 * (J1, sièges, ouverture, fermeture, départs automatiques).
 */
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
}

export interface SessionView {
  sessionId: string;
  version: number;
  status: SessionStatus;
  creatorId: string;
  /** 2, 3 ou 4, fixé à la création, immuable. */
  maxPlayers: number;
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
  endReason?: 'INSTANT_WIN' | 'CONTROL_AFTER_LAST_TRICK' | 'INSTANT_WIN_TIE' | 'ADMIN_STOP';
  replayOfGameId?: string;
  maxPlayers: number;
  playerIds: string[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}
