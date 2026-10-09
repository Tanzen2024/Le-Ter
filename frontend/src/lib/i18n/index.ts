import { DEFAULT_LANGUAGE, usePreferencesStore, type Language } from '../../stores/preferences-store';
import { en } from './en';
import { fr, type Messages } from './fr';

/**
 * Internationalisation légère, sans dépendance : un dictionnaire typé par langue, la langue
 * étant la préférence `language` du store des préférences (source de vérité unique).
 * Changer de langue ne re-rend que les composants qui lisent les textes : aucune partie,
 * aucun timer ni aucune connexion n'en dépend. Ajouter une langue : docs/settings.md.
 */
export type { Messages };

const MESSAGES: Record<Language, Messages> = { fr, en };

/** Textes d'une langue (par défaut : la langue choisie), utilisable hors composant. */
export function getMessages(language: Language = usePreferencesStore.getState().language): Messages {
  return MESSAGES[language] ?? MESSAGES[DEFAULT_LANGUAGE];
}

/** Textes de la langue choisie ; le composant se met à jour dès qu'elle change. */
export function useMessages(): Messages {
  return getMessages(usePreferencesStore((s) => s.language));
}

export function useLanguage(): Language {
  return usePreferencesStore((s) => s.language);
}
