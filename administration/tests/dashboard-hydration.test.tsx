import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatCard } from '@/components/data/stat-card';
import { attentionQuery } from '@/features/attention/api';
import { dashboardQuery } from '@/features/dashboard/api';
import { DashboardView } from '@/features/dashboard/dashboard-view';
import { ApiError } from '@/lib/api/errors';
import type { Dashboard } from '@/types/admin';

const get = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (path: string, query?: unknown) => get(path, query), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/tableau-de-bord',
}));

const DASHBOARD: Dashboard = {
  period: {
    from: '2026-09-12T23:00:00.000Z',
    to: '2026-10-11T23:00:00.000Z',
    timezone: 'Africa/Douala',
  },
  generatedAt: '2026-10-11T10:00:00.000Z',
  definitions: { activePlayer: 'Définition.', platformRevenue: 'Définition.' },
  players: { total: 2, newInPeriod: 1, active: 1, admins: 1 },
  games: {
    waiting: 0,
    inProgress: 0,
    createdInPeriod: 3,
    finishedInPeriod: 3,
    byStatusInPeriod: [],
  },
  tournaments: [],
  payments: [],
  platformRevenue: 0,
  alerts: {
    newDetectionAlerts: 0,
    pendingTournamentApprovals: 0,
    stalePendingPayments: 0,
    overdueTurns: 0,
  },
  reconciliationAnomalies: { total: 0, critical: 0 } as Dashboard['reconciliationAnomalies'],
  series: [],
  recentAdminActivity: [],
};

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

/** HTML du serveur : aucune requête n'y est exécutée, le cache est vide. */
function serverHtml(): string {
  return renderToString(
    <QueryClientProvider client={client()}>
      <DashboardView />
    </QueryClientProvider>,
  );
}

const containers: HTMLElement[] = [];
const roots: { unmount(): void }[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  containers.splice(0).forEach((c) => c.remove());
  get.mockReset();
});

/**
 * Hydrate le HTML serveur avec un cache client donné. Reproduit le cas réel : la `Topbar`
 * (hors du `<Suspense>` de la page, donc hydratée avant elle) a déjà lancé et résolu
 * `dashboardQuery()` quand le segment de la page s'hydrate.
 */
async function hydrate(html: string, queryClient: QueryClient) {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  containers.push(container);
  const recoverable: unknown[] = [];
  await act(async () => {
    roots.push(
      hydrateRoot(
        container,
        <QueryClientProvider client={queryClient}>
          <DashboardView />
        </QueryClientProvider>,
        { onRecoverableError: (error) => recoverable.push(error) },
      ),
    );
  });
  return { container, recoverable };
}

describe('Tableau de bord : hydratation', () => {
  it('cache déjà rempli avant l’hydratation : aucune différence avec le HTML serveur', async () => {
    const html = serverHtml();
    expect(html).toContain('animate-pulse');
    expect(html).not.toContain('>2</p>');

    const queryClient = client();
    queryClient.setQueryData(dashboardQuery().queryKey, DASHBOARD);
    // Points d'attention (D-116), déjà lus par la Topbar comme le tableau de bord.
    queryClient.setQueryData(attentionQuery().queryKey, {
      generatedAt: DASHBOARD.generatedAt,
      alerts: DASHBOARD.alerts,
      reconciliationAnomalies: DASHBOARD.reconciliationAnomalies,
    });
    const { recoverable } = await hydrate(html, queryClient);

    expect(recoverable).toEqual([]);
    // Juste après l'hydratation, les vraies valeurs remplacent le squelette.
    await waitFor(() =>
      expect(screen.getByText('Joueurs inscrits').parentElement?.parentElement).toHaveTextContent(
        '2',
      ),
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('cache vide : squelette pendant le chargement, puis valeurs réelles', async () => {
    let resolve: (value: Dashboard) => void = () => undefined;
    get.mockReturnValue(new Promise<Dashboard>((r) => (resolve = r)));
    const { container, recoverable } = await hydrate(serverHtml(), client());

    expect(recoverable).toEqual([]);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(get).toHaveBeenCalledWith(
      'dashboard',
      expect.objectContaining({ from: expect.any(String) }),
    );
    await act(async () => resolve(DASHBOARD));
    await waitFor(() => expect(screen.getByText('3 créées sur la période')).toBeInTheDocument());
  });

  it('erreur déjà en cache avant l’hydratation : même HTML, puis message d’erreur', async () => {
    const html = serverHtml();
    const queryClient = client();
    get.mockRejectedValue(new ApiError(503, 'ADMIN_UNAVAILABLE', 'Service indisponible.'));
    await queryClient.prefetchQuery(dashboardQuery());
    expect(queryClient.getQueryState(dashboardQuery().queryKey)?.status).toBe('error');

    const { recoverable } = await hydrate(html, queryClient);
    expect(recoverable).toEqual([]);
    await waitFor(() => expect(screen.getByText('Service indisponible.')).toBeInTheDocument());
  });
});

describe('StatCard', () => {
  it('squelette pendant le chargement, valeur ensuite ; jamais de valeur fictive', () => {
    const html = renderToString(<StatCard label="Joueurs" value="—" loading />);
    expect(html).toContain('animate-pulse');
    expect(html).not.toContain('—');
    const loaded = renderToString(<StatCard label="Joueurs" value="2" />);
    expect(loaded).toContain('>2</p>');
  });
});
