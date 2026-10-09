import type { Metadata } from 'next';

import { PaymentsList } from '@/features/finance/payments-list';

export const metadata: Metadata = { title: 'Paiements' };

export default function Page() {
  return <PaymentsList />;
}
