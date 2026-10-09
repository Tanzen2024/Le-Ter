import type { Metadata } from 'next';

import { TournamentForm } from '@/features/tournaments/tournament-form';

export const metadata: Metadata = { title: 'Créer un tournoi' };

export default function Page() {
  return <TournamentForm />;
}
