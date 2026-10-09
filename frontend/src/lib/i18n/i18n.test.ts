/// <reference types="jest" />
import { DEFAULT_PREFERENCES, usePreferencesStore } from '../../stores/preferences-store';
import { en } from './en';
import { fr } from './fr';
import { getMessages } from './index';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

/** Toutes les clés (chemins) d'un dictionnaire. */
function keysOf(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'object' && child !== null
      ? keysOf(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('i18n', () => {
  beforeEach(() => usePreferencesStore.setState(DEFAULT_PREFERENCES));

  it("le français et l'anglais ont exactement les mêmes clés", () => {
    expect(keysOf(en).sort()).toEqual(keysOf(fr).sort());
  });

  it('suit la langue choisie', () => {
    expect(getMessages().settings.title).toBe('Réglages');
    usePreferencesStore.getState().setLanguage('en');
    expect(getMessages().settings.title).toBe('Settings');
    usePreferencesStore.getState().setLanguage('fr');
    expect(getMessages().settings.title).toBe('Réglages');
  });

  it('traduit le module Réglages', () => {
    expect(fr.settings).toMatchObject({
      title: 'Réglages',
      sound: 'Son',
      languages: 'Langues',
      french: 'Français',
      support: 'Assistance',
      terms: "Conditions d'utilisations",
      privacy: 'Confidentialité',
    });
    expect(en.settings).toMatchObject({
      title: 'Settings',
      sound: 'Sound',
      languages: 'Language',
      french: 'French',
      english: 'English',
      support: 'Support',
      terms: 'Terms of Use',
      privacy: 'Privacy Policy',
    });
  });
});
