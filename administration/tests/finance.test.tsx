import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  depositsWithoutPayment,
  movementLines,
  movementTotals,
  paymentMatches,
  purchasesByStatus,
  purchasesTotal,
  revenueConsistent,
  unsafeAmounts,
} from '@/features/finance/finance-summary';
import { FinanceView } from '@/features/finance/finance-view';
import type { FinanceOverview, Reconciliation } from '@/types/admin';

const get = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (path: string, query?: unknown) => get(path, query) },
  idempotencyKey: () => 'k',
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/finances',
}));

/**
 * Données réelles observées le 2026-10-09 (base de développement) : 9 paiements CinetPay
 * échoués (7 500 FCFA) et 4 achats refusés AVANT CinetPay (3 × 690 040 149 jetons, un
 * numéro de téléphone saisi comme montant, + 1 000) que l'ancien panneau additionnait :
 * 2 070 128 947 jetons « d'achats échoués ».
 */
const overview = (overrides: Partial<FinanceOverview> = {}): FinanceOverview => ({
  period: { from: '2026-09-10T23:00:00.000Z', to: '2026-10-09T23:00:00.000Z' },
  currency: 'XAF',
  purchases: {
    label: 'Achats',
    byStatus: [
      { status: 'FAILED', count: 9, amount: 7_500 },
      { status: 'PENDING', count: 1, amount: 500 },
      { status: 'SUCCESS', count: 2, amount: 3_000 },
    ],
  },
  walletMovements: [
    { kind: 'deposit', status: 'failed', withoutPayment: false, count: 9, tokens: 7_500 },
    { kind: 'deposit', status: 'failed', withoutPayment: true, count: 4, tokens: 2_070_121_447 },
    { kind: 'deposit', status: 'pending', withoutPayment: false, count: 1, tokens: 500 },
    { kind: 'deposit', status: 'succeeded', withoutPayment: false, count: 2, tokens: 3_000 },
    {
      kind: 'tournament_entry',
      status: 'succeeded',
      withoutPayment: false,
      count: 3,
      tokens: 3_000,
    },
    {
      kind: 'tournament_prize',
      status: 'succeeded',
      withoutPayment: false,
      count: 1,
      tokens: 2_400,
    },
  ],
  reservations: [
    { status: 'ACTIVE', count: 2, amount: 2_000 },
    { status: 'CAPTURED', count: 3, amount: 3_000 },
  ],
  playerBalances: { label: 'Soldes', wallets: 12, balance: 1_500, reserved: 2_000 },
  platformRevenue: {
    label: 'Recettes',
    byKind: [
      { kind: 'TOURNAMENT_PLATFORM_FEE', count: 1, amount: 600 },
      { kind: 'UNALLOCATED_PRIZE', count: 1, amount: 100 },
    ],
    total: 700,
  },
  platformAccountBalance: 4_200,
  unsupported: [],
  ...overrides,
});

const reconciliation: Reconciliation = {
  generatedAt: '2026-10-09T22:00:00.000Z',
  summary: { total: 4, critical: 0, warning: 4, byType: { DEPOSIT_WITHOUT_PAYMENT: 4 } },
  checked: { tournaments: 0, paymentCandidates: 13, limitPerControl: 100 },
  thresholds: { stalePendingPaymentMinutes: 30 },
  guaranteedByDatabase: [],
  items: [
    {
      type: 'DEPOSIT_WITHOUT_PAYMENT',
      severity: 'WARNING',
      domain: 'PAYMENT',
      reference: {
        kind: 'WALLET_TRANSACTION',
        id: 'abcdef12-0000-0000-0000-000000000000',
        label: 'joueur',
      },
      date: '2026-10-08T13:42:17.077Z',
      amount: 690_040_149,
      currency: 'XAF',
      compared: [],
      explanation: '',
      state: 'OPEN',
    },
  ],
};

describe('synthèses des cartes de détail', () => {
  it('achats CinetPay : quatre statuts exclusifs, total = somme des statuts (aucun double compte)', () => {
    const rows = purchasesByStatus(overview());
    expect(rows.map((r) => r.status)).toEqual(['SUCCESS', 'PENDING', 'FAILED', 'EXPIRED']);
    expect(rows.find((r) => r.status === 'EXPIRED')).toEqual({
      status: 'EXPIRED',
      count: 0,
      amount: 0,
    });
    const total = purchasesTotal(overview());
    expect(total).toEqual({ count: 12, amount: 11_000 });
    expect(rows.reduce((t, r) => t + r.amount, 0)).toBe(total.amount);
  });

  it('statut inconnu renvoyé par l’API : affiché, jamais masqué', () => {
    const o = overview({
      purchases: { label: '', byStatus: [{ status: 'REFUNDED', count: 1, amount: 500 }] },
    });
    expect(purchasesByStatus(o).at(-1)).toEqual({ status: 'REFUNDED', count: 1, amount: 500 });
  });

  it('anomalie 2 070 128 947 : achats refusés avant CinetPay séparés des achats CinetPay échoués', () => {
    const o = overview();
    const failed = movementLines(o).filter((l) => l.group === 'failed');
    expect(failed).toEqual([
      { group: 'failed', label: 'Achats de jetons (CinetPay)', count: 9, tokens: 7_500 },
      {
        group: 'failed',
        label: 'Achats refusés avant CinetPay (aucun paiement)',
        count: 4,
        tokens: 2_070_121_447,
      },
    ]);
    // Échecs CinetPay = paiements FAILED/EXPIRED, ligne à ligne (1 FCFA = 1 jeton).
    expect(paymentMatches(o).find((m) => m.walletStatus === 'failed')).toMatchObject({
      payments: { count: 9, amount: 7_500 },
      deposits: { count: 9, tokens: 7_500 },
      matches: true,
    });
    expect(depositsWithoutPayment(o)).toEqual({ count: 4, tokens: 2_070_121_447 });
  });

  it('crédits et débits effectifs distincts des attentes, échecs et réservations', () => {
    const totals = movementTotals(overview());
    expect(totals.credit).toEqual({ count: 3, tokens: 5_400 });
    expect(totals.debit).toEqual({ count: 3, tokens: 3_000 });
    expect(totals.pending).toEqual({ count: 1, tokens: 500 });
    expect(totals.failed).toEqual({ count: 13, tokens: 2_070_128_947 });
    // Les réservations (ACTIVE 2 000, CAPTURED 3 000) ne s'ajoutent jamais aux débits.
    expect(totals.debit.tokens).not.toBe(3_000 + 2_000);
  });

  it('écart de statut paiement / achat : signalé, jamais corrigé', () => {
    const o = overview({
      purchases: { label: '', byStatus: [{ status: 'SUCCESS', count: 1, amount: 1_000 }] },
      walletMovements: [
        { kind: 'deposit', status: 'pending', withoutPayment: false, count: 1, tokens: 1_000 },
      ],
    });
    const matches = paymentMatches(o);
    expect(matches.find((m) => m.walletStatus === 'succeeded')?.matches).toBe(false);
    expect(matches.find((m) => m.walletStatus === 'pending')?.matches).toBe(false);
  });

  it('grands nombres : exacts jusqu’à 2^53 − 1, signalés au-delà', () => {
    expect(unsafeAmounts(overview())).toEqual([]);
    const huge = overview({ platformAccountBalance: 2 ** 53 + 2 });
    expect(unsafeAmounts(huge)).toEqual(['Solde comptable']);
  });

  it('recettes : total cohérent avec la somme des natures', () => {
    expect(revenueConsistent(overview())).toBe(true);
    const o = overview();
    expect(revenueConsistent({ ...o, platformRevenue: { ...o.platformRevenue, total: 701 } })).toBe(
      false,
    );
  });
});

describe('page Finances : 12 cartes', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (path: string) => {
      if (path === 'finance/overview') return overview();
      if (path === 'reconciliation/anomalies') return reconciliation;
      if (path === 'wallet-transactions') return { page: 1, limit: 25, total: 0, items: [] };
      throw new Error(`inattendu : ${path}`);
    });
  });

  async function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <FinanceView />
      </QueryClientProvider>,
    );
    const list = screen.getByRole('list', { name: 'Indicateurs financiers' });
    // Montant présent deux fois : mouvement (carte 10) et contrôle des achats sans paiement (12).
    await waitFor(() => expect(within(list).getAllByText('2 070 121 447 jetons')).toHaveLength(2));
    return list;
  }

  it('exactement 12 cartes : 8 indicateurs dans l’ordre, puis 4 cartes de détail', async () => {
    const list = await renderPage();
    const cards = within(list)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === list);
    expect(cards).toHaveLength(12);
    const titles = cards.map((c) => c.querySelector('p, h3')?.textContent);
    expect(titles).toEqual([
      'Achats confirmés (période)',
      'Soldes des joueurs',
      'Recettes de la plateforme (période)',
      'Solde comptable de la plateforme',
      'Paiements en attente (période)',
      'Paiements échoués ou expirés (période)',
      'Inscriptions de tournoi débitées (période)',
      'Gains de tournoi versés (période)',
      'Achats CinetPay par statut (période)',
      'Mouvements des comptes de jeu (période)',
      'Recettes par nature (période)',
      'Rapprochement financier et anomalies',
    ]);
    // Les anciens panneaux (sections Card) n'existent plus : aucune carte en double.
    expect(screen.getAllByText('Achats CinetPay par statut (période)')).toHaveLength(1);
    expect(
      screen.queryByRole('heading', { name: 'Achats CinetPay par statut', level: 2 }),
    ).toBeNull();
  });

  it('valeurs issues de finance/overview, FCFA et jetons distingués, lien « Voir le compte »', async () => {
    const list = await renderPage();
    const cards = within(list)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === list);
    const card = (i: number) => within(cards[i] as HTMLElement);
    expect(card(0).getByText('3 000 FCFA')).toBeInTheDocument();
    expect(card(1).getByText('1 500 jetons')).toBeInTheDocument();
    expect(card(2).getByText('700 FCFA')).toBeInTheDocument();
    expect(card(3).getByRole('link', { name: 'Voir le compte' })).toHaveAttribute(
      'href',
      '/compte-plateforme',
    );
    expect(card(5).getByText('9')).toBeInTheDocument();
    expect(card(5).getByText(/7 500 FCFA/)).toBeInTheDocument();
    expect(card(6).getByText('3 000 jetons')).toBeInTheDocument();
    expect(card(7).getByText('2 400 jetons')).toBeInTheDocument();
    // Carte 10 : l'échec CinetPay (7 500 jetons) et les refus avant CinetPay sur deux lignes.
    expect(card(9).getByText('Achats refusés avant CinetPay (aucun paiement)')).toBeInTheDocument();
    expect(card(9).getByText('Réservées (non débitées)')).toBeInTheDocument();
    // Carte 12 : anomalies du rapprochement, montant d'un achat sans paiement en jetons.
    await waitFor(() => expect(card(11).getByText('4 anomalies')).toBeInTheDocument());
    expect(card(11).getByText('690 040 149 jetons')).toBeInTheDocument();
    expect(card(11).getByRole('link', { name: 'Ouvrir le rapprochement complet' })).toHaveAttribute(
      'href',
      '/rapprochement',
    );
  });

  it('mise en page : 1 colonne (mobile), 2 (tablette), 4 (bureau), selon la zone de contenu', async () => {
    const list = await renderPage();
    expect(list.className).toContain('grid-cols-1');
    expect(list.className).toContain('@xl:grid-cols-2');
    expect(list.className).toContain('@4xl:grid-cols-4');
    expect(list.parentElement?.className).toContain('@container');
    // Listes longues : zones défilantes atteignables au clavier.
    for (const region of screen.getAllByRole('region')) {
      expect(region).toHaveAttribute('tabindex', '0');
    }
  });
});
