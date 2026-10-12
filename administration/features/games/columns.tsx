import { AlertTriangle } from 'lucide-react';

import type { Column } from '@/components/data/data-table';
import { IdText, StatusBadge } from '@/components/data/status-badge';
import { Badge } from '@/components/ui/badge';
import { formatDateTime, formatDuration } from '@/lib/format';
import { GAME_ANOMALY, GAME_STATUS, label } from '@/lib/labels';
import type { GameRow } from '@/types/admin';

import { GameOutcomeCell } from './game-outcome-cell';

export const gameColumns: Column<GameRow>[] = [
  { key: 'id', header: 'Partie', cell: (g) => <IdText id={g.id} /> },
  {
    key: 'status',
    header: 'Statut',
    cell: (g) => <StatusBadge map={GAME_STATUS} value={g.status} />,
  },
  {
    key: 'players',
    header: 'Joueurs',
    cell: (g) => (
      <span className="text-ink">
        {g.players.map((p) => p.username).join(', ') || '—'}
        <span className="text-muted text-xs">
          {' '}
          ({g.players.length}/{g.maxPlayers})
        </span>
      </span>
    ),
  },
  {
    key: 'winner',
    header: 'Vainqueur',
    hideOnMobile: true,
    cell: (g) => <GameOutcomeCell game={g} />,
  },
  { key: 'created', header: 'Créée', cell: (g) => formatDateTime(g.createdAt), hideOnMobile: true },
  {
    key: 'duration',
    header: 'Durée',
    cell: (g) => formatDuration(g.durationSeconds),
    align: 'right',
    hideOnMobile: true,
  },
  {
    key: 'flags',
    header: <span className="sr-only">Anomalies</span>,
    cell: (g) =>
      g.anomalies.length > 0 ? (
        <Badge tone="warning" title={g.anomalies.map((a) => label(GAME_ANOMALY, a)).join(' · ')}>
          <AlertTriangle className="size-3" aria-hidden />{' '}
          {g.anomalies.length === 1
            ? label(GAME_ANOMALY, g.anomalies[0])
            : `${g.anomalies.length} anomalies`}
        </Badge>
      ) : g.tournament ? (
        <Badge tone="primary">Tournoi</Badge>
      ) : null,
  },
];
