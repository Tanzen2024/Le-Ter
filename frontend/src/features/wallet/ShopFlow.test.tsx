/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { ApiError } from '../../lib/api-client';
import { walletApi } from '../../services/wallet-api';
import { useAuthStore } from '../../stores/auth-store';
import type { PaymentView, WalletView } from '../../types/wallet';
import { walletKey } from './hooks';
import { ShopFlow } from './ShopFlow';

jest.mock('../../services/wallet-api', () => ({
  walletApi: { get: jest.fn(), deposit: jest.fn(), withdraw: jest.fn(), payment: jest.fn() },
}));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(() => Promise.resolve({ type: 'dismiss' })),
}));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `leter://${path}` }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'idem-key-0001' }));

const api = walletApi as jest.Mocked<typeof walletApi>;
const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;

const PAYMENT_ID = '55555555-5555-4555-8555-555555555555';
const PAYMENT_URL = 'https://secure.sandbox.cinetpay.net/payment/abc';
const PAY_1000 = 'Recharger 1000 francs CFA';
const NO_WITHDRAWAL = 'Les retraits Mobile Money seront bientôt disponibles.';
const FCFA_1000 = '1 000 FCFA';

const wallet = (overrides: Partial<WalletView> = {}): WalletView => ({
  balance: 0,
  mobileMoneyNumber: '+23*******271',
  phoneVerified: false,
  mobileMoneyAvailable: true,
  withdrawalAvailable: false,
  ...overrides,
});

const payment = (status: PaymentView['status']): PaymentView => ({
  id: PAYMENT_ID,
  status,
  amount: 1000,
  currency: 'XAF',
  ...(status === 'PENDING' && { paymentUrl: PAYMENT_URL }),
});

const clients: QueryClient[] = [];

async function openShop() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>
      <ShopFlow onClose={jest.fn()} />
    </QueryClientProvider>,
  );
  return queryClient;
}

async function openShopDeposit() {
  const queryClient = await openShop();
  fireEvent.press(await screen.findByLabelText('Acheter des jetons'));
  return queryClient;
}

/** Solde tel que le cache TanStack Query du wallet le connaît (relu sur le serveur). */
const balanceIn = (queryClient: QueryClient) =>
  queryClient.getQueryData<WalletView>(walletKey)?.balance;

const pendingDeposit = (amount: number) => ({
  transaction: {
    id: 'tx-1',
    kind: 'deposit' as const,
    status: 'pending' as const,
    tokens: amount,
    createdAt: '2026-10-08T10:00:00.000Z',
  },
  balance: 0,
  payment: { ...payment('PENDING'), amount },
});

/** Choisit 1 000 FCFA : le serveur crée le paiement CinetPay (en attente). */
async function payThousand() {
  api.deposit.mockResolvedValue(pendingDeposit(1000));
  fireEvent.press(await screen.findByLabelText(PAY_1000));
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
  api.get.mockResolvedValue({ wallet: wallet() });
});

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe('Boutique → Acheter (CinetPay, D-050)', () => {
  it('sélection du montant : « Recharger mon wallet » et les 4 montants en FCFA', async () => {
    await openShopDeposit();
    expect(await screen.findByText('Recharger mon wallet')).toBeTruthy();
    for (const label of ['500 FCFA', FCFA_1000, '2 000 FCFA', '5 000 FCFA']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // Plus de saisie libre : seuls les montants autorisés.
    expect(screen.queryByText('Entrer le nombre de jetons à acheter')).toBeNull();
  });

  it('lancement du paiement : création côté serveur puis ouverture de la page CinetPay', async () => {
    api.payment.mockResolvedValue({ payment: payment('PENDING') });
    await openShopDeposit();
    await payThousand();

    await waitFor(() => expect(openAuthSession).toHaveBeenCalledWith(PAYMENT_URL, 'leter://payment/return'));
    // Une Idempotency-Key par intention (appui), générée par l'application.
    expect(api.deposit).toHaveBeenCalledWith('jeton', 1000, 'idem-key-0001');
  });

  it('état pending : « Paiement en cours... », le solde n’est pas modifié par l’écran', async () => {
    api.payment.mockResolvedValue({ payment: payment('PENDING') });
    await openShopDeposit();
    await payThousand();

    expect(await screen.findByText('Paiement en cours...')).toBeTruthy();
    expect(screen.getByLabelText('Ouvrir la page de paiement')).toBeTruthy();
    expect(screen.queryByText('Paiement confirmé')).toBeNull();
  });

  it('succès : « Paiement confirmé +1 000 jetons » d’après le serveur, puis solde rechargé', async () => {
    api.payment.mockResolvedValue({ payment: payment('SUCCESS') });
    const queryClient = await openShopDeposit();
    await waitFor(() => expect(balanceIn(queryClient)).toBe(0));
    // Le serveur a crédité le compte (notification vérifiée) : la relecture renvoie le solde.
    api.get.mockResolvedValue({ wallet: wallet({ balance: 1000 }) });
    await payThousand();

    expect(await screen.findByText('Paiement confirmé')).toBeTruthy();
    expect(screen.getByText('+1 000 jetons')).toBeTruthy();
    expect(api.payment).toHaveBeenCalledWith('jeton', PAYMENT_ID);
    // Rafraîchissement du wallet (même cache TanStack Query) : relu sur le serveur.
    await waitFor(() => expect(balanceIn(queryClient)).toBe(1000));
  });

  it('échec : « Paiement échoué », le solde n’augmente pas', async () => {
    api.payment.mockResolvedValue({ payment: payment('FAILED') });
    const queryClient = await openShopDeposit();
    const walletReads = api.get.mock.calls.length;
    await payThousand();
    expect(await screen.findByText('Paiement échoué')).toBeTruthy();
    expect(screen.queryByText('Paiement confirmé')).toBeNull();
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(walletReads));
    expect(balanceIn(queryClient)).toBe(0);
  });

  it('expiration : « Paiement expiré »', async () => {
    api.payment.mockResolvedValue({ payment: payment('EXPIRED') });
    await openShopDeposit();
    await payThousand();
    expect(await screen.findByText('Paiement expiré')).toBeTruthy();
  });

  it('refus du serveur : « Paiement impossible », aucune page ouverte, bouton à nouveau disponible', async () => {
    api.deposit.mockRejectedValue(
      new ApiError(503, 'MOBILE_MONEY_UNAVAILABLE', 'Le service de paiement est indisponible.'),
    );
    await openShopDeposit();
    fireEvent.press(await screen.findByLabelText(PAY_1000));
    expect(
      await screen.findByText('Paiement impossible. Le service de paiement est indisponible.'),
    ).toBeTruthy();
    expect(openAuthSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText(PAY_1000).props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByLabelText(PAY_1000));
    await waitFor(() => expect(api.deposit).toHaveBeenCalledTimes(2));
  });

  it('erreur réseau : « Impossible de contacter le service de paiement. Réessayez. »', async () => {
    api.deposit.mockRejectedValue(
      new ApiError(0, 'NETWORK_ERROR', 'Impossible de joindre le serveur.'),
    );
    await openShopDeposit();
    fireEvent.press(await screen.findByLabelText(PAY_1000));
    expect(
      await screen.findByText('Impossible de contacter le service de paiement. Réessayez.'),
    ).toBeTruthy();
    expect(openAuthSession).not.toHaveBeenCalled();
  });

  it.each([
    [500, '500 FCFA'],
    [1000, FCFA_1000],
    [2000, '2 000 FCFA'],
    [5000, '5 000 FCFA'],
  ])('%i FCFA : bouton cliquable → POST /api/wallet/deposits pour ce montant, page ouverte', async (amount, label) => {
    api.deposit.mockResolvedValue(pendingDeposit(amount));
    api.payment.mockResolvedValue({ payment: { ...payment('PENDING'), amount } });
    await openShopDeposit();
    const button = await screen.findByLabelText(`Recharger ${amount} francs CFA`);
    expect(screen.getByText(label)).toBeTruthy();
    expect(button.props.accessibilityRole).toBe('button');
    await waitFor(() => expect(button.props.accessibilityState.disabled).toBe(false));

    fireEvent.press(button);
    await waitFor(() =>
      expect(api.deposit).toHaveBeenCalledWith('jeton', amount, 'idem-key-0001'),
    );
    expect(api.deposit).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(openAuthSession).toHaveBeenCalledWith(PAYMENT_URL, 'leter://payment/return'),
    );
  });

  it('création en cours : « Création du paiement… », boutons bloqués, double appui impossible', async () => {
    let resolve: (value: ReturnType<typeof pendingDeposit>) => void = () => undefined;
    api.deposit.mockImplementation(() => new Promise((r) => (resolve = r)));
    api.payment.mockResolvedValue({ payment: payment('PENDING') });
    await openShopDeposit();
    const thousand = await screen.findByLabelText(PAY_1000);
    await waitFor(() => expect(thousand.props.accessibilityState.disabled).toBe(false));

    fireEvent.press(thousand);
    expect(await screen.findByText('Création du paiement…')).toBeTruthy();
    expect(screen.getByLabelText(PAY_1000).props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true, busy: true }),
    );
    fireEvent.press(screen.getByLabelText(PAY_1000));
    fireEvent.press(screen.getByLabelText('Recharger 500 francs CFA'));
    expect(api.deposit).toHaveBeenCalledTimes(1);

    resolve(pendingDeposit(1000));
    await waitFor(() => expect(openAuthSession).toHaveBeenCalledTimes(1));
  });

  it('fournisseur non configuré : montants désactivés', async () => {
    api.get.mockResolvedValue({ wallet: wallet({ mobileMoneyAvailable: false }) });
    await openShopDeposit();
    expect(await screen.findByText('Mobile Money bientôt disponible.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText(PAY_1000));
    expect(api.deposit).not.toHaveBeenCalled();
  });
});

describe('Boutique → Retirer', () => {
  it('retrait indisponible (CinetPay : achat seulement) : désactivé, aucun appel, solde intact', async () => {
    const queryClient = await openShop();
    expect(await screen.findByText(NO_WITHDRAWAL)).toBeTruthy();
    const withdraw = screen.getByLabelText('Retirer des jetons vers Mobile Money');
    expect(withdraw.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(withdraw);
    // Toujours dans la Boutique : ni formulaire, ni demande, ni débit.
    expect(screen.queryByText('Entrer le nombre de jetons à retirer')).toBeNull();
    expect(api.withdraw).not.toHaveBeenCalled();
    expect(balanceIn(queryClient)).toBe(0);
  });

  it('retrait annoncé disponible par le serveur : le formulaire s’ouvre', async () => {
    api.get.mockResolvedValue({ wallet: wallet({ withdrawalAvailable: true, balance: 50 }) });
    await openShop();
    const withdraw = await screen.findByLabelText('Retirer des jetons vers Mobile Money');
    await waitFor(() => expect(withdraw.props.accessibilityState.disabled).toBe(false));
    fireEvent.press(withdraw);
    expect(await screen.findByText('Entrer le nombre de jetons à retirer')).toBeTruthy();
    expect(screen.queryByText(NO_WITHDRAWAL)).toBeNull();
  });
});
