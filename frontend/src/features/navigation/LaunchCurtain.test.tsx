/// <reference types="jest" />
import { act, cleanup, render, screen } from '@testing-library/react-native';

import { useAuthStore } from '../../stores/auth-store';
import {
  LAUNCH_CURTAIN_MAX_MS,
  LAUNCH_CURTAIN_SETTLE_DELAY_MS,
  LaunchCurtain,
} from './LaunchCurtain';
import { beginNavigationRoot, resetLastRouteForTests, restoreLastRoute } from './last-route';

/**
 * Relancement après destruction du processus par Android : le rideau couvre la reconstruction
 * de la pile (accueil, Reconnexion) jusqu'à la réouverture du dernier écran.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../services/preferences-storage', () => ({
  preferencesStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

beforeEach(() => {
  jest.useFakeTimers();
  resetLastRouteForTests();
  beginNavigationRoot();
  useAuthStore.setState({ status: 'loading', accessToken: null });
});
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
});

const curtainShown = () => screen.queryByTestId('launch-curtain') !== null;

describe('rideau de relancement', () => {
  it('reste levé tant que le dernier écran n’est pas rouvert, puis disparaît', async () => {
    await render(<LaunchCurtain />);
    expect(curtainShown()).toBe(true);
    await act(async () => useAuthStore.getState().signIn('jeton'));
    expect(curtainShown()).toBe(true);

    await act(async () => {
      await restoreLastRoute(() => '/');
    });
    expect(curtainShown()).toBe(true);
    await act(async () => jest.advanceTimersByTime(LAUNCH_CURTAIN_SETTLE_DELAY_MS));
    expect(curtainShown()).toBe(false);
  });

  it('déconnecté : levé aussitôt (écran de connexion)', async () => {
    await render(<LaunchCurtain />);
    await act(async () => useAuthStore.getState().signOut());
    expect(curtainShown()).toBe(false);
  });

  it('serveur injoignable : levé au bout du délai maximal', async () => {
    await render(<LaunchCurtain />);
    await act(async () => jest.advanceTimersByTime(LAUNCH_CURTAIN_MAX_MS));
    expect(curtainShown()).toBe(false);
  });

  it('une fois levé, ne revient pas', async () => {
    await render(<LaunchCurtain />);
    await act(async () => useAuthStore.getState().signOut());
    await act(async () => useAuthStore.getState().signIn('jeton'));
    expect(curtainShown()).toBe(false);
  });
});
