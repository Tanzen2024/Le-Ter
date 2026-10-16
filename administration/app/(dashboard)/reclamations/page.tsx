import type { Metadata } from 'next';

import { ComplaintsList } from '@/features/complaints/complaints-list';

export const metadata: Metadata = { title: 'Réclamations' };

export default function Page() {
  return <ComplaintsList />;
}
