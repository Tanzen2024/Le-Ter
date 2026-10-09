import type { Metadata } from 'next';

import { FinanceView } from '@/features/finance/finance-view';

export const metadata: Metadata = { title: 'Finances' };

export default function Page() {
  return <FinanceView />;
}
