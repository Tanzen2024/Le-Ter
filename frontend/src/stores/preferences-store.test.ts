/// <reference types="jest" />
import * as SecureStore from 'expo-secure-store';

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  sanitizePreferences,
  usePreferencesStore,
} from './preferences-store';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

const secure = SecureStore as unknown as {
  __store: Map<string, string>;
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const saved = () => JSON.parse(secure.__store.get(PREFERENCES_STORAGE_KEY) ?? 'null');

beforeEach(async () => {
  await flush();
  secure.__store.clear();
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
  await flush();
});

describe('préférences : son', () => {
  it('est activé par défaut', () => {
    expect(DEFAULT_PREFERENCES.soundEnabled).toBe(true);
    expect(usePreferencesStore.getState().soundEnabled).toBe(true);
  });

  it("passe à OFF puis à ON, et chaque choix est enregistré sur l'appareil", async () => {
    usePreferencesStore.getState().setSoundEnabled(false);
    expect(usePreferencesStore.getState().soundEnabled).toBe(false);
    await flush();
    expect(saved().state).toEqual({
      soundEnabled: false,
      effectsVolume: 'high',
      musicEnabled: true,
      musicVolume: 'medium',
      language: 'fr',
    });

    usePreferencesStore.getState().setSoundEnabled(true);
    expect(usePreferencesStore.getState().soundEnabled).toBe(true);
    await flush();
    expect(saved().state.soundEnabled).toBe(true);
  });
});

describe('préférences : langue', () => {
  it('est le français par défaut', () => {
    expect(usePreferencesStore.getState().language).toBe('fr');
  });

  it("passe à l'anglais puis revient au français, avec persistance", async () => {
    usePreferencesStore.getState().setLanguage('en');
    expect(usePreferencesStore.getState().language).toBe('en');
    await flush();
    expect(saved().state.language).toBe('en');

    usePreferencesStore.getState().setLanguage('fr');
    expect(usePreferencesStore.getState().language).toBe('fr');
    await flush();
    expect(saved().state.language).toBe('fr');
  });

  it('refuse une langue inconnue', () => {
    usePreferencesStore.getState().setLanguage('de' as never);
    expect(usePreferencesStore.getState().language).toBe('fr');
  });
});

describe('préférences : restauration au lancement', () => {
  it("restaure le son OFF et l'anglais enregistrés", async () => {
    secure.__store.set(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ state: { soundEnabled: false, language: 'en' }, version: 1 }),
    );
    await usePreferencesStore.persist.rehydrate();
    expect(usePreferencesStore.getState()).toMatchObject({ soundEnabled: false, language: 'en' });
  });

  it("reprend les valeurs par défaut si l'état enregistré est corrompu", async () => {
    secure.__store.set(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ state: { soundEnabled: 'oui', language: 'xx' }, version: 1 }),
    );
    await usePreferencesStore.persist.rehydrate();
    expect(usePreferencesStore.getState()).toMatchObject(DEFAULT_PREFERENCES);

    secure.__store.set(PREFERENCES_STORAGE_KEY, '{pas du json');
    await usePreferencesStore.persist.rehydrate();
    expect(usePreferencesStore.getState()).toMatchObject(DEFAULT_PREFERENCES);
  });

  it('continue de fonctionner si le stockage est indisponible', async () => {
    secure.getItemAsync.mockRejectedValueOnce(new Error('keystore'));
    secure.setItemAsync.mockRejectedValueOnce(new Error('keystore'));
    await usePreferencesStore.persist.rehydrate();
    usePreferencesStore.getState().setSoundEnabled(false);
    await flush();
    expect(usePreferencesStore.getState().soundEnabled).toBe(false);
  });

  it('ne garde que les préférences connues', () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences({ soundEnabled: false, language: 'en', token: 'x' })).toEqual({
      soundEnabled: false,
      effectsVolume: 'high',
      // Préférence musique absente : elle suit le son coupé.
      musicEnabled: false,
      musicVolume: 'medium',
      language: 'en',
    });
  });
});

describe('préférences : musique', () => {
  it('ON et « moyen » par défaut, indépendante des effets, enregistrée puis restaurée', async () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({ musicEnabled: true, musicVolume: 'medium' });
    usePreferencesStore.getState().setMusicEnabled(false);
    usePreferencesStore.getState().setMusicVolume('low');
    await flush();
    expect(saved().state).toMatchObject({ musicEnabled: false, musicVolume: 'low', soundEnabled: true });
    expect(sanitizePreferences({ soundEnabled: true, musicEnabled: false }).musicEnabled).toBe(false);
    expect(sanitizePreferences({ musicVolume: 'max' }).musicVolume).toBe('medium');
  });
});

describe('préférences : volume des effets', () => {
  it('« fort » par défaut : le volume déjà connu des joueurs ne change pas', () => {
    expect(DEFAULT_PREFERENCES.effectsVolume).toBe('high');
    expect(usePreferencesStore.getState().effectsVolume).toBe('high');
  });

  it("chaque choix est enregistré sur l'appareil, puis restauré", async () => {
    usePreferencesStore.getState().setEffectsVolume('low');
    await flush();
    expect(saved().state.effectsVolume).toBe('low');
    secure.__store.set(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ state: { soundEnabled: true, effectsVolume: 'medium', language: 'fr' }, version: 1 }),
    );
    await usePreferencesStore.persist.rehydrate();
    expect(usePreferencesStore.getState().effectsVolume).toBe('medium');
  });

  it('valeur inconnue (stockage ou appel) : ignorée, valeur par défaut ou précédente gardée', () => {
    expect(sanitizePreferences({ effectsVolume: 'max' }).effectsVolume).toBe('high');
    usePreferencesStore.getState().setEffectsVolume('medium');
    usePreferencesStore.getState().setEffectsVolume('max' as never);
    expect(usePreferencesStore.getState().effectsVolume).toBe('medium');
  });
});
