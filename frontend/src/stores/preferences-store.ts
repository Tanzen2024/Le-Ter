import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { preferencesStorage } from '../services/preferences-storage';

/** Langues disponibles. Ajouter une langue : voir docs/settings.md. */
export const LANGUAGES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'fr';

/**
 * Volume des effets sonores (3 niveaux, panneau Réglages). « high » = niveau des fichiers,
 * valeur par défaut : le volume déjà connu des joueurs ne change pas.
 */
export const EFFECTS_VOLUMES = ['low', 'medium', 'high'] as const;
export type EffectsVolume = (typeof EFFECTS_VOLUMES)[number];
export const DEFAULT_EFFECTS_VOLUME: EffectsVolume = 'high';

/**
 * Volume de la musique de partie, indépendant de celui des effets (mêmes trois niveaux, gains
 * propres : la musique reste sous les effets). « Moyen » par défaut.
 */
export const DEFAULT_MUSIC_VOLUME: EffectsVolume = 'medium';

export function isEffectsVolume(value: unknown): value is EffectsVolume {
  return typeof value === 'string' && (EFFECTS_VOLUMES as readonly string[]).includes(value);
}

/** Clé du stockage local (caractères autorisés par SecureStore : [A-Za-z0-9._-]). */
export const PREFERENCES_STORAGE_KEY = 'le-ter.preferences';

/**
 * Préférences locales de l'appareil (panneau Réglages), source de vérité UNIQUE du son et de
 * la langue. Indépendantes de toute partie (aucun `gameId`, aucune donnée de jeu) et jamais
 * envoyées au serveur. Persistées sur l'appareil et restaurées au lancement.
 */
export interface PreferencesState {
  soundEnabled: boolean;
  /** Volume des effets sonores ; sans effet tant que le son est coupé. */
  effectsVolume: EffectsVolume;
  /** Musique de partie ON/OFF, indépendante des effets (`soundEnabled`). */
  musicEnabled: boolean;
  musicVolume: EffectsVolume;
  language: Language;
  setSoundEnabled(enabled: boolean): void;
  setEffectsVolume(volume: EffectsVolume): void;
  setMusicEnabled(enabled: boolean): void;
  setMusicVolume(volume: EffectsVolume): void;
  setLanguage(language: Language): void;
}

type PersistedPreferences = Pick<
  PreferencesState,
  'soundEnabled' | 'effectsVolume' | 'musicEnabled' | 'musicVolume' | 'language'
>;

export const DEFAULT_PREFERENCES: PersistedPreferences = {
  soundEnabled: true,
  effectsVolume: DEFAULT_EFFECTS_VOLUME,
  musicEnabled: true,
  musicVolume: DEFAULT_MUSIC_VOLUME,
  language: DEFAULT_LANGUAGE,
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Valeurs relues du stockage : tout champ absent ou corrompu reprend sa valeur par défaut. */
export function sanitizePreferences(stored: unknown): PersistedPreferences {
  const value = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >;
  const soundEnabled =
    typeof value.soundEnabled === 'boolean' ? value.soundEnabled : DEFAULT_PREFERENCES.soundEnabled;
  return {
    soundEnabled,
    effectsVolume: isEffectsVolume(value.effectsVolume)
      ? value.effectsVolume
      : DEFAULT_PREFERENCES.effectsVolume,
    // Préférence absente (enregistrée avant l'arrivée de la musique) : elle suit le son, pour
    // qu'un joueur qui avait coupé le son n'entende pas de musique sans l'avoir demandé.
    musicEnabled: typeof value.musicEnabled === 'boolean' ? value.musicEnabled : soundEnabled,
    musicVolume: isEffectsVolume(value.musicVolume)
      ? value.musicVolume
      : DEFAULT_PREFERENCES.musicVolume,
    language: isLanguage(value.language) ? value.language : DEFAULT_PREFERENCES.language,
  };
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setEffectsVolume: (effectsVolume) => {
        if (isEffectsVolume(effectsVolume)) set({ effectsVolume });
      },
      setMusicEnabled: (musicEnabled) => set({ musicEnabled }),
      setMusicVolume: (musicVolume) => {
        if (isEffectsVolume(musicVolume)) set({ musicVolume });
      },
      setLanguage: (language) => {
        if (isLanguage(language)) set({ language });
      },
    }),
    {
      name: PREFERENCES_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => preferencesStorage),
      partialize: ({ soundEnabled, effectsVolume, musicEnabled, musicVolume, language }) => ({
        soundEnabled,
        effectsVolume,
        musicEnabled,
        musicVolume,
        language,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizePreferences(persisted) }),
    },
  ),
);
