import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PayoutDetailView } from '@/features/platform-payouts/payout-detail';
import { PlatformPayoutsView } from '@/features/platform-payouts/platform-payouts-view';
import { ApiError } from '@/lib/api/errors';
import type {
  PayoutBeneficiary,
  PlatformFinanceOverview,
  PlatformPayoutDetail,
  PlatformPayoutRow,
} from '@/types/admin';

const get = vi.fn();
const post = vi.fn();
const push = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (path: string, query?: unknown) => get(path, query),
    post: (path: string, body?: unknown, headers?: unknown) => post(path, body, headers),
  },
  idempotencyKey: (prefix: string) => `${prefix}-key`,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push }),
  usePathname: () => '/retraits-plateforme',
}));

/** Retraits des revenus de la plateforme (D-078) : affichage fidèle des données du serveur. */
const overview = (over: Partial<PlatformFinanceOverview> = {}): PlatformFinanceOverview => ({
  currency: 'XAF',
  generatedAt: '2026-10-11T10:00:00.000Z',
  revenue: {
    validatedRevenue: 100_000,
    charges: { playerTransferFees: 1_500, executedPayouts: 0, executedPayoutFees: 0 },
    reserved: 0,
    distributable: 98_500,
    rawDistributable: 98_500,
    lastUpdatedAt: null,
    anomalies: ['COLLECTION_FEES_NOT_RECORDED'],
  },
  treasury: {
    state: 'UNKNOWN',
    lastObservation: null,
    lastValidObservation: null,
    confirmedAvailable: null,
    obligations: {
      walletBalances: 300_000,
      openWithdrawals: 0,
      tournamentFundsHeld: 0,
      total: 300_000,
    },
    reservedPayouts: 0,
    free: null,
    rawFree: null,
    freshUntil: null,
    anomalies: ['TREASURY_UNKNOWN'],
    providerConfigured: true,
  },
  fees: { configured: true, bps: 100, fixed: 0, estimateForWithdrawable: null },
  withdrawable: { amount: null, ceiling: null, blockers: ['TREASURY_NOT_CONFIRMED'] },
  execution: { enabled: false, reason: 'PLATFORM_PAYOUTS_DISABLED', mode: 'disabled' },
  reconciliationRequired: 0,
  ...over,
});

const beneficiary: PayoutBeneficiary = {
  id: 'b-1',
  label: 'Compte MTN Le Ter',
  operator: 'MTN_CM',
  msisdn: '+2376** *** *56',
  status: 'ACTIVE',
  createdBy: { id: 'a', username: 'alice' },
  createdAt: '2026-10-10T10:00:00.000Z',
  verifiedBy: { id: 'b', username: 'bruno' },
  verifiedAt: '2026-10-10T11:00:00.000Z',
  verificationNote: 'Appel MTN',
  disabledAt: null,
};

const row = (over: Partial<PlatformPayoutRow> = {}): PlatformPayoutRow => ({
  id: 'p-1',
  reference: 'LP0123456789abcdef0123456789',
  providerReference: null,
  beneficiary: { id: 'b-1', label: 'Compte MTN Le Ter', msisdn: '+2376** *** *56' },
  operator: 'MTN_CM',
  amount: 25_000,
  currency: 'XAF',
  estimatedFee: 250,
  finalAmount: null,
  finalFee: null,
  purpose: 'Versement mensuel',
  status: 'PENDING_APPROVAL',
  providerStatus: null,
  initiatedBy: { id: 'a', username: 'alice' },
  approvedBy: null,
  releasedBy: null,
  decidedBy: null,
  decisionNote: null,
  lastErrorCode: null,
  lastErrorAt: null,
  reconciliationResult: null,
  submissionAttempts: 0,
  notFoundChecks: 0,
  lastCheckedAt: null,
  createdAt: '2026-10-11T09:00:00.000Z',
  approvedAt: null,
  releasedAt: null,
  updatedAt: '2026-10-11T09:00:00.000Z',
  completedAt: null,
  ...over,
});

function wrap(ui: ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
}

function serve(o: PlatformFinanceOverview, rows: PlatformPayoutRow[] = []) {
  get.mockImplementation((path: string) => {
    if (path === 'platform-finance') return Promise.resolve(o);
    if (path === 'platform-finance/beneficiaries')
      return Promise.resolve({ beneficiaries: [beneficiary] });
    if (path === 'platform-finance/payouts')
      return Promise.resolve({ page: 1, limit: 25, total: rows.length, items: rows });
    return new Promise(() => {});
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  push.mockReset();
});

describe('indicateurs', () => {
  it('trésorerie inconnue : « Non confirmée » et « Bloqué », jamais 0 FCFA ; exécution désactivée expliquée', async () => {
    serve(overview());
    wrap(<PlatformPayoutsView />);
    expect(await screen.findByText('Revenus comptables validés')).toBeInTheDocument();
    expect(screen.getAllByText('Non confirmée').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Bloqué')).toBeInTheDocument();
    expect(
      screen.getAllByText(/Trésorerie non confirmée : relisez le solde CinetPay/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Exécution des transferts désactivée/)).toBeInTheDocument();
    const treasuryCard = screen
      .getByText('Trésorerie CinetPay confirmée')
      .closest('div')!.parentElement!;
    expect(treasuryCard).not.toHaveTextContent(/0\sFCFA/);
    expect(screen.getByRole('button', { name: 'Créer la demande' })).toBeDisabled();
  });

  it('trésorerie confirmée : montants du serveur, frais, anomalies', async () => {
    serve(
      overview({
        treasury: {
          ...overview().treasury,
          state: 'CONFIRMED',
          confirmedAvailable: 500_000,
          free: 200_000,
          rawFree: 200_000,
          anomalies: [],
          lastObservation: {
            id: 'o',
            source: 'CINETPAY_API',
            environment: 'test',
            status: 'VALID',
            availableAmount: 500_000,
            currency: 'XAF',
            observedAt: '2026-10-11T09:58:00.000Z',
          },
        },
        withdrawable: { amount: 97_524, ceiling: 98_500, blockers: [] },
        fees: { configured: true, bps: 100, fixed: 0, estimateForWithdrawable: 976 },
      }),
    );
    wrap(<PlatformPayoutsView />);
    expect(await screen.findByText(/500\s000\sFCFA/)).toBeInTheDocument();
    expect(screen.getAllByText(/97\s524\sFCFA/).length).toBeGreaterThan(0);
    expect(screen.getByText(/976\sFCFA/)).toBeInTheDocument();
    expect(
      screen.getByText(/Frais de collecte CinetPay des achats non enregistrés/),
    ).toBeInTheDocument();
    await screen.findByRole('option', { name: /Compte MTN Le Ter/ });
    expect(screen.getByRole('button', { name: 'Créer la demande' })).toBeEnabled();
  });

  it('chargement puis erreur explicites', async () => {
    get.mockImplementation((path: string) =>
      path === 'platform-finance'
        ? Promise.reject(
            new ApiError(503, 'ADMIN_UNAVAILABLE', 'L’administration n’est pas disponible.'),
          )
        : new Promise(() => {}),
    );
    wrap(<PlatformPayoutsView />);
    expect(screen.getAllByLabelText('Chargement').length).toBeGreaterThan(0);
    expect(await screen.findByText('L’administration n’est pas disponible.')).toBeInTheDocument();
  });
});

describe('demandes', () => {
  it('liste : montants, frais estimés / définitifs, bénéficiaire masqué, statut, anomalie', async () => {
    serve(overview(), [
      row(),
      row({
        id: 'p-2',
        status: 'RECONCILIATION_REQUIRED',
        reconciliationResult: 'NOT_FOUND_UNPROVEN',
        providerReference: 'cp-42',
        finalFee: 260,
        approvedBy: { id: 'b', username: 'bruno' },
      }),
    ]);
    wrap(<PlatformPayoutsView />);
    const table = await screen.findByRole('table', { name: 'Retraits de la plateforme' });
    expect(await within(table).findByText('En attente d’approbation')).toBeInTheDocument();
    expect(within(table).getByText('Rapprochement requis')).toBeInTheDocument();
    expect(within(table).getByText(/NOT_FOUND_UNPROVEN/)).toBeInTheDocument();
    expect(within(table).getByText(/CinetPay : cp-42/)).toBeInTheDocument();
    expect(within(table).getByText(/250\sFCFA \/ 260\sFCFA/)).toBeInTheDocument();
    expect(within(table).getByText('alice / bruno')).toBeInTheDocument();
    expect(table).not.toHaveTextContent(/\+237\d{9}/);
    fireEvent.click(within(table).getAllByRole('row')[1]!);
    expect(push).toHaveBeenCalledWith('/retraits-plateforme/p-1');
  });

  it('création : nombre entier, clé d’idempotence, aucun statut ni frais envoyés', async () => {
    serve(overview({ withdrawable: { amount: 50_000, ceiling: 50_500, blockers: [] } }));
    post.mockResolvedValue({ payout: row(), replayed: false });
    wrap(<PlatformPayoutsView />);
    await screen.findByRole('option', { name: /Compte MTN Le Ter/ });
    fireEvent.change(screen.getByLabelText('Bénéficiaire vérifié'), { target: { value: 'b-1' } });
    fireEvent.change(screen.getByLabelText('Montant (FCFA)'), { target: { value: '25000' } });
    fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'Versement mensuel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la demande' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      'platform-finance/payouts',
      { beneficiaryId: 'b-1', amount: 25_000, purpose: 'Versement mensuel' },
      { 'idempotency-key': 'platform-payout-key' },
    );
    expect(await screen.findByText(/un autre administrateur doit l’approuver/)).toBeInTheDocument();
  });
});

const detail = (over: Partial<PlatformPayoutDetail> = {}): PlatformPayoutDetail => ({
  ...row(),
  actions: {
    approve: { allowed: false, reason: 'SAME_ADMIN' },
    reject: { allowed: false, reason: 'SAME_ADMIN' },
    cancel: { allowed: true, reason: null },
    release: { allowed: false, reason: 'PLATFORM_PAYOUTS_DISABLED' },
    check: { allowed: false, reason: null },
  },
  events: [
    {
      id: 'e1',
      event: 'CREATED',
      fromStatus: null,
      toStatus: 'PENDING_APPROVAL',
      actor: { id: 'a', username: 'alice' },
      details: { amount: 25_000 },
      createdAt: '2026-10-11T09:00:00.000Z',
    },
  ],
  ...over,
});

describe('détail et droits', () => {
  it('actions refusées par le serveur : boutons désactivés avec leur motif ; historique', async () => {
    get.mockResolvedValue({ payout: detail() });
    wrap(<PayoutDetailView id="p-1" />);
    expect(await screen.findByRole('button', { name: 'Approuver' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rejeter' })).toBeDisabled();
    expect(screen.getAllByText(/Un autre administrateur doit décider/).length).toBe(2);
    expect(screen.getByRole('button', { name: 'Mettre en exécution' })).toBeDisabled();
    expect(screen.getByText(/Exécution désactivée sur ce serveur/)).toBeInTheDocument();
    expect(screen.getByText('Demande créée')).toBeInTheDocument();
    expect(screen.getByText('Non confirmé')).toBeInTheDocument(); // montant définitif
  });

  it('approbation par un autre administrateur : appel serveur, statut rafraîchi', async () => {
    get.mockResolvedValue({
      payout: detail({
        actions: { ...detail().actions, approve: { allowed: true, reason: null } },
      }),
    });
    post.mockResolvedValue({ id: 'p-1', status: 'RESERVED' });
    wrap(<PayoutDetailView id="p-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approuver' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approuver' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('platform-finance/payouts/p-1/approve', {}, undefined),
    );
    expect(await screen.findByText(/Approuvée · fonds réservés/)).toBeInTheDocument();
  });

  it('annulation : motif obligatoire vérifié avant tout appel ; refus serveur affiché', async () => {
    get.mockResolvedValue({ payout: detail() });
    post.mockRejectedValue(
      new ApiError(
        403,
        'PLATFORM_PAYOUT_REFUSED',
        'Un autre administrateur doit prendre cette décision (séparation des responsabilités).',
      ),
    );
    wrap(<PayoutDetailView id="p-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler la demande' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler la demande' }));
    expect(await within(dialog).findByText(/Motif : 5 caractères minimum/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Motif'), {
      target: { value: 'Budget reporté' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler la demande' }));
    expect(await within(dialog).findByText(/séparation des responsabilités/)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(
      'platform-finance/payouts/p-1/cancel',
      { note: 'Budget reporté' },
      undefined,
    );
  });
});
