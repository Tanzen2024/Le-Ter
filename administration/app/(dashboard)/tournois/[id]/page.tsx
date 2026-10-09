import type { Metadata } from 'next';

import { TournamentDetailView } from '@/features/tournaments/tournament-detail';

export const metadata: Metadata = { title: 'Détail d’un tournoi' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TournamentDetailView id={id} />;
}
