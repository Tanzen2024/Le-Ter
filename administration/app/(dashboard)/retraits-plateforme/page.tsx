import type { Metadata } from 'next';

import { PlatformPayoutsView } from '@/features/platform-payouts/platform-payouts-view';

export const metadata: Metadata = { title: 'Retraits de la plateforme' };

export default function Page() {
  return <PlatformPayoutsView />;
}
