/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { walletApi } from '../../services/wallet-api';
import { useAuthStore } from '../../stores/auth-store';
import type { WalletView } from '../../types/wallet';
import { LobbyHud, useBalanceLabel } from './LobbyUi';

jest.mock('../../services/wallet-api', () => ({ walletApi: { get: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('crypto').randomUUID() }));

const get = walletApi.get as jest.MockedFunction<typeof walletApi.get>;

const wallet = (overrides: Partial<WalletView>): WalletView => ({
  balance: 5000,
  mobileMoneyNumber: '+23*******271',
  phoneVerified: false,
  mobileMoneyAvailable: false,
  withdrawalAvailable: false,
  ...overrides,
});

const clients: QueryClient[] = [];
/** Un client par test (pas par rendu : le cache doit survivre aux re-rendus). */
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((c) => c.clear());
});

describe('solde du HUD (D-056)', () => {
  it('affiche le DISPONIBLE et indique à part les fonds réservés', async () => {
    get.mockResolvedValue({ wallet: wallet({ reserved: 1000, available: 4000 }) });
    const { result } = await renderHook(() => useBalanceLabel(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.text).toBe('4000'));
    expect(result.current.reserved).toBe('🔒 1000');
    expect(result.current.label).toBe(
      'Solde disponible : 4000 jetons, 1000 réservés (tournois), non débités',
    );
  });

  it('sans réservation : solde simple, aucun indicateur', async () => {
    get.mockResolvedValue({ wallet: wallet({ reserved: 0, available: 5000 }) });
    const { result } = await renderHook(() => useBalanceLabel(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.text).toBe('5000'));
    expect(result.current.reserved).toBeUndefined();
    expect(result.current.label).toBe('Solde : 5000 jetons');
  });

  it('serveur sans les nouveaux champs : retombe sur le solde', async () => {
    get.mockResolvedValue({ wallet: wallet({}) });
    const { result } = await renderHook(() => useBalanceLabel(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.text).toBe('5000'));
  });
});

describe('HUD : pseudo, numéro d’ordre du joueur (D-133) et solde', () => {
  const renderHud = async (props: Partial<Parameters<typeof LobbyHud>[0]> = {}) => {
    const Wrapper = makeWrapper();
    const onAddCoins = jest.fn();
    await render(
      <Wrapper>
        <LobbyHud username="LAMAT" onAddCoins={onAddCoins} {...props} />
      </Wrapper>,
    );
    return onAddCoins;
  };

  it('affiche le numéro d’ordre renvoyé par le serveur, à la place du « — »', async () => {
    get.mockResolvedValue({ wallet: wallet({ available: 12424 }) });
    await renderHud({ playerNumber: 42 });
    expect(screen.getByText('LAMAT')).toBeTruthy();
    expect(screen.getByText('N° 42')).toBeTruthy();
    expect(screen.getByLabelText('Joueur numéro 42 sur la plateforme')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('12424')).toBeTruthy());
  });

  it('numéro absent (serveur plus ancien) ou invalide : « — », jamais un numéro inventé', async () => {
    get.mockResolvedValue({ wallet: wallet({}) });
    await renderHud();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByLabelText('Compteur indisponible')).toBeTruthy();
    await cleanup();
    await renderHud({ playerNumber: 1.5 });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('inerte (panneau ouvert) : toujours affiché, « + » sans effet ; sinon il ouvre la Boutique', async () => {
    get.mockResolvedValue({ wallet: wallet({}) });
    const inert = await renderHud({ playerNumber: 7, inert: true });
    await fireEvent.press(screen.getByLabelText('Ajouter des jetons'));
    expect(inert).not.toHaveBeenCalled();
    expect(screen.getByText('N° 7')).toBeTruthy();
    await cleanup();
    const active = await renderHud({ playerNumber: 7 });
    await fireEvent.press(screen.getByLabelText('Ajouter des jetons'));
    expect(active).toHaveBeenCalledTimes(1);
  });
});
