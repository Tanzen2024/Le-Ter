import type { Metadata } from 'next';

import { WithdrawalDetailView } from '@/features/withdrawals/withdrawal-detail';

export const metadata: Metadata = { title: 'Détail d’un retrait' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WithdrawalDetailView id={id} />;
}
