/// <reference types="jest" />
import { act, cleanup, render, renderHook, screen } from '@testing-library/react-native';

import type { GameView } from '../../../types/game';
import { FAREWELL_MS, FarewellHand, useFarewell } from './TurnHud';

/** Main d'au revoir de 3 s après « Se coucher », avant le panneau de fin de partie. */

const game = (fledAt?: string, viewerId = 'me') =>
  ({
    gameId: 'g-1',
    viewerId,
    status: fledAt ? 'finished' : 'in_progress',
    players: [
      { playerId: 'me', seat: 0, joinedAt: '2026-10-12T09:00:00Z', ...(fledAt && { fledAt }) },
      { playerId: 'other', seat: 1, joinedAt: '2026-10-12T09:00:01Z' },
    ],
  }) as unknown as GameView;

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  cleanup();
});

describe('main d’au revoir', () => {
  it('ma fuite confirmée : visible 3 s exactement, puis le panneau de fin peut s’afficher', async () => {
    const { result, rerender } = await renderHook(({ g }: { g: GameView }) => useFarewell(g), {
      initialProps: { g: game() },
    });
    expect(result.current).toBe(false);
    await rerender({ g: game('2026-10-12T09:01:00Z') });
    expect(result.current).toBe(true);
    expect(FAREWELL_MS).toBe(3000);
    await act(() => jest.advanceTimersByTime(FAREWELL_MS - 1));
    expect(result.current).toBe(true);
    await act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('partie déjà fuie à l’ouverture de l’écran (reconnexion) : aucune main', async () => {
    const { result } = await renderHook(() => useFarewell(game('2026-10-12T09:01:00Z')));
    expect(result.current).toBe(false);
  });

  it('fuite d’un AUTRE joueur : aucune main chez moi', async () => {
    const { result, rerender } = await renderHook(({ g }: { g: GameView }) => useFarewell(g), {
      initialProps: { g: game(undefined, 'other') },
    });
    await rerender({ g: game('2026-10-12T09:01:00Z', 'other') });
    expect(result.current).toBe(false);
  });

  it('dessinée au centre donné, sans capter les gestes', async () => {
    await render(<FarewellHand cx={400} cy={200} size={120} />);
    expect(screen.getByLabelText('Au revoir : vous vous êtes couché')).toHaveStyle({
      left: 340,
      top: 140,
      width: 120,
      height: 120,
      pointerEvents: 'none',
    });
  });
});
