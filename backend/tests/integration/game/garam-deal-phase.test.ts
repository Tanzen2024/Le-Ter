import { DealInProgressError } from '../../../src/domain/game/game-errors';
import type { GaramCardId } from '../../../src/domain/garam/garam-cards';
import { garamDealPhaseMs } from '../../../src/domain/garam/garam-engine';
import { GARAM_TURN_DURATION_MS } from '../../../src/domain/garam/garam-rules';
import { createGameServiceFixture, listen, player } from '../../fixtures/game-service.fixture';
import { garamDecksRandom } from '../../fixtures/random';

/**
 * GARAM TIA, phase de distribution et temps de décision (D-102, D-122) : la distribution
 * (mains puis terre) est une phase PERSISTÉE du serveur pendant laquelle aucun temps de
 * décision ne court ; le premier tour commence à sa confirmation, avec la durée COMPLÈTE du
 * tour de GARAM (GARAM_TURN_DURATION_MS, 15 s affichées, D-127) ; à l'échéance, le mécanisme existant (TURN_TIMEOUT puis
 * action automatique) joue une carte LÉGALE.
 */
const [p1, p2] = [player('garam-1'), player('garam-2')];
const T0 = new Date('2026-10-20T10:00:00.000Z');
const TURN = GARAM_TURN_DURATION_MS;
/** 2 joueurs : 3 cartes chacun, terre de 3 cartes. */
const DEAL = garamDealPhaseMs(2, 3);
const at = (ms: number) => new Date(T0.getTime() + ms);

const DECK: GaramCardId[] = [
  'COEUR-9', 'TREFLE-7', 'PIQUE-10', // p1, dégageur
  'COEUR-5', 'CARREAU-8', 'TREFLE-10', // p2
  'TREFLE-4', 'PIQUE-5', 'CARREAU-3', // terre
];

async function dealingGaram() {
  const fixture = createGameServiceFixture({
    random: garamDecksRandom(DECK),
    // Calendrier réel de production : 2 joueurs, 4 lots de mains (2 + 1) + 3 cartes de terre.
    dealDurationMs: (batches) => garamDealPhaseMs(2, batches - 4),
  });
  const created = await fixture.service.createGame(p1, { maxPlayers: 2, gameType: 'GARAM', garamVariant: 15 });
  await fixture.service.joinGame(created.id, p2);
  const events = await listen(fixture.service, created.id, p1);
  const game = await fixture.service.startGame(created.id, p1);
  return { ...fixture, game, events };
}

const ofType = <E extends { type: string }>(events: E[], type: string) =>
  events.filter((e) => e.type === type);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});
afterEach(() => jest.useRealTimers());

describe('GARAM TIA : distribution avant tout temps de décision (D-122)', () => {
  it('pendant la distribution (mains + terre) : aucune échéance, aucune action acceptée', async () => {
    const { service, game, repository, events } = await dealingGaram();
    const stored = (await repository.findById(game.id))!;
    expect(stored.dealEndsAt).toEqual(at(DEAL));
    expect(stored.turnDeadlineAt).toBeUndefined();
    expect(await repository.findTurnDeadlines()).toEqual([]);
    expect(ofType(events, 'game:started')[0]?.payload).toMatchObject({
      dealEndsAt: at(DEAL).toISOString(),
      // 2 cartes ensemble à chaque joueur, puis la 3e (D-123).
      dealSequence: [2, 1].flatMap((count, i) =>
        [p1, p2].map((playerId) => ({ pass: i + 1, playerId, count })),
      ),
    });
    await expect(service.playCard(game.id, p1, 'COEUR-9')).rejects.toThrow(DealInProgressError);
    await jest.advanceTimersByTimeAsync(DEAL - 1);
    expect(ofType(events, 'game:deal_completed')).toHaveLength(0);
    expect(ofType(events, 'game:turn_timeout')).toHaveLength(0);
  });

  it('confirmation : tour du dégageur, durée COMPLÈTE du Ter, puis action automatique légale', async () => {
    const { repository, game, events } = await dealingGaram();
    await jest.advanceTimersByTimeAsync(DEAL);
    expect(ofType(events, 'game:deal_completed')[0]?.payload).toMatchObject({
      nextPlayerId: p1,
      turnStartedAt: at(DEAL).toISOString(),
      turnDeadlineAt: at(DEAL + TURN).toISOString(),
    });

    await jest.advanceTimersByTimeAsync(TURN - 1);
    expect(ofType(events, 'game:turn_timeout')).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(ofType(events, 'game:turn_timeout')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ playerId: p1 }) }),
    ]);
    const played = ofType(events, 'game:card_played')[0];
    expect(played?.payload).toMatchObject({ playerId: p1, automatic: true });
    expect(['COEUR-9', 'TREFLE-7', 'PIQUE-10']).toContain(played?.payload.cardId);

    // Le joueur suivant reçoit à son tour la durée complète, à partir de l'action automatique.
    const after = (await repository.findById(game.id))!;
    expect(after.garam?.nextPlayerId).toBe(p2);
    expect(after.turnDeadlineAt).toEqual(at(DEAL + TURN + TURN));
  });
});
