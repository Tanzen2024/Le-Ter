import { AlertTriangle, Trophy } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { GameRow } from '@/types/admin';

import { describeGameOutcome, type OutcomeTone } from './game-outcome';

const TONE: Record<OutcomeTone, string> = {
  neutral: 'text-ink-soft',
  accent: 'text-accent',
  info: 'text-info',
};

/** Cellule « Vainqueur » : trophée doré + pseudo, sinon l'état réellement enregistré. */
export function GameOutcomeCell({ game }: { game: GameRow }) {
  const outcome = describeGameOutcome(game);
  const details = outcome.details.length > 0 && (
    <span className="text-muted block text-xs">{outcome.details.join(' · ')}</span>
  );

  if (outcome.kind === 'winner') {
    return (
      <span title={outcome.method}>
        <span className="text-ink inline-flex items-center gap-1.5 font-medium">
          <Trophy className="text-gold size-4 shrink-0" aria-label="Vainqueur :" role="img" />
          {outcome.winner}
        </span>
        {details}
      </span>
    );
  }

  return (
    <span>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 font-medium',
          outcome.kind === 'anomaly' ? 'text-warning' : TONE[outcome.tone],
        )}
      >
        {outcome.kind === 'anomaly' && <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
        {outcome.title}
      </span>
      {details}
    </span>
  );
}
