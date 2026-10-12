/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '../../lib/api-client';
import { walletApi } from '../../services/wallet-api';
import { useAuthStore } from '../../stores/auth-store';
import type { WalletView, WithdrawalPolicy, WithdrawalView } from '../../types/wallet';
import { WithdrawalPanel } from './WithdrawalPanel';

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
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `leter://${path}` }));
let mockKeySequence = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `withdrawal-key-${++mockKeySequence}` }));

const api = walletApi as jest.Mocked<typeof walletApi>;

const wallet = (overrides: Partial<WalletView> = {}): WalletView => ({
  balance: 5000,
  reserved: 0,
  available: 5000,
  mobileMoneyNumber: '+23*******271',
  phoneVerified: false,
  mobileMoneyAvailable: true,
  withdrawalAvailable: true,
  ...overrides,
});

const policy = (overrides: Partial<WithdrawalPolicy> = {}): WithdrawalPolicy => ({
  available: true,
  minTokens: 1000,
  maxTokens: 1_500_000,
  currency: 'XAF',
  tokensPerUnit: 1,
  platformFeeTokens: 0,
  operators: [
    { code: 'OM_CM', label: 'Orange Money' },
    { code: 'MTN_CM', label: 'MTN Mobile Money' },
  ],
  msisdn: '+23*******271',
  msisdnSupported: true,
  limit: { count: null, periodMinutes: null, used: 0, remaining: null, nextAvailableAt: null },
  ...overrides,
});

const created = (status: WithdrawalView['status'] = 'PROCESSING'): WithdrawalView => ({
  id: '11111111-1111-4111-8111-111111111111',
  reference: 'LW0123456789abcdef0123456789',
  status,
  tokens: 2000,
  amount: 2000,
  currency: 'XAF',
  operator: 'MTN_CM',
  operatorLabel: 'MTN Mobile Money',
  msisdn: '+23*******271',
  createdAt: '2026-10-10T10:00:00.000Z',
});

const clients: QueryClient[] = [];

async function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(client);
  await render(
    <QueryClientProvider client={client}>
      <WithdrawalPanel onBack={jest.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByText('Orange Money');
}

async function fill(tokens: string, operator = 'MTN Mobile Money') {
  await fireEvent.changeText(screen.getByLabelText('Nombre de jetons à retirer'), tokens);
  await fireEvent.press(screen.getByText(operator));
}

const continueButton = () => screen.getByLabelText(/^Continuer le retrait/);

beforeEach(() => {
  jest.clearAllMocks();
  mockKeySequence = 0;
  useAuthStore.getState().signIn('jeton');
  api.get.mockResolvedValue({ wallet: wallet() });
  api.withdrawals.mockResolvedValue({ withdrawals: [], policy: policy() });
});

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe('Saisie', () => {
  it('999 jetons : refusé avant tout envoi ; 1 000 : la confirmation est possible', async () => {
    await open();
    await fill('999');
    expect(screen.getByText(/^Le retrait minimum est de 1\s000 jetons\.$/)).toBeTruthy();
    expect(continueButton().props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText('Nombre de jetons à retirer'), '1000');
    await waitFor(() => expect(continueButton().props.accessibilityState.disabled).toBe(false));
    expect(api.withdraw).not.toHaveBeenCalled();
  });

  it('opérateur obligatoire ; solde disponible insuffisant refusé', async () => {
    await open();
    await fireEvent.changeText(screen.getByLabelText('Nombre de jetons à retirer'), '2000');
    expect(continueButton().props.accessibilityState.disabled).toBe(true);
    await fill('6000');
    expect(screen.getByText('Solde disponible insuffisant.')).toBeTruthy();
    expect(continueButton().props.accessibilityState.disabled).toBe(true);
  });

  it('quota atteint ou numéro non pris en charge : retrait bloqué, message clair', async () => {
    api.withdrawals.mockResolvedValue({
      withdrawals: [],
      policy: policy({
        limit: {
          count: 1,
          periodMinutes: 1440,
          used: 1,
          remaining: 0,
          nextAvailableAt: '2026-10-11T10:00:00.000Z',
        },
      }),
    });
    await open();
    await fill('2000');
    expect(screen.getByText(/Nombre maximal de retraits atteint/)).toBeTruthy();
    expect(screen.getByText('0 retrait restant sur 1 par période de 1 jour.')).toBeTruthy();
    expect(continueButton().props.accessibilityState.disabled).toBe(true);
  });
});

describe('Confirmation et envoi', () => {
  it('récapitulatif sans frais inventés, puis référence et statut renvoyés par le serveur', async () => {
    api.withdraw.mockResolvedValue({
      withdrawal: created(),
      balance: { balance: 3000, reserved: 0, available: 3000 },
      replayed: false,
    });
    api.withdrawal.mockResolvedValue({ withdrawal: created('PROCESSING') });
    await open();
    await fill('2000');
    await fireEvent.press(continueButton());

    expect(await screen.findByRole('header', { name: 'Confirmer le retrait' })).toBeTruthy();
    expect(screen.getByText(/^2\s000 jetons$/)).toBeTruthy();
    expect(screen.getByText(/^2\s000\sFCFA$/)).toBeTruthy();
    expect(screen.getByText('Aucun')).toBeTruthy();
    expect(screen.getByText(/^3\s000 jetons$/)).toBeTruthy(); // disponible après le retrait
    expect(api.withdraw).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Confirmer le retrait de 2000 jetons'));
    expect(await screen.findByText('Transfert en cours')).toBeTruthy();
    expect(screen.getByText('Référence : LW0123456789abcdef0123456789')).toBeTruthy();
    expect(api.withdraw).toHaveBeenCalledWith(
      'jeton',
      { tokens: 2000, operator: 'MTN_CM' },
      'withdrawal-key-1',
    );
  });

  it('double appui pendant l’envoi : une seule demande', async () => {
    let resolve: (value: Awaited<ReturnType<typeof api.withdraw>>) => void = () => undefined;
    api.withdraw.mockImplementation(() => new Promise((r) => (resolve = r)));
    await open();
    await fill('2000');
    await fireEvent.press(continueButton());
    const confirm = await screen.findByLabelText('Confirmer le retrait de 2000 jetons');
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    await waitFor(() =>
      expect(
        screen.getByLabelText('Confirmer le retrait de 2000 jetons').props.accessibilityState.busy,
      ).toBe(true),
    );
    await fireEvent.press(screen.getByLabelText('Confirmer le retrait de 2000 jetons'));
    expect(api.withdraw).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Modifier').props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      resolve({
        withdrawal: created('CREATED'),
        balance: { balance: 3000, reserved: 0, available: 3000 },
        replayed: false,
      });
    });
  });

  it('coupure réseau : nouvel essai avec la MÊME clé (jamais deux retraits)', async () => {
    api.withdraw
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'réseau'))
      .mockResolvedValueOnce({
        withdrawal: created(),
        balance: { balance: 3000, reserved: 0, available: 3000 },
        replayed: true,
      });
    api.withdrawal.mockResolvedValue({ withdrawal: created() });
    await open();
    await fill('2000');
    await fireEvent.press(continueButton());
    await fireEvent.press(await screen.findByLabelText('Confirmer le retrait de 2000 jetons'));
    expect(await screen.findByText(/Connexion impossible/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Confirmer le retrait de 2000 jetons'));
    expect(await screen.findByText('Transfert en cours')).toBeTruthy();
    expect(api.withdraw.mock.calls.map((c) => c[2])).toEqual(['withdrawal-key-1', 'withdrawal-key-1']);
  });

  it.each([
    ['WITHDRAWAL_LIMIT_REACHED', 429, /nombre maximal de retraits/],
    ['INSUFFICIENT_BALANCE', 409, /Solde disponible insuffisant/],
    ['MOBILE_MONEY_UNAVAILABLE', 503, /service de retrait est indisponible/],
  ])('refus %s : message compréhensible, rien n’est affiché comme réussi', async (code, status, text) => {
    api.withdraw.mockRejectedValue(new ApiError(status, code, 'refus'));
    await open();
    await fill('2000');
    await fireEvent.press(continueButton());
    await fireEvent.press(await screen.findByLabelText('Confirmer le retrait de 2000 jetons'));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByText(/Référence/)).toBeNull();
  });

  it('statut final relu sur le serveur : échec confirmé = jetons recrédités', async () => {
    api.withdraw.mockResolvedValue({
      withdrawal: created('PROCESSING'),
      balance: { balance: 3000, reserved: 0, available: 3000 },
      replayed: false,
    });
    api.withdrawal.mockResolvedValue({ withdrawal: { ...created('FAILED'), failureCode: 'PROVIDER_FAILED' } });
    await open();
    await fill('2000');
    await fireEvent.press(continueButton());
    await fireEvent.press(await screen.findByLabelText('Confirmer le retrait de 2000 jetons'));
    expect(await screen.findByText('Retrait échoué')).toBeTruthy();
    expect(screen.getByText(/^2\s000 jetons ont été recrédités sur votre compte de jeu\.$/)).toBeTruthy();
  });
});

describe('Disponibilité annoncée par le serveur (D-077)', () => {
  it('mode test : bandeau visible, réussite relue marquée « test »', async () => {
    api.get.mockResolvedValue({ wallet: wallet({ withdrawalMode: 'sandbox' }) });
    api.withdrawals.mockResolvedValue({ withdrawals: [], policy: policy({ mode: 'sandbox' }) });
    api.withdraw.mockResolvedValue({
      withdrawal: created('PROCESSING'),
      balance: { balance: 3000, reserved: 0, available: 3000 },
      replayed: false,
    });
    api.withdrawal.mockResolvedValue({ withdrawal: created('SUCCEEDED') });
    await open();
    expect(screen.getByText('ENVIRONNEMENT DE TEST')).toBeTruthy();
    await fill('2000');
    await fireEvent.press(continueButton());
    await fireEvent.press(await screen.findByLabelText('Confirmer le retrait de 2000 jetons'));
    expect(await screen.findByText('Retrait effectué (test)')).toBeTruthy();
    expect(screen.queryByText('Retrait effectué')).toBeNull();
  });

  it('accepté mais non confirmé : jamais « effectué »', async () => {
    api.withdraw.mockResolvedValue({
      withdrawal: created('PROCESSING'),
      balance: { balance: 3000, reserved: 0, available: 3000 },
      replayed: false,
    });
    api.withdrawal.mockResolvedValue({ withdrawal: created('PROCESSING') });
    await open();
    await fill('2000');
    await fireEvent.press(continueButton());
    await fireEvent.press(await screen.findByLabelText('Confirmer le retrait de 2000 jetons'));
    expect(await screen.findByText('Transfert en cours')).toBeTruthy();
    expect(screen.queryByText(/Retrait effectué/)).toBeNull();
  });

  it('indisponible avec motif : message compréhensible, retrait bloqué', async () => {
    api.withdrawals.mockResolvedValue({
      withdrawals: [],
      policy: policy({ available: false, mode: 'unavailable', unavailableReason: 'TRANSFERS_DISABLED' }),
    });
    await open();
    expect(
      await screen.findByText(
        'Les retraits Mobile Money sont fermés pour le moment. Vos jetons restent disponibles pour jouer.',
      ),
    ).toBeTruthy();
    await fill('2000');
    expect(continueButton().props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByText('ENVIRONNEMENT DE TEST')).toBeNull();
  });
});

describe('Historique', () => {
  it('date, montant, opérateur, numéro masqué, référence et statut', async () => {
    api.withdrawals.mockResolvedValue({
      withdrawals: [created('SUCCEEDED'), { ...created('FAILED'), id: 'w2', reference: 'LWfailed' }],
      policy: policy(),
    });
    await open();
    await fireEvent.press(screen.getByText('Mes retraits'));
    expect(await screen.findByText('Retrait effectué')).toBeTruthy();
    expect(screen.getByText('Retrait échoué')).toBeTruthy();
    expect(screen.getByText('Réf. LW0123456789abcdef0123456789')).toBeTruthy();
    expect(screen.getAllByText(/MTN Mobile Money \+23\*\*\*\*\*\*\*271/)).toHaveLength(2);
  });
});
