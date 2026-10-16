/// <reference types="jest" />
import { focusManager, QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Text, type AppStateStatus } from 'react-native';

import { useGameReconnection } from '../features/games/use-game-reconnection';
import { installAppFocusManager, resetAppFocusManagerForTests } from './app-focus';
import { resetAppLifecycleForTests } from './app-lifecycle';
import { createAppQueryClient, DEFAULT_STALE_TIME_MS, queryClient } from './query-client';

/**
 * Retour au premier plan avec le cache RÉEL de l'application : rien n'est rechargé ni vidé ;
 * seules les requêtes affichées et périmées sont relues, une fois chacune ; `inactive` et les
 * retours rapprochés ne relisent rien ; l'écran d'une partie n'envoie qu'une requête par retour.
 */

let handlers: ((state: AppStateStatus) => void)[] = [];
const emit = (state: AppStateStatus) => act(async () => handlers.forEach((h) => h(state)));
let now = Date.parse('2026-10-15T10:00:00.000Z');
const away = async (ms: number) => {
  await emit('background');
  now += ms;
  await emit('active');
};

let client: QueryClient;
beforeEach(() => {
  handlers = [];
  now = Date.parse('2026-10-15T10:00:00.000Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    handlers.push(handler as (state: AppStateStatus) => void);
    return {
      remove: () => (handlers = handlers.filter((h) => h !== handler)),
    } as ReturnType<typeof AppState.addEventListener>;
  });
  resetAppLifecycleForTests(() => now);
  resetAppFocusManagerForTests();
  focusManager.setFocused(undefined);
  installAppFocusManager();
  client = createAppQueryClient();
});
afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

function Probe({ id, fetcher, staleTime }: { id: string; fetcher: () => Promise<string>; staleTime?: number }) {
  const q = useQuery({ queryKey: [id], queryFn: fetcher, ...(staleTime !== undefined && { staleTime }) });
  return <Text testID={id}>{q.isPending ? 'chargement' : q.data}</Text>;
}

async function show(ui: React.ReactElement) {
  await render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const settle = () => act(async () => {});

describe('cache de l’application', () => {
  it('un seul cache pour tout le processus (survit à un remontage de la racine)', () => {
    expect(queryClient).toBe(queryClient);
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(DEFAULT_STALE_TIME_MS);
  });
});

describe('retour au premier plan', () => {
  it('retour rapproché (< fraîcheur) : aucune requête, données affichées conservées', async () => {
    const fetcher = jest.fn(async () => 'accueil');
    await show(<Probe id="home" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('home')).toHaveTextContent('accueil'));
    await away(10_000);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('home')).toHaveTextContent('accueil');
  });

  it('donnée périmée : relue UNE fois, sans repasser par le chargement', async () => {
    // Réponse de la relecture retenue jusqu'à `release` : l'écran est observé PENDANT la
    // relecture, quel que soit l'ordre des microtâches (sinon `act` peut déjà l'avoir finie).
    let release: () => void = () => undefined;
    const fetcher = jest
      .fn<Promise<string>, []>()
      .mockResolvedValueOnce('v1')
      .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve('v2'))));
    await show(<Probe id="home" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('home')).toHaveTextContent('v1'));
    await emit('background');
    now += DEFAULT_STALE_TIME_MS + 1;
    await emit('active');
    // Pendant la relecture, l'écran garde ses données (aucun écran de chargement global).
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('home')).toHaveTextContent('v1');
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId('home')).toHaveTextContent('v2'));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('`inactive` → `active` (notification, dialogue système) : aucune relecture', async () => {
    const fetcher = jest.fn(async () => 'x');
    await show(<Probe id="live" fetcher={fetcher} staleTime={0} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await emit('inactive');
    now += 60_000;
    await emit('active');
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('donnée vivante (solde, partie) : relue à chaque retour, une requête par retour', async () => {
    const fetcher = jest.fn(async () => 'solde');
    await show(<Probe id="wallet" fetcher={fetcher} staleTime={0} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await away(2_000);
    await away(2_000);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('plusieurs écrans sur la même donnée : une seule requête par retour', async () => {
    const fetcher = jest.fn(async () => 'liste');
    await show(
      <>
        <Probe id="list" fetcher={fetcher} staleTime={0} />
        <Probe id="list" fetcher={fetcher} staleTime={0} />
      </>,
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await away(5_000);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('écran d’une partie : focus + reprise de l’écran = UNE requête (état officiel relu)', async () => {
    let turn = 0;
    const fetcher = jest.fn(async () => `tour ${++turn}`);
    function GameProbe() {
      const game = useQuery({ queryKey: ['game', 'g-1'], queryFn: fetcher, staleTime: 0 });
      const reconnection = useGameReconnection(game);
      return (
        <Text testID="game">
          {game.data ?? '…'}
          {reconnection.state ? ` (${reconnection.state})` : ''}
        </Text>
      );
    }
    await show(<GameProbe />);
    await waitFor(() => expect(screen.getByTestId('game')).toHaveTextContent('tour 1'));
    await away(120_000);
    await waitFor(() => expect(screen.getByTestId('game')).toHaveTextContent(/^tour 2$/));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
