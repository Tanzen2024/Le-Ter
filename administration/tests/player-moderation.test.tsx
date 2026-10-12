import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountBadges } from '@/features/players/player-actions';
import { ModerationActionsCard, NotesSection } from '@/features/players/player-moderation';
import type { PlayerDetail, PlayerModeration } from '@/types/admin';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (path: string, query?: unknown) => get(path, query),
    post: (path: string, body?: unknown, headers?: unknown) => post(path, body, headers),
    patch: vi.fn(),
  },
  idempotencyKey: (prefix: string) => `${prefix}-cle-0001`,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
  gamesPlayed: 3,
  lastGameAt: null,
  suspension: null,
  chatRestriction: null,
  phoneVerified: false,
  updatedAt: '2026-10-01T08:00:00Z',
  gamesWon: 1,
  activeGameId: null,
  activeSessionId: null,
  tournamentRegistrations: 0,
  payments: { total: 0, succeeded: 0, succeededAmount: 0, pending: 0 },
};

const MODERATION: PlayerModeration = {
  serverTime: '2026-10-11T10:00:00Z',
  suspension: null,
  chatRestriction: null,
  security: { lastLoginAt: null, lastSessionActivityAt: null, activeSessions: 1 },
  isSelf: false,
  limits: {
    reason: { min: 3, max: 500 },
    comment: { max: 2000 },
    playerMessage: { max: 1000 },
    note: { max: 2000 },
    maxDurationDays: 365,
    minDurationMinutes: 5,
  },
};

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('Gestion des joueurs (D-079)', () => {
  it('badges : statut, suspension et restriction du chat', () => {
    render(
      <AccountBadges
        player={{
          status: 'disabled',
          suspension: { endsAt: null },
          chatRestriction: { endsAt: '2026-10-12T10:00:00Z' },
        }}
      />,
    );
    expect(screen.getByText('Désactivé')).toBeInTheDocument();
    expect(screen.getByText('Suspendu')).toBeInTheDocument();
    expect(screen.getByText('Chat restreint')).toBeInTheDocument();
  });

  it('désactivation : motif obligatoire, puis envoi après confirmation', async () => {
    post.mockResolvedValue({ status: 'disabled', changed: true, revokedSessions: 1 });
    wrap(<ModerationActionsCard player={PLAYER} moderation={MODERATION} />);
    fireEvent.click(screen.getByRole('button', { name: /Désactiver le compte/ }));
    // Le bouton de confirmation du dialogue porte le même libellé que l'action.
    await screen.findByLabelText('Motif');
    fireEvent.click(screen.getAllByRole('button', { name: 'Désactiver le compte' }).at(-1)!);
    expect(await screen.findByText('Motif obligatoire.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'Fraude avérée' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Désactiver le compte' }).at(-1)!);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        `users/${PLAYER.id}/disable`,
        { reason: 'Fraude avérée' },
        undefined,
      ),
    );
  });

  it('propre fiche : actions qui retirent l’accès désactivées', () => {
    wrap(<ModerationActionsCard player={PLAYER} moderation={{ ...MODERATION, isSelf: true }} />);
    expect(screen.getByRole('button', { name: /Désactiver le compte/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Suspendre le joueur/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Déconnecter tous les appareils/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Envoyer un avertissement/ })).toBeEnabled();
  });

  it('suspension en cours : seule la levée est proposée', () => {
    wrap(
      <ModerationActionsCard
        player={PLAYER}
        moderation={{
          ...MODERATION,
          suspension: {
            id: 's1',
            kind: 'SUSPENSION',
            state: 'ACTIVE',
            reason: 'Abus',
            comment: null,
            playerMessage: null,
            delivered: null,
            startsAt: '2026-10-11T09:00:00Z',
            endsAt: null,
            createdBy: { id: 'a', username: 'admin' },
            createdAt: '2026-10-11T09:00:00Z',
            lifted: null,
          },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /Lever la suspension/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Suspendre le joueur/ })).toBeNull();
  });

  it('avertissement : envoyé avec une clé d’idempotence et le message visible', async () => {
    post.mockResolvedValue({ sanctionId: 'w1', delivered: true, replayed: false });
    wrap(<ModerationActionsCard player={PLAYER} moderation={MODERATION} />);
    fireEvent.click(screen.getByRole('button', { name: /Envoyer un avertissement/ }));
    fireEvent.change(await screen.findByLabelText('Motif (interne)'), {
      target: { value: 'Insultes' },
    });
    fireEvent.change(screen.getByLabelText('Message visible par le joueur (facultatif)'), {
      target: { value: 'Restez courtois.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’avertissement' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        `users/${PLAYER.id}/warnings`,
        { reason: 'Insultes', playerMessage: 'Restez courtois.' },
        { 'idempotency-key': 'warn-cle-0001' },
      ),
    );
  });

  it('notes : texte affiché brut, note supprimée sans son texte', async () => {
    get.mockResolvedValue({
      page: 1,
      limit: 10,
      total: 2,
      items: [
        {
          id: 'n1',
          body: '<img src=x onerror=alert(1)> rappel',
          author: { id: 'a', username: 'admin' },
          createdAt: '2026-10-11T09:00:00Z',
          deleted: null,
        },
        {
          id: 'n2',
          body: null,
          author: { id: 'a', username: 'admin' },
          createdAt: '2026-10-10T09:00:00Z',
          deleted: {
            at: '2026-10-11T09:30:00Z',
            by: { id: 'a', username: 'admin' },
            reason: 'Erreur',
          },
        },
      ],
    });
    const { container } = wrap(<NotesSection playerId={PLAYER.id} />);
    expect(await screen.findByText('<img src=x onerror=alert(1)> rappel')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/Note supprimée le .* : Erreur/)).toBeInTheDocument();
  });
});
