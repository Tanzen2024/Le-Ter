import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NAV } from '@/components/layout/nav';
import { ComplaintDetailContent } from '@/features/complaints/complaint-detail';
import { AUDIT_ACTION, AUDIT_TARGET } from '@/lib/labels';
import type { AdminComplaintDetail } from '@/types/complaints';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (path: string, query?: unknown) => get(path, query),
    post: (path: string, body?: unknown, headers?: unknown) => post(path, body, headers),
    patch: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  downloadUrl: (path: string) => `/api/admin/${path}`,
  idempotencyKey: (prefix: string) => `${prefix}-cle-0001`,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const ID = '22222222-2222-4222-8222-222222222222';

function detail(overrides: Partial<AdminComplaintDetail['complaint']> = {}): AdminComplaintDetail {
  return {
    complaint: {
      id: ID,
      reference: 'RCL-20261015-7K3M9Q',
      category: 'PAYMENT',
      suggestedCategory: 'PAYMENT',
      title: 'Recharge non créditée',
      description: 'Le joueur déclare un paiement MTN validé.',
      status: 'IN_REVIEW',
      priority: 'HIGH',
      links: { paymentId: '33333333-3333-4333-8333-333333333333' },
      incidentAt: null,
      decision: null,
      decidedAt: null,
      decidedBy: null,
      reopenCount: 0,
      conversationId: null,
      player: { id: '11111111-1111-4111-8111-111111111111', username: 'kossi' },
      assignee: null,
      version: 3,
      createdAt: '2026-10-15T08:00:00Z',
      updatedAt: '2026-10-15T08:00:00Z',
      closedAt: null,
      ...overrides,
    },
    aiAnalysis: {
      status: 'COMPLETED',
      summary: 'Le joueur déclare un paiement validé ; la recharge est en attente.',
    },
    verified: {
      readAt: '2026-10-15T09:00:00Z',
      game: null,
      wallet: { balance: 1000, reserved: 0, available: 1000, entries: [] },
      transaction: null,
      payment: {
        paymentId: '33333333-3333-4333-8333-333333333333',
        status: 'PENDING',
        amount: 5000,
      },
      withdrawal: null,
      tournament: null,
    },
    checks: [
      {
        id: 'k1',
        tool: 'check_payment',
        outcome: 'FOUND',
        source: 'SYSTEM',
        facts: {},
        createdAt: '2026-10-15T08:00:01Z',
      },
    ],
    messages: [
      {
        id: 'm1',
        authorType: 'ADMIN',
        body: 'Vérifier chez CinetPay',
        visibility: 'INTERNAL',
        author: { id: 'a1', username: 'admin' },
        createdAt: '2026-10-15T08:30:00Z',
      },
    ],
    events: [],
    attachments: [],
  };
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue({ assignees: [{ id: 'a1', username: 'admin' }] });
  post.mockResolvedValue({ status: 'RESOLVED' });
});

describe('Réclamations dans l’administration (D-114)', () => {
  it('est une rubrique de la navigation et du journal d’audit', () => {
    expect(NAV.flatMap((g) => g.items).some((i) => i.href === '/reclamations')).toBe(true);
    expect(AUDIT_ACTION.COMPLAINT_STATUS_CHANGED).toBeTruthy();
    expect(AUDIT_TARGET.COMPLAINT).toBe('Réclamation');
  });

  it('sépare les faits vérifiés, l’analyse automatisée et la déclaration du joueur', () => {
    wrap(<ComplaintDetailContent detail={detail()} />);
    expect(screen.getByText(/Faits vérifiés \(sources qui font autorité\)/)).toBeInTheDocument();
    expect(screen.getByText(/Analyse automatisée \(IA\)/)).toBeInTheDocument();
    expect(screen.getByText(/jamais une preuve ni une décision/)).toBeInTheDocument();
    expect(screen.getByText(/une déclaration, jamais un fait vérifié/)).toBeInTheDocument();
    expect(screen.getByText(/note interne/)).toBeInTheDocument();
  });

  it('exige une décision motivée pour résoudre et transmet le statut attendu', async () => {
    wrap(<ComplaintDetailContent detail={detail()} />);
    fireEvent.change(screen.getByLabelText('Nouveau statut'), { target: { value: 'RESOLVED' } });
    const apply = screen.getByRole('button', { name: 'Appliquer' });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Décision motivée/), {
      target: { value: 'Paiement confirmé par la revérification administrative.' },
    });
    fireEvent.click(apply);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        `complaints/${ID}/status`,
        {
          status: 'RESOLVED',
          expectedStatus: 'IN_REVIEW',
          decision: 'Paiement confirmé par la revérification administrative.',
        },
        undefined,
      ),
    );
  });

  it('présente la décision comme humaine et renvoie vers les modules financiers existants', () => {
    wrap(<ComplaintDetailContent detail={detail()} />);
    expect(screen.getByText('Décision humaine')).toBeInTheDocument();
    const links = screen.getByTestId('correction-links');
    expect(links).toHaveTextContent(/jamais ici/);
    expect(screen.getByRole('link', { name: 'Paiement lié' })).toHaveAttribute(
      'href',
      '/paiements/33333333-3333-4333-8333-333333333333',
    );
    expect(screen.getByRole('link', { name: 'Fiche du joueur' })).toHaveAttribute(
      'href',
      '/joueurs/11111111-1111-4111-8111-111111111111',
    );
  });

  it('ne propose aucune transition sur un dossier clôturé', () => {
    wrap(<ComplaintDetailContent detail={detail({ status: 'CLOSED' })} />);
    expect(screen.getByText(/aucune transition possible/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Répondre au joueur' })).toBeNull();
  });
});
