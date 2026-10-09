import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable } from '@/components/data/data-table';
import { StatusBadge } from '@/components/data/status-badge';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ErrorState, UnavailableNotice } from '@/components/feedback/states';
import { UnsupportedOperations } from '@/features/finance/unsupported-operations';
import { ApiError } from '@/lib/api/errors';
import { PAYMENT_STATUS } from '@/lib/labels';

describe('composants partagés', () => {
  it('badge de statut : libellé français, statut inconnu affiché tel quel', () => {
    const { rerender } = render(<StatusBadge map={PAYMENT_STATUS} value="SUCCESS" />);
    expect(screen.getByText('Confirmé')).toBeInTheDocument();
    rerender(<StatusBadge map={PAYMENT_STATUS} value="REFUNDED" />);
    expect(screen.getByText('REFUNDED')).toBeInTheDocument();
  });

  it('tableau : états vide et erreur explicites', () => {
    const { rerender } = render(
      <DataTable
        caption="t"
        columns={[{ key: 'a', header: 'A', cell: () => 'x' }]}
        rows={[]}
        rowKey={() => 'k'}
        empty="Rien ici"
      />,
    );
    expect(screen.getByText('Rien ici')).toBeInTheDocument();
    rerender(
      <DataTable
        caption="t"
        columns={[]}
        rows={undefined}
        rowKey={() => 'k'}
        error={new ApiError(503, 'ADMIN_UNAVAILABLE', 'L’administration n’est pas disponible.')}
      />,
    );
    expect(screen.getByText('L’administration n’est pas disponible.')).toBeInTheDocument();
  });

  it('erreur réseau : message compréhensible et bouton Réessayer', () => {
    const retry = vi.fn();
    render(<ErrorState error={new TypeError('fetch failed')} onRetry={retry} />);
    expect(screen.getByText(/Impossible de joindre le serveur/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(retry).toHaveBeenCalled();
  });

  it('confirmation : l’action n’est envoyée qu’après confirmation ; l’erreur serveur reste visible', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'TOURNAMENT_STARTED', 'Le tournoi a déjà commencé.'));
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Annuler ?"
        description="Définitif."
        confirmLabel="Annuler le tournoi"
        tone="danger"
        onConfirm={onConfirm}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler le tournoi' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Le tournoi a déjà commencé.'),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('opérations financières non prises en charge : affichées sans aucun bouton d’action', () => {
    render(
      <UnsupportedOperations
        operations={[
          { operation: 'REFUND', label: 'Remboursement', reason: 'Non pris en charge.' },
          { operation: 'MANUAL_CREDIT', label: 'Crédit manuel', reason: 'Aucune règle.' },
        ]}
      />,
    );
    expect(screen.getByText('Remboursement')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('fonction indisponible : annoncée comme note', () => {
    render(<UnavailableNotice title="Mode maintenance">Inexistant.</UnavailableNotice>);
    expect(screen.getByRole('note')).toHaveTextContent('Mode maintenance');
  });
});
