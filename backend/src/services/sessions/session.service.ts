import { randomUUID } from 'node:crypto';

import { isReplayEndReason, type Game, type GameType } from '../../domain/game/game';
import { ParticipationRefusedError } from '../../domain/game/game-errors';
import type { PlayerId } from '../../domain/game/game-id';
import { InsufficientBalanceForStakeError, InvalidGameStakeError } from '../../domain/rules/stake';
import {
  FirstPlayerUndeterminedError,
  NotASessionMemberError,
  PlayerAlreadyInSessionError,
  SESSION_DECISION_WINDOW_MS,
  SessionClosedError,
  SessionDecisionInProgressError,
  SessionGameInProgressError,
  SessionMaxPlayersImmutableError,
  SessionNotFoundError,
  SessionPasswordInvalidError,
  activeSessionPlayers,
  arrivalOrder,
  decide,
  isActiveSessionMember,
  isRoundOpen,
  joinSession,
  lastTrickPresentationMs,
  leaveSession,
  newSession,
  pendingDecisions,
  seatMap,
  syncDecisionRound,
  type LastGameInfo,
  type Session,
  type SessionGameSummary,
  type SessionId,
  type SessionTransition,
} from '../../domain/sessions/session';
import type { SessionEventDraft } from '../../domain/sessions/session-events';
import { PasswordService } from '../auth/password.service';
import type { GameEventDraft } from '../../domain/game/game-events';
import { determineFirstPlayer, nextDealer } from '../../domain/sessions/table-order';
import { garamRevealPresentationMs } from '../../domain/garam/garam-rules';
import { DuplicateCreationKeyError } from '../../repositories/game.repository';
import type {
  LeaveWrite,
  OpenTableSummary,
  SessionContext,
  SessionRepository,
} from '../../repositories/session.repository';
import { BackgroundTasks } from '../../utils/background-tasks';
import type { Logger } from '../../utils/logger';
import type { SessionEventPublisher } from '../../websocket/session-event-publisher';
import type { DetectionGlobalSwitch } from '../detection/detection-settings.service';
import type { CreateGameOptions, GameService } from '../game/game.service';
import { SessionTimerRegistry } from '../game/game-timer-registry';

/** Nombre maximal de tables ouvertes renvoyées par la liste « Rechercher une partie ». */
const OPEN_TABLES_LIMIT = 30;

/** Paramètres de création d'une session (et de sa première partie). */
export type NewSessionOptions = Pick<
  CreateGameOptions,
  'maxPlayers' | 'stakeAmount' | 'creationKey' | 'autoStartDelayMs' | 'gameType' | 'garamVariant'
> & {
  /** Nom de la partie privée (D-039), déjà validé (1 à 40 caractères). */
  name?: string;
  /** Mot de passe facultatif en clair (D-039) : haché ici, jamais enregistré ni journalisé. */
  password?: string;
  /** Réglage « détection anti-collusion » (D-043) ; faux par défaut, immuable. */
  suspicionDetectionEnabled?: boolean;
  /**
   * Table de tournoi (D-054) : rattachée au tournoi dans la MÊME transaction que sa création,
   * sous verrou du tournoi (voir SessionRepository.createWithFirstGame).
   */
  tournamentId?: string;
};

/** Hachage des mots de passe de partie (bcrypt, comme les comptes). */
export interface TablePasswordHasher {
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
}

/**
 * Contrôle d'accès FACULTATIF à l'arrivée dans une session, pour un joueur qui n'y est pas
 * déjà présent. Sans politique, toute session ouverte reste joignable (règles D-033, D-034
 * inchangées). Tournois (D-051) : une table de tournoi est réservée aux inscrits pendant le
 * tournoi. Lève une erreur pour refuser.
 */
export interface SessionAdmissionPolicy {
  assertCanJoin(sessionId: SessionId, playerId: PlayerId): Promise<void>;
}

/**
 * Paramètres de la partie suivante. `maxPlayers` est celui de la session (immuable) :
 * s'il est fourni, il doit être identique.
 */
export type NextGameOptions = Partial<Pick<CreateGameOptions, 'maxPlayers'>> &
  Pick<CreateGameOptions, 'stakeAmount' | 'creationKey'>;

export interface SessionServiceDependencies {
  sessions: SessionRepository;
  games: GameService;
  publisher: SessionEventPublisher;
  logger: Logger;
  clock?: () => Date;
  /** Timers de décision (un par session). */
  timers?: SessionTimerRegistry;
  /** Délai Poursuivre/Quitter. Par défaut SESSION_DECISION_WINDOW_MS (13 s dont 10 s affichées, D-098). */
  decisionWindowMs?: number;
  /** Mots de passe de partie (D-039). Par défaut bcrypt au coût des comptes. */
  passwords?: TablePasswordHasher;
  /**
   * « Poursuivre » enchaîne directement la partie suivante (D-042) : créée et distribuée par
   * le serveur dès la clôture de la ronde. Vrai par défaut ; les tests qui créent la partie
   * suivante eux-mêmes (API historique) le désactivent.
   */
  autoNextGame?: boolean;
  /**
   * Durée de présentation du 5e tour, ajoutée avant la ronde (D-041). Par défaut le rythme
   * des écrans (`lastTrickPresentationMs`) ; 0 dans les tests qui ne portent pas dessus.
   */
  lastTrickPresentationMs?: (cards: number) => number;
  /**
   * GARAM TIA : présentation de fin d'une manche gagnée (révélation des mains, totaux,
   * gagnant, D-128), ajoutée avant la ronde. Par défaut `garamRevealPresentationMs` ; 0 dans
   * les tests qui ne portent pas dessus.
   */
  garamRevealPresentationMs?: (players: number) => number;
  /** Accès aux sessions réservées (tables de tournoi, D-051) ; absent : aucune restriction. */
  admission?: SessionAdmissionPolicy;
  /**
   * Nouvelle partie dans une session (suivante, automatique ou demandée, et reprise après
   * égalité) ; absente : toujours permise. Tables de tournoi : rien après la fin (D-056).
   */
  continuation?: SessionContinuationPolicy;
  /**
   * Interrupteur GLOBAL de la détection (D-053), relu dans PostgreSQL. Désactivé : l'option
   * « Détection anti-collusion » n'est ni proposée aux joueurs ni enregistrée (D-081).
   * Absent (tests) : l'option est toujours proposée.
   */
  detectionSwitch?: DetectionGlobalSwitch;
}

/** Politique FACULTATIVE de création d'une nouvelle partie dans une session existante. */
export interface SessionContinuationPolicy {
  allowsNewGame(sessionId: SessionId): Promise<boolean>;
  /** Partie automatique refusée : informer les joueurs (idempotent). */
  onNewGameRefused?(sessionId: SessionId, playerIds: PlayerId[]): Promise<void>;
  /**
   * Joueurs présents qui ne peuvent PAS jouer la partie suivante (tables de tournoi : seuil
   * de jetons, D-063), après la partie terminée `previous`. Ils quittent la session avant
   * la création de la partie suivante ; absente : personne n'est écarté.
   */
  playersBarredFromNextGame?(
    sessionId: SessionId,
    playerIds: PlayerId[],
    previous: Game,
  ): Promise<PlayerId[]>;
  /**
   * « Poursuivre » pendant la ronde (D-073) : lève l'erreur de refus si le joueur ne pourra
   * pas jouer la partie suivante (`previous` : partie terminée dont la mise est reprise).
   * Absente : aucun contrôle avant la clôture de la ronde.
   */
  assertCanContinue?(sessionId: SessionId, playerId: PlayerId, previous: Game): Promise<void>;
}

interface CallMeta {
  requestId?: string;
}

/** Vue d'une session pour un joueur : la session et sa partie la plus récente. */
export interface SessionSnapshot {
  session: Session;
  lastGame: LastGameInfo | null;
  /**
   * Ronde ouverte et réponse du joueur attendue : peut-il choisir « Poursuivre » (solde
   * disponible relu dans PostgreSQL, D-073) ? `undefined` : sans objet, ou non vérifiable.
   */
  viewerCanContinue?: boolean;
}

/**
 * Orchestration des SESSIONS (D-033, D-034) : capacité, joueurs présents, sièges fixes,
 * parties successives, J1 de chaque partie, ronde Poursuivre/Quitter entre deux parties
 * (timer A, AUTO_LEAVE), ouverture et fermeture. Ne contient AUCUNE règle de jeu :
 * distribution, coups, contrôle, timer de tour, fuite et victoire restent dans GameService
 * et le moteur.
 *
 * L'identité de l'acteur vient toujours de l'appelant authentifié (JWT), jamais du client.
 * Toute mutation passe par `mutate` : verrou de la session, mise à jour de la ronde de
 * décision (échéance comprise), transition pure, enregistrement, PUIS événements et timer.
 */
export class SessionService {
  private readonly clock: () => Date;
  private readonly timers: SessionTimerRegistry;
  private readonly windowMs: number;
  private readonly passwords: TablePasswordHasher;
  private readonly presentationMs: (cards: number) => number;
  private readonly garamPresentationMs: (players: number) => number;
  private readonly autoNextGame: boolean;
  private readonly background = new BackgroundTasks();

  constructor(private readonly deps: SessionServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
    this.timers = deps.timers ?? new SessionTimerRegistry();
    this.windowMs = deps.decisionWindowMs ?? SESSION_DECISION_WINDOW_MS;
    this.passwords = deps.passwords ?? new PasswordService();
    this.presentationMs = deps.lastTrickPresentationMs ?? lastTrickPresentationMs;
    this.garamPresentationMs = deps.garamRevealPresentationMs ?? garamRevealPresentationMs;
    this.autoNextGame = deps.autoNextGame ?? true;
    // Fin d'une partie → ronde Poursuivre/Quitter. Si ce processus s'arrête avant, la
    // reprise (`recoverDecisionTimers`) ou la prochaine mutation de la session l'ouvre,
    // avec la même échéance (fin de partie + 10 s).
    // GARAM TIA (§3.16) : un joueur retiré d'une manche faute de solde quitte la table.
    deps.games.onPlayersWithdrawn((game, playerIds) => {
      const { sessionId } = game;
      if (!sessionId) return;
      for (const playerId of playerIds) {
        this.background.run(() =>
          this.leaveSession(sessionId, playerId).then(
            () => undefined,
            (err: unknown) =>
              deps.logger.error('withdrawn player removal failed', {
                sessionId,
                gameId: game.id,
                error: err instanceof Error ? err.message : String(err),
              }),
          ),
        );
      }
    });
    deps.games.onGameFinished((game) => {
      const { sessionId } = game;
      if (sessionId) {
        this.background.run(() =>
          this.syncSession(sessionId).catch((err: unknown) =>
            deps.logger.error('decision round opening failed', {
              sessionId,
              gameId: game.id,
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        );
      }
    });
  }

  /**
   * Crée une session (capacité 2, 3 ou 4, immuable) avec sa première partie, en UNE
   * transaction. Le créateur occupe le siège 0 et est J1 de cette partie. Idempotent par
   * `creationKey`. Refusé si le créateur est déjà présent dans une autre session.
   */
  async createSession(
    creatorId: PlayerId,
    options: NewSessionOptions,
    meta: CallMeta = {},
  ): Promise<{ session: Session; game: Game; replayed: boolean }> {
    const log = this.log(creatorId, 'CREATE_SESSION', meta);
    const { name, password, suspicionDetectionEnabled, tournamentId, ...gameOptions } = options;
    const replay = async () => {
      const game = await this.deps.games.findCreationReplay(creatorId, gameOptions, log);
      return game?.sessionId ? { session: await this.load(game.sessionId), game } : undefined;
    };
    try {
      const replayed = await replay();
      if (replayed) {
        return { ...replayed, replayed: true };
      }
      const passwordHash =
        password !== undefined ? await this.passwords.hashPassword(password) : undefined;
      // Détection coupée par l'administration (D-081) : l'option n'est pas proposée ; une
      // demande venant d'un ancien client n'active jamais la table.
      // GARAM TIA : la détection anti-collusion s'y applique comme au Ter (D-125) : même
      // option de table, même interrupteur global. Variante obligatoire, vérifiée par
      // GameService avant tout enregistrement (D-127) ; tables de tournoi GARAM permises.
      const garam = options.gameType === 'GARAM';
      const detection = suspicionDetectionEnabled === true && (await this.isDetectionAvailable());
      const session = newSession(creatorId, options.maxPlayers, this.clock(), {
        name,
        passwordHash,
        suspicionDetectionEnabled: detection,
        ...(garam && { gameType: 'GARAM' as const, garamVariant: options.garamVariant }),
      });
      let game: Game;
      try {
        game = await this.deps.games.prepareNewGame(creatorId, {
          ...gameOptions,
          sessionId: session.id,
          firstPlayerId: creatorId, // première partie : J1 = créateur de la session
          creatorTablePosition: 0,
          // Table de tournoi : jetons de tournoi, hors mise du compte de jeu (D-073).
          ...(tournamentId !== undefined && { tournamentTable: true, tournamentId }),
        });
        await this.deps.sessions.createWithFirstGame(
          session,
          game,
          tournamentId ? { tournamentId, linkId: randomUUID() } : undefined,
        );
      } catch (err) {
        // Même clé envoyée en même temps : l'autre requête a créé la session pendant que
        // celle-ci était refusée (clé déjà prise, ou créateur déjà dans la partie/session
        // créée par cette même intention). On renvoie la création existante.
        const existing = isCreationRace(err) ? await replay() : undefined;
        if (existing) {
          return { ...existing, replayed: true };
        }
        throw err;
      }
      this.publish(
        session,
        [
          {
            type: 'session:created',
            payload: { gameId: game.id, maxPlayers: session.maxPlayers, seat: 0 },
          },
        ],
        creatorId,
      );
      this.deps.games.announceCreated(game, log);
      log.info('session created', {
        sessionId: session.id,
        gameId: game.id,
        version: session.version,
      });
      return { session, game, replayed: false };
    } catch (err) {
      this.logRejection(log, err);
      throw err;
    }
  }

  /**
   * Crée la partie SUIVANTE d'une session ouverte (D-033, D-034). Sous verrou de la
   * session : le créateur doit être présent, aucune partie active, aucune ronde de
   * décision ouverte ; capacité = celle de la session ; J1 = gagnant de la dernière partie
   * s'il est présent, sinon premier siège occupé après le sien (sens antihoraire).
   */
  async createNextGame(
    sessionId: SessionId,
    creatorId: PlayerId,
    options: NextGameOptions,
    meta: CallMeta = {},
  ): Promise<{ game: Game; replayed: boolean }> {
    const log = this.log(creatorId, 'CREATE_NEXT_GAME', meta).child({ sessionId });
    try {
      const { maxPlayers, gameType, garamVariant } = await this.load(sessionId);
      if (this.deps.continuation && !(await this.deps.continuation.allowsNewGame(sessionId))) {
        throw new SessionClosedError(sessionId);
      }
      const last = await this.deps.sessions.findLastGame(sessionId);
      const previous =
        last?.status === 'finished' ? await this.deps.games.findGame(last.gameId) : null;
      if (previous) await this.removeBarredPlayers(sessionId, previous, log);
      if (options.maxPlayers !== undefined && options.maxPlayers !== maxPlayers) {
        throw new SessionMaxPlayersImmutableError(sessionId, maxPlayers);
      }
      const withSession = {
        ...options,
        maxPlayers,
        sessionId,
        gameType: gameType ?? 'TER',
        ...(garamVariant !== undefined && { garamVariant }),
      };
      const replayed = await this.deps.games.findCreationReplay(creatorId, withSession, log);
      if (replayed) {
        return { game: replayed, replayed: true };
      }
      // Échéance de décision éventuellement dépassée : appliquée et enregistrée d'abord, même
      // si la création est ensuite refusée.
      await this.syncSession(sessionId);
      let result: SessionTransition & { game: Game };
      try {
        // Préparée AVANT le verrou (validation, contrôle R-18 : lectures en base). Sous le
        // verrou de la session, seules des décisions pures : membre, ronde, J1, siège.
        const draft = await this.deps.games.prepareNewGame(creatorId, withSession);
        const now = this.clock();
        result = await this.deps.sessions.createNextGame(sessionId, (ctx) => {
          const synced = this.syncRound(ctx.session, ctx.lastGame, now);
          const session = synced.session;
          if (session.status === 'closed') {
            throw new SessionClosedError(sessionId);
          }
          const creator = session.players.find((p) => p.playerId === creatorId && p.active);
          if (!creator) {
            throw new NotASessionMemberError(sessionId, creatorId);
          }
          if (ctx.lastGame && ctx.lastGame.status !== 'finished') {
            throw new SessionGameInProgressError(sessionId);
          }
          if (isRoundOpen(session)) {
            throw new SessionDecisionInProgressError(sessionId);
          }
          const decision = this.determineFirstPlayer(session, ctx.lastGame);
          if (decision.kind !== 'first') {
            // `none` est impossible ici (le créateur est présent) ; `undetermined` : la
            // dernière partie terminée n'a pas de gagnant, aucune règle ne fixe J1.
            throw new FirstPlayerUndeterminedError(sessionId);
          }
          return {
            ...synced,
            game: {
              ...draft,
              firstPlayerId: decision.playerId,
              players: draft.players.map((p) => ({ ...p, tablePosition: creator.seat })),
            },
          };
        });
      } catch (err) {
        const existing = isCreationRace(err)
          ? await this.deps.games.findCreationReplay(creatorId, withSession, log)
          : undefined;
        if (existing) {
          return { game: existing, replayed: true };
        }
        throw err;
      }
      this.afterCommit(result, creatorId);
      this.deps.games.announceCreated(result.game, log);
      log.info('session game created', {
        gameId: result.game.id,
        firstPlayerId: result.game.firstPlayerId,
      });
      return { game: result.game, replayed: false };
    } catch (err) {
      this.logRejection(log, err);
      throw err;
    }
  }

  /**
   * J1 d'une nouvelle partie (D-033, D-034), à partir du contexte verrouillé : sièges
   * fixes de la session, gagnant et siège du gagnant dans la dernière partie terminée.
   */
  determineFirstPlayer(
    session: Session,
    lastGame: LastGameInfo | null,
  ): ReturnType<typeof determineFirstPlayer<PlayerId>> {
    const seats = seatMap(session);
    const previous = lastGame?.status === 'finished' ? lastGame : null;
    // GARAM TIA (§3.17) : après une manche jouée, le dégagement passe au siège occupé suivant,
    // sens antihoraire ; la manche nulle garde son dégageur (règles communes ci-dessous).
    if (
      session.gameType === 'GARAM' &&
      previous &&
      !isReplayEndReason(previous.endReason) &&
      previous.firstPlayerSeat !== undefined
    ) {
      const dealer = nextDealer(session.maxPlayers, previous.firstPlayerSeat, (seat) => seats[seat]);
      return dealer === undefined ? { kind: 'none' } : { kind: 'first', playerId: dealer };
    }
    return determineFirstPlayer({
      creatorId: session.creatorId,
      arrivalOrder: arrivalOrder(session),
      seatCount: session.maxPlayers,
      occupantOf: (seat) => seats[seat],
      isActive: (id) => isActiveSessionMember(session, id),
      previousGame: previous
        ? {
            ...(previous.winnerId !== undefined && { winnerId: previous.winnerId }),
            ...(previous.winnerSeat !== undefined && { winnerSeat: previous.winnerSeat }),
            ...(isReplayEndReason(previous.endReason) && {
              tieFirstPlayerId: previous.firstPlayerId,
            }),
          }
        : null,
    });
  }

  /**
   * Rejoindre une session ouverte (sans effet si déjà présent) : premier siège vacant.
   * Le joueur ne rejoint JAMAIS la partie en cours ; il attend la suivante.
   */
  /**
   * Arriver dans une session. Partie privée protégée (D-039) : le mot de passe est vérifié
   * pour tout joueur qui n'y est pas déjà présent (le hash est fixé à la création, une
   * vérification avant le verrou suffit).
   */
  async joinSession(
    sessionId: SessionId,
    playerId: PlayerId,
    meta: CallMeta = {},
    password?: string,
  ): Promise<Session> {
    const current = await this.deps.sessions.findById(sessionId);
    if (current && this.deps.admission && !isActiveSessionMember(current, playerId)) {
      await this.deps.admission.assertCanJoin(sessionId, playerId);
    }
    if (current?.passwordHash && !isActiveSessionMember(current, playerId)) {
      const accepted =
        password !== undefined &&
        (await this.passwords.verifyPassword(password, current.passwordHash));
      if (!accepted) {
        this.log(playerId, 'JOIN_SESSION', meta).warn('table password rejected', { sessionId });
        throw new SessionPasswordInvalidError(sessionId);
      }
    }
    return this.mutate(sessionId, 'JOIN_SESSION', playerId, meta, ({ session }, now) =>
      joinSession(session, playerId, now),
    );
  }

  /**
   * Quitter la session (R-19, D-037), en UNE transaction avec sa partie en attente :
   * - partie EN COURS dont le joueur fait partie : refusé (PLAYER_IN_ACTIVE_GAME) ;
   * - ronde Poursuivre/Quitter ouverte : vaut « Quitter » ;
   * - partie EN ATTENTE : le joueur sort de la session (siège vacant) ET de la partie ; J1
   *   et créateur de la partie remplacés selon l'ordre d'arrivée ; partie sans joueur
   *   supprimée ;
   * - dernier joueur : session supprimée (sans historique) ou fermée (avec historique).
   * `deleted` : la session n'existe plus.
   */
  async leaveSession(
    sessionId: SessionId,
    playerId: PlayerId,
    meta: CallMeta = {},
  ): Promise<{ session: Session; deleted: boolean }> {
    const log = this.deps.logger.child({
      sessionId,
      playerId,
      action: 'LEAVE_SESSION',
      requestId: meta.requestId,
    });
    const now = this.clock();
    let refusal: unknown;
    let gameEvents: GameEventDraft[] = [];
    try {
      const result = await this.deps.sessions.leave(sessionId, (ctx): LeaveWrite => {
        const synced = this.syncRound(ctx.session, ctx.lastGame, now);
        try {
          const done = leaveSession(synced.session, playerId, now, {
            lastGame: ctx.lastGame,
            hasFinishedGames: ctx.hasFinishedGames,
          });
          const write: LeaveWrite = { ...done, events: [...synced.events, ...done.events] };
          if (done.waitingGame?.kind === 'remove_player') {
            if (!ctx.waitingGame || ctx.waitingGame.id !== done.waitingGame.gameId) {
              throw new Error('leaveSession : partie en attente non verrouillée');
            }
            const built = this.deps.games.buildWaitingGameDeparture(
              ctx.waitingGame,
              done.waitingGame,
              now,
            );
            gameEvents = built.events;
            write.savedGame = { game: built.game, expectedVersion: ctx.waitingGame.version };
          }
          return write;
        } catch (err) {
          refusal = err;
          return { ...synced, deleteSession: false };
        }
      });
      this.afterCommit(result, playerId, log);
      if (refusal) {
        throw refusal;
      }
      if (result.savedGame) {
        this.deps.games.announceWaitingGameDeparture(result.savedGame.game, gameEvents, playerId);
      }
      if (result.events.length > 0) {
        log.info('SESSION_LEFT', {
          version: result.session.version,
          ...(result.waitingGame && {
            waitingGame: result.waitingGame.kind,
            gameId: result.waitingGame.gameId,
          }),
          ...(result.waitingGame?.kind === 'remove_player' && {
            firstPlayerId: result.waitingGame.firstPlayerId,
            creatorId: result.waitingGame.creatorId,
          }),
          deleted: result.deleteSession,
        });
      }
      return { session: result.session, deleted: result.deleteSession };
    } catch (err) {
      this.logRejection(log, err);
      throw err;
    }
  }

  /**
   * Poursuivre ou Quitter pendant la ronde de décision (D-034). « Poursuivre » est refusé si
   * le joueur ne pourra pas jouer la partie suivante (solde disponible < 2 × mise, D-073) ;
   * la clôture de la ronde et le séquestre au démarrage (D-074) le revérifient sous verrou.
   */
  async decide(
    sessionId: SessionId,
    playerId: PlayerId,
    choice: 'continue' | 'leave',
    meta: CallMeta = {},
  ): Promise<Session> {
    if (choice === 'continue') {
      const previous = await this.roundGame(await this.load(sessionId), playerId);
      if (previous) {
        try {
          await this.deps.continuation?.assertCanContinue?.(sessionId, playerId, previous);
        } catch (err) {
          this.logRejection(this.log(playerId, 'SESSION_DECISION', meta), err);
          throw err;
        }
      }
    }
    return this.mutate(sessionId, 'SESSION_DECISION', playerId, meta, ({ session }, now) =>
      decide(session, playerId, choice, now),
    );
  }

  /** Partie terminée de la ronde ouverte où la réponse du joueur est attendue, sinon null. */
  private async roundGame(session: Session, playerId: PlayerId): Promise<Game | null> {
    const round = session.round;
    if (!round || round.resolvedAt || !pendingDecisions(session).includes(playerId)) return null;
    return this.deps.games.findGame(round.gameId);
  }

  /**
   * Éligibilité à « Poursuivre » pour la vue du joueur : `false` sur un refus de la politique
   * (solde insuffisant, mise invalide), `undefined` si le contrôle n'a pas pu se faire (le
   * client ne propose alors pas « Poursuivre », sans conclure à un solde insuffisant).
   */
  private async viewerCanContinue(
    session: Session,
    playerId: PlayerId,
  ): Promise<boolean | undefined> {
    const policy = this.deps.continuation;
    try {
      const previous = await this.roundGame(session, playerId);
      if (!previous) return undefined;
      if (!policy?.assertCanContinue) return true;
      await policy.assertCanContinue(session.id, playerId, previous);
      return true;
    } catch (err) {
      if (err instanceof InsufficientBalanceForStakeError || err instanceof InvalidGameStakeError) {
        return false;
      }
      this.deps.logger.error('continue eligibility check failed', {
        sessionId: session.id,
        playerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  /**
   * Met la ronde de décision à jour (ouverture après une fin de partie, AUTO_LEAVE à
   * l'échéance). Commande système : déclenchée par la fin d'une partie, par le timer de
   * décision, par la reprise après redémarrage. Idempotente : sans effet si rien n'a changé.
   */
  async syncSession(sessionId: SessionId): Promise<Session> {
    const session = await this.mutate(
      sessionId,
      'SESSION_DECISION_SYNC',
      undefined,
      {},
      ({ session: current }) => ({ session: current, events: [] }),
    );
    await this.ensureReplay(sessionId);
    await this.ensureContinuation(sessionId);
    return session;
  }

  /**
   * PARTIE SUIVANTE APRÈS « POURSUIVRE » (D-042) : dès que la ronde Poursuivre/Quitter est
   * close, le serveur crée la nouvelle partie de la MÊME session avec les joueurs restés
   * (ceux qui ont choisi Poursuivre ; les autres sont déjà partis, D-034), à leurs sièges
   * fixes, J1 selon les règles existantes, et la distribue aussitôt (dès 2 joueurs). Aucune
   * action supplémentaire n'est demandée aux joueurs.
   *
   * Idempotente et sûre en concurrence (clics multiples, timer, plusieurs instances) : sous
   * le verrou de la session, rien n'est fait si une partie plus récente existe déjà ; en
   * base, une seule partie active par session (`games_one_active_per_session`).
   */
  private async ensureContinuation(sessionId: SessionId): Promise<void> {
    if (!this.autoNextGame) return;
    const last = await this.deps.sessions.findLastGame(sessionId);
    if (!last || last.status !== 'finished' || isReplayEndReason(last.endReason)) return;
    const previous = await this.deps.games.findGame(last.gameId);
    if (!previous) return;
    const log = this.deps.logger.child({ sessionId, action: 'CONTINUE_NEXT_GAME' });
    if (!(await this.newGameAllowed(sessionId, previous, log))) return;
    await this.removeBarredPlayers(sessionId, previous, log, { afterResolvedRound: true });
    const now = this.clock();
    let next: SessionTransition & { game: Game; gameEvents: GameEventDraft[] };
    try {
      next = await this.deps.sessions.createNextGame(sessionId, (ctx) => {
        const round = ctx.session.round;
        if (
          ctx.session.status !== 'open' ||
          ctx.lastGame?.gameId !== previous.id ||
          round?.gameId !== previous.id ||
          !round.resolvedAt
        ) {
          throw new ReplayNotNeeded();
        }
        const decision = this.determineFirstPlayer(ctx.session, ctx.lastGame);
        if (decision.kind !== 'first') {
          throw new ContinuationImpossible(decision.kind);
        }
        const seats = activeSessionPlayers(ctx.session).map((p) => ({
          playerId: p.playerId,
          tablePosition: p.seat,
        }));
        const built = this.deps.games.buildNextGame(previous, seats, decision.playerId, now);
        return { session: ctx.session, events: [], game: built.game, gameEvents: built.events };
      });
    } catch (err) {
      if (err instanceof ReplayNotNeeded || err instanceof SessionGameInProgressError) {
        return; // rien à faire, ou déjà créée par une autre commande / instance
      }
      if (err instanceof ContinuationImpossible) {
        log.warn('CONTINUE_NEXT_GAME not possible', { gameId: previous.id, reason: err.reason });
        return;
      }
      throw err;
    }
    log.info('CONTINUE_NEXT_GAME', {
      gameId: next.game.id,
      previousGameId: previous.id,
      firstPlayerId: next.game.firstPlayerId,
      players: next.game.players.length,
      status: next.game.status,
    });
    this.deps.games.announceInserted(next.game, next.gameEvents);
  }

  /**
   * REPRISE IMMÉDIATE après égalité de priorité des mains instantanées (D-035, décisions
   * 17 et 23) : si la dernière partie de la session a été annulée pour égalité, une
   * nouvelle partie la remplace aussitôt, SANS Poursuivre/Quitter : même session, mêmes
   * joueurs présents à leurs sièges, même J1, nouveau mélange des 31 cartes, nouvelle
   * distribution et nouvelle analyse. Répétée tant que l'égalité se reproduit (chaque
   * nouvelle égalité déclenche une nouvelle reprise).
   *
   * Idempotente et sûre en concurrence : sous le verrou de la session, rien n'est fait si
   * la dernière partie n'est plus l'égalité (déjà rejouée) ; en base, une partie annulée
   * n'est rejouée qu'une fois (`games_one_replay_per_game`).
   *
   * Cas NON définis par le socle (aucune règle inventée, journalisés, pas de reprise) :
   * J1 n'est plus dans la session, ou il reste moins de 2 joueurs de la partie annulée.
   */
  private async ensureReplay(sessionId: SessionId): Promise<void> {
    const last = await this.deps.sessions.findLastGame(sessionId);
    if (!last || !isReplayEndReason(last.endReason)) {
      return;
    }
    const previous = await this.deps.games.findGame(last.gameId);
    if (!previous) {
      return;
    }
    const log = this.deps.logger.child({ sessionId, action: 'INSTANT_WIN_REPLAY' });
    if (!(await this.newGameAllowed(sessionId, previous, log))) return;
    const now = this.clock();
    let replay: SessionTransition & { game: Game; gameEvents: GameEventDraft[] };
    try {
      replay = await this.deps.sessions.createNextGame(sessionId, (ctx) => {
        if (
          ctx.session.status === 'closed' ||
          ctx.lastGame?.gameId !== previous.id ||
          !isReplayEndReason(ctx.lastGame.endReason)
        ) {
          throw new ReplayNotNeeded();
        }
        const present = previous.players
          .map((p) => p.playerId)
          .filter((id) => isActiveSessionMember(ctx.session, id));
        if (!present.includes(previous.firstPlayerId) || present.length < 2) {
          throw new ReplayImpossible(present.length, present.includes(previous.firstPlayerId));
        }
        const built = this.deps.games.buildReplayGame(previous, present, now);
        return { session: ctx.session, events: [], game: built.game, gameEvents: built.events };
      });
    } catch (err) {
      if (err instanceof ReplayNotNeeded) {
        return;
      }
      if (err instanceof ReplayImpossible) {
        log.warn('INSTANT_WIN_REPLAY not possible: rule undefined', {
          gameId: previous.id,
          remainingPlayers: err.remaining,
          firstPlayerPresent: err.firstPlayerPresent,
        });
        return;
      }
      if (err instanceof SessionGameInProgressError) {
        return; // rejouée entre-temps par une autre instance
      }
      throw err;
    }
    log.info('INSTANT_WIN_REPLAY', {
      gameId: replay.game.id,
      replayOfGameId: previous.id,
      firstPlayerId: replay.game.firstPlayerId,
    });
    this.deps.games.announceInserted(replay.game, replay.gameEvents);
  }

  /** Session vue par un joueur qui en est ou en a été membre. */
  async getSession(sessionId: SessionId, viewerId: PlayerId): Promise<SessionSnapshot> {
    const session = await this.load(sessionId);
    if (!session.players.some((p) => p.playerId === viewerId)) {
      throw new NotASessionMemberError(sessionId, viewerId);
    }
    const [lastGame, viewerCanContinue] = await Promise.all([
      this.deps.sessions.findLastGame(sessionId),
      this.viewerCanContinue(session, viewerId),
    ]);
    return { session, lastGame, ...(viewerCanContinue !== undefined && { viewerCanContinue }) };
  }

  /** Historique des parties de la session (résumés publics, aucune carte). */
  async listGames(sessionId: SessionId, viewerId: PlayerId): Promise<SessionGameSummary[]> {
    await this.getSession(sessionId, viewerId);
    return this.deps.sessions.listGames(sessionId);
  }

  findActiveSessions(playerId: PlayerId): Promise<Session[]> {
    return this.deps.sessions.findActiveByPlayer(playerId);
  }

  /**
   * Tables ouvertes à rejoindre (partie en attente, siège libre), la sienne marquée `mine`.
   * Lecture indicative : rejoindre reste validé par `joinSession` puis la partie.
   */
  listOpenTables(viewerId: PlayerId, gameType: GameType = 'TER'): Promise<OpenTableSummary[]> {
    return this.deps.sessions.findOpenTables(viewerId, OPEN_TABLES_LIMIT, gameType);
  }

  /**
   * L'option « Détection anti-collusion » peut-elle être proposée aux joueurs ? Suit
   * l'interrupteur global de l'administration (D-053, D-081), relu à chaque appel.
   */
  async isDetectionAvailable(): Promise<boolean> {
    return this.deps.detectionSwitch ? this.deps.detectionSwitch.isGloballyEnabled() : true;
  }

  /**
   * Reconstruit les timers de décision depuis PostgreSQL (démarrage, balayage) : échéance
   * future → timer réarmé ; échéance passée → résolue immédiatement (AUTO_LEAVE) ; partie
   * terminée sans ronde → ronde ouverte. Renvoie le nombre de sessions traitées.
   */
  async recoverDecisionTimers(): Promise<{ scheduled: number; processed: number }> {
    let scheduled = 0;
    let processed = 0;
    const now = this.clock().getTime();
    for (const {
      sessionId,
      deadlineAt,
    } of await this.deps.sessions.findPendingDecisionDeadlines()) {
      if (deadlineAt.getTime() > now) {
        this.scheduleDecisionTimer(sessionId, deadlineAt);
        scheduled += 1;
      } else {
        await this.syncSafely(sessionId);
        processed += 1;
      }
    }
    for (const sessionId of await this.deps.sessions.findSessionsAwaitingDecisionRound()) {
      await this.syncSafely(sessionId);
      processed += 1;
    }
    for (const sessionId of await this.deps.sessions.findSessionsAwaitingReplay()) {
      await this.syncSafely(sessionId);
      processed += 1;
    }
    return { scheduled, processed };
  }

  /** Arrêt du serveur. */
  stopTimers(): void {
    this.timers.cancelAll();
  }

  /**
   * Attend la fin des commandes lancées en arrière-plan (timers de décision, ouverture de
   * ronde, timers de tour de GameService) : à appeler après `stopTimers`, avant de fermer la
   * base.
   */
  async idle(): Promise<void> {
    await Promise.all([this.background.idle(), this.deps.games.idle()]);
    await this.background.idle();
  }

  get decisionTimers(): SessionTimerRegistry {
    return this.timers;
  }

  // --- Interne -----------------------------------------------------------------------

  private async mutate(
    sessionId: SessionId,
    action: string,
    actorId: PlayerId | undefined,
    meta: CallMeta,
    op: (context: SessionContext, now: Date) => SessionTransition,
  ): Promise<Session> {
    const log = this.deps.logger.child({
      sessionId,
      playerId: actorId,
      action,
      requestId: meta.requestId,
    });
    const now = this.clock();
    let refusal: unknown;
    try {
      const result = await this.deps.sessions.update(sessionId, (ctx) => {
        // D'abord la ronde de décision (ouverture, échéance) : elle s'applique et est
        // enregistrée même si l'opération est ensuite refusée.
        const synced = this.syncRound(ctx.session, ctx.lastGame, now);
        try {
          const done = op({ ...ctx, session: synced.session }, now);
          return { session: done.session, events: [...synced.events, ...done.events] };
        } catch (err) {
          refusal = err;
          return synced;
        }
      });
      this.afterCommit(result, actorId, log);
      if (refusal) {
        throw refusal;
      }
      if (result.events.length > 0 && actorId) {
        log.info('session command applied', { version: result.session.version });
      }
      return result.session;
    } catch (err) {
      this.logRejection(log, err);
      throw err;
    }
  }

  /** Après enregistrement : événements, journal des départs automatiques, timer. */
  private afterCommit(
    result: SessionTransition,
    actorId: PlayerId | undefined,
    log: Logger = this.deps.logger.child({ sessionId: result.session.id }),
  ): void {
    if (result.events.length === 0) {
      return;
    }
    const { session } = result;
    this.publish(session, result.events, actorId);
    for (const event of result.events) {
      const payload = event.payload ?? {};
      if (event.type === 'session:decision_started') {
        log.info('SESSION_DECISION_STARTED', { version: session.version, ...payload });
      } else if (event.type === 'session:auto_leave') {
        log.warn('AUTO_LEAVE', {
          version: session.version,
          playerId: payload.playerId as string,
          gameId: payload.gameId as string,
          deadline: session.round?.deadlineAt.toISOString(),
        });
      } else if (event.type === 'session:decision_closed') {
        log.info('SESSION_DECISION_CLOSED', { version: session.version, ...payload });
      } else if (event.type === 'session:closed') {
        log.info('SESSION_CLOSED', { version: session.version });
      } else if (event.type === 'session:deleted') {
        log.info('SESSION_DELETED', { version: session.version });
      }
    }
    if (result.events.some((e) => e.type === 'session:auto_leave')) {
      log.warn('SESSION_DECISION_TIMEOUT', {
        version: session.version,
        gameId: session.round?.gameId,
        deadline: session.round?.deadlineAt.toISOString(),
      });
    }
    this.syncDecisionTimer(session);
    // Ronde close (tous ont répondu, ou échéance) : la partie suivante enchaîne (D-042).
    if (result.events.some((e) => e.type === 'session:decision_closed')) {
      this.background.run(() =>
        this.ensureContinuation(session.id).catch((err: unknown) =>
          this.deps.logger.error('next game creation failed', {
            sessionId: session.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
    }
  }

  /** Timer A : réarmé sur l'échéance persistée de la ronde ouverte, annulé sinon. */
  private syncDecisionTimer(session: Session): void {
    // Une session supprimée (Q1) est vue ici fermée : son timer est annulé.
    if (session.status === 'open' && session.round && !session.round.resolvedAt) {
      this.scheduleDecisionTimer(session.id, session.round.deadlineAt);
    } else {
      this.timers.cancel(session.id);
    }
  }

  private scheduleDecisionTimer(sessionId: SessionId, deadlineAt: Date): void {
    this.timers.schedule(sessionId, deadlineAt.getTime() - this.clock().getTime(), () => {
      this.background.run(() => this.syncSafely(sessionId));
    });
  }

  private async syncSafely(sessionId: SessionId): Promise<void> {
    try {
      await this.syncSession(sessionId);
    } catch (err) {
      this.deps.logger.error('session decision sync failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Joueurs écartés de la partie suivante par la politique (D-063) : ils quittent la session
   * par le chemin normal (`leaveSession`, transaction et verrous habituels) AVANT la création
   * de la partie, qui ne retient ensuite que les joueurs encore présents. Un départ en échec
   * est journalisé et n'empêche pas les autres de continuer.
   */
  private async removeBarredPlayers(
    sessionId: SessionId,
    previous: Game,
    log: Logger,
    { afterResolvedRound = false } = {},
  ) {
    const policy = this.deps.continuation;
    if (!policy?.playersBarredFromNextGame) return;
    const session = await this.deps.sessions.findById(sessionId);
    if (!session || session.status !== 'open') return;
    // Partie suivante automatique : seulement une fois la ronde Poursuivre/Quitter close
    // (`ensureContinuation` est aussi appelé à l'ouverture de la ronde).
    if (
      afterResolvedRound &&
      (session.round?.gameId !== previous.id || !session.round.resolvedAt)
    ) {
      return;
    }
    const present = activeSessionPlayers(session).map((p) => p.playerId);
    const barred = await policy.playersBarredFromNextGame(sessionId, present, previous);
    for (const playerId of barred.filter((p) => present.includes(p))) {
      log.info('PLAYER_BARRED_FROM_NEXT_GAME', { playerId, previousGameId: previous.id });
      await this.leaveSession(sessionId, playerId).catch((err: unknown) =>
        log.error('barred player removal failed', {
          playerId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  /** Politique de continuation : refus journalisé et signalé aux joueurs de la partie. */
  private async newGameAllowed(sessionId: SessionId, previous: Game, log: Logger) {
    const policy = this.deps.continuation;
    if (!policy || (await policy.allowsNewGame(sessionId))) return true;
    log.info('NEW_GAME_REFUSED_BY_POLICY', { previousGameId: previous.id });
    await policy
      .onNewGameRefused?.(
        sessionId,
        previous.players.map((p) => p.playerId),
      )
      .catch((err: unknown) =>
        log.error('new game refusal notification failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return false;
  }

  private async load(sessionId: SessionId): Promise<Session> {
    const session = await this.deps.sessions.findById(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  /** Après enregistrement seulement ; une erreur de diffusion ne remonte jamais. */
  private publish(
    session: Session,
    drafts: SessionEventDraft[],
    actorId: PlayerId | undefined,
  ): void {
    drafts.forEach((draft, sequence) => {
      try {
        this.deps.publisher.publish({
          eventId: randomUUID(),
          sessionId: session.id,
          version: session.version,
          sequence,
          type: draft.type,
          occurredAt: session.updatedAt.toISOString(),
          ...(actorId && { actorId }),
          payload: structuredClone(draft.payload ?? {}),
        });
      } catch (err) {
        this.deps.logger.error('session event publish failed', {
          sessionId: session.id,
          type: draft.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  /**
   * Ronde Poursuivre/Quitter, ouverte après la présentation du 5e tour (D-041) ou, en GARAM
   * TIA, après la révélation des mains de la manche (D-128).
   */
  private syncRound(session: Session, lastGame: LastGameInfo | null, now: Date) {
    const presentation =
      this.presentationMs(lastGame?.lastTrickCards ?? 0) +
      (lastGame?.gameType === 'GARAM' ? this.garamPresentationMs(lastGame.playerIds.length) : 0);
    return syncDecisionRound(session, lastGame, now, this.windowMs, presentation);
  }

  private log(playerId: PlayerId, action: string, meta: CallMeta): Logger {
    return this.deps.logger.child({ playerId, action, requestId: meta.requestId });
  }

  private logRejection(log: Logger, err: unknown): void {
    log.warn('session command rejected', {
      errorName: err instanceof Error ? err.name : typeof err,
    });
  }
}

/** La dernière partie n'est plus une égalité à rejouer (déjà fait) : rien à faire. */
class ReplayNotNeeded extends Error {}

/** Partie suivante impossible sans règle : aucun J1 déterminable (ex. arrêt sans gagnant). */
class ContinuationImpossible extends Error {
  constructor(readonly reason: string) {
    super('partie suivante impossible');
  }
}

/** Reprise impossible sans règle : J1 absent ou moins de 2 joueurs restants. */
class ReplayImpossible extends Error {
  constructor(
    readonly remaining: number,
    readonly firstPlayerPresent: boolean,
  ) {
    super('reprise après égalité impossible');
  }
}

/**
 * Refus qui peuvent venir d'une requête JUMELLE (même Idempotency-Key) arrivée en même
 * temps : clé déjà enregistrée, ou créateur déjà dans la partie (R-18) ou la session
 * (D-034) que cette jumelle vient de créer. On relit alors la clé avant de refuser.
 */
function isCreationRace(err: unknown): boolean {
  return (
    err instanceof DuplicateCreationKeyError ||
    err instanceof ParticipationRefusedError ||
    err instanceof PlayerAlreadyInSessionError
  );
}
