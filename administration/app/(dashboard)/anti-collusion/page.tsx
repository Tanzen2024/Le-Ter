import type { Metadata } from 'next';

import { AlertsList } from '@/features/anti-collusion/alerts-list';

export const metadata: Metadata = { title: 'Anti-collusion' };

export default function Page() {
  return <AlertsList />;
}
