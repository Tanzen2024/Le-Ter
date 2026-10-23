import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Topbar } from '@/components/layout/topbar';
import type { Attention } from '@/types/admin';

const ATTENTION: Attention = {
  generatedAt: '2026-10-23T08:00:00.000Z',
  alerts: {
    newDetectionAlerts: 0,
    pendingTournamentApprovals: 0,
    stalePendingPayments: 0,
    overdueTurns: 0,
    pendingComplaints: 2,
  },
  reconciliationAnomalies: { total: 0, critical: 0 } as Attention['reconciliationAnomalies'],
};

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(async () => ATTENTION), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('@/features/attention/use-attention-stream', () => ({ useAttentionStream: () => undefined }));
vi.mock('@/hooks/use-session', () => ({
  useAdminSession: () => ({ data: undefined }),
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/tableau-de-bord',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe('cloche de l’administration', () => {
  it('compte les réclamations à traiter et mène à la rubrique Réclamations', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Topbar />
      </QueryClientProvider>,
    );
    const bell = await screen.findByRole('button', { name: 'Points d’attention : 2' });
    expect(bell).toHaveTextContent('2');

    fireEvent.keyDown(bell, { key: 'Enter' });
    const item = await screen.findByRole('menuitem', { name: /réclamations à traiter/ });
    expect(item).toHaveTextContent('2 réclamations à traiter');
    expect(item).toHaveAttribute('href', '/reclamations');
  });
});
