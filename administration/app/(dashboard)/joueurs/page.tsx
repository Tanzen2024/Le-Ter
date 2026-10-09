import type { Metadata } from 'next';

import { PlayersList } from '@/features/players/players-list';

export const metadata: Metadata = { title: 'Joueurs' };

export default function Page() {
  return <PlayersList />;
}
