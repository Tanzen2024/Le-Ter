import type { Metadata } from 'next';

import { GamesList } from '@/features/games/games-list';

export const metadata: Metadata = { title: 'Parties' };

export default function Page() {
  return <GamesList />;
}
