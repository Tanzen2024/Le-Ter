import { randomUUID } from 'node:crypto';

import type { RandomSource } from '../../domain/cards/random-source';
import {
  ALLOWED_MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  RECENT_COMMANDS_LIMIT,
  syncStartDeadline,
  type Game,
} from '../../domain/game/game';
import { assertPlayerInGame } from '../../domain/game/game-access';
import { InvalidCardError } from '../../domain/cards/card';
import {
  GameAccessDeniedError,
  GameFinishedError,
  GameFullError,
  GameNotFoundError,
  GameNotJoinableError,
  GameVersionConflictError,
  InvalidPlayerCountError,
  FirstPlayerNotInGameError,
  GameRuleViolationError,
  GameStartForbiddenError,
  IdempotencyKeyReuseError,
  ParticipationRefusedError,
  TurnExpiredError,
} from '../../domain/game/game-errors';
import {
  LowestCardAutomaticSelectionStrategy,
  type AutomaticCardSelectionStrategy,
} from '../../domain/game/automatic-card-selection';
import type { GameEvent, GameEventDraft } from '../../domain/game/game-events';
import type { GameId, PlayerId } from '../../domain/game/game-id';
import { toPlayerView, type PlayerGameView } from '../../domain/game/game-view';
import type { GameSettlementReader } from '../../repositories/game-settlement.repository';
import * as engine from '../../domain/game/ter-engine';
import { OFFICIAL_TER_RULES } from '../../domain/rules/official-rules';
import { TURN_DURATION_MS, type TerRuleSet } from '../../domain/rules/rule-set';
import {
  NotASessionMemberError,
  SessionGameInProgressError,
  type SessionId,
} from '../../domain/sessions/session';
import { InvalidGameStakeError, isValidGameStake } from '../../domain/rules/stake';
import { UnresolvedRuleError } from '../../domain/rules/unresolved-rule';
import { cryptoRandomSource } from '../../utils/crypto-random-source';
import {
  DuplicateCreationKeyError,
  type GameRepository,
  type DealDeadline,
  type StartDeadline,
  type TurnDeadline,
} from '../../repositories/game.repository';
import { BackgroundTasks } from '../../utils/background-tasks';
import { KeyedSerialQueue } from '../../utils/keyed-serial-queue';
import type { Logger } from '../../utils/logger';
import type {
  GameEventListener,
  GameEventPublisher,
  GameEventSubscriber,
} from '../../websocket/game-event-publisher';
import { GameTimerRegistry } from './game-timer-registry';

/**
 * Décide si un joueur peut rejoindre une partie au regard de ses AUTRES parties
 * (une seule partie active ? plusieurs ? solde suffisant ?). Règles encore à
 * clarifier (docs/TODO.md R-18 à R-21) : la politique est donc injectée.
 */
export interface ParticipationPolicy {
  canJoin(playerId: PlayerId, game: Game): Promise<boolean>;
}

/**
 * Mise des parties ORDINAIRES (D-073) : mise > 0 et solde disponible du compte de jeu
 * ≥ 2 × mise, relus côté serveur à chaque entrée d'un joueur dans une partie (création,
 * participation). Lève une erreur explicite pour refuser ; ignore les tables de tournoi
 * (jetons de tournoi, D-054). Absente : aucun contrôle de solde (tests du moteur).
 */
export interface GameStakePolicy {
  assertCanStake(playerId: PlayerId, game: Game): Promise<void>;
}

/**
 * Condition supplémentaire au démarrage MANUEL d'une partie (D-095 : consentements d'une
 * table surveillée). Lève une erreur explicite pour refuser ; la partie reste en attente.
 */
export interface GameStartPolicy {
  assertCanStart(game: Game): Promise<void>;
}

/** Paramètres de création (R-23 : maxPlayers ∈ {2, 3, 4}). */
export interface CreateGameOptions {
  maxPlayers: number;
  stakeAmount?: number;
  /** Clé d'idempotence (en-tête Idempotency-Key). */
  creationKey?: string;
  /** Session de la partie (D-033) ; fournie par SessionService. */
  sessionId?: SessionId;
  /** J1 déterminé par la session (D-033). Par défaut : le créateur. */
  firstPlayerId?: PlayerId;
  /** Place du créateur à la table de la session. */
  creatorTablePosition?: number;
  /**
   * Délai de démarrage automatique (D-065), tables de tournoi seulement : dès 2 joueurs, le
   * créateur peut démarrer pendant ce délai, puis le serveur démarre la partie.
   */
  autoStartDelayMs?: number;
  /**
   * Table de tournoi en cours de création (D-054) : elle se joue en jetons de tournoi, la
   * mise du compte de jeu (D-073) ne s'applique pas. Jamais lu dans une requête client.
   */
  tournamentTable?: boolean;
}

/**
 * Place d'un joueur ACTIF dans une session (D-033), ou null s'il n'en est pas membre
 * actif. Port implémenté par le dépôt des sessions ; GameService ne connaît pas les
 * sessions au-delà de cette question.
 */
export interface SessionSeatLookup {
  activeSeat(sessionId: SessionId, playerId: PlayerId): Promise<number | null>;
}

/** Métadonnées de toute commande client. */
export interface CommandMeta {
  /** Identifiant unique généré par le client : une double soumission est ignorée. */
  commandId?: string;
  /** Version de la partie connue du client : refus si l'état a changé entre-temps. */
  expectedVersion?: number;
  /** Requête HTTP d'origine, pour relier les logs de la commande à la requête. */
  requestId?: string;
}

export type { GameEventDraft };

export interface CommandContext {
  actorId?: PlayerId;
  now: Date;
}

/**
 * Logique d'une commande : reçoit une copie de l'état courant de LA partie,
 * la modifie et renvoie les événements à diffuser, ou `null` si rien ne change.
 * Les règles du jeu se brancheront ici.
 */
export type GameCommandHandler = (
  game: Game,
  context: CommandContext,
) => Promise<GameEventDraft[] | null> | GameEventDraft[] | null;

export interface GameServiceDependencies {
  repository: GameRepository;
  publisher: GameEventPublisher;
  subscriber: GameEventSubscriber;
  timers: GameTimerRegistry;
  /**
   * Timers de démarrage automatique (D-065), un par partie en attente. Copies volatiles de
   * `games.start_deadline_at`, reconstruites par DeadlineSupervisor. Par défaut : un registre
   * propre au service.
   */
  startTimers?: GameTimerRegistry;
  participationPolicy: ParticipationPolicy;
  /** Mise et solde des parties ordinaires (D-073). */
  stakePolicy?: GameStakePolicy;
  /** Démarrage manuel : consentements d'une table surveillée (D-095). */
  startPolicy?: GameStartPolicy;
  logger: Logger;
  clock?: () => Date;
  /** Règles coup par coup. Par défaut : OFFICIAL_TER_RULES (D-035, socle de vérité). */
  rules?: TerRuleSet;
  /** Hasard du mélange. Par défaut : générateur cryptographique. */
  random?: RandomSource;
  /** Obligatoire pour les parties rattachées à une session (D-033). */
  sessionSeats?: SessionSeatLookup;
  /** Durée d'un tour. Par défaut TURN_DURATION_MS (13 s dont 10 s affichées, D-098). */
  turnDurationMs?: number;
  /**
   * Durée de la phase de distribution selon le nombre de lots (D-102). Par défaut
   * `dealPhaseDurationMs`. Renvoyer 0 confirme la distribution dans la transition de
   * démarrage (tests du moteur qui ne portent pas sur la distribution).
   */
  dealDurationMs?: (batchCount: number) => number;
  /**
   * Choix de la carte jouée automatiquement après TURN_TIMEOUT (tours 1 à 4). Par défaut :
   * règle officielle D-036 (LowestCardAutomaticSelectionStrategy).
   */
  autoCardSelection?: AutomaticCardSelectionStrategy;
  /** Bilan financier du joueur ajouté à sa vue d'une partie terminée (D-074, lecture seule). */
  settlements?: GameSettlementReader;
}

export type GameFinishedListener = (game: Game) => void;

/**
 * Point d'entrée unique de toute modification d'une partie.
 *
 * Garanties :
 * - chaque commande est rattachée à un gameId explicite ;
 * - les commandes d'une même partie sont sérialisées (file par gameId),
 *   celles de parties différentes s'exécutent en parallèle ;
 * - chaque écriture est conditionnée à la version lue (concurrence optimiste) ;
 * - les événements ne sont diffusés qu'après l'enregistrement, dans la salle
 *   de la partie concernée uniquement.
 */
export class GameService {
  private readonly queue = new KeyedSerialQueue<GameId>();
  private readonly clock: () => Date;
  private readonly finishedListeners: GameFinishedListener[] = [];
  private readonly background = new BackgroundTasks();
  private readonly startTimers: GameTimerRegistry;

  constructor(private readonly deps: GameServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
    this.startTimers = deps.startTimers ?? new GameTimerRegistry();
  }

  /**
   * Être prévenu, APRÈS enregistrement, de chaque partie qui se termine (SessionService
   * ouvre alors la ronde Poursuivre/Quitter). Une erreur de l'écouteur ne remonte jamais.
   */
  onGameFinished(listener: GameFinishedListener): void {
    this.finishedListeners.push(listener);
  }

  private get turnDurationMs(): number {
    return this.deps.turnDurationMs ?? TURN_DURATION_MS;
  }

  /** Crée une partie (sans clé d'idempotence). Voir `createGameIdempotent`. */
  async createGame(
    creatorId: PlayerId,
    options: CreateGameOptions,
    meta: Pick<CommandMeta, 'requestId'> = {},
  ): Promise<Game> {
    return (await this.createGameIdempotent(creatorId, options, meta)).game;
  }

  /**
   * Crée une partie dont `creatorId` est le premier joueur (D-031).
   *
   * - Capacité : 2, 3 ou 4 joueurs (R-23), c'est un maximum.
   * - R-18 : refusé si le créateur est déjà membre d'une partie active (garanti en base).
   * - Idempotence : une `creationKey` déjà utilisée par ce créateur renvoie la partie
   *   existante (`replayed: true`) au lieu d'en créer une seconde, y compris si deux
   *   requêtes identiques arrivent en même temps. Réutiliser la clé pour une création
   *   différente est refusé (IdempotencyKeyReuseError).
   */
  async createGameIdempotent(
    creatorId: PlayerId,
    options: CreateGameOptions,
    meta: Pick<CommandMeta, 'requestId'> = {},
  ): Promise<{ game: Game; replayed: boolean }> {
    const log = this.deps.logger.child({
      playerId: creatorId,
      action: 'CREATE_GAME',
      requestId: meta.requestId,
    });
    try {
      return await this.create(creatorId, options, log);
    } catch (err) {
      logRejection(log, {}, err);
      throw err;
    }
  }

  private async create(
    creatorId: PlayerId,
    options: CreateGameOptions,
    log: Logger,
  ): Promise<{ game: Game; replayed: boolean }> {
    // Requête rejouée : la partie existe déjà, on la renvoie (avant le contrôle R-18,
    // qui refuserait sinon : le créateur est justement membre de cette partie).
    const replayed = await this.findCreationReplay(creatorId, options, log);
    if (replayed) {
      return { game: replayed, replayed: true };
    }
    let game: Game;
    try {
      game = await this.prepareNewGame(creatorId, options);
      await this.deps.repository.insert(game);
    } catch (err) {
      // Même clé envoyée en même temps : l'autre requête a créé la partie (clé déjà prise,
      // ou R-18 parce que le créateur est déjà dans cette partie). On la renvoie.
      if (err instanceof DuplicateCreationKeyError || err instanceof ParticipationRefusedError) {
        const existing = await this.findCreationReplay(creatorId, options, log);
        if (existing) {
          return { game: existing, replayed: true };
        }
      }
      throw err;
    }
    this.announceCreated(game, log);
    return { game, replayed: false };
  }

  /**
   * Partie déjà créée par ce joueur avec cette clé d'idempotence (D-031), ou undefined.
   * La même clé pour d'autres paramètres → IdempotencyKeyReuseError.
   */
  async findCreationReplay(
    creatorId: PlayerId,
    options: CreateGameOptions,
    log: Logger = this.deps.logger,
  ): Promise<Game | undefined> {
    if (!options.creationKey) {
      return undefined;
    }
    const existing = await this.deps.repository.findByCreationKey(creatorId, options.creationKey);
    if (!existing) {
      return undefined;
    }
    if (
      existing.maxPlayers !== options.maxPlayers ||
      existing.stakeAmount !== options.stakeAmount ||
      (options.sessionId !== undefined && existing.sessionId !== options.sessionId)
    ) {
      throw new IdempotencyKeyReuseError(existing.id);
    }
    log.info('game creation replayed', { gameId: existing.id, version: existing.version });
    return existing;
  }

  /**
   * Construit une partie NEUVE (non enregistrée) : capacité 2/3/4 (R-23), mise valide,
   * créateur premier membre, J1 (D-033), et contrôle R-18 préalable. Utilisée par
   * `createGame` et par SessionService, qui l'enregistre avec sa session en une transaction.
   */
  async prepareNewGame(creatorId: PlayerId, options: CreateGameOptions): Promise<Game> {
    const {
      maxPlayers,
      stakeAmount,
      creationKey,
      sessionId,
      creatorTablePosition,
      autoStartDelayMs,
      tournamentTable,
    } = options;
    if (!(ALLOWED_MAX_PLAYERS as readonly number[]).includes(maxPlayers)) {
      throw new InvalidPlayerCountError(maxPlayers);
    }
    // Mise enregistrée : toujours > 0 (D-073). Son absence n'est admise que pour une table de
    // tournoi : la politique de mise la refuse pour une partie ordinaire.
    if (stakeAmount !== undefined && !isValidGameStake(stakeAmount)) {
      throw new InvalidGameStakeError(stakeAmount);
    }
    if (
      autoStartDelayMs !== undefined &&
      (!Number.isSafeInteger(autoStartDelayMs) || autoStartDelayMs <= 0)
    ) {
      throw new RangeError(`Délai de démarrage invalide : ${autoStartDelayMs}`);
    }
    const now = this.clock();
    const game: Game = {
      id: this.deps.repository.nextId(),
      ...(sessionId && { sessionId }),
      firstPlayerId: options.firstPlayerId ?? creatorId,
      version: 1,
      status: 'waiting',
      creatorId,
      maxPlayers,
      ...(stakeAmount !== undefined && { stakeAmount }),
      // Le créateur est ajouté à la partie (diagramme « création de partie »).
      players: [
        {
          playerId: creatorId,
          seat: 0,
          ...(creatorTablePosition !== undefined && { tablePosition: creatorTablePosition }),
          joinedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
      recentCommandIds: [],
      ...(creationKey && { creationKey }),
      ...(autoStartDelayMs !== undefined && { autoStartDelayMs }),
    };
    if (!(await this.deps.participationPolicy.canJoin(creatorId, structuredClone(game)))) {
      throw new ParticipationRefusedError(game.id, creatorId);
    }
    if (!tournamentTable) {
      await this.deps.stakePolicy?.assertCanStake(creatorId, structuredClone(game));
    }
    return game;
  }

  /** Diffuse `game:created` d'une partie qui vient d'être ENREGISTRÉE. */
  announceCreated(game: Game, log: Logger = this.deps.logger): void {
    this.publish(
      game,
      [
        {
          type: 'game:created',
          payload: {
            maxPlayers: game.maxPlayers,
            ...(game.sessionId && { sessionId: game.sessionId }),
            firstPlayerId: game.firstPlayerId,
          },
        },
      ],
      game.creatorId,
    );
    log.info('game created', {
      gameId: game.id,
      sessionId: game.sessionId,
      playerId: game.creatorId,
      action: 'CREATE_GAME',
      version: game.version,
    });
  }

  joinGame(gameId: GameId, playerId: PlayerId, meta: CommandMeta = {}): Promise<Game> {
    return this.mutate(gameId, 'JOIN_GAME', playerId, meta, async (game, { now }) => {
      if (game.status === 'finished') {
        throw new GameFinishedError(gameId);
      }
      if (game.players.some((p) => p.playerId === playerId)) {
        return null; // Déjà membre : rejoindre est idempotent.
      }
      if (game.status !== 'waiting') {
        throw new GameNotJoinableError(gameId);
      }
      if (game.players.length >= game.maxPlayers) {
        throw new GameFullError(gameId);
      }
      if (!(await this.deps.participationPolicy.canJoin(playerId, structuredClone(game)))) {
        throw new ParticipationRefusedError(gameId, playerId);
      }
      // D-073 : mise de LA partie et solde relus côté serveur, jamais ceux du client.
      await this.deps.stakePolicy?.assertCanStake(playerId, structuredClone(game));
      // D-033 : seul un joueur actif de la session entre dans sa partie ; il y garde sa
      // place de session (ordre antihoraire). Revérifié en base dans la transaction.
      let tablePosition: number | undefined;
      if (game.sessionId) {
        if (!this.deps.sessionSeats) {
          throw new Error('GameService : sessionSeats requis pour une partie de session');
        }
        const seat = await this.deps.sessionSeats.activeSeat(game.sessionId, playerId);
        if (seat === null) {
          throw new NotASessionMemberError(game.sessionId, playerId);
        }
        tablePosition = seat;
      }
      // Rang dans la partie : le plus petit libre (un joueur parti d'une partie en attente
      // libère le sien, R-19) ; jamais un rang déjà pris.
      const seat = firstFreeGameSeat(game);
      game.players.push({
        playerId,
        seat,
        ...(tablePosition !== undefined && { tablePosition }),
        joinedAt: now,
      });
      // Table de tournoi : l'arrivée du 2e joueur fait partir l'échéance de démarrage
      // (D-065) ; les arrivées suivantes ne la repoussent pas.
      syncStartDeadline(game, now);
      return [
        {
          type: 'game:player_joined',
          payload: {
            playerId,
            seat,
            ...(game.startDeadlineAt && { startDeadlineAt: game.startDeadlineAt.toISOString() }),
          },
        },
      ];
    });
  }

  /**
   * Commande d'un joueur sur SA partie. L'appartenance est vérifiée sur l'état
   * réel lu dans la file de la partie, jamais sur une information du client.
   */
  executePlayerCommand(
    gameId: GameId,
    playerId: PlayerId,
    action: string,
    meta: CommandMeta,
    handler: GameCommandHandler,
  ): Promise<Game> {
    return this.mutate(
      gameId,
      action,
      playerId,
      meta,
      (game, context) => {
        if (game.status === 'finished') {
          throw new GameFinishedError(gameId);
        }
        return handler(game, context);
      },
      true,
    );
  }

  // --- Commandes du moteur de jeu -------------------------------------------

  /**
   * Démarre la partie (R-23) : waiting → in_progress, une seule fois.
   *
   * - Seul le créateur démarre ; `actorId` vient du JWT (jamais du client).
   * - Au moins 2 joueurs ; la capacité maximale n'est pas une condition.
   * - Atomicité : file par partie sur une instance, version optimiste entre instances.
   *   Deux démarrages simultanés produisent une seule transition et un seul `game:started` ;
   *   l'autre reçoit GameAlreadyStartedError ou GameVersionConflictError.
   * - La distribution (5 cartes en deux passages 3 + 2, sens antihoraire depuis J1), J1
   *   et le contrôle initial sont fixés dans la même transition (D-032) : jamais de partie
   *   in_progress aux mains incomplètes.
   */
  startGame(gameId: GameId, actorId: PlayerId, meta: CommandMeta = {}): Promise<Game> {
    return this.mutate(
      gameId,
      'START_GAME',
      actorId,
      meta,
      async (game, { now }) => {
        if (game.creatorId !== actorId) {
          throw new GameStartForbiddenError(gameId, actorId);
        }
        // Vérifié sur l'état lu : l'enregistrement est conditionné à cette version, une
        // arrivée concurrente fait donc échouer le démarrage (conflit de version).
        if (game.status === 'waiting') {
          await this.deps.startPolicy?.assertCanStart(structuredClone(game));
        }
        // Distribution, J1, contrôle et ordre du tour dans la même transition (D-032,
        // D-033). Les règles encore ouvertes (R-03, R-08…) ne concernent que les coups.
        return engine.startGame(game, {
          rules: this.rules,
          random: this.random,
          now,
          turnDurationMs: this.turnDurationMs,
          dealDurationMs: this.deps.dealDurationMs,
        });
      },
      true,
    );
  }

  /**
   * Coup d'un joueur. Le timer de tour fait autorité (D-034) : après l'échéance persistée
   * (ou une fois TURN_TIMEOUT constaté), le coup du joueur attendu est refusé
   * (TurnExpiredError) ; c'est au coup automatique de jouer.
   */
  playCard(gameId: GameId, playerId: PlayerId, cardId: unknown, meta: CommandMeta = {}) {
    return this.executePlayerCommand(gameId, playerId, 'PLAY_CARD', meta, (game, { now }) => {
      assertTurnNotExpired(game, playerId, now);
      return engine.playCard(game, playerId, cardId, this.engineContext(now));
    });
  }

  declareWin(gameId: GameId, playerId: PlayerId, meta: CommandMeta = {}) {
    return this.executePlayerCommand(gameId, playerId, 'DECLARE_WIN', meta, (game, { now }) =>
      engine.declareWin(game, playerId, this.engineContext(now)),
    );
  }

  flee(gameId: GameId, playerId: PlayerId, meta: CommandMeta = {}) {
    return this.executePlayerCommand(gameId, playerId, 'FLEE', meta, (game, { now }) =>
      engine.flee(game, playerId, this.engineContext(now)),
    );
  }

  // --- Timer de tour (D-034) --------------------------------------------------

  /**
   * TURN_TIMEOUT : commande système déclenchée par le timer de la partie (ou par la reprise
   * après redémarrage). Elle passe par la file de la partie et relit l'état : elle n'a
   * d'effet que si un tour est en cours, non encore expiré, ET que son échéance PERSISTÉE
   * est atteinte. Deux déclenchements (deux timers, deux instances) n'en produisent qu'un :
   * le second voit `turnTimedOutAt` déjà posé (ou perd sur la version). Puis le coup
   * automatique est tenté.
   *
   * Le timeout ne fait ni quitter, ni éliminer, ni fermer quoi que ce soit.
   */
  async handleTurnTimeout(gameId: GameId): Promise<Game> {
    // Une autre instance a écrit entre-temps (version) : on relit et on réévalue. Au pire,
    // l'expiration a déjà été constatée ailleurs et cette commande devient sans effet.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.applyTurnTimeout(gameId);
      } catch (err) {
        if (!(err instanceof GameVersionConflictError) || attempt >= 3) {
          throw err;
        }
      }
    }
  }

  private async applyTurnTimeout(gameId: GameId): Promise<Game> {
    let timedOutNow = false;
    const game = await this.mutate(gameId, 'TURN_TIMEOUT', undefined, {}, (g, { now }) => {
      const playerId = g.play?.nextPlayerId;
      if (g.status !== 'in_progress' || !playerId || !g.turnDeadlineAt || g.turnTimedOutAt) {
        return null;
      }
      if (now.getTime() < g.turnDeadlineAt.getTime()) {
        return null; // Déclenchement anticipé : le timer est réarmé ci-dessous.
      }
      g.turnTimedOutAt = now;
      timedOutNow = true;
      return [
        {
          type: 'game:turn_timeout',
          payload: {
            playerId,
            trickNumber: g.play?.trickNumber,
            turnDeadlineAt: g.turnDeadlineAt.toISOString(),
          },
        },
      ];
    });
    this.syncTurnTimer(game);
    // Seul le déclenchement qui a constaté l'expiration enchaîne le coup automatique ; un
    // doublon (autre timer, autre instance) s'arrête là.
    if (timedOutNow && game.status === 'in_progress' && game.turnTimedOutAt) {
      this.deps.logger.warn('TURN_TIMEOUT', {
        gameId,
        sessionId: game.sessionId,
        playerId: game.play?.nextPlayerId,
        version: game.version,
        deadline: game.turnDeadlineAt?.toISOString(),
        timeout: game.turnTimedOutAt.toISOString(),
      });
      return this.playAutomatically(game);
    }
    return game;
  }

  // --- Démarrage automatique des tables de tournoi (D-065) ------------------------------

  /**
   * START_DEADLINE : commande système déclenchée par le timer de démarrage (ou par la reprise
   * après redémarrage). Elle passe par la file de la partie et relit l'état : elle ne démarre
   * la partie que si elle est TOUJOURS en attente, avec au moins 2 joueurs, et que son
   * échéance PERSISTÉE est atteinte. Démarrage manuel concurrent, double timer, deux
   * instances : une seule transition waiting → in_progress réussit (file par partie, version
   * optimiste en base) ; les autres deviennent sans effet.
   */
  async handleStartDeadline(gameId: GameId): Promise<Game> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.applyStartDeadline(gameId);
      } catch (err) {
        if (!(err instanceof GameVersionConflictError) || attempt >= 3) {
          throw err;
        }
      }
    }
  }

  private async applyStartDeadline(gameId: GameId): Promise<Game> {
    let started = false;
    const game = await this.mutate(gameId, 'AUTO_START_GAME', undefined, {}, (g, { now }) => {
      if (g.status !== 'waiting' || !g.startDeadlineAt) {
        return null; // déjà démarrée (manuellement ou ailleurs), ou plus d'échéance
      }
      if (now.getTime() < g.startDeadlineAt.getTime()) {
        return null; // déclenchement anticipé : le timer est réarmé ci-dessous
      }
      if (g.players.length < MIN_PLAYERS_TO_START) {
        return null; // impossible : l'échéance est retirée sous 2 joueurs
      }
      started = true;
      return engine.startGame(g, {
        rules: this.rules,
        random: this.random,
        now,
        turnDurationMs: this.turnDurationMs,
        dealDurationMs: this.deps.dealDurationMs,
      });
    });
    this.syncStartTimer(game);
    if (started) {
      this.deps.logger.info('GAME_AUTO_STARTED', {
        gameId,
        sessionId: game.sessionId,
        players: game.players.length,
        version: game.version,
      });
    }
    return game;
  }

  /** Échéances de démarrage persistées (parties en attente), pour reconstruire les timers. */
  findStartDeadlines(): Promise<StartDeadline[]> {
    return this.deps.repository.findStartDeadlines();
  }

  /**
   * Arme (ou annule) le timer de démarrage de la partie d'après son échéance PERSISTÉE.
   * Échéance déjà dépassée : déclenchement immédiat.
   */
  syncStartTimer(game: Pick<Game, 'id' | 'status' | 'startDeadlineAt'>): void {
    if (game.status !== 'waiting' || !game.startDeadlineAt) {
      this.startTimers.cancel(game.id);
      return;
    }
    const delay = game.startDeadlineAt.getTime() - this.clock().getTime();
    this.startTimers.schedule(game.id, delay, () => {
      this.background.run(() =>
        this.handleStartDeadline(game.id).catch((err: unknown) => {
          this.deps.logger.error('auto start failed', {
            gameId: game.id,
            action: 'AUTO_START_GAME',
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      );
    });
  }

  /** Arrêt du serveur : timers de démarrage annulés (les échéances restent en base). */
  cancelStartTimers(): void {
    this.startTimers.cancelAll();
  }

  /** Reprise d'un coup automatique en attente (tour expiré avant un redémarrage). */
  async retryAutomaticPlay(gameId: GameId): Promise<Game> {
    const game = await this.load(gameId);
    return game.status === 'in_progress' && game.turnTimedOutAt
      ? this.playAutomatically(game)
      : game;
  }

  /**
   * Coup automatique après TURN_TIMEOUT. La carte est choisie par la stratégie (D-036 :
   * plus petite carte de la famille du contrôle, sinon de la main), puis jouée par le MÊME
   * chemin qu'un coup manuel : file de la partie, moteur (mêmes règles), version,
   * enregistrement, puis événements. `commandId` déterministe par tour : idempotent.
   */
  private async playAutomatically(game: Game): Promise<Game> {
    const play = game.play;
    const playerId = play?.nextPlayerId;
    if (!play || !playerId) {
      return game;
    }
    const log = this.deps.logger.child({
      gameId: game.id,
      sessionId: game.sessionId,
      playerId,
      action: 'AUTO_CARD_PLAY',
    });
    let cardId: string;
    try {
      cardId = (this.deps.autoCardSelection ?? officialAutoCardSelection).selectCard({
        gameId: game.id,
        playerId,
        hand: [...(play.hands[playerId] ?? [])],
        trickNumber: play.trickNumber,
        currentTrick: structuredClone(play.currentTrick),
        controllerId: play.control.playerId,
        ...(play.currentTrick[0] && { leadCardId: play.currentTrick[0].cardId }),
        ...(play.control.cardId && { controlCardId: play.control.cardId }),
      });
    } catch (err) {
      log.error('AUTO_CARD_PLAY strategy failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return game;
    }
    const commandId = `auto-play:${game.id}:${play.trickNumber}:${play.currentTrick.length}`;
    try {
      const after = await this.mutate(
        game.id,
        'AUTO_CARD_PLAY',
        undefined,
        { commandId },
        (g, { now }) => {
          // Le tour n'est plus celui qui a expiré (déjà joué ailleurs) : rien à faire.
          if (
            g.status !== 'in_progress' ||
            !g.turnTimedOutAt ||
            g.play?.nextPlayerId !== playerId
          ) {
            return null;
          }
          const trickNumber = g.play.trickNumber;
          const events = engine.playCard(g, playerId, cardId, this.engineContext(now));
          return [{ type: 'game:auto_card_played', payload: { playerId, trickNumber } }, ...events];
        },
      );
      log.info('AUTO_CARD_PLAY', { commandId, version: after.version });
      return after;
    } catch (err) {
      // Refus des règles ou concurrence : l'état reste celui du tour expiré.
      log.warn('AUTO_CARD_PLAY rejected', {
        commandId,
        errorName: err instanceof Error ? err.name : typeof err,
      });
      return this.load(game.id);
    }
  }

  /** Échéances de tour persistées (parties en cours), pour reconstruire les timers. */
  findTurnDeadlines(): Promise<TurnDeadline[]> {
    return this.deps.repository.findTurnDeadlines();
  }

  /** Fins de distribution persistées (D-102), pour reconstruire les timers. */
  findDealDeadlines(): Promise<DealDeadline[]> {
    return this.deps.repository.findDealDeadlines();
  }

  // --- Confirmation de la distribution (D-102) -----------------------------------

  /**
   * COMPLETE_DEAL : commande système déclenchée par le timer de la partie (ou par la reprise
   * après redémarrage) à la fin PERSISTÉE de la phase de distribution. Elle passe par la
   * file de la partie et relit l'état : elle n'a d'effet que si la distribution n'est pas
   * encore confirmée ET que son échéance est atteinte. Le moteur vérifie alors que chaque
   * main est complète, puis ouvre le premier tour : c'est le SEUL point où le premier timer
   * de décision est créé. Doublons (timer + balayage, deux instances) : un seul effet.
   */
  async handleDealDeadline(gameId: GameId): Promise<Game> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.applyDealDeadline(gameId);
      } catch (err) {
        if (!(err instanceof GameVersionConflictError) || attempt >= 3) {
          throw err;
        }
      }
    }
  }

  private async applyDealDeadline(gameId: GameId): Promise<Game> {
    let completed = false;
    const game = await this.mutate(gameId, 'COMPLETE_DEAL', undefined, {}, (g, { now }) => {
      if (!engine.isDealing(g) || !g.dealEndsAt) {
        return null; // déjà confirmée, ou partie terminée entre-temps
      }
      if (now.getTime() < g.dealEndsAt.getTime()) {
        return null; // déclenchement anticipé : le timer est réarmé ci-dessous
      }
      const events = engine.completeDeal(g, this.engineContext(now));
      completed = events !== null;
      return events;
    });
    this.syncTurnTimer(game);
    if (completed) {
      this.deps.logger.info('DEAL_COMPLETED', {
        gameId,
        sessionId: game.sessionId,
        playerId: game.play?.nextPlayerId,
        version: game.version,
        deadline: game.turnDeadlineAt?.toISOString(),
      });
    }
    return game;
  }

  /**
   * Arme (ou annule) le timer en mémoire de la partie d'après son échéance PERSISTÉE.
   * Échéance déjà dépassée : déclenchement immédiat. Utilisé après chaque commande et à
   * la reconstruction des timers après un redémarrage.
   *
   * Un seul timer par partie : pendant la distribution (D-102), il vise la fin de la
   * distribution (COMPLETE_DEAL) ; il n'existe alors aucune échéance de tour.
   */
  syncTurnTimer(
    game: Pick<Game, 'id' | 'status' | 'turnDeadlineAt' | 'turnTimedOutAt' | 'dealEndsAt'>,
  ): void {
    if (game.status === 'in_progress' && game.dealEndsAt) {
      const delay = game.dealEndsAt.getTime() - this.clock().getTime();
      this.deps.timers.schedule(game.id, delay, () => {
        this.background.run(() =>
          this.handleDealDeadline(game.id).catch((err: unknown) => {
            this.deps.logger.error('deal completion failed', {
              gameId: game.id,
              action: 'COMPLETE_DEAL',
              error: err instanceof Error ? err.message : String(err),
            });
          }),
        );
      });
      return;
    }
    if (game.status !== 'in_progress' || !game.turnDeadlineAt || game.turnTimedOutAt) {
      this.deps.timers.cancel(game.id);
      return;
    }
    const delay = game.turnDeadlineAt.getTime() - this.clock().getTime();
    this.deps.timers.schedule(game.id, delay, () => {
      this.background.run(() =>
        this.handleTurnTimeout(game.id).catch((err: unknown) => {
          this.deps.logger.error('turn timeout failed', {
            gameId: game.id,
            action: 'TURN_TIMEOUT',
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      );
    });
  }

  /** Attend la fin des commandes déclenchées par les timers (arrêt du serveur, tests). */
  idle(): Promise<void> {
    return this.background.idle();
  }

  /**
   * Arrête la partie sans résultat de jeu (action système ou administrative) et
   * libère ses ressources (timer).
   */
  finishGame(gameId: GameId): Promise<Game> {
    return this.mutate(gameId, 'FINISH_GAME', undefined, {}, (g, { now }) => {
      if (g.status === 'finished') {
        return null;
      }
      g.status = 'finished';
      g.finishedAt = now;
      g.endReason = 'ADMIN_STOP';
      engine.clearTurn(g);
      if (g.play) {
        g.play.nextPlayerId = undefined;
      }
      return [{ type: 'game:finished', payload: { endReason: 'ADMIN_STOP' } }];
    });
  }

  // --- Reprise immédiate après égalité de priorité (D-035, décisions 17 et 23) ---------

  /** Partie telle qu'enregistrée (lecture interne pour SessionService). */
  findGame(gameId: GameId): Promise<Game | null> {
    return this.deps.repository.findById(gameId);
  }

  /**
   * Construit, sans rien enregistrer, la partie EN ATTENTE après le départ d'un joueur de
   * sa session (R-19, D-037) : le joueur en sort ; J1 et créateur sont ceux décidés par la
   * session (Q2) ; les places de table des autres joueurs ne changent pas (Q3). Pure et
   * synchrone : SessionService l'appelle sous le verrou de la session et de la partie, et
   * l'enregistre dans la même transaction (version + 1, comme toute commande).
   */
  buildWaitingGameDeparture(
    current: Game,
    departure: { playerId: PlayerId; firstPlayerId: PlayerId; creatorId: PlayerId },
    now: Date,
  ): { game: Game; events: GameEventDraft[] } {
    if (current.status !== 'waiting') {
      throw new GameNotJoinableError(current.id);
    }
    const game = structuredClone(current);
    game.players = game.players.filter((p) => p.playerId !== departure.playerId);
    game.firstPlayerId = departure.firstPlayerId;
    game.creatorId = departure.creatorId;
    game.version = current.version + 1;
    game.updatedAt = now;
    // Table de tournoi : sous 2 joueurs, plus de compte à rebours ; sinon l'échéance déjà
    // posée est conservée et le droit de démarrer passe au nouveau créateur (D-065).
    syncStartDeadline(game, now);
    return {
      game,
      events: [
        {
          type: 'game:player_left',
          payload: {
            playerId: departure.playerId,
            firstPlayerId: game.firstPlayerId,
            creatorId: game.creatorId,
          },
        },
      ],
    };
  }

  /** Après l'enregistrement d'un départ (R-19) : diffusion dans la salle de la partie. */
  announceWaitingGameDeparture(game: Game, events: GameEventDraft[], actorId: PlayerId): void {
    this.publish(game, events, actorId);
    this.syncStartTimer(game);
    this.deps.logger.info('WAITING_GAME_PLAYER_LEFT', {
      gameId: game.id,
      sessionId: game.sessionId,
      version: game.version,
      firstPlayerId: game.firstPlayerId,
      creatorId: game.creatorId,
      players: game.players.length,
    });
  }

  /**
   * Construit, sans rien enregistrer, la partie qui REJOUE une partie annulée pour égalité
   * de priorité : même session, même J1, mêmes joueurs présents à leurs sièges, nouveau
   * mélange des 31 cartes, nouvelle distribution et nouvelle analyse des mains. Pure et
   * synchrone : SessionService l'appelle sous le verrou de la session. La partie renvoyée
   * est déjà démarrée (ou déjà terminée si la nouvelle donne finit elle-même la partie).
   */
  buildReplayGame(
    previous: Game,
    playerIds: readonly PlayerId[],
    now: Date,
  ): { game: Game; events: GameEventDraft[] } {
    const players = previous.players
      .filter((p) => playerIds.includes(p.playerId))
      .map((p, seat) => ({
        playerId: p.playerId,
        seat,
        ...(p.tablePosition !== undefined && { tablePosition: p.tablePosition }),
        joinedAt: now,
      }));
    const game: Game = {
      id: this.deps.repository.nextId(),
      ...(previous.sessionId && { sessionId: previous.sessionId }),
      firstPlayerId: previous.firstPlayerId,
      version: 1,
      status: 'waiting',
      creatorId: previous.creatorId,
      maxPlayers: previous.maxPlayers,
      ...(previous.stakeAmount !== undefined && { stakeAmount: previous.stakeAmount }),
      players,
      createdAt: now,
      updatedAt: now,
      recentCommandIds: [],
      replayOfGameId: previous.id,
      ...(previous.autoStartDelayMs !== undefined && {
        autoStartDelayMs: previous.autoStartDelayMs,
      }),
    };
    const events = engine.startGame(game, {
      rules: this.rules,
      random: this.random,
      now,
      turnDurationMs: this.turnDurationMs,
      dealDurationMs: this.deps.dealDurationMs,
    });
    return {
      game,
      events: [
        {
          type: 'game:created',
          payload: {
            maxPlayers: game.maxPlayers,
            ...(game.sessionId && { sessionId: game.sessionId }),
            firstPlayerId: game.firstPlayerId,
            replayOfGameId: previous.id,
          },
        },
        ...events,
      ],
    };
  }

  /**
   * Construit, sans rien enregistrer, la PARTIE SUIVANTE d'une session après « Poursuivre »
   * (D-042) : les joueurs restés à la table, à leurs sièges fixes (`tablePosition`), J1
   * désigné par les règles de session (D-033, D-034), créateur = J1, même mise. Dès 2
   * joueurs (R-23), la partie est démarrée dans la même transition : distribution 3 + 2,
   * sens antihoraire depuis J1 (D-032). Avec un seul joueur, elle attend les arrivées.
   */
  buildNextGame(
    previous: Game,
    seats: readonly { playerId: PlayerId; tablePosition: number }[],
    firstPlayerId: PlayerId,
    now: Date,
  ): { game: Game; events: GameEventDraft[] } {
    const game: Game = {
      id: this.deps.repository.nextId(),
      ...(previous.sessionId && { sessionId: previous.sessionId }),
      firstPlayerId,
      version: 1,
      status: 'waiting',
      creatorId: firstPlayerId,
      maxPlayers: previous.maxPlayers,
      ...(previous.stakeAmount !== undefined && { stakeAmount: previous.stakeAmount }),
      players: seats.map((s, seat) => ({
        playerId: s.playerId,
        seat,
        tablePosition: s.tablePosition,
        joinedAt: now,
      })),
      createdAt: now,
      updatedAt: now,
      recentCommandIds: [],
      ...(previous.autoStartDelayMs !== undefined && {
        autoStartDelayMs: previous.autoStartDelayMs,
      }),
    };
    const created: GameEventDraft = {
      type: 'game:created',
      payload: {
        maxPlayers: game.maxPlayers,
        ...(game.sessionId && { sessionId: game.sessionId }),
        firstPlayerId,
        continuedFromGameId: previous.id,
      },
    };
    if (game.players.length < MIN_PLAYERS_TO_START) {
      return { game, events: [created] };
    }
    const started = engine.startGame(game, {
      rules: this.rules,
      random: this.random,
      now,
      turnDurationMs: this.turnDurationMs,
      dealDurationMs: this.deps.dealDurationMs,
    });
    return { game, events: [created, ...started] };
  }

  /**
   * Après l'enregistrement d'une partie rejouée : diffusion de ses événements, timer du
   * premier tour, et notification si la nouvelle donne termine déjà la partie (nouvelle
   * égalité → nouvelle reprise ; victoire automatique → Poursuivre/Quitter).
   */
  announceInserted(game: Game, events: GameEventDraft[]): void {
    this.publish(game, events, undefined);
    this.syncTurnTimer(game);
    this.syncStartTimer(game);
    this.deps.logger.info('GAME_REPLAYED', {
      gameId: game.id,
      sessionId: game.sessionId,
      replayOfGameId: game.replayOfGameId,
      version: game.version,
      status: game.status,
    });
    if (game.status === 'finished') {
      this.notifyFinished(game);
    }
  }

  /** État d'une partie vu par un de ses joueurs (lecture, reconnexion). */
  async getGameForPlayer(gameId: GameId, playerId: PlayerId): Promise<PlayerGameView> {
    const game = await this.load(gameId);
    assertPlayerInGame(game, playerId);
    const view = toPlayerView(game, playerId, this.rules);
    if (game.status !== 'finished' || !this.deps.settlements) return view;
    const settlement = await this.deps.settlements.findPlayerSettlement(gameId, playerId);
    return settlement ? { ...view, mySettlement: settlement } : view;
  }

  /** Parties actives d'un joueur, pour le reprendre là où il en était après une reconnexion. */
  async findActiveGamesForPlayer(playerId: PlayerId): Promise<PlayerGameView[]> {
    const games = await this.deps.repository.findActiveByPlayer(playerId);
    return games.map((g) => toPlayerView(g, playerId, this.rules));
  }

  /**
   * Abonne la connexion d'un joueur à la salle `game:{gameId}`, après contrôle
   * d'appartenance. C'est le seul chemin d'abonnement autorisé.
   */
  async subscribe(
    gameId: GameId,
    playerId: PlayerId,
    listener: GameEventListener,
  ): Promise<() => void> {
    const game = await this.load(gameId);
    assertPlayerInGame(game, playerId);
    return this.deps.subscriber.subscribe(gameId, playerId, listener);
  }

  private mutate(
    gameId: GameId,
    action: string,
    actorId: PlayerId | undefined,
    meta: CommandMeta,
    handler: GameCommandHandler,
    requireMember = false,
  ): Promise<Game> {
    return this.queue.run(gameId, async () => {
      const log = this.deps.logger.child({
        gameId,
        playerId: actorId,
        action,
        requestId: meta.requestId,
      });
      try {
        return await this.apply(gameId, action, actorId, meta, handler, requireMember, log);
      } catch (err) {
        logRejection(log, meta, err);
        throw err;
      }
    });
  }

  /** Cycle d'une commande, exécuté dans la file de la partie. */
  private async apply(
    gameId: GameId,
    action: string,
    actorId: PlayerId | undefined,
    meta: CommandMeta,
    handler: GameCommandHandler,
    requireMember: boolean,
    log: Logger,
  ): Promise<Game> {
    const current = await this.load(gameId);

    // Contrôle d'accès en premier, sur l'état réel : même une commande
    // dupliquée ou périmée d'un non-membre est refusée.
    if (requireMember) {
      if (!actorId) {
        throw new Error(`Commande ${action} sans acteur`);
      }
      assertPlayerInGame(current, actorId);
    }

    if (meta.commandId && current.recentCommandIds.includes(meta.commandId)) {
      log.info('duplicate command ignored', { commandId: meta.commandId });
      return current;
    }
    if (meta.expectedVersion !== undefined && meta.expectedVersion !== current.version) {
      throw new GameVersionConflictError(gameId, meta.expectedVersion, current.version);
    }

    const next = structuredClone(current);
    const now = this.clock();
    const drafts = await handler(next, { actorId, now });
    if (drafts === null) {
      return current;
    }

    next.version = current.version + 1;
    next.updatedAt = now;
    if (meta.commandId) {
      next.recentCommandIds = [...next.recentCommandIds, meta.commandId].slice(
        -RECENT_COMMANDS_LIMIT,
      );
    }

    await this.deps.repository.save(next, current.version);
    // À partir d'ici la commande est enregistrée : plus rien ne doit la faire échouer.
    // Timer de tour : réarmé sur la nouvelle échéance, annulé si la partie est finie. Timer
    // de démarrage (D-065) : armé à l'arrivée du 2e joueur, annulé au démarrage.
    this.syncTurnTimer(next);
    this.syncStartTimer(next);
    this.publish(next, drafts, actorId);
    log.info('game command applied', {
      sessionId: next.sessionId,
      version: next.version,
      commandId: meta.commandId,
      ...(next.turnDeadlineAt && { deadline: next.turnDeadlineAt.toISOString() }),
    });
    if (current.status !== 'finished' && next.status === 'finished') {
      this.notifyFinished(next);
    }
    return next;
  }

  private notifyFinished(game: Game): void {
    for (const listener of this.finishedListeners) {
      try {
        listener(structuredClone(game));
      } catch (err) {
        this.deps.logger.error('game finished listener failed', {
          gameId: game.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private engineContext(now: Date): engine.EngineContext {
    return { rules: this.rules, now, turnDurationMs: this.turnDurationMs };
  }

  private get rules(): TerRuleSet {
    return this.deps.rules ?? OFFICIAL_TER_RULES;
  }

  private get random(): RandomSource {
    return this.deps.random ?? cryptoRandomSource;
  }

  private async load(gameId: GameId): Promise<Game> {
    const game = await this.deps.repository.findById(gameId);
    if (!game) {
      throw new GameNotFoundError(gameId);
    }
    return game;
  }

  /**
   * Diffuse les événements d'une commande DÉJÀ enregistrée. Une erreur de diffusion
   * (abonné défaillant, transport) est journalisée mais ne remonte jamais : le client
   * rattrape l'état grâce à la version (D-024).
   */
  private publish(game: Game, drafts: GameEventDraft[], actorId: PlayerId | undefined): void {
    drafts.forEach((draft, sequence) => {
      const event: GameEvent = {
        eventId: randomUUID(),
        gameId: game.id,
        version: game.version,
        sequence,
        type: draft.type,
        occurredAt: game.updatedAt.toISOString(),
        actorId,
        // Copie : un abonné ne peut pas modifier l'état de la partie via un événement.
        payload: structuredClone(draft.payload ?? {}),
      };
      try {
        if (draft.recipientId) {
          this.deps.publisher.publishToPlayer(draft.recipientId, event);
        } else {
          this.deps.publisher.publishToGame(event);
        }
      } catch (err) {
        this.deps.logger.error('game event publish failed', {
          gameId: game.id,
          version: game.version,
          type: event.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }
}

/**
 * Refus attendus (règle du jeu, accès, concurrence, entrée invalide) : `warn`, sans
 * recopier le message, qui peut nommer une carte. Tout le reste est une panne : `error`.
 */
const EXPECTED_REJECTIONS: readonly (abstract new (...args: never[]) => Error)[] = [
  GameRuleViolationError,
  GameNotFoundError,
  GameAccessDeniedError,
  GameVersionConflictError,
  GameFullError,
  GameNotJoinableError,
  GameFinishedError,
  ParticipationRefusedError,
  GameStartForbiddenError,
  IdempotencyKeyReuseError,
  InvalidPlayerCountError,
  InvalidCardError,
  UnresolvedRuleError,
  FirstPlayerNotInGameError,
  NotASessionMemberError,
  SessionGameInProgressError,
];

/** Coup automatique officiel après TURN_TIMEOUT (D-036). */
const officialAutoCardSelection = new LowestCardAutomaticSelectionStrategy();

/** Le joueur attendu ne joue plus après l'échéance persistée (D-034). */
function assertTurnNotExpired(game: Game, playerId: PlayerId, now: Date): void {
  if (game.status !== 'in_progress' || game.play?.nextPlayerId !== playerId) {
    return; // Les autres refus (pas son tour, pas démarrée…) relèvent du moteur.
  }
  if (
    game.turnTimedOutAt ||
    (game.turnDeadlineAt && now.getTime() >= game.turnDeadlineAt.getTime())
  ) {
    throw new TurnExpiredError(game.id, playerId);
  }
}

function logRejection(log: Logger, meta: CommandMeta, err: unknown): void {
  const expected = EXPECTED_REJECTIONS.some((type) => err instanceof type);
  const context = {
    commandId: meta.commandId,
    expectedVersion: meta.expectedVersion,
    errorName: err instanceof Error ? err.name : typeof err,
  };
  if (expected) {
    log.warn('game command rejected', context);
  } else {
    log.error('game command rejected', {
      ...context,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Plus petit rang libre d'une partie (0 … maxPlayers-1). */
function firstFreeGameSeat(game: Game): number {
  const taken = new Set(game.players.map((p) => p.seat));
  let seat = 0;
  while (taken.has(seat)) {
    seat += 1;
  }
  return seat;
}
