import type { Metadata } from 'next';

import { SettingsView } from '@/features/settings/settings-view';

export const metadata: Metadata = { title: 'Paramètres' };

export default function Page() {
  return <SettingsView />;
}
