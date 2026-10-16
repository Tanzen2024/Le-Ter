import type { Metadata } from 'next';

import { ComplaintDetailView } from '@/features/complaints/complaint-detail';

export const metadata: Metadata = { title: 'Détail d’une réclamation' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ComplaintDetailView id={id} />;
}
