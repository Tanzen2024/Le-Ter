/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { walletApi } from '../../services/wallet-api';
import { useAuthStore } from '../../stores/auth-store';
import type { WalletView } from '../../types/wallet';
import { useBalanceLabel } from './LobbyUi';

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
