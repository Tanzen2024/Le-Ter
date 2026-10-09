import type { CardId } from '../../../src/domain/cards/card';
import { controlDecisions } from '../../../src/domain/detection/behavior-analysis';
import { createGameServiceFixture, player } from '../../fixtures/game-service.fixture';
import { deckForHands, decksRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

/**
 * Contrat entre GameService et la détection comportementale (R-36, étape 3, D-047) : un
 * coup joué automatiquement après TURN_TIMEOUT (D-036) laisse dans la partie un
 * `commandId` `auto-play:{gameId}:{tour}:{position}`. CARD_CHOICE_ANOMALY s'en sert pour
 * EXCLURE ces coups : si le format change, ce test doit échouer.
 */
const [p1, p2] = [player('player-1'), player('player-2')];
const H1: CardId[] = ['PIQUE-5', 'TREFLE-10', 'COEUR-8', 'ETOILE-9', 'COEUR-10'];
const H2: CardId[] = ['PIQUE-7', 'PIQUE-9', 'COEUR-4', 'TREFLE-6', 'PIQUE-8'];

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-07T10:00:00.000Z'));
});
afterEach(() => jest.useRealTimers());

it('partie jouée entièrement par timeouts : chaque coup est reconnu, aucune décision retenue', async () => {
  const { service, repository } = createGameServiceFixture({
    rules: testRules,
    random: decksRandom(deckForHands([H1, H2])),
  });
  const created = await service.createGame(p1, { maxPlayers: 2 });
  await service.joinGame(created.id, p2);
  await service.startGame(created.id, p1);

  for (let i = 0; i < 20; i += 1) {
    const current = (await repository.findById(created.id))!;
    if (current.status === 'finished') break;
    await jest.advanceTimersByTimeAsync(10_000);
  }
  const game = (await repository.findById(created.id))!;
  expect(game.status).toBe('finished');
  expect(game.endReason).toBe('CONTROL_AFTER_LAST_TRICK');

  const manualTricks = game.play!.completedTricks.filter((t) => t.number < 5);
  const expected = manualTricks.flatMap((t) =>
    t.plays.map((_, position) => `auto-play:${game.id}:${t.number}:${position}`),
  );
  expect(game.recentCommandIds).toEqual(expect.arrayContaining(expected));
  expect(controlDecisions(game)).toEqual({ decisions: [] });
});
