import { CheckCircle2, XCircle } from 'lucide-react';

import { formatDateTime } from '@/lib/format';
import { AUDIT_ACTION, label } from '@/lib/labels';
import type { AuditEvent } from '@/types/admin';

/** Une ligne lisible du journal : action, résultat, auteur et date. */
export function AuditEventLine({ event }: { event: AuditEvent }) {
  const failed = event.outcome === 'FAILURE';
  const Icon = failed ? XCircle : CheckCircle2;
  return (
    <div className="flex items-start gap-2.5">
      <Icon
        className={
          failed ? 'text-danger mt-0.5 size-4 shrink-0' : 'text-success mt-0.5 size-4 shrink-0'
        }
        aria-label={failed ? 'Échec' : 'Réussite'}
      />
      <div className="min-w-0 text-sm">
        <p className="text-ink truncate">{label(AUDIT_ACTION, event.action)}</p>
        <p className="text-muted text-xs">
          {event.actor?.username ?? (event.actor ? 'Administrateur' : 'Compte inconnu')} ·{' '}
          {formatDateTime(event.createdAt)}
        </p>
      </div>
    </div>
  );
}
