import type { RandomSource } from '../../src/domain/cards/random-source';
import type { GameEvent } from '../../src/domain/game/game-events';
import { toPlayerId, type GameId, type PlayerId } from '../../src/domain/game/game-id';
import { InMemoryGameRepository } from '../../src/repositories/in-memory-game.repository';
import { GameService, type ParticipationPolicy } from '../../src/services/game/game.service';
import { GameTimerRegistry } from '../../src/services/game/game-timer-registry';
import type { TerRuleSet } from '../../src/domain/rules/rule-set';
import type { AutomaticCardSelectionStrategy } from '../../src/domain/game/automatic-card-selection';
import { GARAM_TURN_DURATION_MS } from '../../src/domain/garam/garam-rules';
import { createLogger, type Logger } from '../../src/utils/logger';
import { InMemoryGameEventHub } from '../../src/websocket/in-memory-game-event-hub';
import { defaultTestRandom } from './random';

/**
 * Politique de test sans restriction. Elle NE préjuge PAS de la règle réelle
 * (plusieurs parties simultanées par joueur ?) qui reste à clarifier (R-18).
 */
/**
 * Tirage automatique GARAM (D-136) aussi lent qu'un tour : les tests qui tirent par `DRAW_CARD`
 * (ou attendent le Katika après `turnDurationMs`) gardent leur déroulement. Les délais réels se
 * testent en passant `garamAutoDrawMs`.
 */
export function sameAsTurn(turnDurationMs: number | undefined): { first: number; step: number } {
  const ms = turnDurationMs ?? GARAM_TURN_DURATION_MS;
  return { first: ms, step: ms };
}

export const allowAllParticipation: ParticipationPolicy = {
  canJoin: async () => true,
};

export function createGameServiceFixture(
  options: {
    participationPolicy?: ParticipationPolicy;
    rules?: TerRuleSet;
    random?: RandomSource;
    turnDurationMs?: number;
    /** GARAM TIA, tirage automatique (D-136). Par défaut : la durée d'un tour. */
    garamAutoDrawMs?: { first: number; step: number };
    /**
     * Phase de distribution (D-102). Par défaut 0 dans les tests : distribution confirmée
     * au démarrage, premier tour immédiat. La phase réelle se teste par `deal-phase.test.ts`.
     */
    dealDurationMs?: (batchCount: number) => number;
    autoCardSelection?: AutomaticCardSelectionStrategy;
  } = {},
) {
  const repository = new InMemoryGameRepository();
  const hub = new InMemoryGameEventHub();
  const timers = new GameTimerRegistry();
  const logLines: Record<string, unknown>[] = [];
  const logger: Logger = createLogger({}, (line) => logLines.push(JSON.parse(line)));

  const service = new GameService({
    repository,
    publisher: hub,
    subscriber: hub,
    timers,
    participationPolicy: options.participationPolicy ?? allowAllParticipation,
    logger,
    rules: options.rules,
    random: options.random ?? defaultTestRandom(),
    turnDurationMs: options.turnDurationMs,
    garamAutoDrawMs: options.garamAutoDrawMs ?? sameAsTurn(options.turnDurationMs),
    dealDurationMs: options.dealDurationMs ?? (() => 0),
    autoCardSelection: options.autoCardSelection,
  });

  return { service, repository, hub, timers, logLines };
}

export const player = (name: string): PlayerId => toPlayerId(name);

/** Abonne un joueur à une partie et collecte les événements reçus. */
export async function listen(
  service: GameService,
  gameId: GameId,
  playerId: PlayerId,
): Promise<GameEvent[]> {
  const received: GameEvent[] = [];
  await service.subscribe(gameId, playerId, (event) => received.push(event));
  return received;
}

/** Commande neutre : ne change que la version. Remplace une vraie action de jeu dans les tests. */
export const noopCommand = () => [];
