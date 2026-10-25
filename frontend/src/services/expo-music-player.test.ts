/// <reference types="jest" />
import type { AppStateStatus } from 'react-native';

import { DEFAULT_PREFERENCES, usePreferencesStore } from '../stores/preferences-store';
import {
  isMusicAvailable,
  MUSIC_VOLUME_LEVELS,
  registerMusicPlayer,
  setMusicScene,
  type MusicPlayer,
} from './audio-service';
import { createExpoMusicPlayer, pickThemeIndex, type MusicHandle } from './expo-music-player';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(async () => undefined),
}));

/**
 * Chaîne logicielle de la musique avec un faux lecteur natif et des sources factices (des
 * numéros, comme un `require`). Aucun fichier musical n'est fourni par le projet : ces tests
 * ne prouvent pas qu'une musique sort du haut-parleur.
 */
type FakeHandle = jest.Mocked<MusicHandle> & {
  source: number;
  finish(): void;
};

let handles: FakeHandle[];
let appListener: (state: AppStateStatus) => void;
const appState = {
  addEventListener: jest.fn((_type: 'change', listener: (state: AppStateStatus) => void) => {
    appListener = listener;
    return { remove: jest.fn() };
  }),
};

function createPlayer(source: number): MusicHandle {
  let listener: ((status: { didJustFinish?: boolean }) => void) | null = null;
  const handle = {
    source,
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    addListener: jest.fn((_event: 'playbackStatusUpdate', next: typeof listener) => {
      listener = next;
      return { remove: jest.fn(() => (listener = null)) };
    }),
    finish: () => listener?.({ didJustFinish: true }),
  } as unknown as FakeHandle;
  handles.push(handle);
  return handle;
}

const TRACKS = {
  themes: [
    { intro: 1, loop: 10 },
    { intro: 2, loop: 11 },
    { intro: 3, loop: 12 },
  ],
  victory: 20,
  roundEnd: 21,
};
const live = () => handles.filter((h) => h.remove.mock.calls.length === 0);

beforeEach(() => {
  handles = [];
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
});
afterEach(() => registerMusicPlayer(null));

describe('lecteur de musique', () => {
  it("joue le thème d'entrée puis la boucle du générique, sans redémarrer au même appel", () => {
    const player = createExpoMusicPlayer(TRACKS, createPlayer, appState, () => 0.5);
    player.setScene('match', 'game-a');
    player.setScene('match', 'game-a');
    expect(handles).toHaveLength(1);
    expect(handles[0]).toMatchObject({ source: 2, loop: false });
    handles[0]!.finish();
    expect(handles).toHaveLength(2);
    expect(handles[0]!.remove).toHaveBeenCalled();
    expect(handles[1]).toMatchObject({ source: 11, loop: true });
    expect(handles[1]!.play).toHaveBeenCalledTimes(1);
    // Fin d'un tour de boucle : la boucle continue, le thème d'entrée ne revient pas.
    handles[1]!.finish();
    expect(handles).toHaveLength(2);
    expect(handles[1]!.remove).not.toHaveBeenCalled();
  });

  it('tire un autre générique à chaque nouvelle partie, garde le sien pour la même partie', () => {
    const player = createExpoMusicPlayer(TRACKS, createPlayer, appState, () => 0);
    player.setScene('match', 'game-a');
    player.setScene('victory', 'game-a');
    player.setScene('match', 'game-b');
    player.setScene(null);
    player.setScene('match', 'game-b');
    player.setScene('match', 'game-c');
    // Tirage toujours « 0 » : jamais deux fois de suite le même générique.
    expect(handles.filter((h) => h.source < 10).map((h) => h.source)).toEqual([1, 2, 2, 1]);
  });

  it('le tirage couvre tous les génériques et exclut celui de la partie précédente', () => {
    expect(pickThemeIndex(1, 0, () => 0.9)).toBe(0);
    expect(pickThemeIndex(10, undefined, () => 0.999)).toBe(9);
    const drawn = new Set<number>();
    for (let i = 0; i < 9; i += 1) drawn.add(pickThemeIndex(10, 4, () => i / 9));
    expect([...drawn].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9]);
  });

  it('ne superpose jamais deux pistes : résultat, puis nouvelle partie, puis sortie', () => {
    const player = createExpoMusicPlayer({ themes: [{ loop: 10 }], victory: 20 }, createPlayer, appState);
    player.setScene('match', 'a');
    player.setScene('victory', 'a');
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ source: 20, loop: false });
    player.setScene('match', 'b');
    expect(live()).toHaveLength(1);
    player.setScene(null);
    expect(live()).toHaveLength(0);
    expect(player.activeCount()).toBe(0);
  });

  it('un thème de résultat est libéré quand il se termine', () => {
    const player = createExpoMusicPlayer(TRACKS, createPlayer, appState);
    player.setScene('roundEnd');
    handles[0]!.finish();
    expect(player.activeCount()).toBe(0);
  });

  it('pause en arrière-plan, reprise au retour', () => {
    const player = createExpoMusicPlayer({ themes: [{ loop: 10 }] }, createPlayer, appState);
    player.setScene('match', 'a');
    appListener('background');
    expect(handles[0]!.pause).toHaveBeenCalledTimes(1);
    appListener('active');
    expect(handles[0]!.play).toHaveBeenCalledTimes(2);
  });

  it('sans piste déclarée : silence, aucun lecteur', () => {
    const player = createExpoMusicPlayer({ themes: [] }, createPlayer, appState);
    player.setScene('match', 'a');
    player.setScene('victory');
    expect(handles).toHaveLength(0);
    expect(player.hasMusic()).toBe(false);
  });
});

describe('préférences de la musique', () => {
  function fakeMusic(): jest.Mocked<MusicPlayer> {
    return { setScene: jest.fn(), setVolume: jest.fn(), hasMusic: jest.fn(() => true) };
  }

  it('respecte Musique OFF, indépendamment des effets, et reprend la boucle au passage sur ON', () => {
    const music = fakeMusic();
    registerMusicPlayer(music);
    usePreferencesStore.getState().setSoundEnabled(false);
    setMusicScene('match', 'a');
    expect(music.setScene).toHaveBeenLastCalledWith('match', 'a');

    usePreferencesStore.getState().setMusicEnabled(false);
    expect(music.setScene).toHaveBeenLastCalledWith(null, undefined);
    usePreferencesStore.getState().setMusicEnabled(true);
    expect(music.setScene).toHaveBeenLastCalledWith('match', 'a');
  });

  it('ne rejoue pas un thème de résultat au passage sur ON', () => {
    const music = fakeMusic();
    registerMusicPlayer(music);
    usePreferencesStore.getState().setMusicEnabled(false);
    setMusicScene('victory', 'a');
    music.setScene.mockClear();
    usePreferencesStore.getState().setMusicEnabled(true);
    expect(music.setScene).not.toHaveBeenCalled();
  });

  it('volume de la musique distinct de celui des effets', () => {
    const music = fakeMusic();
    registerMusicPlayer(music);
    usePreferencesStore.getState().setEffectsVolume('low');
    usePreferencesStore.getState().setMusicVolume('high');
    expect(music.setVolume).toHaveBeenLastCalledWith(MUSIC_VOLUME_LEVELS.high);
  });

  it("le réglage n'est proposé que si des pistes existent", () => {
    expect(isMusicAvailable()).toBe(false);
    registerMusicPlayer(createExpoMusicPlayer({ themes: [] }, createPlayer, appState));
    expect(isMusicAvailable()).toBe(false);
  });
});
