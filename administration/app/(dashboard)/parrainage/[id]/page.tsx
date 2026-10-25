import type { Metadata } from 'next';

import { ReferrerDetailView } from '@/features/referrals/referrer-detail';

export const metadata: Metadata = { title: 'Détail d’un parrain' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReferrerDetailView id={id} />;
}
