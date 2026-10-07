import { InMemoryGameRepository } from '../../../src/repositories/in-memory-game.repository';
import { singleActiveGameParticipation } from '../../../src/services/game/participation-policies';
import {
  parseCreateGameInput,
  parseGameActionInput,
  parseGameIdParam,
  parseIdempotencyKey,
  parseJoinGameInput,
} from '../../../src/validators/game.validators';
import { ValidationError } from '../../../src/validators/validation-error';
import { waitingGame } from '../../fixtures/game-builders';

const COMMAND = '5b0c2c1e-4b8e-4f5c-9a51-0f1d6a3b2c11';

describe('Validateurs HTTP des parties', () => {
  it('création : maxPlayers 2 à 4, mise entière positive facultative, identité ignorée', () => {
    expect(parseCreateGameInput({ maxPlayers: 4, stakeAmount: 0, creatorId: 'x' })).toEqual({
      maxPlayers: 4,
      stakeAmount: 0,
    });
    expect(parseCreateGameInput({ maxPlayers: 2 })).toEqual({ maxPlayers: 2 });
    expect(() => parseCreateGameInput({ maxPlayers: 2.5 })).toThrow(ValidationError);
    expect(() => parseCreateGameInput({ maxPlayers: 2, stakeAmount: 2 ** 60 })).toThrow(
      ValidationError,
    );
  });

  it('R-23 : capacité 2, 3 ou 4 uniquement', () => {
    for (const maxPlayers of [2, 3, 4]) {
      expect(parseCreateGameInput({ maxPlayers })).toEqual({ maxPlayers });
    }
    for (const maxPlayers of [0, 1, 5, 6, -2, '3', null]) {
      expect(() => parseCreateGameInput({ maxPlayers })).toThrow(ValidationError);
    }
  });

  it('Idempotency-Key : obligatoire, 8 à 128 caractères sûrs', () => {
    expect(parseIdempotencyKey(COMMAND)).toBe(COMMAND);
    for (const key of [undefined, '', 'court', 'a b c d e f g h', 'x'.repeat(129), "'; DROP"]) {
      expect(() => parseIdempotencyKey(key)).toThrow(ValidationError);
    }
  });

  it('gameId : UUID en minuscules seulement', () => {
    expect(parseGameIdParam('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(() => parseGameIdParam("' OR 1=1 --")).toThrow(ValidationError);
  });

  it('actions : commandId UUID obligatoire, type connu, charge utile minimale', () => {
    expect(
      parseGameActionInput({
        commandId: COMMAND.toUpperCase(),
        expectedVersion: 3,
        type: 'PLAY_CARD',
        payload: { cardId: 'COEUR-7', playerId: 'quelqu-un' },
        playerId: 'quelqu-un',
      }),
    ).toEqual({
      commandId: COMMAND,
      expectedVersion: 3,
      action: { type: 'PLAY_CARD', cardId: 'COEUR-7' },
    });
    expect(parseGameActionInput({ commandId: COMMAND, type: 'FLEE' }).action).toEqual({
      type: 'FLEE',
    });
    for (const body of [
      { type: 'FLEE' },
      { commandId: COMMAND, type: 'START_GAME' },
      { commandId: COMMAND, type: 'PLAY_CARD', payload: { cardId: 'x'.repeat(40) } },
      null,
    ]) {
      expect(() => parseGameActionInput(body)).toThrow(ValidationError);
    }
  });

  it('rejoindre : commandId facultatif mais valide s’il est fourni', () => {
    expect(parseJoinGameInput(undefined)).toEqual({});
    expect(parseJoinGameInput({ commandId: COMMAND })).toEqual({ commandId: COMMAND });
    expect(() => parseJoinGameInput({ commandId: 42 })).toThrow(ValidationError);
  });
});

describe('R-18 : une seule partie active (politique officielle, D-031)', () => {
  it('refuse un joueur déjà membre d’une autre partie active ; une partie terminée ne bloque pas', async () => {
    const repository = new InMemoryGameRepository();
    const policy = singleActiveGameParticipation(repository);
    const current = waitingGame(['alice', 'bob'], 4);
    const other = waitingGame(['carol'], 4);
    const finished = { ...waitingGame(['dave'], 4), status: 'finished' as const };
    const started = { ...waitingGame(['erin', 'frank'], 2), status: 'in_progress' as const };
    for (const g of [current, other, finished, started]) {
      await repository.insert(g);
    }

    expect(await policy.canJoin('alice' as never, other)).toBe(false); // waiting ailleurs
    expect(await policy.canJoin('erin' as never, other)).toBe(false); // in_progress ailleurs
    expect(await policy.canJoin('alice' as never, current)).toBe(true); // la même partie
    expect(await policy.canJoin('dave' as never, other)).toBe(true); // partie terminée
    expect(await policy.canJoin('zoe' as never, other)).toBe(true); // aucune partie
  });
});
