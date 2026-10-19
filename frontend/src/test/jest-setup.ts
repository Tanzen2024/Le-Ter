/// <reference types="jest" />
/**
 * Environnement des tests Jest (jest-expo). Seuls les modules natifs absents de Node sont
 * remplacés : polices (expo-font charge des fichiers via expo-asset) et zones sûres.
 */
jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  isLoaded: () => true,
  loadAsync: () => Promise.resolve(),
}));
jest.mock('@expo-google-fonts/cinzel', () => ({ Cinzel_700Bold: 0 }));
jest.mock('@expo-google-fonts/rajdhani', () => ({ Rajdhani_700Bold: 0 }));
jest.mock('react-native-safe-area-context', () => {
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  // Vue racine = fenêtre (cas courant) : les écrans gardent la taille de fenêtre des tests, y
  // compris quand un test simule un autre écran (`spyOn(ReactNative, 'useWindowDimensions')`).
  const frame = () => {
    const { width, height } = jest.requireActual('react-native').useWindowDimensions();
    return { x: 0, y: 0, width, height };
  };
  return { ...mock, useSafeAreaFrame: jest.fn(frame) };
});
