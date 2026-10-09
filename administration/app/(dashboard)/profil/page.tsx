import type { Metadata } from 'next';

import { ProfileView } from '@/features/profile/profile-view';

export const metadata: Metadata = { title: 'Profil et session' };

export default function Page() {
  return <ProfileView />;
}
