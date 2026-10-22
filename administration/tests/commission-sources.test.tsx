import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SourceBreakdown, sharesPerMille } from '@/components/charts/source-breakdown';
import { DashboardView } from '@/features/dashboard/dashboard-view';
import { PlatformAccountView } from '@/features/finance/platform-account-view';
import { rangeOf } from '@/features/shared/period-range';
import type { Dashboard, LedgerEntry, SourceAmount } from '@/types/admin';

/**
 * Recettes de la caisse UNIQUE par origine (D-120) : répartition Fap-Fap / Tournois / Garam Tia
 * cohérente avec le total, caisse distincte des commissions de la période, filtres combinés
 * (source, période, recherche) transmis au serveur.
 */
const get = vi.fn();
let search = new URLSearchParams();
vi.mock('@/lib/api/client', () => ({
  api: { get: (path: string, query?: unknown) => get(path, query), post: vi.fn(), patch: vi.fn() },
  idempotencyKey: () => 'k',
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => search,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/hooks/use-hydrated', () => ({ useHydrated: () => true }));

const BY_SOURCE: SourceAmount[] = [
  { source: 'FAP_FAP', count: 10, amount: 25_000 },
  { source: 'TOURNAMENT', count: 3, amount: 18_500 },
  { source: 'GARAM_TIA', count: 7, amount: 12_300 },
];

function wrap(children: ReactNode) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  get.mockReset();
  search = new URLSearchParams();
});

describe('répartition par source', () => {
  it('parts : la somme fait toujours exactement 100,0 %', () => {
    expect(sharesPerMille([25_000, 18_500, 12_300])).toEqual([448, 332, 220]);
    expect(sharesPerMille([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(sharesPerMille([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('montants, parts et total ; total = Fap-Fap + Tournois + Garam Tia', () => {
    render(<SourceBreakdown bySource={BY_SOURCE} />);
    const table = screen.getByRole('table');
    const row = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement;
    expect(within(row('Fap-Fap')).getByText('44,8 %')).toBeTruthy();
    expect(within(row('Tournois')).getByText('33,2 %')).toBeTruthy();
    expect(within(row('Garam Tia')).getByText('22,0 %')).toBeTruthy();
    expect(within(row('Total')).getByText(/55\s800/)).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Garam Tia 22,0 %');
  });

  it('aucune recette : état vide, aucune part inventée', () => {
    render(<SourceBreakdown bySource={BY_SOURCE.map((s) => ({ ...s, amount: 0, count: 0 }))} />);
    expect(screen.getByText('Aucune recette sur la période')).toBeTruthy();
  });
});

describe('périodes', () => {
  const now = new Date('2026-10-20T10:00:00Z');
  it('aujourd’hui, 7 jours, 30 jours, personnalisée (jours locaux, bornes incluses)', () => {
    expect(rangeOf('today', '', '', now)).toEqual({
      from: '2026-10-19T23:00:00.000Z',
      to: '2026-10-20T23:00:00.000Z',
    });
    expect(rangeOf('7', '', '', now)?.from).toBe('2026-10-13T23:00:00.000Z');
    expect(rangeOf('30', '', '', now)?.from).toBe('2026-09-20T23:00:00.000Z');
    expect(rangeOf('custom', '2026-10-01', '2026-10-05', now)).toEqual({
      from: '2026-09-30T23:00:00.000Z',
      to: '2026-10-05T23:00:00.000Z',
    });
    expect(rangeOf('custom', '2026-10-01', '', now)).toBeUndefined();
  });
});

const DASHBOARD = {
  period: { from: '2026-09-20T23:00:00.000Z', to: '2026-10-20T23:00:00.000Z', timezone: 'Africa/Douala' },
  generatedAt: '2026-10-20T10:00:00.000Z',
  definitions: { activePlayer: 'Définition.', platformRevenue: 'Définition.' },
  players: { total: 2, newInPeriod: 1, active: 1, admins: 1 },
  games: { waiting: 0, inProgress: 0, createdInPeriod: 0, finishedInPeriod: 0, byStatusInPeriod: [] },
  tournaments: [],
  payments: [],
  platformRevenue: 55_800,
  commissions: { total: 55_800, entries: 20, bySource: BY_SOURCE },
  platformAccountBalance: 91_000,
  alerts: { newDetectionAlerts: 0, pendingTournamentApprovals: 0, stalePendingPayments: 0, overdueTurns: 0 },
  reconciliationAnomalies: { total: 0, critical: 0, byType: [] },
  series: [],
  recentAdminActivity: [],
} as unknown as Dashboard;

describe('tableau de bord : caisse unique et commissions par source', () => {
  it('caisse globale distincte des commissions de la période ; une carte par source', async () => {
    get.mockImplementation((path: string) =>
      path === 'dashboard' ? Promise.resolve(DASHBOARD) : new Promise(() => {}),
    );
    render(wrap(<DashboardView />));
    expect(await screen.findByText('Caisse plateforme')).toBeTruthy();
    // Solde de la caisse UNIQUE (tout l'historique), distinct des commissions de la période.
    expect(await screen.findByText(/91\s000/)).toBeTruthy();
    expect(screen.getByText('Commissions sur la période')).toBeTruthy();
    expect(screen.getAllByText(/55\s800/).length).toBeGreaterThan(0);
    expect(screen.getByText('Répartition des commissions par source')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('dashboard', expect.not.objectContaining({ source: expect.anything() }));
  });

  it('source + période personnalisée : envoyées ensemble au serveur', async () => {
    search = new URLSearchParams('source=GARAM_TIA&periode=custom&du=2026-10-01&au=2026-10-05');
    get.mockImplementation((path: string) =>
      path === 'dashboard'
        ? Promise.resolve({
            ...DASHBOARD,
            commissions: {
              source: 'GARAM_TIA',
              total: 12_300,
              entries: 7,
              bySource: BY_SOURCE.map((s) =>
                s.source === 'GARAM_TIA' ? s : { ...s, amount: 0, count: 0 },
              ),
            },
          })
        : new Promise(() => {}),
    );
    render(wrap(<DashboardView />));
    expect(await screen.findByText('Commissions Garam Tia sur la période')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('dashboard', {
      from: '2026-09-30T23:00:00.000Z',
      to: '2026-10-05T23:00:00.000Z',
      source: 'GARAM_TIA',
    });
  });
});

const entry = (overrides: Partial<LedgerEntry>): LedgerEntry => ({
  id: 'e-1',
  kind: 'GAME_COMMISSION',
  source: 'GARAM_TIA',
  amount: 750,
  currency: 'XAF',
  feeBps: 100,
  createdAt: '2026-10-20T10:00:00.000Z',
  origin: { type: 'GAME', id: 'g-1', name: 'Manche GARAM TIA g-1', sessionId: 's-1' },
  participants: 2,
  grossPool: 750,
  ...overrides,
});

describe('compte financier : source visible et filtres combinés', () => {
  it('la colonne Source nomme l’origine ; source + période + recherche transmises au serveur', async () => {
    search = new URLSearchParams('source=GARAM_TIA&periode=today&q=g-1');
    get.mockImplementation((path: string) =>
      path === 'platform-account/entries'
        ? Promise.resolve({ page: 1, limit: 25, total: 1, items: [entry({})] })
        : new Promise(() => {}),
    );
    render(wrap(<PlatformAccountView />));
    expect(await screen.findByText('Manche GARAM TIA g-1')).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Garam Tia')).toBeTruthy();
    const query = get.mock.calls.find(([p]) => p === 'platform-account/entries')?.[1];
    expect(query).toMatchObject({ source: 'GARAM_TIA', q: 'g-1', limit: 25 });
    expect(query.from).toBeDefined();
    expect(query.to).toBeDefined();
  });
});
