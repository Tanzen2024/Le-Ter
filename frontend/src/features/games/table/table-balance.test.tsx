/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { walletApi } from '../../../services/wallet-api';
import { useAuthStore } from '../../../stores/auth-store';
import type { WalletView } from '../../../types/wallet';
import { walletKey } from '../../wallet/hooks';
import { frozenBalance, useTableBalanceLabel } from './table-balance';

jest.mock('../../../services/wallet-api', () => ({
  walletApi: { get: jest.fn() },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual('crypto').randomUUID(),
}));

const get = walletApi.get as jest.MockedFunction<typeof walletApi.get>;

const wallet = (balance: number): WalletView => ({
  balance,
  reserved: 0,
  available: balance,
  mobileMoneyNumber: '+23*******271',
  phoneVerified: false,
  mobileMoneyAvailable: false,
  withdrawalAvailable: false,
});

let client: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  useAuthStore.getState().signIn('jeton');
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

/**
 * D-080 : la partie est réglée par le serveur dès son résultat officiel, mais l'écran présente
 * encore le dernier tour. Le solde affiché ne change qu'à l'annonce du résultat.
 */
describe('solde de la table pendant la présentation du dernier tour', () => {
  it('Roly 3 682 : reste 3 682 tant que le résultat n’est pas annoncé, puis 3 182', async () => {
    get.mockResolvedValue({ wallet: wallet(3_682) });
    const { result, rerender } = await renderHook(
      ({ frozen }: { frozen: boolean }) => useTableBalanceLabel(frozen),
      { wrapper: Wrapper, initialProps: { frozen: false } },
    );
    await waitFor(() => expect(result.current.text).toBe('3682'));

    // Partie terminée côté serveur (réglée), dernier tour encore présenté : le solde relu
    // (rafraîchissement périodique) n'est pas affiché.
    await rerender({ frozen: true });
    get.mockResolvedValue({ wallet: wallet(3_182) });
    await act(() => client.refetchQueries({ queryKey: walletKey }));
    expect(client.getQueryData<WalletView>(walletKey)?.balance).toBe(3_182);
    expect(result.current.text).toBe('3682');

    // Résultat annoncé : le solde réglé apparaît, en même temps que le bilan.
    await rerender({ frozen: false });
    expect(result.current.text).toBe('3182');
  });

  it('aucun solde encore connu : jamais figé sur « — »', () => {
    const unknown = { text: '—', label: 'Solde indisponible' };
    const live = { text: '7710', label: 'Solde : 7710 jetons' };
    expect(frozenBalance(true, unknown, live)).toBe(live);
    expect(frozenBalance(true, live, unknown)).toBe(live);
    expect(frozenBalance(false, unknown, live)).toBe(live);
  });
});
