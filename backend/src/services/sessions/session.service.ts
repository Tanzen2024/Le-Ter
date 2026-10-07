import { randomUUID } from 'node:crypto';

import type { Game } from '../../domain/game/game';
import { ParticipationRefusedError } from '../../domain/game/game-errors';
import type { PlayerId } from '../../domain/game/game-id';
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
  decide,
  isActiveSessionMember,
  isRoundOpen,
  joinSession,
  leaveSession,
  newSession,
  seatMap,
  syncDecisionRound,
  type LastGameInfo,
  type Session,
  type SessionGameSummary,
  type SessionId,
  type SessionTransition,
} from '../../domain/sessions/session';
import type { SessionEventDraft } from '../../domain/sessions/session-events';
import type { GameEventDraft } from '../../domain/game/game-events';
import { determineFirstPlayer } from '../../domain/sessions/table-order';
import { DuplicateCreationKeyError } from '../../repositories/game.repository';
import type { SessionContext, SessionRepository } from '../../repositories/session.repository';
import { BackgroundTasks } from '../../utils/background-tasks';
import type { Logger } from '../../utils/logger';
import type { SessionEventPublisher } from '../../websocket/session-event-publisher';
import type { CreateGameOptions, GameService } from '../game/game.service';
import { SessionTimerRegistry } from '../game/game-timer-registry';

/** Paramètres de création d'une session (et de sa première partie). */
export type NewSessionOptions = Pick<
  CreateGameOptions,
  'maxPlayers' | 'stakeAmount' | 'creationKey'
>;

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
  /** Délai Poursuivre/Quitter. Par défaut SESSION_DECISION_WINDOW_MS (10 s, D-034). */
  decisionWindowMs?: number;
}

interface CallMeta {
  requestId?: string;
}

/** Vue d'une session pour un joueur : la session et sa partie la plus récente. */
export interface SessionSnapshot {
  session: Session;
  lastGame: LastGameInfo | null;
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
  private readonly background = new BackgroundTasks();

  constructor(private readonly deps: SessionServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
    this.timers = deps.timers ?? new SessionTimerRegistry();
    this.windowMs = deps.decisionWindowMs ?? SESSION_DECISION_WINDOW_MS;
    // Fin d'une partie → ronde Poursuivre/Quitter. Si ce processus s'arrête avant, la
    // reprise (`recoverDecisionTimers`) ou la prochaine mutation de la session l'ouvre,
    // avec la même échéance (fin de partie + 10 s).
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
    const replay = async () => {
      const game = await this.deps.games.findCreationReplay(creatorId, options, log);
      return game?.sessionId ? { session: await this.load(game.sessionId), game } : undefined;
    };
    try {
      const replayed = await replay();
      if (replayed) {
        return { ...replayed, replayed: true };
      }
      const session = newSession(creatorId, options.maxPlayers, this.clock());
      let game: Game;
      try {
        game = await this.deps.games.prepareNewGame(creatorId, {
          ...options,
          sessionId: session.id,
          firstPlayerId: creatorId, // première partie : J1 = créateur de la session
          creatorTablePosition: 0,
        });
        await this.deps.sessions.createWithFirstGame(session, game);
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
      const { maxPlayers } = await this.load(sessionId);
      if (options.maxPlayers !== undefined && options.maxPlayers !== maxPlayers) {
        throw new SessionMaxPlayersImmutableError(sessionId, maxPlayers);
      }
      const withSession = { ...options, maxPlayers, sessionId };
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
          const synced = syncDecisionRound(ctx.session, ctx.lastGame, now, this.windowMs);
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
    return determineFirstPlayer({
      creatorId: session.creatorId,
      seatCount: session.maxPlayers,
      occupantOf: (seat) => seats[seat],
      isActive: (id) => isActiveSessionMember(session, id),
      previousGame: previous
        ? {
            ...(previous.winnerId !== undefined && { winnerId: previous.winnerId }),
            ...(previous.winnerSeat !== undefined && { winnerSeat: previous.winnerSeat }),
            ...(previous.endReason === 'INSTANT_WIN_TIE' && {
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
  joinSession(sessionId: SessionId, playerId: PlayerId, meta: CallMeta = {}): Promise<Session> {
    return this.mutate(sessionId, 'JOIN_SESSION', playerId, meta, ({ session }, now) =>
      joinSession(session, playerId, now),
    );
  }

  /**
   * Quitter la session (siège vacant). Le dernier départ FERME la session dans la même
   * transaction. Refusé tant que le joueur est dans la partie active (R-19 / R-05).
   * Pendant une ronde de décision, vaut « Quitter ».
   */
  leaveSession(sessionId: SessionId, playerId: PlayerId, meta: CallMeta = {}): Promise<Session> {
    return this.mutate(sessionId, 'LEAVE_SESSION', playerId, meta, ({ session, lastGame }, now) =>
      leaveSession(session, playerId, now, {
        inActiveGame: Boolean(
          lastGame && lastGame.status !== 'finished' && lastGame.playerIds.includes(playerId),
        ),
      }),
    );
  }

  /** Poursuivre ou Quitter pendant la ronde de décision (D-034). */
  decide(
    sessionId: SessionId,
    playerId: PlayerId,
    choice: 'continue' | 'leave',
    meta: CallMeta = {},
  ): Promise<Session> {
    return this.mutate(sessionId, 'SESSION_DECISION', playerId, meta, ({ session }, now) =>
      decide(session, playerId, choice, now),
    );
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
    return session;
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
    if (!last || last.endReason !== 'INSTANT_WIN_TIE') {
      return;
    }
    const previous = await this.deps.games.findGame(last.gameId);
    if (!previous) {
      return;
    }
    const log = this.deps.logger.child({ sessionId, action: 'INSTANT_WIN_REPLAY' });
    const now = this.clock();
    let replay: SessionTransition & { game: Game; gameEvents: GameEventDraft[] };
    try {
      replay = await this.deps.sessions.createNextGame(sessionId, (ctx) => {
        if (
          ctx.session.status === 'closed' ||
          ctx.lastGame?.gameId !== previous.id ||
          ctx.lastGame.endReason !== 'INSTANT_WIN_TIE'
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
    return { session, lastGame: await this.deps.sessions.findLastGame(sessionId) };
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
        const synced = syncDecisionRound(ctx.session, ctx.lastGame, now, this.windowMs);
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
  }

  /** Timer A : réarmé sur l'échéance persistée de la ronde ouverte, annulé sinon. */
  private syncDecisionTimer(session: Session): void {
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
