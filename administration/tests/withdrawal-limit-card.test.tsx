import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WithdrawalLimitCard } from '@/features/withdrawals/withdrawal-limit-card';
import type { WithdrawalLimitSetting } from '@/types/admin';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (path: string, query?: unknown) => get(path, query),
    patch: (path: string, body: unknown) => patch(path, body),
    post: vi.fn(),
  },
  idempotencyKey: () => 'k',
}));

/** Valeurs par défaut renvoyées par le serveur : n = ∞, t = ∞. */
const UNLIMITED: WithdrawalLimitSetting = {
  count: null,
  periodMinutes: null,
  updatedAt: null,
  bounds: { maxCount: 1000, maxPeriodMinutes: 525_600 },
  countedStatuses: ['CREATED', 'PROCESSING', 'SUCCEEDED'],
};

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
});

describe('Limitation des retraits (administration)', () => {
  it('depuis ∞ : fixer n = 3 sur 24 heures, puis confirmer → PATCH envoyé', async () => {
    get.mockResolvedValue(UNLIMITED);
    patch.mockResolvedValue({ ...UNLIMITED, count: 3, periodMinutes: 1440, changed: true });
    wrap(<WithdrawalLimitCard />);

    const count = (await screen.findByLabelText(/Nombre maximal de retraits/)) as HTMLInputElement;
    const period = screen.getByLabelText(/Période \(t\)/) as HTMLInputElement;
    const [countUnlimited, periodUnlimited] = screen.getAllByRole('checkbox');
    fireEvent.click(countUnlimited!);
    fireEvent.click(periodUnlimited!);
    expect(count.disabled).toBe(false);
    expect(period.disabled).toBe(false);

    fireEvent.change(count, { target: { value: '3' } });
    fireEvent.change(period, { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer', hidden: false }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('settings/withdrawal-limit', {
        count: 3,
        periodMinutes: 1440,
      }),
    );
  });
});
