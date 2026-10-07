import type { Game } from '../domain/game/game';
import type { PlayerId } from '../domain/game/game-id';
import type {
  LastGameInfo,
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
export interface SessionRepository extends SessionSeatLookup {
  /** Session + son créateur + sa première partie, en UNE transaction. */
  createWithFirstGame(session: Session, game: Game): Promise<void>;

  findById(sessionId: SessionId): Promise<Session | null>;

  /** Dernière partie de la session (lecture sans verrou, pour les vues). */
  findLastGame(sessionId: SessionId): Promise<LastGameInfo | null>;

  /** Sessions ouvertes où le joueur est présent (au plus une, D-034). */
  findActiveByPlayer(playerId: PlayerId): Promise<Session[]>;

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
