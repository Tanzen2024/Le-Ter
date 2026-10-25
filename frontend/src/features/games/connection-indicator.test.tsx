/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { ApiError } from '../../lib/api-client';
import { gamesApi } from '../../services/games-api';
import { sessionsApi } from '../../services/sessions-api';
import { useAuthStore } from '../../stores/auth-store';
import { ActiveGameRestorer } from './ActiveGameRestorer';
import {
  CONNECTION_REVEAL_DELAY_MS,
  ConnectionIndicator,
  PENDING_MESSAGE,
  RECONNECTION_FAILED_MESSAGE,
  RECONNECTION_MESSAGE,
} from './ConnectionIndicator';

jest.mock('../../services/games-api', () => ({ gamesApi: { listActive: jest.fn() } }));
jest.mock('../../services/sessions-api', () => ({ sessionsApi: { listMine: jest.fn() } }));
jest.mock('../navigation/last-route', () => ({
  restoreLastRoute: jest.fn(() => Promise.resolve('none')),
  useRememberRoute: jest.fn(),
}));
jest.mock('../auth/session', () => ({
  withAccessToken: (call: (token: string) => unknown) => call('token'),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
  usePathname: () => '/',
}));
jest.mock('../../services/audio-service', () => ({
  playSound: jest.fn(),
  setMusicScene: jest.fn(),
  isMusicAvailable: jest.fn(() => false),
}));

const indicator = () => screen.queryByTestId('connection-indicator');
/** Avance l'horloge et laisse se résoudre les promesses (requêtes simulées). */
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
/** Aucun détail technique (code d'erreur, URL, JSON) n'atteint l'écran. */
const TECHNICAL = /TIMEOUT|NETWORK_ERROR|https?:|\/api\/|[{}]/;

beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
  jest.clearAllMocks();
});

/** Un écran quelconque (le lobby), avec une commande indépendante du serveur. */
function Lobby({ onPress }: { onPress: () => void }) {
  return (
    <View testID="lobby">
      <Text>Salon</Text>
      <Pressable accessibilityRole="button" onPress={onPress}>
        <Text>Règles</Text>
      </Pressable>
    </View>
  );
}

describe('ConnectionIndicator', () => {
  it('latence imperceptible : rien ne s’affiche', async () => {
    const view = await render(<ConnectionIndicator status="restoring" />);
    await advance(CONNECTION_REVEAL_DELAY_MS - 50);
    await view.rerender(<ConnectionIndicator status={null} />);
    await advance(1_000);
    expect(indicator()).toBeNull();
  });

  it('reconnexion : panneau flottant au-dessus de l’écran, qui reste en place et touchable', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <Lobby onPress={onPress} />
        <ConnectionIndicator status="restoring" />
      </>,
    );
    await advance(CONNECTION_REVEAL_DELAY_MS);
    expect(screen.getByText(RECONNECTION_MESSAGE)).toBeTruthy();
    expect(RECONNECTION_MESSAGE).toBe('Reconnexion en cours…');
    // L'écran du dessous reste affiché et utilisable ; le panneau ne capte aucun appui.
    expect(screen.getByTestId('lobby')).toBeTruthy();
    expect(indicator()?.props.pointerEvents).toBe('none');
    await fireEvent.press(screen.getByRole('button', { name: 'Règles' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TECHNICAL)).toBeNull();
  });

  it('action longue : « Traitement en cours… »', async () => {
    await render(<ConnectionIndicator status="pending" />);
    await advance(CONNECTION_REVEAL_DELAY_MS);
    expect(screen.getByText(PENDING_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('échec durable : message compréhensible, Réessayer et action de repli', async () => {
    const onRetry = jest.fn();
    const onHome = jest.fn();
    await render(
      <ConnectionIndicator
        status="failed"
        onRetry={onRetry}
        secondary={{ title: 'Accueil', onPress: onHome }}
      />,
    );
    await advance(0);
    expect(screen.getByText(RECONNECTION_FAILED_MESSAGE)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Réessayer' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Accueil' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('connexion rétablie : le panneau disparaît de lui-même', async () => {
    const view = await render(<ConnectionIndicator status="restoring" />);
    await advance(CONNECTION_REVEAL_DELAY_MS);
    expect(indicator()).toBeTruthy();
    await view.rerender(<ConnectionIndicator status={null} />);
    await advance(1_000);
    expect(indicator()).toBeNull();
  });
});

describe('ActiveGameRestorer au-dessus du lobby', () => {
  const listActive = gamesApi.listActive as jest.Mock;
  const listMine = sessionsApi.listMine as jest.Mock;

  it('serveur injoignable puis rétabli : lobby conservé, aucune navigation, aucun détail technique', async () => {
    listMine.mockResolvedValue({ sessions: [] });
    listActive.mockRejectedValue(
      new ApiError(0, 'TIMEOUT', 'GET http://100.72.158.120:3000/api/sessions/open {"cause":"x"}'),
    );
    useAuthStore.setState({ status: 'signedIn' });
    const onPress = jest.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render(
      <QueryClientProvider client={client}>
        <Lobby onPress={onPress} />
        <ActiveGameRestorer />
      </QueryClientProvider>,
    );
    await advance(0);
    await advance(CONNECTION_REVEAL_DELAY_MS);

    expect(screen.getByText(RECONNECTION_FAILED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(TECHNICAL)).toBeNull();
    expect(screen.getByText('Salon')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Règles' }));
    expect(onPress).toHaveBeenCalledTimes(1);

    // Réseau revenu, aucune partie active : le panneau s'efface, l'écran ne bouge pas.
    listActive.mockResolvedValue({ games: [] });
    await fireEvent.press(screen.getByRole('button', { name: 'Réessayer' }));
    await advance(0);
    await advance(1_000);
    expect(indicator()).toBeNull();
    expect(screen.getByText('Salon')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.dismissTo).not.toHaveBeenCalled();
  });
});
