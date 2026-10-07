import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Stockage du refresh token.
 *
 * - iOS / Android : expo-secure-store (Keychain / Keystore chiffré). Jamais AsyncStorage.
 * - Web : SecureStore n'existe pas ; le jeton reste en mémoire seulement (perdu au
 *   rechargement de la page) plutôt que dans localStorage, lisible par tout script.
 *
 * L'access token (15 min) n'est jamais persisté : il vit dans le store en mémoire.
 */
const REFRESH_TOKEN_KEY = 'le-ter.refresh-token';
const secureStoreAvailable = Platform.OS === 'ios' || Platform.OS === 'android';

let memoryToken: string | null = null;

export const tokenStorage = {
  async getRefreshToken(): Promise<string | null> {
    return secureStoreAvailable ? SecureStore.getItemAsync(REFRESH_TOKEN_KEY) : memoryToken;
  },

  async setRefreshToken(token: string): Promise<void> {
    if (secureStoreAvailable) {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
    } else {
      memoryToken = token;
    }
  },

  async clearRefreshToken(): Promise<void> {
    if (secureStoreAvailable) {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    } else {
      memoryToken = null;
    }
  },
};
