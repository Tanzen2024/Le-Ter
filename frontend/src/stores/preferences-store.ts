import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { preferencesStorage } from '../services/preferences-storage';

/** Langues disponibles. Ajouter une langue : voir docs/settings.md. */
export const LANGUAGES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'fr';

/** Clé du stockage local (caractères autorisés par SecureStore : [A-Za-z0-9._-]). */
export const PREFERENCES_STORAGE_KEY = 'le-ter.preferences';

/**
 * Préférences locales de l'appareil (panneau Réglages), source de vérité UNIQUE du son et de
 * la langue. Indépendantes de toute partie (aucun `gameId`, aucune donnée de jeu) et jamais
 * envoyées au serveur. Persistées sur l'appareil et restaurées au lancement.
 */
export interface PreferencesState {
  soundEnabled: boolean;
  language: Language;
  setSoundEnabled(enabled: boolean): void;
  setLanguage(language: Language): void;
}

type PersistedPreferences = Pick<PreferencesState, 'soundEnabled' | 'language'>;

export const DEFAULT_PREFERENCES: PersistedPreferences = {
  soundEnabled: true,
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
  return {
    soundEnabled:
      typeof value.soundEnabled === 'boolean'
        ? value.soundEnabled
        : DEFAULT_PREFERENCES.soundEnabled,
    language: isLanguage(value.language) ? value.language : DEFAULT_PREFERENCES.language,
  };
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setLanguage: (language) => {
        if (isLanguage(language)) set({ language });
      },
    }),
    {
      name: PREFERENCES_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => preferencesStorage),
      partialize: ({ soundEnabled, language }) => ({ soundEnabled, language }),
      merge: (persisted, current) => ({ ...current, ...sanitizePreferences(persisted) }),
    },
  ),
);
