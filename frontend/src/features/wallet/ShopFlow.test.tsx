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
  walletApi: {
    get: jest.fn(),
    deposit: jest.fn(),
    withdraw: jest.fn(),
    withdrawals: jest.fn(),
    withdrawal: jest.fn(),
    payment: jest.fn(),
  },
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
/** L'ancien message permanent, qui ne doit plus jamais apparaître. */
const OLD_SOON = /bientôt disponibles/;
const NOT_OPEN =
  'Les retraits Mobile Money ne sont pas encore ouverts. Vos jetons restent disponibles pour jouer.';
const CLOSED =
  'Les retraits Mobile Money sont fermés pour le moment. Vos jetons restent disponibles pour jouer.';
const GENERIC = 'Les retraits Mobile Money ne sont pas disponibles pour le moment.';
const TEST_MODE = 'Mode test : les retraits sont simulés, aucun argent réel n’est envoyé.';

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

let onClose: jest.Mock;

async function openShop() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  onClose = jest.fn();
  await render(
    <QueryClientProvider client={queryClient}>
      <ShopFlow onClose={onClose} />
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

const AMOUNT_FIELD = 'Montant de la recharge (FCFA)';

/** Saisit un montant (texte brut, comme au clavier). */
async function typeAmount(value: string) {
  fireEvent.changeText(await screen.findByLabelText(AMOUNT_FIELD), value);
}

/** Saisit `amount` puis appuie sur l'unique bouton de paiement (libellé : montant + opérateur). */
async function payWith(operator: 'MTN Mobile Money' | 'Orange Money', amount = 1000) {
  await typeAmount(String(amount));
  fireEvent.press(await screen.findByLabelText(`Payer ${amount} francs CFA avec ${operator}`));
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
  api.get.mockResolvedValue({ wallet: wallet() });
});

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe('Mes jetons → Retirer', () => {
  it('retrait indisponible (serveur sans motif) : désactivé, aucun appel, solde intact', async () => {
    const queryClient = await openShop();
    expect(await screen.findByText(GENERIC)).toBeTruthy();
    expect(screen.queryByText(OLD_SOON)).toBeNull();
    const withdraw = screen.getByLabelText('Retirer des jetons vers Mobile Money');
    expect(withdraw.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(withdraw);
    // Toujours sur « Acheter » : ni formulaire de retrait, ni demande, ni débit.
    expect(screen.queryByLabelText('Nombre de jetons à retirer')).toBeNull();
    expect(api.withdraw).not.toHaveBeenCalled();
    expect(balanceIn(queryClient)).toBe(0);
  });

  it('retrait annoncé disponible par le serveur : le formulaire s’ouvre', async () => {
    api.get.mockResolvedValue({ wallet: wallet({ withdrawalAvailable: true, balance: 5000 }) });
    api.withdrawals.mockResolvedValue({
      withdrawals: [],
      policy: {
        available: true,
        minTokens: 1000,
        maxTokens: 1_500_000,
        currency: 'XAF',
        tokensPerUnit: 1,
        platformFeeTokens: 0,
        operators: [{ code: 'MTN_CM', label: 'MTN Mobile Money' }],
        msisdn: '+23*******271',
        msisdnSupported: true,
        limit: { count: null, periodMinutes: null, used: 0, remaining: null, nextAvailableAt: null },
      },
    });
    await openShop();
    const withdraw = await screen.findByLabelText('Retirer des jetons vers Mobile Money');
    await waitFor(() => expect(withdraw.props.accessibilityState.disabled).toBe(false));
    fireEvent.press(withdraw);
    expect(await screen.findByLabelText('Nombre de jetons à retirer')).toBeTruthy();
    expect(screen.queryByText(GENERIC)).toBeNull();
    expect(screen.queryByText(TEST_MODE)).toBeNull();
  });

  it.each([
    ['PROVIDER_NOT_CONFIGURED', NOT_OPEN],
    ['TRANSFERS_DISABLED', CLOSED],
    ['LIVE_NOT_CONFIRMED', 'Les retraits Mobile Money sont momentanément indisponibles (maintenance du service).'],
  ])('indisponible (%s) : motif compréhensible, bouton désactivé', async (reason, message) => {
    api.get.mockResolvedValue({
      wallet: wallet({
        withdrawalAvailable: false,
        withdrawalMode: 'unavailable',
        withdrawalUnavailableReason: reason,
      }),
    });
    await openShop();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(OLD_SOON)).toBeNull();
    const withdraw = screen.getByLabelText('Retirer des jetons vers Mobile Money');
    expect(withdraw.props.accessibilityState.disabled).toBe(true);
  });

  it('mode test : onglet actif ET environnement de test annoncé côté retrait', async () => {
    api.get.mockResolvedValue({
      wallet: wallet({ withdrawalAvailable: true, withdrawalMode: 'sandbox', balance: 5000 }),
    });
    await openShop();
    const withdraw = await screen.findByLabelText('Retirer des jetons vers Mobile Money');
    await waitFor(() => expect(withdraw.props.accessibilityState.disabled).toBe(false));
    fireEvent.press(withdraw);
    expect(await screen.findByText(TEST_MODE)).toBeTruthy();
    expect(screen.getByText('ENVIRONNEMENT DE TEST')).toBeTruthy();
  });

  it('production : aucun message d’indisponibilité ni de test', async () => {
    api.get.mockResolvedValue({
      wallet: wallet({ withdrawalAvailable: true, withdrawalMode: 'live', balance: 5000 }),
    });
    await openShop();
    const withdraw = await screen.findByLabelText('Retirer des jetons vers Mobile Money');
    await waitFor(() => expect(withdraw.props.accessibilityState.disabled).toBe(false));
    expect(screen.queryByText(TEST_MODE)).toBeNull();
    expect(screen.queryByText(GENERIC)).toBeNull();
    expect(screen.queryByText(OLD_SOON)).toBeNull();
  });
});

/**
 * Recharger mon portefeuille (D-085, D-087, D-090) : un seul champ (montant), un seul bouton aux
 * couleurs de l'opérateur DÉDUIT PAR LE SERVEUR du numéro du compte ; aucun choix d'opérateur,
 * aucun numéro saisi ; l'application n'envoie que le montant. Aucun crédit avant le statut relu.
 */
describe('Recharger mon portefeuille', () => {
  const mtn = () => api.get.mockResolvedValue({ wallet: wallet({ paymentOperator: 'MTN_CM' }) });
  const orange = () => api.get.mockResolvedValue({ wallet: wallet({ paymentOperator: 'OM_CM' }) });
  const directPayment = (status: PaymentView['status']): PaymentView => ({
    id: PAYMENT_ID,
    status,
    amount: 1000,
    currency: 'XAF',
    mode: 'DIRECT',
    operator: 'MTN_CM',
  });

  it('compte MTN : un seul champ, un seul bouton jaune « Payer avec MTN Mobile Money », aucun choix', async () => {
    mtn();
    await openShopDeposit();
    expect(await screen.findByText('Payer avec MTN Mobile Money')).toBeTruthy();
    expect(screen.getByText('Mes jetons')).toBeTruthy();
    expect(screen.getAllByLabelText(AMOUNT_FIELD)).toHaveLength(1);
    expect(screen.queryByText('Orange Money')).toBeNull();
    expect(screen.queryByText(/Payer avec Orange Money/)).toBeNull();
    expect(screen.queryByText('Numéro de paiement')).toBeNull();
    expect(screen.queryByText(/Autre moyen|Autres moyens/)).toBeNull();
    expect(screen.queryByText(/Paiement sécurisé par CinetPay/)).toBeNull();
    expect(screen.queryByText(/jetons crédités/)).toBeNull();
    const button = screen.getByLabelText('Payer avec MTN Mobile Money');
    expect(button).toHaveStyle({ backgroundColor: '#FFCB05' });
    expect(button.props.accessibilityState.disabled).toBe(true); // montant vide
  });

  it('compte Orange : bouton orange « Payer avec Orange Money », pas de MTN', async () => {
    orange();
    await openShopDeposit();
    expect(await screen.findByText('Payer avec Orange Money')).toBeTruthy();
    expect(screen.getByLabelText('Payer avec Orange Money')).toHaveStyle({
      backgroundColor: '#FF7900',
    });
    expect(screen.queryByText(/MTN/)).toBeNull();
  });

  it('numéro non pris en charge : aucun bouton, message explicatif', async () => {
    api.get.mockResolvedValue({ wallet: wallet({ paymentOperator: null }) });
    await openShopDeposit();
    expect(await screen.findByText(/aucun paiement n’est possible/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Payer/)).toBeNull();
    expect(screen.getByLabelText(AMOUNT_FIELD).props.editable).toBe(false);
  });

  it('aucune carte « Montant à payer » ; le montant saisi s’affiche dans le bouton, modifiable', async () => {
    mtn();
    await openShopDeposit();
    expect(await screen.findByText('Payer avec MTN Mobile Money')).toBeTruthy();
    expect(screen.queryByText('Montant à payer')).toBeNull();
    expect(screen.queryByTestId('deposit-amount-to-pay')).toBeNull();
    // Limites non affichées sous le champ (seuls les messages d'erreur le sont).
    expect(screen.queryByText(/^De 100/)).toBeNull();
    await typeAmount('1234');
    expect(await screen.findByText(/^1\s?234\sFCFA$/)).toBeTruthy();
    await typeAmount('750');
    expect(await screen.findByText(/^750\sFCFA$/)).toBeTruthy();
    expect(screen.queryByText(/^1\s?234\sFCFA$/)).toBeNull();
  });

  it.each([
    ['zéro', '0', 'Minimum 100 FCFA.'],
    ['décimal', '1000.5', 'Saisissez un nombre entier de FCFA.'],
    ['négatif', '-500', 'Saisissez un nombre entier de FCFA.'],
    ['au-dessus du maximum', '2500001', 'Maximum 2 500 000 FCFA.'],
  ])('montant %s : message, bouton indisponible, aucune demande', async (_l, value, message) => {
    mtn();
    await openShopDeposit();
    await typeAmount(value);
    expect(await screen.findByText(message)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Payer avec MTN Mobile Money'));
    expect(api.deposit).not.toHaveBeenCalled();
  });

  it('paiement : SEUL le montant est envoyé (ni numéro, ni opérateur, ni mode)', async () => {
    mtn();
    api.deposit.mockResolvedValue({ ...pendingDeposit(1000), payment: directPayment('PENDING') });
    api.payment.mockResolvedValue({ payment: directPayment('PENDING') });
    await openShopDeposit();
    await payWith('MTN Mobile Money');
    await waitFor(() => expect(api.deposit).toHaveBeenCalledWith('jeton', 1000, 'idem-key-0001'));
    expect(JSON.stringify(api.deposit.mock.calls[0])).not.toMatch(/MTN|OM_CM|method|operator|\+237|phone/);
    expect(await screen.findByText('En attente de confirmation sur votre téléphone')).toBeTruthy();
    expect(openAuthSession).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'EXPIRED'] as const)(
    'direct MTN clos %s sans débit : le même achat passe automatiquement par la page CinetPay (D-134)',
    async (status) => {
      mtn();
      const PAGE_ID = '66666666-6666-4666-8666-666666666666';
      api.deposit
        .mockResolvedValueOnce({ ...pendingDeposit(1000), payment: directPayment('PENDING') })
        .mockResolvedValueOnce({
          ...pendingDeposit(1000),
          payment: { ...payment('PENDING'), id: PAGE_ID, operator: 'MTN_CM' },
        });
      api.payment.mockImplementation((_token: string, id: string) =>
        Promise.resolve({
          payment:
            id === PAYMENT_ID ? directPayment(status) : { ...payment('PENDING'), id: PAGE_ID },
        }),
      );
      await openShopDeposit();
      await payWith('MTN Mobile Money');
      await waitFor(() => expect(openAuthSession).toHaveBeenCalledWith(PAYMENT_URL, 'leter://payment/return'));
      // Même achat : même montant, MÊME clé d'idempotence (jamais un second paiement).
      expect(api.deposit).toHaveBeenCalledTimes(2);
      expect(api.deposit.mock.calls[1]).toEqual(['jeton', 1000, 'idem-key-0001']);
      expect(screen.queryByText(/Paiement (échoué|expiré)/)).toBeNull();
    },
  );

  it('direct MTN toujours en attente : aucun repli (jamais de double débit)', async () => {
    mtn();
    api.deposit.mockResolvedValue({ ...pendingDeposit(1000), payment: directPayment('PENDING') });
    api.payment.mockResolvedValue({ payment: directPayment('PENDING') });
    await openShopDeposit();
    await payWith('MTN Mobile Money');
    expect(await screen.findByText('En attente de confirmation sur votre téléphone')).toBeTruthy();
    expect(api.deposit).toHaveBeenCalledTimes(1);
    expect(openAuthSession).not.toHaveBeenCalled();
  });

  it('repli décidé par le serveur (page CinetPay) : la page s’ouvre, consigne si l’opérateur n’est pas présélectionné', async () => {
    orange();
    api.deposit.mockResolvedValue(pendingDeposit(2000));
    api.payment.mockResolvedValue({ payment: { ...payment('PENDING'), amount: 2000 } });
    await openShopDeposit();
    await payWith('Orange Money', 2000);
    await waitFor(() => expect(openAuthSession).toHaveBeenCalledWith(PAYMENT_URL, 'leter://payment/return'));
    expect(await screen.findByText('Sur la page CinetPay, choisissez Orange Money.')).toBeTruthy();
    expect(api.deposit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['SUCCESS', 'Paiement confirmé'],
    ['FAILED', 'Paiement échoué'],
    ['EXPIRED', 'Paiement expiré'],
  ] as const)('statut %s lu sur le serveur : « %s » ; crédit seulement après confirmation', async (status, title) => {
    mtn();
    api.deposit.mockResolvedValue(pendingDeposit(1000));
    api.payment.mockResolvedValue({ payment: payment(status) });
    const queryClient = await openShopDeposit();
    if (status === 'SUCCESS') {
      api.get.mockResolvedValue({ wallet: wallet({ balance: 1000, paymentOperator: 'MTN_CM' }) });
    }
    await payWith('MTN Mobile Money');
    expect(await screen.findByText(title)).toBeTruthy();
    if (status === 'SUCCESS') await waitFor(() => expect(balanceIn(queryClient)).toBe(1000));
    else expect(balanceIn(queryClient)).toBe(0);
  });

  it.each([
    // Cause classée par le serveur (D-100) : son message est affiché tel quel.
    [
      new ApiError(503, 'MOBILE_MONEY_UNAVAILABLE', 'Le service de paiement CinetPay est injoignable pour le moment. Aucun montant n’a été débité. Réessayez dans quelques minutes.'),
      'Le service de paiement CinetPay est injoignable pour le moment. Aucun montant n’a été débité. Réessayez dans quelques minutes.',
    ],
    // Ancien serveur sans message : texte de secours.
    [new ApiError(503, 'MOBILE_MONEY_UNAVAILABLE', ''), 'Service de paiement momentanément indisponible. Aucun montant n’a été débité.'],
    [new ApiError(0, 'NETWORK_ERROR', 'Réseau.'), 'Impossible de contacter le service de paiement. Réessayez.'],
    [new ApiError(409, 'DIRECT_PAYMENT_UNAVAILABLE', 'CinetPay a refusé le paiement direct.'), 'Paiement refusé. CinetPay a refusé le paiement direct.'],
  ])('erreur %# : message distinct, aucune page, aucun second appel', async (error, message) => {
    mtn();
    api.deposit.mockRejectedValue(error);
    await openShopDeposit();
    await payWith('MTN Mobile Money');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(api.deposit).toHaveBeenCalledTimes(1);
    expect(openAuthSession).not.toHaveBeenCalled();
  });

  it('issue inconnue (503 PAYMENT_VERIFICATION_PENDING) : vérification en cours, jamais « aucun montant débité », relance bloquée', async () => {
    mtn();
    api.deposit.mockRejectedValue(
      new ApiError(503, 'PAYMENT_VERIFICATION_PENDING', 'Vérification du paiement en cours.'),
    );
    await openShopDeposit();
    await payWith('MTN Mobile Money');
    expect(await screen.findByText(/Vérification du paiement en cours/)).toBeTruthy();
    expect(screen.queryByText(/Aucun montant n’a été débité/)).toBeNull();
    // Même montant : pas de nouvelle demande immédiate.
    fireEvent.press(screen.getByLabelText('Payer 1000 francs CFA avec MTN Mobile Money'));
    expect(api.deposit).toHaveBeenCalledTimes(1);
    expect(
      screen.getByLabelText('Payer 1000 francs CFA avec MTN Mobile Money').props.accessibilityState
        .disabled,
    ).toBe(true);
  });

  it('base momentanément indisponible (503 SERVICE_TEMPORARILY_UNAVAILABLE) : message dédié', async () => {
    mtn();
    api.deposit.mockRejectedValue(
      new ApiError(503, 'SERVICE_TEMPORARILY_UNAVAILABLE', 'Service momentanément indisponible.'),
    );
    await openShopDeposit();
    await payWith('MTN Mobile Money');
    expect(
      await screen.findByText('Service momentanément indisponible. Réessayez dans quelques instants.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Aucun montant/)).toBeNull();
  });

  it('initialisation en cours : bouton et saisie bloqués, double appui sans effet', async () => {
    mtn();
    let resolve: (value: ReturnType<typeof pendingDeposit>) => void = () => undefined;
    api.deposit.mockImplementation(() => new Promise((r) => (resolve = r)));
    api.payment.mockResolvedValue({ payment: payment('PENDING') });
    await openShopDeposit();
    await payWith('MTN Mobile Money');
    expect(await screen.findByText('Initialisation du paiement…')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Payer 1000 francs CFA avec MTN Mobile Money'));
    fireEvent.changeText(screen.getByLabelText(AMOUNT_FIELD), '500');
    expect(screen.getByLabelText(AMOUNT_FIELD).props.value).toMatch(/^1\s000$/);
    expect(api.deposit).toHaveBeenCalledTimes(1);
    resolve(pendingDeposit(1000));
    await waitFor(() => expect(openAuthSession).toHaveBeenCalledTimes(1));
  });

  it('« Fermer » ferme le panneau sans rien créer', async () => {
    mtn();
    await openShopDeposit();
    expect(await screen.findByText('Payer avec MTN Mobile Money')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Fermer'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.deposit).not.toHaveBeenCalled();
  });

  it('coupure réseau (issue inconnue) : le nouvel essai du même montant réutilise la MÊME clé', async () => {
    mtn();
    api.deposit
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Réseau.'))
      .mockResolvedValueOnce(pendingDeposit(1000));
    api.payment.mockResolvedValue({ payment: payment('PENDING') });
    await openShopDeposit();
    await payWith('MTN Mobile Money');
    expect(
      await screen.findByText('Impossible de contacter le service de paiement. Réessayez.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Payer 1000 francs CFA avec MTN Mobile Money'));
    await waitFor(() => expect(api.deposit).toHaveBeenCalledTimes(2));
    expect(api.deposit.mock.calls.map((c) => c[2])).toEqual(['idem-key-0001', 'idem-key-0001']);
  });
});

/**
 * Panneau unique (`+L`) : solde disponible, choix Acheter / Retirer sur place, montant saisi à
 * la main, sans montant proposé ni frais ni montant net.
 */
describe('Mes jetons : un seul panneau', () => {
  const policy = {
    available: true,
    minTokens: 1000,
    maxTokens: 1_500_000,
    currency: 'XAF' as const,
    tokensPerUnit: 1,
    platformFeeTokens: 0,
    operators: [{ code: 'MTN_CM' as const, label: 'MTN Mobile Money' }],
    msisdn: '+23*******271',
    msisdnSupported: true,
    limit: { count: null, periodMinutes: null, used: 0, remaining: null, nextAvailableAt: null },
  };
  const ready = () => {
    api.get.mockResolvedValue({
      wallet: wallet({
        balance: 5000,
        reserved: 1000,
        available: 4000,
        withdrawalAvailable: true,
        withdrawalMode: 'live',
        paymentOperator: 'MTN_CM',
      }),
    });
    api.withdrawals.mockResolvedValue({ withdrawals: [], policy });
  };

  it('solde DISPONIBLE, Acheter choisi, champ vide : aucun montant proposé, ni frais ni net', async () => {
    ready();
    await openShop();
    expect(await screen.findByLabelText('Solde disponible : 4000 jetons')).toBeTruthy();
    expect(await screen.findByText('Payer avec MTN Mobile Money')).toBeTruthy();
    expect(screen.getByLabelText('Acheter des jetons').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText(AMOUNT_FIELD).props.value).toBe('');
    expect(screen.queryByText(/frais|net|commission/i)).toBeNull();
    // Aucun bouton de montant : seuls la fermeture et l'unique bouton de paiement.
    expect(screen.queryAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual([
      'Fermer',
      'Payer avec MTN Mobile Money',
    ]);
  });

  it('Retirer sur place : même panneau, montant conservé, bouton du retrait, rien envoyé', async () => {
    ready();
    await openShop();
    expect(await screen.findByText('Payer avec MTN Mobile Money')).toBeTruthy();
    await typeAmount('2000');
    const withdraw = screen.getByLabelText('Retirer des jetons vers Mobile Money');
    await waitFor(() => expect(withdraw.props.accessibilityState.disabled).toBe(false));
    fireEvent.press(withdraw);

    expect(screen.getAllByTestId('token-sheet')).toHaveLength(1);
    const field = await screen.findByLabelText('Nombre de jetons à retirer');
    expect(field.props.value).toMatch(/^2\s000$/);
    expect(screen.queryByLabelText(AMOUNT_FIELD)).toBeNull();
    expect(await screen.findByLabelText('Continuer le retrait de 2000 jetons')).toBeTruthy();
    // Même présentation que l'achat : bouton aux couleurs de l'opérateur du compte, numéro masqué.
    expect(screen.getByText('Retirer vers MTN Mobile Money')).toBeTruthy();
    expect(screen.getByText(/^2\s000 jetons · \+23\*{7}271$/)).toBeTruthy();
    expect(screen.queryByText(/frais|net|commission/i)).toBeNull();
    expect(api.withdraw).not.toHaveBeenCalled();
    expect(api.deposit).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Acheter des jetons'));
    expect(await screen.findByLabelText('Payer 2000 francs CFA avec MTN Mobile Money')).toBeTruthy();
  });

  it('achat lancé : le choix Acheter / Retirer est verrouillé pendant le suivi réel', async () => {
    ready();
    api.deposit.mockResolvedValue(pendingDeposit(1000));
    api.payment.mockResolvedValue({ payment: payment('PENDING') });
    await openShop();
    await payWith('MTN Mobile Money');
    expect(await screen.findByText('Paiement en cours...')).toBeTruthy();
    expect(
      screen.getByLabelText('Retirer des jetons vers Mobile Money').props.accessibilityState.disabled,
    ).toBe(true);
    // Retour à l'application : jamais une preuve de paiement, le statut reste celui du serveur.
    expect(screen.queryByText('Paiement confirmé')).toBeNull();
  });

  it('fermeture puis réouverture : panneau neuf, sur Acheter, champ vide', async () => {
    ready();
    await openShop();
    await typeAmount('1500');
    fireEvent.press(screen.getByLabelText('Fermer'));
    expect(onClose).toHaveBeenCalledTimes(1);
    screen.unmount();
    await openShop();
    expect(
      (await screen.findByLabelText('Acheter des jetons')).props.accessibilityState.selected,
    ).toBe(true);
    expect(screen.getByLabelText(AMOUNT_FIELD).props.value).toBe('');
  });
});
