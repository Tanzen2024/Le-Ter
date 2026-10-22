import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { gameColumns } from '@/features/games/columns';
import { PlayerDetailView } from '@/features/players/player-detail';
import type { GameRow, PlayerDetail } from '@/types/admin';

/**
 * Fap-Fap et Garam Tia sont deux jeux indépendants (D-126) : la fiche joueur ne mélange pas
 * leurs victoires, la liste des parties affiche le jeu de chaque partie.
 */
const get = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (path: string, query?: unknown) => get(path, query) },
  downloadUrl: (path: string) => path,
  idempotencyKey: () => 'k',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/joueurs',
  useSearchParams: () => new URLSearchParams(),
}));

const PLAYER: PlayerDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'kossi',
  firstName: 'Kossi',
  lastName: 'Mensah',
  email: 'kossi@example.com',
  phone: '+237••••12',
  role: 'user',
  status: 'active',
  createdAt: '2026-10-01T08:00:00Z',
  balance: 1000,
  reserved: 0,
  gamesPlayed: 9,
  lastGameAt: null,
  suspension: null,
  chatRestriction: null,
  phoneVerified: false,
  updatedAt: '2026-10-01T08:00:00Z',
  gamesWon: { fapFap: 4, garamTia: 2 },
  activeGameId: null,
  activeSessionId: null,
  tournamentRegistrations: 0,
  payments: { total: 0, succeeded: 0, succeededAmount: 0, pending: 0 },
};

describe('séparation Fap-Fap / Garam Tia (D-126)', () => {
  it('fiche joueur : victoires affichées séparément par jeu, jamais additionnées', async () => {
    get.mockImplementation((path: string) =>
      path === `users/${PLAYER.id}`
        ? Promise.resolve({ user: PLAYER })
        : new Promise(() => undefined),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PlayerDetailView id={PLAYER.id} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Victoires : 4 Fap-Fap · 2 Garam Tia')).toBeTruthy();
    expect(screen.queryByText(/6 gagnées/)).toBeNull();
  });

  it('liste des parties : colonne « Jeu »', () => {
    const column = gameColumns.find((c) => c.key === 'gameType')!;
    expect(column.header).toBe('Jeu');
    const row = (gameType: GameRow['gameType']) => ({ gameType }) as GameRow;
    render(
      <ul>
        <li>{column.cell(row('TER'))}</li>
        <li>{column.cell(row('GARAM'))}</li>
      </ul>,
    );
    expect(screen.getByText('Fap-Fap')).toBeTruthy();
    expect(screen.getByText('Garam Tia')).toBeTruthy();
  });
});
