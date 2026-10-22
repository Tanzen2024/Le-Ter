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
jest.mock('../auth/hooks', () => ({
  useCurrentUser: () => ({ data: { username: 'ana', playerNumber: 42 } }),
}));
jest.mock('./LobbyUi', () => {
  const { createElement } = jest.requireActual('react');
  const { Text: T } = jest.requireActual('react-native');
  return {
    ...jest.requireActual('./LobbyUi'),
    // HUD simulé : pseudo, numéro d'ordre et bouton « ajouter des pièces » (ouvre la Boutique),
    // inactif quand la coquille le déclare inerte.
    LobbyHud: ({
      username,
      playerNumber,
      onAddCoins,
      inert,
    }: {
      username?: string;
      playerNumber?: number;
      onAddCoins: () => void;
      inert?: boolean;
    }) =>
      createElement(
        T,
        {
          onPress: inert ? undefined : onAddCoins,
          accessibilityLabel: 'Ouvrir la boutique',
          accessibilityState: { disabled: Boolean(inert) },
        },
        `hud ${username} n°${playerNumber}`,
      ),
  };
});
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
  // L'écran reste monté (rien n'est rechargé), mais caché tant que le panneau est ouvert.
  expect(screen.getByText('accueil', { includeHiddenElements: true })).toBeTruthy();
});

it('panneau ouvert : seul visible et interactif jusqu’à sa fermeture (D-126)', async () => {
  await shell();
  expect(screen.getByText('accueil')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Profil'));
  expect(screen.getByText('panneau profil')).toBeTruthy();
  // Écran du dessous : ni visible pour les lecteurs d'écran, ni touchable.
  expect(screen.queryByText('accueil')).toBeNull();
  expect(screen.queryByLabelText('Réglages')).toBeNull();
  // Fermé : l'écran redevient visible et interactif.
  await fireEvent.press(screen.getByText('panneau profil'));
  expect(screen.getByText('accueil')).toBeTruthy();
  expect(screen.getByLabelText('Réglages')).toBeTruthy();
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

it('Boutique ouverte : seule interactive ; pseudo, numéro et solde (HUD) restent visibles (D-133)', async () => {
  await shell();
  expect(screen.getByLabelText('Ouvrir la boutique').props.accessibilityState).toEqual({
    disabled: false,
  });
  await fireEvent.press(screen.getByLabelText('Ouvrir la boutique'));
  expect(screen.getByText('portefeuille')).toBeTruthy();
  // L'écran du dessous (accueil, boutons du bas) n'est ni visible ni touchable…
  expect(screen.queryByText('accueil')).toBeNull();
  expect(screen.queryByLabelText('Profil')).toBeNull();
  // … mais le HUD reste affiché (pseudo, numéro d'ordre, solde), sans être touchable.
  const hud = screen.getByLabelText('Ouvrir la boutique');
  expect(hud.props.children).toBe('hud ana n°42');
  expect(hud.props.accessibilityState).toEqual({ disabled: true });
  expect(hud.props.onPress).toBeUndefined();
  // Couche du HUD au-dessus des fenêtres exclusives (zIndex 100).
  const layer = screen.getByTestId('hud-layer');
  const flat = Object.assign({}, ...[layer.props.style].flat(Infinity).filter(Boolean));
  expect(flat.zIndex).toBeGreaterThan(100);
  expect(flat.pointerEvents).toBe('none');
  await fireEvent.press(screen.getByText('portefeuille'));
  expect(screen.queryByText('portefeuille')).toBeNull();
  expect(screen.getByText('accueil')).toBeTruthy();
  expect(screen.getByLabelText('Ouvrir la boutique').props.accessibilityState).toEqual({
    disabled: false,
  });
});
