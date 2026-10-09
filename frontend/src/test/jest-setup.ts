/// <reference types="jest" />
/**
 * Environnement des tests Jest (jest-expo). Seuls les modules natifs absents de Node sont
 * remplacés : polices (expo-font charge des fichiers via expo-asset) et zones sûres.
 */
jest.mock('expo-font', () => ({ useFonts: () => [true, null], isLoaded: () => true }));
jest.mock('@expo-google-fonts/cinzel', () => ({ Cinzel_700Bold: 0 }));
jest.mock('@expo-google-fonts/rajdhani', () => ({ Rajdhani_700Bold: 0 }));
jest.mock('react-native-safe-area-context', () =>
  jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
