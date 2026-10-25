/// <reference types="jest" />
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { DEFAULT_PREFERENCES, usePreferencesStore } from '../stores/preferences-store';
import { playSound, registerSoundPlayer } from './audio-service';
import { createExpoSoundPlayer, installSoundPlayer, type AudioHandle } from './expo-sound-player';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(async () => undefined),
    remove: jest.fn(),
  })),
  setAudioModeAsync: jest.fn(async () => undefined),
}));

/**
 * Ces tests vérifient toute la chaîne logicielle (préférence → playSound → lecteur →
 * appels expo-audio) avec un faux lecteur natif. Ils ne peuvent pas prouver qu'un son sort
 * du haut-parleur : cela reste à vérifier sur un appareil (docs/settings.md).
 */
function fakeHandle(): jest.Mocked<AudioHandle> {
  return {
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(async (_seconds: number) => undefined),
    remove: jest.fn(),
  };
}

let handles: jest.Mocked<AudioHandle>[];
let createPlayer: jest.Mock;

beforeEach(() => {
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
  handles = [];
  createPlayer = jest.fn(() => {
    const handle = fakeHandle();
    handles.push(handle);
    return handle;
  });
});

afterEach(() => registerSoundPlayer(null));

describe('lecteur expo-audio', () => {
  it('son activé : le son demandé est joué depuis le début', () => {
    registerSoundPlayer(createExpoSoundPlayer(createPlayer));
    expect(playSound('uiClick')).toBe(true);
    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(handles[0].seekTo).toHaveBeenCalledWith(0);
    expect(handles[0].play).toHaveBeenCalledTimes(1);
  });

  it('son désactivé : aucun son lancé, aucun lecteur créé', () => {
    registerSoundPlayer(createExpoSoundPlayer(createPlayer));
    usePreferencesStore.getState().setSoundEnabled(false);
    expect(playSound('uiClick')).toBe(false);
    expect(playSound('uiError')).toBe(false);
    expect(createPlayer).not.toHaveBeenCalled();
  });

  it('ON → OFF : les sons en cours sont arrêtés et les lecteurs libérés', () => {
    const player = createExpoSoundPlayer(createPlayer);
    registerSoundPlayer(player);
    playSound('uiClick');
    playSound('uiConfirm');
    expect(player.activeCount()).toBe(2);

    usePreferencesStore.getState().setSoundEnabled(false);
    for (const handle of handles) {
      expect(handle.pause).toHaveBeenCalledTimes(1);
      expect(handle.remove).toHaveBeenCalledTimes(1);
    }
    expect(player.activeCount()).toBe(0);
  });

  it('OFF → ON : les sons reprennent avec un nouveau lecteur', () => {
    const player = createExpoSoundPlayer(createPlayer);
    registerSoundPlayer(player);
    playSound('uiClick');
    usePreferencesStore.getState().setSoundEnabled(false);
    usePreferencesStore.getState().setSoundEnabled(true);

    expect(playSound('uiClick')).toBe(true);
    expect(createPlayer).toHaveBeenCalledTimes(2);
    expect(handles[1].play).toHaveBeenCalledTimes(1);
    expect(player.activeCount()).toBe(1);
  });

  it('aucun lecteur inutile : un seul lecteur par son, réutilisé à chaque lecture', () => {
    const player = createExpoSoundPlayer(createPlayer);
    registerSoundPlayer(player);
    for (let i = 0; i < 5; i += 1) playSound('uiClick');
    playSound('uiError');

    expect(createPlayer).toHaveBeenCalledTimes(2);
    expect(handles[0].play).toHaveBeenCalledTimes(5);
    expect(player.activeCount()).toBe(2);
  });

  it('erreur du lecteur audio : aucun plantage, le lecteur fautif est recréé', () => {
    const player = createExpoSoundPlayer(createPlayer);
    registerSoundPlayer(player);
    createPlayer.mockImplementationOnce(() => {
      throw new Error('native');
    });
    expect(() => playSound('uiClick')).not.toThrow();

    const broken = fakeHandle();
    broken.play.mockImplementation(() => {
      throw new Error('native');
    });
    broken.seekTo.mockRejectedValue(new Error('native'));
    createPlayer.mockImplementationOnce(() => broken);
    expect(() => playSound('uiClick')).not.toThrow();
    expect(broken.remove).toHaveBeenCalledTimes(1);
    expect(player.activeCount()).toBe(0);

    broken.remove.mockImplementation(() => {
      throw new Error('native');
    });
    expect(() => player.stopAll?.()).not.toThrow();
  });

  it("s'installe une seule fois : mode audio d'interface, jamais de doublon", () => {
    installSoundPlayer();
    installSoundPlayer();
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: false,
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
    });

    playSound('uiClick');
    playSound('uiClick');
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  });
});

describe('volume des effets (Réglages)', () => {
  it('appliqué aux lecteurs déjà ouverts et à ceux créés ensuite', () => {
    registerSoundPlayer(createExpoSoundPlayer(createPlayer));
    playSound('uiClick');
    expect(handles[0].volume).toBe(1);
    usePreferencesStore.getState().setEffectsVolume('low');
    expect(handles[0].volume).toBeCloseTo(0.35);
    playSound('cardPlace');
    expect(handles[1].volume).toBeCloseTo(0.35);
  });

  it('son coupé : aucun son de table joué, quel que soit le volume', () => {
    registerSoundPlayer(createExpoSoundPlayer(createPlayer));
    usePreferencesStore.getState().setSoundEnabled(false);
    for (const sound of ['cardDeal', 'cardPick', 'cardPlace', 'turnChime', 'resultWin', 'resultNeutral'] as const) {
      expect(playSound(sound)).toBe(false);
    }
    expect(createPlayer).not.toHaveBeenCalled();
  });

  it('chaque son de table a son fichier et un seul lecteur, réutilisé', () => {
    registerSoundPlayer(createExpoSoundPlayer(createPlayer));
    for (let i = 0; i < 3; i += 1) playSound('cardDeal');
    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(handles[0].play).toHaveBeenCalledTimes(3);
  });
});
