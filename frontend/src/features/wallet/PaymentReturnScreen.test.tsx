/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';

import { walletApi } from '../../services/wallet-api';
import { useAuthStore } from '../../stores/auth-store';
import { PaymentReturnScreen } from './PaymentReturnScreen';

jest.mock('../../services/wallet-api', () => ({
  walletApi: { get: jest.fn(), payment: jest.fn() },
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
  useLocalSearchParams: jest.fn(),
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`redirect:${href}`}</Text>;
  },
}));
// La coquille (HUD, profil…) n'est pas l'objet du test.
jest.mock('../lobby/LobbyShell', () => ({
  LobbyShell: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `leter://${path}` }));

const api = walletApi as jest.Mocked<typeof walletApi>;
const params = useLocalSearchParams as jest.Mock;
const ID = '66666666-6666-4666-8666-666666666666';

const clients: QueryClient[] = [];

async function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>
      <PaymentReturnScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
  api.get.mockResolvedValue({
    wallet: {
      balance: 0,
      mobileMoneyNumber: '+23*******271',
      phoneVerified: false,
      mobileMoneyAvailable: true,
      withdrawalAvailable: false,
    },
  });
});

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe('leter://payment/return (D-050)', () => {
  it('relit le paiement sur le serveur et affiche son statut réel', async () => {
    params.mockReturnValue({ paymentId: ID });
    api.payment.mockResolvedValue({
      payment: { id: ID, status: 'SUCCESS', amount: 2000, currency: 'XAF' },
    });
    await renderScreen();
    expect(await screen.findByText('Paiement confirmé')).toBeTruthy();
    expect(screen.getByText('+2 000 jetons')).toBeTruthy();
    expect(api.payment).toHaveBeenCalledWith('jeton', ID);
  });

  it('ne déclare jamais un succès lui-même : paiement encore en attente côté serveur', async () => {
    params.mockReturnValue({ paymentId: ID, status: 'success' });
    api.payment.mockResolvedValue({
      payment: { id: ID, status: 'PENDING', amount: 500, currency: 'XAF' },
    });
    await renderScreen();
    expect(await screen.findByText('Paiement en cours...')).toBeTruthy();
    expect(screen.queryByText('Paiement confirmé')).toBeNull();
  });

  it.each([undefined, 'not-a-uuid'])('paymentId absent ou invalide (%p) : aucun appel', async (id) => {
    params.mockReturnValue({ paymentId: id });
    await renderScreen();
    expect(await screen.findByText('Paiement introuvable.')).toBeTruthy();
    expect(api.payment).not.toHaveBeenCalled();
  });

  it('ouvert à froid pendant la restauration de la session : attend, sans aucun appel', async () => {
    useAuthStore.setState({ status: 'loading', accessToken: null });
    params.mockReturnValue({ paymentId: ID });
    await renderScreen();
    expect(screen.getByTestId('payment-return-loading')).toBeTruthy();
    expect(api.payment).not.toHaveBeenCalled();
  });

  it('sans session : renvoi vers la connexion, aucun paiement lu', async () => {
    useAuthStore.getState().signOut();
    params.mockReturnValue({ paymentId: ID });
    await renderScreen();
    expect(screen.getByText('redirect:/login')).toBeTruthy();
    expect(api.payment).not.toHaveBeenCalled();
  });
});
