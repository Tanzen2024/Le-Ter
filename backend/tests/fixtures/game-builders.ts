import type { CardId } from '../../src/domain/cards/card';
import { createDeck } from '../../src/domain/cards/deck';
import type { Game } from '../../src/domain/game/game';
import { toPlayerId, type GameId, type PlayerId } from '../../src/domain/game/game-id';
import { startGame } from '../../src/domain/game/ter-engine';
import type { TerRuleSet } from '../../src/domain/rules/rule-set';
import { identityRandom } from './random';
import { testRules } from './rules';

export const NOW = new Date('2026-10-07T10:00:00Z');

let counter = 0;
function nextGameId(): GameId {
  counter += 1;
  // UUID valide et lisible (00000000-0000-4000-8000-000000000001…), stockable en base.
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}` as GameId;
}

/** Partie en attente, complète ou non, sans passer par le service. */
export function waitingGame(playerNames: string[], maxPlayers = playerNames.length): Game {
  const players = playerNames.map((name, seat) => ({
    playerId: toPlayerId(name),
    seat,
    joinedAt: NOW,
  }));
  return {
    id: nextGameId(),
    version: 1,
    status: 'waiting',
    creatorId: players[0]!.playerId,
    maxPlayers,
    players,
    createdAt: NOW,
    updatedAt: NOW,
    recentCommandIds: [],
  };
}

/**
 * Partie démarrée avec des mains CHOISIES (le moteur distribue normalement, puis
 * les mains sont remplacées). L'ordre de distribution suit l'ordre des clés de `hands`.
 */
export function startedGame(
  hands: Record<string, CardId[]>,
  rules: TerRuleSet = testRules,
): { game: Game; players: PlayerId[] } {
  const game = waitingGame(Object.keys(hands));
  startGame(game, { rules, random: identityRandom, now: NOW });
  const dealt = new Set(Object.values(hands).flat());
  game.play!.hands = structuredClone(hands);
  game.play!.stock = createDeck().filter((card) => !dealt.has(card));
  return { game, players: game.players.map((p) => p.playerId) };
}
