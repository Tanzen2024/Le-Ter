import type { Metadata } from 'next';

import { ReconciliationView } from '@/features/finance/reconciliation-view';

export const metadata: Metadata = { title: 'Rapprochement' };

export default function Page() {
  return <ReconciliationView />;
}
