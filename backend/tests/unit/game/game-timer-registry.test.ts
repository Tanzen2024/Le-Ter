import type { GameId } from '../../../src/domain/game/game-id';
import { GameTimerRegistry } from '../../../src/services/game/game-timer-registry';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as GameId;
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as GameId;

describe('GameTimerRegistry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('gère un timer distinct par partie', () => {
    const registry = new GameTimerRegistry();
    const onA = jest.fn();
    const onB = jest.fn();

    registry.schedule(A, 1_000, onA);
    registry.schedule(B, 2_000, onB);
    jest.advanceTimersByTime(1_000);

    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
    expect(registry.has(A)).toBe(false);
    expect(registry.has(B)).toBe(true);
  });

  it("annuler ou réarmer A n'affecte pas B", () => {
    const registry = new GameTimerRegistry();
    const firstA = jest.fn();
    const secondA = jest.fn();
    const onB = jest.fn();

    registry.schedule(A, 1_000, firstA);
    registry.schedule(B, 1_000, onB);
    registry.schedule(A, 3_000, secondA);
    jest.advanceTimersByTime(1_000);

    expect(firstA).not.toHaveBeenCalled();
    expect(onB).toHaveBeenCalledTimes(1);

    expect(registry.cancel(A)).toBe(true);
    jest.advanceTimersByTime(5_000);
    expect(secondA).not.toHaveBeenCalled();
  });

  it('cancelAll arrête tous les timers (arrêt du serveur)', () => {
    const registry = new GameTimerRegistry();
    const onA = jest.fn();
    registry.schedule(A, 1_000, onA);
    registry.schedule(B, 1_000, onA);

    registry.cancelAll();
    jest.advanceTimersByTime(1_000);

    expect(onA).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });
});
