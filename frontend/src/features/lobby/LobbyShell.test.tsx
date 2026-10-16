/// <reference types="jest" />
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import * as lastRoute from '../navigation/last-route';
import { LobbyShell } from './LobbyShell';

/**
 * Coquille des écrans connectés : le panneau ouvert (portefeuille, profil…) est déclaré pour
 * être mémorisé avec l'écran, et un panneau restauré après la destruction du processus est
 * rouvert. Ni navigation, ni rechargement : seul l'état du panneau change.
 */

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});
jest.mock('../auth/hooks', () => ({ useCurrentUser: () => ({ data: { username: 'ana' } }) }));
jest.mock('./LobbyUi', () => ({
  ...jest.requireActual('./LobbyUi'),
  LobbyHud: () => null,
}));
/** Panneau simulé : son texte, et un appui le referme. */
function mockPanel(label: string) {
  const { createElement } = jest.requireActual('react');
  const { Text: T } = jest.requireActual('react-native');
  return ({ onClose }: { onClose: () => void }) => createElement(T, { onPress: onClose }, label);
}
jest.mock('./ProfilePanel', () => ({ ProfilePanel: mockPanel('panneau profil') }));
jest.mock('./SettingsPanel', () => ({ SettingsPanel: mockPanel('panneau réglages') }));
jest.mock('./PrivateGamePanel', () => ({ PrivateGamePanel: mockPanel('partie privée') }));
jest.mock('../wallet/ShopFlow', () => ({ ShopFlow: mockPanel('portefeuille') }));

const remembered = jest.spyOn(lastRoute, 'rememberLobbyPanel');

beforeEach(() => {
  lastRoute.resetLastRouteForTests();
  remembered.mockClear();
});
afterEach(async () => {
  await cleanup();
});

const shell = () =>
  render(
    <LobbyShell>
      <Text>accueil</Text>
    </LobbyShell>,
  );

it('panneau restauré avant l’affichage : rouvert à l’arrivée sur l’écran', async () => {
  lastRoute.requestLobbyPanel('shop');
  await shell();
  expect(screen.getByText('portefeuille')).toBeTruthy();
  expect(screen.getByText('accueil')).toBeTruthy();
});

it('panneau restauré pendant l’affichage : rouvert sans remonter l’écran', async () => {
  await shell();
  expect(screen.queryByText('portefeuille')).toBeNull();
  await act(() => lastRoute.requestLobbyPanel('shop'));
  expect(screen.getByText('portefeuille')).toBeTruthy();
});

it('ouverture et fermeture d’un panneau : déclarées pour être mémorisées avec l’écran', async () => {
  await shell();
  expect(remembered).toHaveBeenLastCalledWith(null);
  await fireEvent.press(screen.getByLabelText('Réglages'));
  expect(remembered).toHaveBeenLastCalledWith('settings');
  await fireEvent.press(screen.getByText('panneau réglages'));
  expect(remembered).toHaveBeenLastCalledWith(null);
});

it('écran quitté : plus aucun panneau mémorisé pour lui', async () => {
  await shell();
  await fireEvent.press(screen.getByLabelText('Réglages'));
  remembered.mockClear();
  await cleanup();
  expect(remembered).toHaveBeenCalledWith(null);
});
