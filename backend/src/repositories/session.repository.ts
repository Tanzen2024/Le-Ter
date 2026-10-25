import type { Game, GameType } from '../domain/game/game';
import type { GaramVariant } from '../domain/garam/garam-rules';
import type { PlayerId } from '../domain/game/game-id';
import type {
  LastGameInfo,
  LeaveTransition,
  Session,
  SessionGameSummary,
  SessionId,
  SessionTransition,
} from '../domain/sessions/session';
import type { SessionSeatLookup } from '../services/game/game.service';

/** Contexte d'une mutation, lu SOUS VERROU de la session. */
export interface SessionContext {
  session: Session;
  /**
   * Partie la plus récente de la session (les parties sont successives : si une partie
   * est active, c'est celle-ci), ou null.
   */
  lastGame: LastGameInfo | null;
}

/** Contexte d'un départ (R-19, D-037), lu SOUS VERROU de la partie active et de la session. */
export interface LeaveContext extends SessionContext {
  /** La partie la plus récente si elle est EN ATTENTE (agrégat complet, verrouillé). */
  waitingGame: Game | null;
  /** La session a au moins une partie terminée (historique à conserver, Q1). */
  hasFinishedGames: boolean;
}

/**
 * Ce qu'un départ enregistre, en UNE transaction : la session (ou sa suppression) et sa
 * partie en attente (mise à jour ou suppression).
 */
export interface LeaveWrite extends LeaveTransition {
  /** Partie en attente à enregistrer, avec la version lue sous verrou. */
  savedGame?: { game: Game; expectedVersion: number };
}

/**
 * Ce qu'une arrivée enregistre, en UNE transaction (D-153) : la session et, si elle en a
 * une, sa partie en attente avec le nouveau joueur. Jamais un siège sans place dans la partie.
 */
export interface JoinWrite extends SessionTransition {
  /** Partie en attente à enregistrer, avec la version lue sous verrou. */
  savedGame?: { game: Game; expectedVersion: number };
}

/**
 * Table ouverte que l'on peut rejoindre (liste « Rechercher une partie ») : session ouverte,
 * partie EN ATTENTE, au moins un siège libre. Aucune carte, aucune donnée de compte hormis le
 * pseudo (nom visible en jeu) du créateur de la partie.
 */
export interface OpenTableSummary {
  sessionId: SessionId;
  /** Jeu de la table (D-119) ; absent : Le Ter. */
  gameType?: GameType;
  /** GARAM TIA : variante de la table (D-127). */
  garamVariant?: GaramVariant;
  gameId: string;
  /** Nom choisi à la création (absent pour les tables antérieures à D-039). */
  name?: string;
  creatorName: string;
  /** Mise de la partie en attente (indicative, R-13). */
  stakeAmount?: number;
  /** Protégée par un mot de passe (jamais le hash). */
  hasPassword: boolean;
  /** Réglage « détection anti-collusion » choisi à la création (D-043). */
  suspicionDetectionEnabled: boolean;
  /** Le joueur qui consulte y est présent (sa propre partie, à reprendre). */
  mine: boolean;
  maxPlayers: number;
  /** Joueurs de la partie en attente. */
  playerCount: number;
  createdAt: Date;
}

/** Échéance d'une ronde Poursuivre/Quitter non résolue (réarmement des timers). */
export interface PendingDecisionDeadline {
  sessionId: SessionId;
  deadlineAt: Date;
}

/**
 * Persistance des sessions (port, D-033, D-034). Les sessions de JEU (tables
 * multi-parties) ; à ne pas confondre avec les sessions d'authentification
 * (auth-session.repository.ts).
 *
 * Toute mutation verrouille la ligne de la session et ses joueurs (`FOR UPDATE`) :
 * arrivées, départs, décisions, fermeture et création de partie d'une même session
 * s'exécutent l'un après l'autre, sur toutes les instances du backend. Les fonctions
 * `change` / `build` sont PURES et synchrones : aucune lecture ni écriture sous verrou.
 */
/** Rattachement d'une nouvelle session à un tournoi (D-054). */
export interface TournamentTableClaim {
  tournamentId: string;
  linkId: string;
}

export interface SessionRepository extends SessionSeatLookup {
  /**
   * Session + son créateur + sa première partie, en UNE transaction. Table de tournoi
   * (D-054) : dans la même transaction, verrou du tournoi, contrôle (tournoi en cours, aucune
   * table du tournoi encore joignable) et rattachement `tournament_sessions` : la table n'est
   * jamais visible comme table ordinaire, et deux instances n'ouvrent pas deux tables à la fois.
   */
  createWithFirstGame(
    session: Session,
    game: Game,
    tournament?: TournamentTableClaim,
  ): Promise<void>;

  findById(sessionId: SessionId): Promise<Session | null>;

  /** Dernière partie de la session (lecture sans verrou, pour les vues). */
  findLastGame(sessionId: SessionId): Promise<LastGameInfo | null>;

  /** Sessions ouvertes où le joueur est présent (au plus une, D-034). */
  findActiveByPlayer(playerId: PlayerId): Promise<Session[]>;

  /**
   * Tables ouvertes à rejoindre (lecture sans verrou, purement indicative : l'arrivée reste
   * validée sous verrou par `update`), les plus récentes d'abord ; `mine` marque celle où le
   * joueur est déjà présent.
   */
  /** Tables ouvertes d'UN jeu (D-119) ; par défaut Le Ter. */
  findOpenTables(
    viewerId: PlayerId,
    limit: number,
    gameType?: GameType,
  ): Promise<OpenTableSummary[]>;

  /** Applique `change` au contexte verrouillé ; enregistre si des événements sont produits. */
  update<R extends SessionTransition>(
    sessionId: SessionId,
    change: (context: SessionContext) => R,
  ): Promise<R>;

  /**
   * Comme `update`, et insère en plus la partie produite par `build`, dans la même
   * transaction (une seule partie active par session, garanti en base).
   */
  createNextGame<R extends SessionTransition & { game: Game }>(
    sessionId: SessionId,
    build: (context: SessionContext) => R,
  ): Promise<R>;

  /**
   * Départ d'un joueur (R-19, D-037), en UNE transaction : verrou de la partie active PUIS de
   * la session (même ordre que les écritures de partie, sans interblocage), puis selon
   * `change` : partie en attente mise à jour ou supprimée, session enregistrée ou supprimée.
   */
  leave<R extends LeaveWrite>(
    sessionId: SessionId,
    change: (context: LeaveContext) => R,
  ): Promise<R>;

  /**
   * Arrivée d'un joueur (D-153), en UNE transaction : mêmes verrous et même ordre que
   * `leave` (partie active PUIS session), puis session et partie en attente enregistrées
   * ensemble. Une partie refusée (R-18 : joueur déjà dans une autre partie active) annule
   * aussi le siège.
   */
  join<R extends JoinWrite>(sessionId: SessionId, change: (context: LeaveContext) => R): Promise<R>;

  /** Historique des parties de la session, les plus anciennes d'abord (sans aucune carte). */
  listGames(sessionId: SessionId): Promise<SessionGameSummary[]>;

  /** Rondes de décision non résolues (reprise après redémarrage, balayage). */
  findPendingDecisionDeadlines(): Promise<PendingDecisionDeadline[]>;

  /**
   * Sessions ouvertes dont la dernière partie est terminée sans ronde de décision
   * (processus arrêté entre la fin de partie et l'ouverture de la ronde, ou partie arrêtée
   * par un outil d'administration) : la ronde doit être ouverte.
   */
  findSessionsAwaitingDecisionRound(): Promise<SessionId[]>;

  /**
   * Sessions ouvertes dont la dernière partie a été annulée pour égalité de priorité et
   * pas encore rejouée (reprise après un arrêt du processus).
   */
  findSessionsAwaitingReplay(): Promise<SessionId[]>;
}
