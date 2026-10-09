import { Badge } from '@/components/ui/badge';
import { entry } from '@/lib/labels';
import type { BadgeTone } from '@/components/ui/badge';

/** Badge d'un statut à partir d'une table de libellés (`lib/labels.ts`). */
export function StatusBadge({
  map,
  value,
}: {
  map: Record<string, readonly [string, BadgeTone]>;
  value: string | null | undefined;
}) {
  const [text, tone] = entry(map, value);
  return (
    <Badge tone={tone} dot>
      {text}
    </Badge>
  );
}

/** Identifiant monospace raccourci ; l'identifiant complet reste accessible au survol. */
export function IdText({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="text-faint">—</span>;
  return (
    <span title={id} className="text-ink-soft font-mono text-xs">
      {id.slice(0, 8)}
    </span>
  );
}
