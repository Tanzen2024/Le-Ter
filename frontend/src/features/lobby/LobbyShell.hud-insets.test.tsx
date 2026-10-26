/// <reference types="jest" />
import { cleanup, render, screen } from '@testing-library/react-native';
import { useContext } from 'react';
import { Text } from 'react-native';

import { LobbyShell } from './LobbyShell';
import { HudInsetsContext } from './LobbyUi';

/**
 * Emprise du HUD au changement d'écran : chaque écran connecté monte sa propre coquille. Un
 * panneau affiché dès l'arrivée (« Proposer un tournoi ») doit être posé d'emblée entre les
 * blocs du HUD, avec la dernière emprise mesurée, et non sur toute la largeur puis resserré.
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
let mockMeasured = true;
jest.mock('./LobbyUi', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    ...jest.requireActual('./LobbyUi'),
    // HUD simulé : il « mesure » son emprise au montage, comme `onLayout`.
    LobbyHud: ({ onInsets }: { onInsets?: (i: { left?: number; right?: number }) => void }) => {
      useEffect(() => {
        if (mockMeasured) onInsets?.({ left: 180, right: 140 });
      }, [onInsets]);
      return null;
    },
  };
});
jest.mock('./ProfilePanel', () => ({ ProfilePanel: () => null }));
jest.mock('./SettingsPanel', () => ({ SettingsPanel: () => null }));
jest.mock('./PrivateGamePanel', () => ({ PrivateGamePanel: () => null }));
jest.mock('../wallet/ShopFlow', () => ({ ShopFlow: () => null }));

/** Contenu d'écran qui note chaque emprise reçue, du premier rendu au dernier. */
function Probe({ seen }: { seen: { left: number; right: number }[] }) {
  const insets = useContext(HudInsetsContext);
  seen.push(insets);
  return <Text>{`emprise ${insets.left}/${insets.right}`}</Text>;
}

afterEach(async () => {
  await cleanup();
});

it('l’écran suivant reçoit dès son premier rendu la dernière emprise mesurée', async () => {
  const first: { left: number; right: number }[] = [];
  await render(
    <LobbyShell>
      <Probe seen={first} />
    </LobbyShell>,
  );
  expect(await screen.findByText('emprise 180/140')).toBeTruthy();
  await cleanup();

  // Nouvel écran (nouvelle coquille), mesure pas encore faite : aucun rendu à 0/0.
  mockMeasured = false;
  const next: { left: number; right: number }[] = [];
  await render(
    <LobbyShell>
      <Probe seen={next} />
    </LobbyShell>,
  );
  expect(next.length).toBeGreaterThan(0);
  expect(next.every((i) => i.left === 180 && i.right === 140)).toBe(true);
});
