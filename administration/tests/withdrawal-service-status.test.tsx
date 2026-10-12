import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  describeWithdrawalService,
  WithdrawalServiceStatus,
} from '@/features/withdrawals/withdrawal-service-status';

/** État des nouveaux retraits (D-077) dans « État des services ». */
describe('état du service de retrait', () => {
  it('production : aucun motif', () => {
    render(<WithdrawalServiceStatus state={{ mode: 'live', warnings: [] }} />);
    expect(screen.getByText('Production · fonds réels')).toBeTruthy();
  });

  it('sandbox : mode test et avertissement de notification', () => {
    const state = { mode: 'sandbox' as const, warnings: ['TRANSFER_NOTIFY_URL_NOT_PUBLIC'] };
    render(<WithdrawalServiceStatus state={state} />);
    expect(screen.getByText('Mode test (sandbox)')).toBeTruthy();
    expect(screen.getByText(/seule la réconciliation réglera les retraits/)).toBeTruthy();
  });

  it('indisponible : motif et action attendue ; code inconnu affiché tel quel', () => {
    expect(
      describeWithdrawalService({ mode: 'unavailable', reason: 'LIVE_NOT_CONFIRMED', warnings: [] }),
    ).toEqual([
      'Clé de production sans attestation des prérequis (CINETPAY_TRANSFERS_LIVE_CONFIRMED).',
    ]);
    expect(
      describeWithdrawalService({ mode: 'unavailable', reason: 'NOUVEAU_MOTIF', warnings: [] }),
    ).toEqual(['NOUVEAU_MOTIF']);
    render(
      <WithdrawalServiceStatus
        state={{ mode: 'unavailable', reason: 'SCHEMA_OUTDATED', warnings: [] }}
      />,
    );
    expect(screen.getByText('Indisponibles')).toBeTruthy();
    expect(screen.getByText(/npm run db:migrate/)).toBeTruthy();
  });

  it('serveur antérieur (champ absent)', () => {
    render(<WithdrawalServiceStatus state={undefined} />);
    expect(screen.getByText('Inconnu (serveur antérieur)')).toBeTruthy();
  });
});
