import type { Metadata } from 'next';

import { AlertDetailView } from '@/features/anti-collusion/alert-detail';

export const metadata: Metadata = { title: 'Alerte anti-collusion' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AlertDetailView id={id} />;
}
