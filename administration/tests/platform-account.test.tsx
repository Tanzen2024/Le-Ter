import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlatformAccountView } from '@/features/finance/platform-account-view';
import type { LedgerEntry } from '@/types/admin';

const get = vi.fn();
const push = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (path: string, query?: unknown) => get(path, query) },
  idempotencyKey: () => 'k',
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push }),
  usePathname: () => '/compte-plateforme',
}));

const entry = (overrides: Partial<LedgerEntry>): LedgerEntry => ({
  id: 'e-1',
  kind: 'GAME_COMMISSION',
  source: 'FAP_FAP',
  amount: 4,
  currency: 'XAF',
  feeBps: 400,
  createdAt: '2026-10-10T10:00:00.000Z',
  origin: { type: 'GAME', id: 'g-1', name: 'Partie g-1' },
  participants: null,
  grossPool: null,
  ...overrides,
});

beforeEach(() => {
  get.mockReset();
  push.mockReset();
});

describe('compte de la plateforme : commission des parties (D-074)', () => {
  it('libellé « Commission de partie » ; une écriture de partie ouvre la partie, pas un tournoi', async () => {
    get.mockImplementation((path: string) =>
      path === 'platform-account/entries'
        ? Promise.resolve({
            page: 1,
            limit: 25,
            total: 2,
            items: [
              entry({}),
              entry({
                id: 'e-2',
                kind: 'TOURNAMENT_PLATFORM_FEE',
                origin: { type: 'TOURNAMENT', id: 't-1', name: 'Tournoi du soir' },
              }),
            ],
          })
        : new Promise(() => {}),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PlatformAccountView />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText('Partie g-1'));
    expect(push).toHaveBeenLastCalledWith('/parties/g-1');
    expect(screen.getAllByText('Commission de partie').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Tournoi du soir'));
    expect(push).toHaveBeenLastCalledWith('/tournois/t-1');
  });
});
