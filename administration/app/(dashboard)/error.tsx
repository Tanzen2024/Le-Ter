'use client';

import { ErrorState } from '@/components/feedback/states';
import { Card } from '@/components/ui/card';

/** Erreur inattendue d'une page : message compréhensible, possibilité de réessayer. */
export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Card>
      <ErrorState error={error} onRetry={reset} />
    </Card>
  );
}
