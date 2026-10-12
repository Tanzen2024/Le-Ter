/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useIsFocused } from 'expo-router';
import { Text } from 'react-native';

import { geolocationApi } from '../../services/geolocation-api';
import { useAuthStore } from '../../stores/auth-store';
import type { GameView } from '../../types/game';
import type { GeolocationStatus } from '../../types/geolocation';
import { distanceLabel, usePlayerDistances } from '../games/table/distance';
import { CONSENT_TITLE, GameGeolocation } from './GameGeolocation';
import { POSITION_TIMEOUT_MS, resetGeolocationConsent } from './hooks';
import { useGameUiStore } from '../../stores/game-ui-store';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { High: 4 },
}));
jest.mock('expo-router', () => ({ useIsFocused: jest.fn(() => true) }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual('crypto').randomUUID(),
}));
jest.mock('../../services/geolocation-api', () => ({
  geolocationApi: { status: jest.fn(), sendPosition: jest.fn() },
}));

const location = Location as jest.Mocked<typeof Location>;
const focused = useIsFocused as jest.MockedFunction<typeof useIsFocused>;
const status = geolocationApi.status as jest.MockedFunction<typeof geolocationApi.status>;
const sendPosition = geolocationApi.sendPosition as jest.MockedFunction<
  typeof geolocationApi.sendPosition
>;

const GAME = '11111111-1111-4111-8111-111111111111';
const INTERVAL = 45_000;

const gameView = (overrides: Partial<GameView> = {}) =>
  ({
    gameId: GAME,
    sessionId: 'table-1',
    status: 'in_progress',
    ...overrides,
  }) as GameView;

const watched = (overrides: Partial<GeolocationStatus> = {}): GeolocationStatus =>
  ({
    detectionEnabled: true,
    collecting: true,
    collectionIntervalMs: INTERVAL,
    distances: [
      { playerId: 'p2', meters: null },
      { playerId: 'p3', meters: null },
    ],
    ...overrides,
  }) as GeolocationStatus;

const permission = (granted: boolean, canAskAgain = true) =>
  ({
    granted,
    canAskAgain,
    status: granted ? 'granted' : 'undetermined',
    expires: 'never',
  }) as never;

/** Étiquettes de distance, comme sur la table : aucune quand la partie n'est pas surveillée. */
const NO_TAG = 'aucune étiquette';
function Distances({ game }: { game: GameView }) {
  const distances = usePlayerDistances(game);
  return (
    <>
      <Text testID="p2">{distances ? distanceLabel(distances.of('p2')) : NO_TAG}</Text>
      <Text testID="p3">{distances ? distanceLabel(distances.of('p3')) : NO_TAG}</Text>
    </>
  );
}

function Screen({ game, client }: { game: GameView; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <GameGeolocation game={game} />
      <Distances game={game} />
    </QueryClientProvider>
  );
}

async function renderScreen(server: GeolocationStatus, game = gameView()) {
  status.mockResolvedValue(server);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = await render(<Screen key={game.gameId} game={game} client={client} />);
  return {
    ...view,
    client,
    // Clé = gameId : une autre partie remonte l'écran, comme dans l'application.
    rerenderWith: (next: GameView) =>
      view.rerender(<Screen key={next.gameId} game={next} client={client} />),
  };
}

const flush = () => act(async () => {});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetGeolocationConsent();
  focused.mockReturnValue(true);
  useAuthStore.getState().signIn('jeton');
  location.getForegroundPermissionsAsync.mockResolvedValue(permission(false));
  location.requestForegroundPermissionsAsync.mockResolvedValue(permission(true));
  location.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 4.0511, longitude: 9.7679, accuracy: 12 },
    timestamp: 1_760_000_000_000,
  } as never);
  sendPosition.mockResolvedValue({
    distances: [
      { playerId: 'p2', meters: 850 },
      { playerId: 'p3', meters: null },
    ],
  });
});
afterEach(() => {
  jest.useRealTimers();
});

async function acceptConsent() {
  await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
  await fireEvent.press(screen.getByText('CONTINUER'));
  await waitFor(() => expect(sendPosition).toHaveBeenCalledTimes(1));
}

describe('Partie non surveillée', () => {
  it('aucune explication, aucune permission demandée, aucune position, aucune étiquette de distance', async () => {
    await renderScreen({ detectionEnabled: false });
    await waitFor(() => expect(status).toHaveBeenCalledWith('jeton', GAME));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(screen.queryByText(CONSENT_TITLE)).toBeNull();
    expect(location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(sendPosition).not.toHaveBeenCalled();
    expect(screen.getByTestId('p2').props.children).toBe(NO_TAG);
  });
});

describe('Partie surveillée : consentement', () => {
  it('message explicatif AVANT toute demande de permission native', async () => {
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    expect(screen.getByText(/jamais montrée aux autres joueurs/)).toBeTruthy();
    expect(screen.getByText(/le serveur calcule seulement les distances/)).toBeTruthy();
    expect(screen.getByText(/conservées temporairement/)).toBeTruthy();
    expect(screen.getByText(/Vous pouvez refuser/)).toBeTruthy();
    expect(screen.queryByText(/trich|suspect|fraud/i)).toBeNull();
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('accepté : permission demandée, position envoyée (strict nécessaire), distances du serveur', async () => {
    await renderScreen(watched());
    await acceptConsent();
    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(sendPosition).toHaveBeenCalledWith('jeton', GAME, {
      latitude: 4.0511,
      longitude: 9.7679,
      accuracy: 12,
      capturedAt: 1_760_000_000_000,
    });
    await waitFor(() => expect(screen.getByTestId('p2').props.children).toBe('850 m'));
    expect(screen.getByTestId('p3').props.children).toBe('En attente de position');
    expect(screen.queryByText(CONSENT_TITLE)).toBeNull();
  });

  it('refusé dans l’explication : aucune permission, aucune position, la partie continue', async () => {
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText('NON MERCI'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(screen.queryByText(CONSENT_TITLE)).toBeNull();
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(sendPosition).not.toHaveBeenCalled();
    expect(screen.getByTestId('p2').props.children).toBe('Localisation refusée');
  });

  it('refusé par le système : rien n’est envoyé, aucune fausse distance', async () => {
    location.requestForegroundPermissionsAsync.mockResolvedValue(permission(false));
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText('CONTINUER'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(sendPosition).not.toHaveBeenCalled();
    expect(screen.getByTestId('p2').props.children).toBe('Localisation refusée');
  });

  it('refus mémorisé pour la table : pas de nouvelle explication à la partie suivante', async () => {
    const view = await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText('NON MERCI'));
    // Partie suivante de la même table : nouvel écran, même table.
    await view.rerenderWith(gameView({ gameId: '22222222-2222-4222-8222-222222222222' }));
    await flush();
    expect(screen.queryByText(CONSENT_TITLE)).toBeNull();
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('Collecte', () => {
  it('envoi périodique à la cadence du serveur (jamais plus d’une position par intervalle)', async () => {
    await renderScreen(watched());
    await acceptConsent();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(INTERVAL - 1_000);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(sendPosition).toHaveBeenCalledTimes(2);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(3);
  });

  it('arrêt quand la partie se termine', async () => {
    const view = await renderScreen(watched());
    await acceptConsent();
    await view.rerenderWith(gameView({ status: 'finished' }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
  });

  it('arrêt quand le serveur refuse (partie terminée côté serveur)', async () => {
    const { ApiError } = jest.requireActual('../../lib/api-client');
    sendPosition.mockRejectedValueOnce(
      new ApiError(409, 'GAME_FINISHED', 'La partie est terminée.'),
    );
    await renderScreen(watched());
    await acceptConsent();
    status.mockResolvedValue(watched({ collecting: false } as Partial<GeolocationStatus>));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
  });

  it('arrêt quand l’écran de la partie n’est plus affiché', async () => {
    const view = await renderScreen(watched());
    await acceptConsent();
    focused.mockReturnValue(false);
    await view.rerenderWith(gameView());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
  });

  it('arrêt quand l’écran est démonté (sortie de la partie)', async () => {
    const view = await renderScreen(watched());
    await acceptConsent();
    await view.unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
  });
});

describe('Distances indisponibles et mises à jour', () => {
  it('position trop ancienne selon le serveur : « Position obsolète », jamais 0 m', async () => {
    await renderScreen(
      watched({
        distances: [
          { playerId: 'p2', meters: null, unavailable: 'STALE' },
          { playerId: 'p3', meters: 0 },
        ],
      }),
    );
    sendPosition.mockResolvedValue({
      distances: [
        { playerId: 'p2', meters: null, unavailable: 'STALE' },
        { playerId: 'p3', meters: 0 },
      ],
    });
    await acceptConsent();
    await waitFor(() =>
      expect(screen.getByTestId('p2').props.children).toBe('Position obsolète'),
    );
    // 0 m est une vraie distance (même lieu), distincte d'une distance inconnue.
    expect(screen.getByTestId('p3').props.children).toBe('0 m');
  });

  it('GPS en échec (coupé) : « GPS indisponible », rien n’est envoyé, nouvel essai plus tard', async () => {
    location.getCurrentPositionAsync.mockRejectedValue(new Error('Location services disabled'));
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText('CONTINUER'));
    await waitFor(() =>
      expect(screen.getByTestId('p2').props.children).toBe('GPS indisponible'),
    );
    expect(sendPosition).not.toHaveBeenCalled();
    // Le GPS revient : la position suivante part, l'état se lève.
    location.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 4.0511, longitude: 9.7679, accuracy: 12 },
      timestamp: 1_760_000_000_000,
    } as never);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('p2').props.children).toBe('850 m'));
  });

  it('GPS sans réponse : délai dépassé, « GPS indisponible », jamais de position fictive', async () => {
    location.getCurrentPositionAsync.mockReturnValue(new Promise(() => undefined));
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText('CONTINUER'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(POSITION_TIMEOUT_MS);
    });
    expect(screen.getByTestId('p2').props.children).toBe('GPS indisponible');
    expect(sendPosition).not.toHaveBeenCalled();
  });

  it('nouvelle position d’un adversaire : distance mise à jour sans envoi ni rechargement', async () => {
    const view = await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    // Ce joueur refuse : il n'envoie rien, mais la distance de la table reste suivie.
    await fireEvent.press(screen.getByText('NON MERCI'));
    status.mockResolvedValue(
      watched({ distances: [{ playerId: 'p2', meters: 1_200 }, { playerId: 'p3', meters: null }] }),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(screen.getByTestId('p2').props.children).toBe('1,2 km');
    expect(sendPosition).not.toHaveBeenCalled();
    // Sortie de la partie : plus aucune relecture, état GPS local oublié.
    const calls = status.mock.calls.length;
    await view.unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(status.mock.calls.length).toBe(calls);
    expect(useGameUiStore.getState().localGps[GAME]).toBeUndefined();
  });

  it('partie terminée côté serveur : plus de relecture périodique', async () => {
    await renderScreen(watched({ collecting: false }));
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('état GPS propre à chaque partie : un refus dans A ne touche pas B', () => {
    const store = useGameUiStore.getState();
    store.setLocalGps('game-a', 'refused');
    store.setLocalGps('game-b', null);
    expect(useGameUiStore.getState().localGps).toEqual({ 'game-a': 'refused' });
    store.setLocalGps('game-a', null);
    expect(useGameUiStore.getState().localGps).toEqual({});
  });
});
