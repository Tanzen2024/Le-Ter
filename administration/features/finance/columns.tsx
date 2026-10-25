import Link from 'next/link';

import type { Column } from '@/components/data/data-table';
import { IdText, StatusBadge } from '@/components/data/status-badge';
import { formatDateTime, formatTokens, formatXaf } from '@/lib/format';
import { label, PAYMENT_STATUS, WALLET_KIND, WALLET_STATUS } from '@/lib/labels';
import type { PaymentRow, WalletTransaction } from '@/types/admin';

const SIGN: Record<string, string> = {
  deposit: '+',
  tournament_prize: '+',
  withdrawal: '−',
  tournament_entry: '−',
  game_winnings: '+',
  game_stake: '−',
  referral_reward: '+',
};

export const transactionColumns: Column<WalletTransaction>[] = [
  { key: 'id', header: 'Référence', cell: (t) => <IdText id={t.id} /> },
  {
    key: 'kind',
    header: 'Opération',
    cell: (t) => (
      <span>
        <span className="text-ink">{label(WALLET_KIND, t.kind)}</span>
        <span className="text-muted block text-xs">{t.username}</span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Statut',
    cell: (t) => <StatusBadge map={WALLET_STATUS} value={t.status} />,
  },
  {
    key: 'tokens',
    header: 'Montant',
    align: 'right',
    cell: (t) => (
      <span className="text-ink font-medium">
        {SIGN[t.kind] ?? ''}
        {formatTokens(t.tokens)}
      </span>
    ),
  },
  {
    key: 'link',
    header: 'Lien',
    hideOnMobile: true,
    cell: (t) =>
      t.paymentId ? (
        <Link
          href={`/paiements/${t.paymentId}`}
          className="text-info hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Paiement
        </Link>
      ) : t.tournamentId ? (
        <Link
          href={`/tournois/${t.tournamentId}`}
          className="text-info hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Tournoi
        </Link>
      ) : (
        <span className="text-faint">—</span>
      ),
  },
  {
    key: 'failure',
    header: 'Motif d’échec',
    cell: (t) => t.failureCode ?? '—',
    hideOnMobile: true,
  },
  { key: 'created', header: 'Date', cell: (t) => formatDateTime(t.createdAt), hideOnMobile: true },
];

export const paymentColumns: Column<PaymentRow>[] = [
  {
    key: 'ref',
    header: 'Référence marchand',
    cell: (p) => <span className="text-ink font-mono text-xs">{p.merchantTransactionId}</span>,
  },
  { key: 'player', header: 'Joueur', cell: (p) => p.username },
  {
    key: 'status',
    header: 'Statut',
    cell: (p) => <StatusBadge map={PAYMENT_STATUS} value={p.status} />,
  },
  {
    key: 'amount',
    header: 'Montant',
    align: 'right',
    cell: (p) => <span className="text-ink font-medium">{formatXaf(p.amount)}</span>,
  },
  {
    key: 'wallet',
    header: 'Achat (compte de jeu)',
    hideOnMobile: true,
    cell: (p) => <StatusBadge map={WALLET_STATUS} value={p.walletTransaction.status} />,
  },
  { key: 'method', header: 'Moyen', hideOnMobile: true, cell: (p) => p.paymentMethod ?? '—' },
  { key: 'created', header: 'Créé', hideOnMobile: true, cell: (p) => formatDateTime(p.createdAt) },
];
