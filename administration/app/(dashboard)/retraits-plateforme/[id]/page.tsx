import type { Metadata } from 'next';

import { PayoutDetailView } from '@/features/platform-payouts/payout-detail';

export const metadata: Metadata = { title: 'Détail d’un retrait de la plateforme' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PayoutDetailView id={id} />;
}
