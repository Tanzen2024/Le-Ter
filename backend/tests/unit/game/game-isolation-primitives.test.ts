import type { Game } from '../../../src/domain/game/game';
import { GameVersionConflictError } from '../../../src/domain/game/game-errors';
import type { GameEvent } from '../../../src/domain/game/game-events';
import {
  InvalidGameIdError,
  isGameId,
  parseGameId,
  toPlayerId,
  type GameId,
} from '../../../src/domain/game/game-id';
import { InMemoryGameRepository } from '../../../src/repositories/in-memory-game.repository';
import { gameChatRoom, gameRoom } from '../../../src/websocket/game-rooms';
import { InMemoryGameEventHub } from '../../../src/websocket/in-memory-game-event-hub';

const p1 = toPlayerId('player-1');
const p2 = toPlayerId('player-2');

function makeGame(id: GameId): Game {
  const now = new Date('2026-10-07T10:00:00Z');
  return {
    id,
    version: 1,
    status: 'waiting',
    creatorId: p1,
    maxPlayers: 2,
    players: [{ playerId: p1, seat: 0, joinedAt: now }],
    createdAt: now,
    updatedAt: now,
    recentCommandIds: [],
  };
}

function makeEvent(gameId: GameId): GameEvent {
  return {
    eventId: 'e1',
    gameId,
    version: 2,
    type: 'game:player_joined',
    occurredAt: '2026-10-07T10:00:00Z',
    payload: {},
  };
}

describe('GameId', () => {
  it('accepte un UUID en minuscules', () => {
    const repo = new InMemoryGameRepository();
    const id = repo.nextId();
    expect(isGameId(id)).toBe(true);
    expect(parseGameId(id)).toBe(id);
  });

  it.each([
    '',
    'abc',
    '../games',
    '6703a1b2c3d4e5f6a7b8c9d0',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    "x' OR '1'='1",
    42,
    null,
    { $ne: null },
  ])('rejette %p', (value) => {
    expect(() => parseGameId(value)).toThrow(InvalidGameIdError);
  });

  it('génère des identifiants uniques', () => {
    const repo = new InMemoryGameRepository();
    const ids = new Set(Array.from({ length: 1000 }, () => repo.nextId()));
    expect(ids.size).toBe(1000);
  });
});

describe('InMemoryGameRepository', () => {
  it("ne partage jamais de référence avec l'appelant", async () => {
    const repo = new InMemoryGameRepository();
    const game = makeGame(repo.nextId());
    await repo.insert(game);

    game.players.push({ playerId: p2, seat: 1, joinedAt: new Date() });
    const loaded = await repo.findById(game.id);
    loaded?.players.push({ playerId: p2, seat: 1, joinedAt: new Date() });

    expect((await repo.findById(game.id))?.players).toHaveLength(1);
  });

  it('refuse une écriture basée sur une version périmée', async () => {
    const repo = new InMemoryGameRepository();
    const game = makeGame(repo.nextId());
    await repo.insert(game);

    await repo.save({ ...game, version: 2 }, 1);
    await expect(repo.save({ ...game, version: 2 }, 1)).rejects.toThrow(GameVersionConflictError);
  });
});

describe('Salles temps réel', () => {
  it('nomme les canaux par gameId', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as GameId;
    expect(gameRoom(id)).toBe('game:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(gameChatRoom(id)).toBe('game:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:chat');
  });

  it("un événement privé n'atteint que son destinataire, dans sa partie", () => {
    const hub = new InMemoryGameEventHub();
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as GameId;
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as GameId;
    const p1InA = jest.fn();
    const p2InA = jest.fn();
    const p1InB = jest.fn();
    hub.subscribe(A, p1, p1InA);
    hub.subscribe(A, p2, p2InA);
    hub.subscribe(B, p1, p1InB);

    hub.publishToPlayer(p1, makeEvent(A));

    expect(p1InA).toHaveBeenCalledTimes(1);
    expect(p2InA).not.toHaveBeenCalled();
    expect(p1InB).not.toHaveBeenCalled();
  });

  it('se désabonner ferme la salle vide', () => {
    const hub = new InMemoryGameEventHub();
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as GameId;
    const unsubscribe = hub.subscribe(A, p1, () => undefined);
    expect(hub.roomCount).toBe(1);
    unsubscribe();
    expect(hub.roomCount).toBe(0);
  });
});
