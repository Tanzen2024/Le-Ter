import type { Metadata } from 'next';

import { TournamentsList } from '@/features/tournaments/tournaments-list';

export const metadata: Metadata = { title: 'Tournois' };

export default function Page() {
  return <TournamentsList />;
}
