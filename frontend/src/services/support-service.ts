import { Alert, Linking } from 'react-native';

import { SUPPORT_URL } from '../constants/app-config';
import { getMessages } from '../lib/i18n';
import { playSound } from './audio-service';

export type SupportOutcome = 'opened' | 'unavailable' | 'invalid' | 'failed';

export interface SupportDeps {
  url: string;
  openURL(url: string): Promise<unknown>;
  alert(title: string, message: string): void;
}

const defaultDeps: SupportDeps = {
  url: SUPPORT_URL,
  openURL: (url) => Linking.openURL(url),
  alert: (title, message) => Alert.alert(title, message),
};

/** Seule une adresse web complète est ouverte (jamais un schéma arbitraire). */
export function isSupportUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url.trim());
}

/**
 * Bouton « Assistance » : ouvre la plateforme d'assistance si elle est configurée
 * (`SUPPORT_URL`), sinon annonce qu'elle arrive. Une adresse configurée mais invalide n'est
 * jamais ouverte (message d'erreur). Ne lève jamais d'erreur.
 */
export async function openSupport(overrides: Partial<SupportDeps> = {}): Promise<SupportOutcome> {
  const deps = { ...defaultDeps, ...overrides };
  const t = getMessages();
  if (!deps.url.trim()) {
    deps.alert(t.support.title, t.support.unavailable);
    return 'unavailable';
  }
  if (!isSupportUrl(deps.url)) {
    playSound('uiError');
    deps.alert(t.support.title, t.support.openFailed);
    return 'invalid';
  }
  try {
    await deps.openURL(deps.url.trim());
    return 'opened';
  } catch {
    playSound('uiError');
    deps.alert(t.support.title, t.support.openFailed);
    return 'failed';
  }
}
