import { UnavailableNotice } from '@/components/feedback/states';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import type { UnsupportedOperation } from '@/types/admin';

/**
 * Opérations exceptionnelles NON prises en charge : affichées comme indisponibles, sans
 * bouton ni endpoint. Aucune modification de solde n'est possible depuis l'administration.
 */
export function UnsupportedOperations({ operations }: { operations: UnsupportedOperation[] }) {
  return (
    <Card>
      <CardHeader
        title="Opérations exceptionnelles"
        description="Indisponibles : aucune règle métier ni intégration ne les autorise aujourd’hui."
      />
      <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {operations.map((o) => (
          <UnavailableNotice key={o.operation} title={o.label}>
            {o.reason}
          </UnavailableNotice>
        ))}
      </CardBody>
    </Card>
  );
}
