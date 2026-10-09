import type { Metadata } from 'next';

import { PlatformAccountView } from '@/features/finance/platform-account-view';

export const metadata: Metadata = { title: 'Compte de la plateforme' };

export default function Page() {
  return <PlatformAccountView />;
}
