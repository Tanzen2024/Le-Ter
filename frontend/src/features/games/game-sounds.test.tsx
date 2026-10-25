/// <reference types="jest" />
import { renderHook } from '@testing-library/react-native';

import { ApiError } from '../../lib/api-client';
import { playSound, setMusicScene } from '../../services/audio-service';
import type { GameView } from '../../types/game';
import {
  musicSceneOf,
  myTurnKeyOf,
  resultSoundOf,
  useGameMusic,
  useMyTurnSound,
  useRefusalSound,
  useResultSound,
} from './game-sounds';

jest.mock('../../services/audio-service', () => ({
  playSound: jest.fn(() => true),
  setMusicScene: jest.fn(),
}));
const played = playSound as jest.Mock;
const scene = setMusicScene as jest.Mock;

/**
 * Sons de la table (LOT 5) : seuls les CHANGEMENTS d'état du serveur observés pendant que
 * l'écran est ouvert sonnent, une seule fois ; l'état présent à l'ouverture (reconnexion,
 * reprise) et les nouveaux rendus ne rejouent rien.
 */
const ME = 'me';
const OTHER = 'other';

function game(overrides: Partial<GameView> = {}, canPlayCard = false): GameView {
  return {
    gameId: 'g1',
    viewerId: ME,
    status: 'in_progress',
    turnDeadlineAt: '2026-10-24T10:00:10.000Z',
    myActions: { canPlayCard },
    result: undefined,
    ...overrides,
  } as unknown as GameView;
}

beforeEach(() => {
  played.mockClear();
  scene.mockClear();
});

describe('cloche « à moi de jouer »', () => {
  it('ne sonne pas à l’ouverture de l’écran, même si c’est déjà mon tour (reconnexion)', async () => {
    await renderHook(() => useMyTurnSound(game({}, true), false));
    expect(played).not.toHaveBeenCalled();
  });

  it('sonne une fois quand le serveur me donne la main, jamais sur un nouveau rendu', async () => {
    const { rerender } = await renderHook(({ g }: { g: GameView }) => useMyTurnSound(g, false), {
      initialProps: { g: game({}, false) },
    });
    await rerender({ g: game({}, true) });
    await rerender({ g: game({}, true) });
    await rerender({ g: game({ version: 9 } as Partial<GameView>, true) });
    expect(played).toHaveBeenCalledTimes(1);
    expect(played).toHaveBeenCalledWith('turnChime');
  });

  it('nouveau tour à moi (nouvelle échéance du serveur) : nouvelle cloche', async () => {
    const { rerender } = await renderHook(({ g }: { g: GameView }) => useMyTurnSound(g, false), {
      initialProps: { g: game({}, false) },
    });
    await rerender({ g: game({}, true) });
    await rerender({ g: game({ turnDeadlineAt: '2026-10-24T10:00:30.000Z' }, true) });
    expect(played).toHaveBeenCalledTimes(2);
  });

  it('aucune cloche pendant la distribution ni hors partie en cours', () => {
    expect(myTurnKeyOf(game({}, true), true)).toBeNull();
    expect(myTurnKeyOf(game({ status: 'finished' }, true), false)).toBeNull();
    expect(myTurnKeyOf(game({}, false), false)).toBeNull();
  });
});

describe('son de refus', () => {
  const refusal = new ApiError(409, 'NOT_YOUR_TURN', 'Ce n’est pas votre tour.');

  it('refus du serveur : un seul son d’erreur, même après plusieurs rendus', async () => {
    const { rerender } = await renderHook(({ e }: { e: unknown }) => useRefusalSound(e), {
      initialProps: { e: null as unknown },
    });
    await rerender({ e: refusal });
    await rerender({ e: refusal });
    expect(played).toHaveBeenCalledTimes(1);
    expect(played).toHaveBeenCalledWith('uiError');
  });

  it('conflit de version (relecture silencieuse) ou erreur réseau : aucun son', async () => {
    const { rerender } = await renderHook(({ e }: { e: unknown }) => useRefusalSound(e), {
      initialProps: { e: null as unknown },
    });
    await rerender({ e: new ApiError(409, 'VERSION_CONFLICT', 'Version') });
    await rerender({ e: new TypeError('Network request failed') });
    expect(played).not.toHaveBeenCalled();
  });
});

describe('son du résultat', () => {
  const won = { winnerId: ME } as GameView['result'];
  const lost = { winnerId: OTHER } as GameView['result'];

  it('choisi d’après le résultat officiel uniquement', () => {
    expect(resultSoundOf(game({ status: 'finished', result: won }))).toBe('resultWin');
    expect(resultSoundOf(game({ status: 'finished', result: lost }))).toBe('resultNeutral');
    expect(resultSoundOf(game({ status: 'finished', result: undefined }))).toBe('resultNeutral');
  });

  it('partie vue en cours puis résultat annoncé : un seul son', async () => {
    const { rerender } = await renderHook(({ g, a }: { g: GameView; a: boolean }) => useResultSound(g, a), {
      initialProps: { g: game(), a: false },
    });
    await rerender({ g: game({ status: 'finished', result: won }), a: false });
    expect(played).not.toHaveBeenCalled();
    await rerender({ g: game({ status: 'finished', result: won }), a: true });
    await rerender({ g: game({ status: 'finished', result: won }), a: true });
    expect(played).toHaveBeenCalledTimes(1);
    expect(played).toHaveBeenCalledWith('resultWin');
  });

  it('partie déjà terminée à l’ouverture de l’écran : aucun son rejoué', async () => {
    await renderHook(() => useResultSound(game({ status: 'finished', result: won }), true));
    expect(played).not.toHaveBeenCalled();
  });
});

describe('musique de la table', () => {
  const won = { winnerId: ME, method: 'CONTROL_AFTER_LAST_TRICK' };
  const lost = { winnerId: OTHER, method: 'CONTROL_AFTER_LAST_TRICK' };

  it("scène d'après l'état du serveur uniquement", () => {
    expect(musicSceneOf(game({ status: 'waiting' } as Partial<GameView>), false, false)).toBeNull();
    expect(musicSceneOf(game(), false, true)).toBe('match');
    const finishedWon = game({ status: 'finished', result: won } as Partial<GameView>);
    expect(musicSceneOf(finishedWon, false, true)).toBe('match');
    expect(musicSceneOf(finishedWon, true, true)).toBe('victory');
    expect(
      musicSceneOf(game({ status: 'finished', result: lost } as Partial<GameView>), true, true),
    ).toBe('roundEnd');
    // Partie déjà terminée à l'ouverture de l'écran : aucune musique.
    expect(musicSceneOf(finishedWon, true, false)).toBeNull();
  });

  it('une seule demande par scène (pas de relance au rendu), silence à la sortie', async () => {
    const g = game({ sessionId: 's1' } as Partial<GameView>);
    const { rerender, unmount } = await renderHook(
      ({ g: current, announced }: { g: GameView; announced: boolean }) =>
        useGameMusic(current, announced),
      { initialProps: { g, announced: false } },
    );
    await rerender({ g: { ...g, version: 3 } as GameView, announced: false });
    expect(scene.mock.calls).toEqual([['match', 'g1']]);
    const finished = { ...g, status: 'finished', result: won } as unknown as GameView;
    await rerender({ g: finished, announced: true });
    expect(scene).toHaveBeenLastCalledWith('victory', 'g1');
    await unmount();
    expect(scene).toHaveBeenLastCalledWith(null);
  });
});
