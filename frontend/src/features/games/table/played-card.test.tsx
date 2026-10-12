/// <reference types="jest" />
import { act, cleanup, render } from '@testing-library/react-native';

import { PlayedCardSpotlight, TRICK_CLEAR_DELAY_MS } from './TableCards';

/** Une carte jouée reste sur la table jusqu'à la fin du tour, puis rejoint son joueur. */

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  cleanup();
});

const spotlight = (release: boolean, onSettled: jest.Mock, onReveal = jest.fn()) => (
  <PlayedCardSpotlight
    cardId="COEUR-3"
    from={{ x: 100, y: 100 }}
    to={{ x: 300, y: 200 }}
    width={40}
    targetWidth={30}
    release={release}
    onReveal={onReveal}
    onSettled={onSettled}
  />
);

describe('carte jouée sur la table', () => {
  it('tour non terminé : la carte reste sur la table, quel que soit le temps écoulé', async () => {
    const onSettled = jest.fn();
    const onReveal = jest.fn();
    await render(spotlight(false, onSettled, onReveal));
    await act(() => jest.advanceTimersByTime(30_000));
    expect(onReveal).toHaveBeenCalledWith('COEUR-3');
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('dernière carte du tour jouée : rangée chez son joueur 2 s plus tard, pas avant', async () => {
    const onSettled = jest.fn();
    const view = await render(spotlight(false, onSettled));
    await act(() => jest.advanceTimersByTime(5_000));
    await view.rerender(spotlight(true, onSettled));
    await act(() => jest.advanceTimersByTime(TRICK_CLEAR_DELAY_MS - 1));
    expect(onSettled).not.toHaveBeenCalled();
    // Puis le court trajet vers la zone du joueur.
    await act(() => jest.advanceTimersByTime(2_000));
    expect(onSettled).toHaveBeenCalledWith('COEUR-3');
  });

  it('démontage (nouvelle partie, sortie) : aucun minuteur résiduel', async () => {
    const onSettled = jest.fn();
    const view = await render(spotlight(true, onSettled));
    await view.unmount();
    await act(() => jest.advanceTimersByTime(10_000));
    expect(onSettled).not.toHaveBeenCalled();
  });
});
