'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { DataTable, DetailList, type Column } from '@/components/data/data-table';
import { IdText, StatusBadge } from '@/components/data/status-badge';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { ALERT_LEVEL, ALERT_STATUS, entry } from '@/lib/labels';
import type { AlertSignals, AlertStatus } from '@/types/admin';

import { ALERT_TRANSITIONS, alertQuery, alertSignalsQuery, changeAlertStatus } from './api';

const TRANSITION_TEXT: Record<AlertStatus, { label: string; description: string }> = {
  REVIEWED: {
    label: 'Passer en examen',
    description: 'L’alerte est en cours d’examen. Aucune conséquence pour les joueurs.',
  },
  DISMISSED: {
    label: 'Écarter',
    description: 'L’alerte est écartée (statut final). Aucune conséquence pour les joueurs.',
  },
  RESOLVED: {
    label: 'Marquer comme traitée',
    description: 'L’examen est terminé (statut final). Aucune conséquence automatique.',
  },
  NEW: { label: '', description: '' },
};

type Signal = AlertSignals['signals'][number];

const signalColumns: Column<Signal>[] = [
  { key: 'type', header: 'Signal', cell: (s) => <span className="text-ink">{s.type}</span> },
  { key: 'severity', header: 'Gravité', cell: (s) => s.severity },
  { key: 'contribution', header: 'Contribution', align: 'right', cell: (s) => s.contribution },
  {
    key: 'retained',
    header: 'Retenu',
    cell: (s) => (s.retained ? <Badge tone="info">Oui</Badge> : <Badge>Non</Badge>),
  },
  { key: 'game', header: 'Partie', hideOnMobile: true, cell: (s) => <IdText id={s.gameId} /> },
  { key: 'date', header: 'Date', hideOnMobile: true, cell: (s) => formatDateTime(s.createdAt) },
];

export function AlertDetailView({ id }: { id: string }) {
  const client = useQueryClient();
  const query = useQuery(alertQuery(id));
  const signals = useQuery(alertSignalsQuery(id));
  const [target, setTarget] = useState<AlertStatus | null>(null);
  const a = query.data?.alert;
  if (query.error)
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  if (!a) return <LoadingRows rows={8} />;

  async function apply(to: AlertStatus) {
    const result = await changeAlertStatus(id, to, a!.status);
    toast.success(result.changed ? 'Statut mis à jour et audité.' : 'Statut déjà à jour.');
    await client.invalidateQueries({ queryKey: ['admin', 'alert', id] });
    await client.invalidateQueries({ queryKey: ['admin', 'alerts'] });
  }

  return (
    <>
      <PageHeader
        title={`Alerte · score ${a.score} / 100`}
        description={`Signalée le ${formatDateTime(a.createdAt)} · algorithme ${a.scoreAlgorithm}`}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/anti-collusion">
                <ArrowLeft /> Alertes
              </Link>
            </Button>
            {ALERT_TRANSITIONS[a.status].map((to) => (
              <Button
                key={to}
                variant={to === 'DISMISSED' ? 'secondary' : 'primary'}
                onClick={() => setTarget(to)}
              >
                {TRANSITION_TEXT[to].label}
              </Button>
            ))}
          </>
        }
      />
      <div className="space-y-6">
        <InfoNote>
          Cette alerte est un signal à examiner, pas une preuve. Les éléments ci-dessous sont
          présentés sous une forme minimisée (aucune position précise, adresse IP ni carte).
        </InfoNote>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Synthèse" />
            <CardBody>
              <DetailList
                items={[
                  ['Suivi', <StatusBadge key="s" map={ALERT_STATUS} value={a.status} />],
                  ['Niveau', <StatusBadge key="l" map={ALERT_LEVEL} value={a.level} />],
                  ['Priorité', a.priority === 'PRIORITY' ? 'Prioritaire' : 'Normale'],
                  ['Sujet', `${a.subject.scope} · ${a.subject.playerIds.length} joueur(s)`],
                  [
                    'Partie',
                    <Link
                      key="g"
                      href={`/parties/${a.gameId}`}
                      className="text-info hover:underline"
                    >
                      <IdText id={a.gameId} />
                    </Link>,
                  ],
                  [
                    'Période observée',
                    `${formatDateTime(a.period.start)} → ${formatDateTime(a.period.end)}`,
                  ],
                  ['Types de signaux', a.signalTypes.join(', ') || '—'],
                  ['Dernière mise à jour', formatDateTime(a.updatedAt)],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Joueurs concernés" />
            <CardBody>
              <ul className="space-y-2">
                {a.subject.playerIds.map((pid) => (
                  <li key={pid}>
                    <Link href={`/joueurs/${pid}`} className="text-info text-sm hover:underline">
                      Fiche joueur <IdText id={pid} />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
        {a.scoreAtAnalysis && (
          <Card>
            <CardHeader
              title="Composition du score"
              description={`Calculé le ${formatDateTime(a.scoreAtAnalysis.computedAt)} · score précédent ${a.scoreAtAnalysis.previousScore ?? '—'}`}
            />
            <CardBody>
              <ul className="space-y-2">
                {a.scoreAtAnalysis.contributions.map((c, i) => (
                  <li
                    key={`${c.type}-${i}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-ink-soft">{c.type}</span>
                    <span className="text-ink font-medium tabular-nums">+{c.contribution}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader
            title="Signaux examinés"
            description="Éléments justificatifs minimisés par le serveur."
          />
          <DataTable
            caption="Signaux de l’alerte"
            columns={signalColumns}
            rows={signals.data?.signals}
            rowKey={(s) => s.signalId}
            loading={signals.isFetching}
            error={signals.error}
            onRetry={() => signals.refetch()}
            empty="Aucun signal"
          />
        </Card>
      </div>
      {target && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setTarget(null)}
          title={`${TRANSITION_TEXT[target].label} ?`}
          description={`${TRANSITION_TEXT[target].description} Statut actuel : ${entry(ALERT_STATUS, a.status)[0]}.`}
          confirmLabel={TRANSITION_TEXT[target].label}
          onConfirm={() => apply(target)}
        />
      )}
    </>
  );
}
