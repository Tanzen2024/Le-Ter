import { randomUUID } from 'node:crypto';

import type { RandomSource } from '../../domain/cards/random-source';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  RECENT_COMMANDS_LIMIT,
  isActive,
  type Game,
} from '../../domain/game/game';
import { assertPlayerInGame } from '../../domain/game/game-access';
import {
  GameFinishedError,
  GameFullError,
  GameNotFoundError,
  GameNotJoinableError,
  GameVersionConflictError,
  InvalidPlayerCountError,
  ParticipationRefusedError,
} from '../../domain/game/game-errors';
import type { GameEvent, GameEventDraft } from '../../domain/game/game-events';
import type { GameId, PlayerId } from '../../domain/game/game-id';
import { toPlayerView, type PlayerGameView } from '../../domain/game/game-view';
import * as engine from '../../domain/game/ter-engine';
import type { TerRuleSet } from '../../domain/rules/rule-set';
import { assertValidStake } from '../../domain/rules/stake';
import { UnresolvedRuleError } from '../../domain/rules/unresolved-rule';
import { cryptoRandomSource } from '../../utils/crypto-random-source';
import type { GameRepository } from '../../repositories/game.repository';
import { KeyedSerialQueue } from '../../utils/keyed-serial-queue';
import type { Logger } from '../../utils/logger';
import type {
  GameEventListener,
  GameEventPublisher,
  GameEventSubscriber,
} from '../../websocket/game-event-publisher';
import type { GameTimerRegistry } from './game-timer-registry';

/**
 * Décide si un joueur peut rejoindre une partie au regard de ses AUTRES parties
 * (une seule partie active ? plusieurs ? solde suffisant ?). Règles encore à
 * clarifier (docs/TODO.md R-18 à R-21) : la politique est donc injectée.
 */
export interface ParticipationPolicy {
  canJoin(playerId: PlayerId, game: Game): Promise<boolean>;
}

/** Métadonnées de toute commande client. */
export interface CommandMeta {
  /** Identifiant unique généré par le client : une double soumission est ignorée. */
  commandId?: string;
  /** Version de la partie connue du client : refus si l'état a changé entre-temps. */
  expectedVersion?: number;
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
  participationPolicy: ParticipationPolicy;
  logger: Logger;
  clock?: () => Date;
  /**
   * Règles du Ter. Plusieurs d'entre elles sont ambiguës (docs/TODO.md) : aucun jeu
   * de règles de production n'existe encore. Sans lui, les commandes de jeu sont refusées.
   */
  rules?: TerRuleSet;
  /** Hasard du mélange. Par défaut : générateur cryptographique. */
  random?: RandomSource;
}

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

  constructor(private readonly deps: GameServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async createGame(
    creatorId: PlayerId,
    options: { maxPlayers: number; stakeAmount?: number },
  ): Promise<Game> {
    const { maxPlayers, stakeAmount } = options;
    if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
      throw new InvalidPlayerCountError(maxPlayers);
    }
    if (stakeAmount !== undefined) {
      assertValidStake(stakeAmount);
    }

    const now = this.clock();
    const game: Game = {
      id: this.deps.repository.nextId(),
      version: 1,
      status: 'waiting',
      creatorId,
      maxPlayers,
      ...(stakeAmount !== undefined && { stakeAmount }),
      // Le créateur est ajouté à la partie (diagramme « création de partie »).
      players: [{ playerId: creatorId, seat: 0, joinedAt: now }],
      createdAt: now,
      updatedAt: now,
      recentCommandIds: [],
    };

    if (!(await this.deps.participationPolicy.canJoin(creatorId, structuredClone(game)))) {
      throw new ParticipationRefusedError(game.id, creatorId);
    }

    await this.deps.repository.insert(game);
    this.publish(game, [{ type: 'game:created', payload: { maxPlayers } }], creatorId);
    this.deps.logger.info('game created', {
      gameId: game.id,
      playerId: creatorId,
      action: 'CREATE_GAME',
      version: game.version,
    });
    return game;
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
      game.players.push({ playerId, seat: game.players.length, joinedAt: now });
      return [{ type: 'game:player_joined', payload: { playerId, seat: game.players.length - 1 } }];
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
   * Distribue les cartes et démarre la partie (table complète). Commande système :
   * qui déclenche le démarrage (automatique ou créateur) reste à définir (R-23).
   */
  startGame(gameId: GameId): Promise<Game> {
    return this.mutate(gameId, 'START_GAME', undefined, {}, (game, { now }) =>
      engine.startGame(game, { rules: this.requireRules(), random: this.random, now }),
    );
  }

  playCard(gameId: GameId, playerId: PlayerId, cardId: unknown, meta: CommandMeta = {}) {
    return this.executePlayerCommand(gameId, playerId, 'PLAY_CARD', meta, (game, { now }) =>
      engine.playCard(game, playerId, cardId, { rules: this.requireRules(), now }),
    );
  }

  declareWin(gameId: GameId, playerId: PlayerId, meta: CommandMeta = {}) {
    return this.executePlayerCommand(gameId, playerId, 'DECLARE_WIN', meta, (game, { now }) =>
      engine.declareWin(game, playerId, { rules: this.requireRules(), now }),
    );
  }

  flee(gameId: GameId, playerId: PlayerId, meta: CommandMeta = {}) {
    return this.executePlayerCommand(gameId, playerId, 'FLEE', meta, (game, { now }) =>
      engine.flee(game, playerId, { rules: this.requireRules(), now }),
    );
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
      g.turnDeadlineAt = undefined;
      if (g.play) {
        g.play.nextPlayerId = undefined;
      }
      return [{ type: 'game:finished' }];
    });
  }

  /**
   * Arme le timer de tour de cette partie. La durée est fournie par l'appelant
   * (règle à clarifier, R-06). À l'expiration, l'événement passe par la file
   * de la partie et n'a d'effet que si l'état n'a pas changé depuis l'armement.
   */
  async armTurnTimer(gameId: GameId, delayMs: number): Promise<Game> {
    const game = await this.mutate(gameId, 'ARM_TURN_TIMER', undefined, {}, (g, { now }) => {
      if (!isActive(g)) {
        throw new GameFinishedError(gameId);
      }
      g.turnDeadlineAt = new Date(now.getTime() + delayMs);
      return [];
    });
    const armedVersion = game.version;
    this.deps.timers.schedule(gameId, delayMs, () => {
      this.onTurnTimeout(gameId, armedVersion).catch((err: unknown) => {
        this.deps.logger.error('turn timeout failed', {
          gameId,
          action: 'TURN_TIMEOUT',
          error: String(err),
        });
      });
    });
    return game;
  }

  /** État d'une partie vu par un de ses joueurs (lecture, reconnexion). */
  async getGameForPlayer(gameId: GameId, playerId: PlayerId): Promise<PlayerGameView> {
    const game = await this.load(gameId);
    assertPlayerInGame(game, playerId);
    return toPlayerView(game, playerId);
  }

  /** Parties actives d'un joueur, pour le reprendre là où il en était après une reconnexion. */
  async findActiveGamesForPlayer(playerId: PlayerId): Promise<PlayerGameView[]> {
    const games = await this.deps.repository.findActiveByPlayer(playerId);
    return games.map((g) => toPlayerView(g, playerId));
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

  private async onTurnTimeout(gameId: GameId, armedVersion: number): Promise<void> {
    await this.mutate(gameId, 'TURN_TIMEOUT', undefined, {}, (g) => {
      // Timer périmé : l'état a évolué depuis l'armement, ou la partie est finie.
      if (g.version !== armedVersion || !isActive(g)) {
        return null;
      }
      g.turnDeadlineAt = undefined;
      // La conséquence (tour passé ou carte jouée automatiquement) reste à définir (R-06).
      return [{ type: 'game:turn_timeout' }];
    });
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
      const log = this.deps.logger.child({ gameId, playerId: actorId, action });
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
      if (next.status === 'finished') {
        this.deps.timers.cancel(gameId); // Une partie terminée ne garde aucun timer.
      }
      this.publish(next, drafts, actorId);
      log.info('game command applied', { version: next.version, commandId: meta.commandId });
      return next;
    });
  }

  private get random(): RandomSource {
    return this.deps.random ?? cryptoRandomSource;
  }

  private requireRules(): TerRuleSet {
    if (!this.deps.rules) {
      throw new UnresolvedRuleError('RULESET', 'aucun jeu de règles du Ter configuré');
    }
    return this.deps.rules;
  }

  private async load(gameId: GameId): Promise<Game> {
    const game = await this.deps.repository.findById(gameId);
    if (!game) {
      throw new GameNotFoundError(gameId);
    }
    return game;
  }

  private publish(game: Game, drafts: GameEventDraft[], actorId: PlayerId | undefined): void {
    for (const draft of drafts) {
      const event: GameEvent = {
        eventId: randomUUID(),
        gameId: game.id,
        version: game.version,
        type: draft.type,
        occurredAt: game.updatedAt.toISOString(),
        actorId,
        // Copie : un abonné ne peut pas modifier l'état de la partie via un événement.
        payload: structuredClone(draft.payload ?? {}),
      };
      if (draft.recipientId) {
        this.deps.publisher.publishToPlayer(draft.recipientId, event);
      } else {
        this.deps.publisher.publishToGame(event);
      }
    }
  }
}
