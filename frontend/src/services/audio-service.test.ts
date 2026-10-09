/// <reference types="jest" />
import { DEFAULT_PREFERENCES, usePreferencesStore } from '../stores/preferences-store';
import { playSound, registerSoundPlayer, type SoundPlayer } from './audio-service';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

let player: { play: jest.Mock; stopAll: jest.Mock };

beforeEach(() => {
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
  player = { play: jest.fn(), stopAll: jest.fn() };
  registerSoundPlayer(player);
});

afterAll(() => registerSoundPlayer(null));

describe('audio-service', () => {
  it('joue le son quand le son est activé', () => {
    expect(playSound('uiClick')).toBe(true);
    expect(player.play).toHaveBeenCalledWith('uiClick');
  });

  it('ne joue aucun son quand le son est désactivé', () => {
    usePreferencesStore.getState().setSoundEnabled(false);
    expect(playSound('uiClick')).toBe(false);
    expect(player.play).not.toHaveBeenCalled();
  });

  it('coupe les sons en cours au passage sur OFF, et rejoue après le retour sur ON', () => {
    usePreferencesStore.getState().setSoundEnabled(false);
    expect(player.stopAll).toHaveBeenCalledTimes(1);
    usePreferencesStore.getState().setSoundEnabled(true);
    expect(playSound('uiClick')).toBe(true);
  });

  it("n'échoue jamais : sans lecteur, ou si le lecteur lève une erreur", async () => {
    registerSoundPlayer(null);
    expect(playSound('uiClick')).toBe(false);

    const failing: SoundPlayer = {
      play: () => {
        throw new Error('audio');
      },
    };
    registerSoundPlayer(failing);
    expect(() => playSound('uiClick')).not.toThrow();

    registerSoundPlayer({ play: () => Promise.reject(new Error('audio')) });
    expect(playSound('uiClick')).toBe(true);
    await Promise.resolve();
  });
});
