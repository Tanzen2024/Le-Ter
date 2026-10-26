/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { ApiError } from '../../lib/api-client';
import { walletApi } from '../../services/wallet-api';
import { useAuthStore } from '../../stores/auth-store';
import type { WalletView, WithdrawalPolicy, WithdrawalView } from '../../types/wallet';
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
  // Opérateur déduit PAR LE SERVEUR du numéro d'inscription (jamais choisi par le joueur).
  paymentOperator: 'MTN_CM',
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
      <ShopFlow onClose={jest.fn()} />
    </QueryClientProvider>,
  );
  // « Retirer » choisi dans le panneau unique « Mes jetons » (ouvert par +L).
  const withdraw = await screen.findByLabelText('Retirer des jetons vers Mobile Money');
  await waitFor(() => expect(withdraw.props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(withdraw);
  await screen.findByLabelText('Nombre de jetons à retirer');
}

async function fill(tokens: string) {
  await fireEvent.changeText(screen.getByLabelText('Nombre de jetons à retirer'), tokens);
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

  it('solde disponible insuffisant refusé', async () => {
    await open();
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
    // Un seul message pour cet état (le décompte du quota n'est plus répété).
    expect(screen.queryByText(/retrait restant/)).toBeNull();
    expect(continueButton().props.accessibilityState.disabled).toBe(true);
  });
});

describe('Confirmation et envoi', () => {
  it('confirmation sur place sans frais ni montant net, puis référence et statut du serveur', async () => {
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
    expect(screen.getAllByTestId('token-sheet')).toHaveLength(1);
    // Une seule ligne de récapitulatif, sans répétition ni note descriptive.
    expect(
      screen.getByText(/^2\s000 jetons vers MTN Mobile Money \+23\*{7}271$/),
    ).toBeTruthy();
    expect(screen.getAllByText(/MTN Mobile Money/)).toHaveLength(1);
    expect(screen.queryByText(/réservés dès la confirmation/)).toBeNull();
    // Ni frais, ni montant envoyé, ni solde après retrait : aucune ventilation financière.
    expect(screen.queryByText(/frais|net|commission|Montant envoyé|après le retrait/i)).toBeNull();
    expect(screen.queryByText(/FCFA/)).toBeNull();
    expect(screen.queryByText('Aucun')).toBeNull();
    expect(api.withdraw).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Confirmer le retrait de 2000 jetons'));
    expect(await screen.findByText('Transfert en cours')).toBeTruthy();
    expect(screen.getByText('Référence : LW0123456789abcdef0123456789')).toBeTruthy();
    // Un seul message d'état : ni récapitulatif répété, ni second message « en cours ».
    expect(screen.queryByText(/→/)).toBeNull();
    expect(screen.queryByText('Confirmer le retrait')).toBeNull();
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
    // Erreur réseau : aucun message (D-168) ; « Réessayer » reprend la MÊME clé.
    expect(await screen.findByText('Réessayer')).toBeTruthy();
    expect(screen.queryByText(/Connexion impossible/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Confirmer le retrait de 2000 jetons'));
    expect(await screen.findByText('Transfert en cours')).toBeTruthy();
    expect(api.withdraw.mock.calls.map((c) => c[2])).toEqual(['withdrawal-key-1', 'withdrawal-key-1']);
  });

  it.each([
    ['WITHDRAWAL_LIMIT_REACHED', 429, /nombre maximal de retraits/],
    ['INSUFFICIENT_BALANCE', 409, /Solde disponible insuffisant/],
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

/**
 * Règle commune (achat et retrait) : le numéro d'inscription UNIQUEMENT, opérateur déduit par
 * le serveur ; aucun choix d'opérateur, aucun autre numéro saisissable.
 */
describe('Numéro d’inscription uniquement', () => {
  it('opérateur déduit du compte : aucun sélecteur, un seul champ (le montant), envoi de cet opérateur', async () => {
    api.withdraw.mockResolvedValue({
      withdrawal: created(),
      balance: { balance: 3000, reserved: 0, available: 3000 },
      replayed: false,
    });
    api.withdrawal.mockResolvedValue({ withdrawal: created() });
    await open();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByText('Orange Money')).toBeNull();
    // Un seul champ : le montant. Aucun numéro ne peut être saisi.
    expect(screen.getAllByPlaceholderText('0')).toHaveLength(1);
    expect(screen.queryByLabelText(/numéro|téléphone/i)).toBeNull();
    expect(screen.getByText('Retirer vers MTN Mobile Money')).toBeTruthy();
    await fill('2000');
    await fireEvent.press(continueButton());
    await fireEvent.press(await screen.findByLabelText('Confirmer le retrait de 2000 jetons'));
    await waitFor(() =>
      expect(api.withdraw).toHaveBeenCalledWith(
        'jeton',
        { tokens: 2000, operator: 'MTN_CM' },
        'withdrawal-key-1',
      ),
    );
  });

  it('compte Orange : « Retirer vers Orange Money », opérateur OM_CM envoyé', async () => {
    api.get.mockResolvedValue({ wallet: wallet({ paymentOperator: 'OM_CM' }) });
    api.withdraw.mockResolvedValue({
      withdrawal: { ...created(), operator: 'OM_CM', operatorLabel: 'Orange Money' },
      balance: { balance: 3000, reserved: 0, available: 3000 },
      replayed: false,
    });
    api.withdrawal.mockResolvedValue({ withdrawal: created() });
    await open();
    expect(await screen.findByText('Retirer vers Orange Money')).toBeTruthy();
    await fill('2000');
    await fireEvent.press(continueButton());
    await fireEvent.press(await screen.findByLabelText('Confirmer le retrait de 2000 jetons'));
    await waitFor(() =>
      expect(api.withdraw.mock.calls[0][1]).toEqual({ tokens: 2000, operator: 'OM_CM' }),
    );
  });

  it.each([
    ['numéro sans opérateur pris en charge', { paymentOperator: null }, {}],
    ['numéro refusé par la politique de retrait', {}, { msisdnSupported: false }],
    [
      'opérateur du compte hors des opérateurs de retrait',
      { paymentOperator: 'OM_CM' as const },
      { operators: [{ code: 'MTN_CM' as const, label: 'MTN Mobile Money' }] },
    ],
  ])('%s : aucun bouton, saisie bloquée, message de régularisation', async (_l, account, rules) => {
    api.get.mockResolvedValue({ wallet: wallet(account) });
    api.withdrawals.mockResolvedValue({ withdrawals: [], policy: policy(rules) });
    await open();
    expect(await screen.findByText(/aucun retrait n’est possible/)).toBeTruthy();
    expect(screen.getByText(/Contactez l’assistance/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Continuer le retrait/)).toBeNull();
    expect(screen.getByLabelText('Nombre de jetons à retirer').props.editable).toBe(false);
    expect(api.withdraw).not.toHaveBeenCalled();
  });
});

describe('Retour Android', () => {
  it('confirmation → saisie (montant conservé) → fermeture du panneau', async () => {
    type Handler = Parameters<typeof BackHandler.addEventListener>[1];
    const handlers: Handler[] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, handler) => {
      handlers.push(handler);
      return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    clients.push(client);
    const onClose = jest.fn();
    await render(
      <QueryClientProvider client={client}>
        <ShopFlow onClose={onClose} />
      </QueryClientProvider>,
    );
    const withdraw = await screen.findByLabelText('Retirer des jetons vers Mobile Money');
    await waitFor(() => expect(withdraw.props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(withdraw);
    await screen.findByLabelText('Nombre de jetons à retirer');
    await fill('2000');
    await fireEvent.press(continueButton());
    expect(await screen.findByRole('header', { name: 'Confirmer le retrait' })).toBeTruthy();

    const pressBack = () =>
      act(() => void handlers[handlers.length - 1]({} as Parameters<Handler>[0]));
    await pressBack();
    expect(screen.queryByRole('header', { name: 'Confirmer le retrait' })).toBeNull();
    expect(screen.getByLabelText('Nombre de jetons à retirer').props.value).toMatch(/^2\s000$/);
    expect(onClose).not.toHaveBeenCalled();
    await pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.withdraw).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
