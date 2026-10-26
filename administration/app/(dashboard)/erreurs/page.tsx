import type { Metadata } from 'next';

import { ServerErrorsView } from '@/features/server-errors/server-errors-view';

export const metadata: Metadata = { title: 'Erreurs' };

export default function Page() {
  return <ServerErrorsView />;
}
