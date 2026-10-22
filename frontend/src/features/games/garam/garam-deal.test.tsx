/// <reference types="jest" />
import { act, renderHook } from '@testing-library/react-native';

import type { DealBatch } from '../../../types/game';
import { garamDealSchedule, useGaramDealProgress } from './garam-deal';

/**
 * Distribution de GARAM TIA (D-123) : passage 1, 2 cartes ENSEMBLE à chaque joueur (un lot,
 * un vol) ; passage 2, la 3e carte de chacun ; puis le terre carte par carte. Calendrier
 * VISUEL seulement : il finit 500 ms avant la phase du serveur (`garamDealPhaseMs`, backend),
 * après laquelle commence le temps du tour du Ter.
 */
const sequenceFor = (order: string[]): DealBatch[] =>
  [2, 1].flatMap((count, i) => order.map((playerId) => ({ pass: i + 1, playerId, count })));

const PLAYERS = ['a', 'b', 'c', 'd'];

describe('calendrier de distribution', () => {
  it.each([
    [2, 3, 4_660],
    [3, 4, 6_560],
    [4, 5, 8_460],
  ])('%i joueurs : 2 + 1 cartes chacun puis %i cartes de terre, fin à %i ms', (n, terre, endsAt) => {
    const order = PLAYERS.slice(0, n);
    const { steps, endsAt: end } = garamDealSchedule(sequenceFor(order), terre);
    const hands = steps.flatMap((s) => (s.kind === 'hand' ? [s.batch] : []));
    // Passage 1 : un lot de 2 cartes par joueur ; passage 2 : une carte ; 3 cartes chacun.
    expect(hands.map((b) => `${b.pass}${b.playerId}×${b.count}`)).toEqual([
      ...order.map((id) => `1${id}×2`),
      ...order.map((id) => `2${id}×1`),
    ]);
    for (const id of order) {
      expect(hands.filter((b) => b.playerId === id).reduce((t, b) => t + b.count, 0)).toBe(3);
    }
    expect(steps.filter((s) => s.kind === 'terre')).toHaveLength(terre);
    expect(steps.findIndex((s) => s.kind === 'terre')).toBe(2 * n);
    // Phase du serveur = fin de l'animation + 500 ms de marge (5 160 / 7 060 / 8 960 ms).
    expect(end).toBe(endsAt);
  });

  it('séquence de référence à 4 joueurs : 600 ms entre joueurs et passages, 700 ms au terre', () => {
    const { steps } = garamDealSchedule(sequenceFor(PLAYERS), 5);
    expect(steps.map((s) => s.at)).toEqual([
      250, 850, 1_450, 2_050, // J1..J4 : 2 cartes ensemble, 600 ms
      2_650, 3_250, 3_850, 4_450, // 600 ms, puis J1..J4 : 1 carte, 600 ms
      5_150, 5_850, 6_550, 7_250, 7_950, // 700 ms, puis terre : 700 ms
    ]);
  });
});

describe('révélation progressive sur la table', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('2 cartes ensemble par joueur, puis la 3e, puis le terre ; fin après la dernière pose', async () => {
    const onDone = jest.fn();
    const { result } = await renderHook(() =>
      useGaramDealProgress(sequenceFor(['a', 'b']), 3, true, onDone),
    );
    let elapsed = 0;
    /** Avance jusqu'à `target` ms par pas de 10 ms ; les cartes en vol atterrissent aussitôt. */
    const advanceTo = async (target: number) => {
      while (elapsed < target) {
        await act(async () => jest.advanceTimersByTime(10));
        elapsed += 10;
        for (let i = result.current.flying.length; i > 0; i--) {
          await act(async () => result.current.land());
        }
      }
    };

    await advanceTo(240);
    expect(result.current.landed).toEqual({});
    await advanceTo(250);
    // Un seul envoi : les deux premières cartes de a arrivent ensemble.
    expect(result.current.landed).toEqual({ a: 2 });
    await advanceTo(840);
    expect(result.current.landed).toEqual({ a: 2 });
    await advanceTo(850);
    expect(result.current.landed).toEqual({ a: 2, b: 2 });
    await advanceTo(1_450);
    expect(result.current.landed).toEqual({ a: 3, b: 2 });
    await advanceTo(2_050);
    expect(result.current.landed).toEqual({ a: 3, b: 3 });
    await advanceTo(2_740); // pause de 700 ms avant le terre
    expect(result.current.terreLanded).toBe(0);
    await advanceTo(2_750);
    expect(result.current.terreLanded).toBe(1);
    await advanceTo(4_150);
    expect(result.current.terreLanded).toBe(3);
    expect(onDone).not.toHaveBeenCalled();
    await advanceTo(4_660);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
