import type { Metadata } from 'next';

import { PaymentDetailView } from '@/features/finance/payment-detail';

export const metadata: Metadata = { title: 'Détail d’un paiement' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentDetailView id={id} />;
}
