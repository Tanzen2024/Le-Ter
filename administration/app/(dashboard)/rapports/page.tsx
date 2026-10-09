import type { Metadata } from 'next';

import { ReportsView } from '@/features/reports/reports-view';

export const metadata: Metadata = { title: 'Rapports' };

export default function Page() {
  return <ReportsView />;
}
