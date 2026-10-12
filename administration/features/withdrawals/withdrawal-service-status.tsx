import { Badge } from '@/components/ui/badge';
import {
  entry,
  WITHDRAWAL_SERVICE_MODE,
  WITHDRAWAL_SERVICE_WARNING,
  WITHDRAWAL_UNAVAILABLE_REASON,
} from '@/lib/labels';
import type { WithdrawalServiceState } from '@/types/admin';

/** Motif et avertissements lisibles ; un code inconnu s'affiche tel quel. */
export function describeWithdrawalService(state: WithdrawalServiceState): string[] {
  const lines: string[] = [];
  if (state.mode === 'unavailable' && state.reason) {
    lines.push(WITHDRAWAL_UNAVAILABLE_REASON[state.reason] ?? state.reason);
  }
  for (const w of state.warnings) lines.push(WITHDRAWAL_SERVICE_WARNING[w] ?? w);
  return lines;
}

/** État des nouveaux retraits (D-077), tel que décidé par le serveur au démarrage. */
export function WithdrawalServiceStatus({ state }: { state: WithdrawalServiceState | undefined }) {
  if (!state) return <Badge dot>Inconnu (serveur antérieur)</Badge>;
  const [label, tone] = entry(WITHDRAWAL_SERVICE_MODE, state.mode);
  const details = describeWithdrawalService(state);
  return (
    <div className="space-y-1">
      <Badge tone={tone} dot>
        {label}
      </Badge>
      {details.map((line) => (
        <p key={line} className="text-muted text-xs">
          {line}
        </p>
      ))}
    </div>
  );
}
