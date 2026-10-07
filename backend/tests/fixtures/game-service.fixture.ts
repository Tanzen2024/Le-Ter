import type { RandomSource } from '../../src/domain/cards/random-source';
import type { GameEvent } from '../../src/domain/game/game-events';
import { toPlayerId, type GameId, type PlayerId } from '../../src/domain/game/game-id';
import { InMemoryGameRepository } from '../../src/repositories/in-memory-game.repository';
import { GameService, type ParticipationPolicy } from '../../src/services/game/game.service';
import { GameTimerRegistry } from '../../src/services/game/game-timer-registry';
import type { TerRuleSet } from '../../src/domain/rules/rule-set';
import type { AutomaticCardSelectionStrategy } from '../../src/domain/game/automatic-card-selection';
import { createLogger, type Logger } from '../../src/utils/logger';
import { InMemoryGameEventHub } from '../../src/websocket/in-memory-game-event-hub';
import { defaultTestRandom } from './random';

/**
 * Politique de test sans restriction. Elle NE préjuge PAS de la règle réelle
 * (plusieurs parties simultanées par joueur ?) qui reste à clarifier (R-18).
 */
export const allowAllParticipation: ParticipationPolicy = {
  canJoin: async () => true,
};

export function createGameServiceFixture(
  options: {
    participationPolicy?: ParticipationPolicy;
    rules?: TerRuleSet;
    random?: RandomSource;
    turnDurationMs?: number;
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
