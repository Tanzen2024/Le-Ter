import type { Metadata } from 'next';

import { GameDetailView } from '@/features/games/game-detail';

export const metadata: Metadata = { title: 'Détail d’une partie' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameDetailView id={id} />;
}
