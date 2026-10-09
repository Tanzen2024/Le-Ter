import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { StateStorage } from 'zustand/middleware';

/**
 * Stockage des préférences locales (son, langue) : uniquement des valeurs non sensibles,
 * jamais de jeton, mot de passe ni clé.
 *
 * - iOS / Android : expo-secure-store, déjà utilisé par l'application (aucune seconde
 *   architecture de persistance, aucun nouveau module natif).
 * - Web : SecureStore n'existe pas ; localStorage suffit pour ces préférences publiques.
 *
 * Un stockage indisponible ou en erreur ne fait jamais échouer l'application : la lecture
 * rend `null` (valeurs par défaut) et l'écriture est ignorée (la préférence reste en mémoire).
 */
const secureStoreAvailable = Platform.OS === 'ios' || Platform.OS === 'android';

function webStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export const preferencesStorage: StateStorage = {
  async getItem(name) {
    try {
      return secureStoreAvailable
        ? await SecureStore.getItemAsync(name)
        : (webStorage()?.getItem(name) ?? null);
    } catch {
      return null;
    }
  },

  async setItem(name, value) {
    try {
      if (secureStoreAvailable) {
        await SecureStore.setItemAsync(name, value);
      } else {
        webStorage()?.setItem(name, value);
      }
    } catch {
      // Préférence conservée en mémoire pour cette exécution.
    }
  },

  async removeItem(name) {
    try {
      if (secureStoreAvailable) {
        await SecureStore.deleteItemAsync(name);
      } else {
        webStorage()?.removeItem(name);
      }
    } catch {
      // Rien à faire : la valeur sera ignorée ou réécrite.
    }
  },
};
