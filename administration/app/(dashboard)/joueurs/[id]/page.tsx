import type { Metadata } from 'next';

import { PlayerDetailView } from '@/features/players/player-detail';

export const metadata: Metadata = { title: 'Fiche joueur' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlayerDetailView id={id} />;
}
