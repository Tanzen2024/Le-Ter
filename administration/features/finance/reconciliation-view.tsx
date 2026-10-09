'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, RotateCw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { StatCard } from '@/components/data/stat-card';
import { FilterBar } from '@/components/data/filter-bar';
import { EmptyState, ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form-controls';
import { useListState } from '@/hooks/use-list-state';
import { formatDateTime, formatNumber, formatXaf } from '@/lib/format';
import { ANOMALY_TYPE, label } from '@/lib/labels';
import type { Anomaly } from '@/types/admin';

import { reconciliationQuery } from './api';

function referenceHref(a: Anomaly): string | null {
  if (a.reference.kind === 'PAYMENT') return `/paiements/${a.reference.id}`;
  if (a.reference.kind === 'TOURNAMENT') return `/tournois/${a.reference.id}`;
  return null;
}

function AnomalyCard({ a }: { a: Anomaly }) {
  const href = referenceHref(a);
  return (
    <li className="border-line rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={a.severity === 'CRITICAL' ? 'danger' : 'warning'} dot>
              {a.severity === 'CRITICAL' ? 'Critique' : 'À surveiller'}
            </Badge>
            <p className="text-ink text-sm font-medium">{label(ANOMALY_TYPE, a.type)}</p>
          </div>
          <p className="text-ink-soft mt-1 text-sm">{a.explanation}</p>
        </div>
        <div className="text-muted text-right text-xs">
          <p>{formatDateTime(a.date)}</p>
          {a.amount !== null && (
            <p className="text-ink mt-0.5 font-medium">{formatXaf(a.amount)}</p>
          )}
        </div>
      </div>
      <table className="mt-3 w-full text-xs">
        <caption className="sr-only">Données comparées</caption>
        <thead>
          <tr className="text-muted text-left">
            <th scope="col" className="py-1 font-medium">
              Donnée comparée
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Attendu
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Constaté
            </th>
          </tr>
        </thead>
        <tbody>
          {a.compared.map((c) => (
            <tr key={c.label} className="border-line border-t">
              <td className="text-ink-soft py-1.5">{c.label}</td>
              <td className="text-ink py-1.5 text-right tabular-nums">{c.expected ?? '—'}</td>
              <td className="text-ink py-1.5 text-right font-medium tabular-nums">
                {c.actual ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted">
          Référence : <span className="text-ink-soft font-mono">{a.reference.label}</span> · état :
          ouverte (calculée)
        </span>
        {href && (
          <Link href={href} className="text-info inline-flex items-center gap-1 hover:underline">
            Ouvrir <ExternalLink className="size-3" aria-hidden />
          </Link>
        )}
      </div>
    </li>
  );
}

export function ReconciliationView() {
  const query = useQuery(reconciliationQuery());
  const { filters, setFilter, reset } = useListState(['domaine', 'gravite', 'type'] as const);
  const data = query.data;
  const items = useMemo(
    () =>
      (data?.items ?? []).filter(
        (a) =>
          (!filters.domaine || a.domain === filters.domaine) &&
          (!filters.gravite || a.severity === filters.gravite) &&
          (!filters.type || a.type === filters.type),
      ),
    [data, filters],
  );

  return (
    <>
      <PageHeader
        title="Rapprochement financier"
        description="Contrôles en lecture seule entre paiements CinetPay, comptes de jeu, tournois et compte de la plateforme. Aucune correction automatique."
        actions={
          <Button variant="secondary" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RotateCw /> {query.isFetching ? 'Analyse…' : 'Relancer l’analyse'}
          </Button>
        }
      />
      {query.error ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingRows />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Anomalies ouvertes"
              value={formatNumber(data.summary.total)}
              hint={`Analyse du ${formatDateTime(data.generatedAt)}`}
              tone={data.summary.total ? 'warning' : 'success'}
            />
            <StatCard
              label="Critiques"
              value={formatNumber(data.summary.critical)}
              hint="Écarts d’argent ou de statut"
              tone={data.summary.critical ? 'danger' : 'success'}
            />
            <StatCard
              label="Tournois contrôlés"
              value={formatNumber(data.checked.tournaments)}
              hint={`Six contrôles par tournoi · paiements en attente > ${data.thresholds.stalePendingPaymentMinutes} min`}
              tone="info"
            />
          </div>

          <Card>
            <CardHeader
              title="Anomalies"
              description="Une anomalie disparaît d’elle-même dès que les données concordent."
            />
            <FilterBar onReset={reset}>
              <Select
                aria-label="Domaine"
                value={filters.domaine}
                onChange={(e) => setFilter('domaine', e.target.value)}
                className="w-auto"
              >
                <option value="">Tous les domaines</option>
                <option value="PAYMENT">Paiements</option>
                <option value="TOURNAMENT">Tournois et compte plateforme</option>
              </Select>
              <Select
                aria-label="Gravité"
                value={filters.gravite}
                onChange={(e) => setFilter('gravite', e.target.value)}
                className="w-auto"
              >
                <option value="">Toutes les gravités</option>
                <option value="CRITICAL">Critiques</option>
                <option value="WARNING">À surveiller</option>
              </Select>
              <Select
                aria-label="Type"
                value={filters.type}
                onChange={(e) => setFilter('type', e.target.value)}
                className="w-auto"
              >
                <option value="">Tous les types</option>
                {Object.keys(data.summary.byType).map((t) => (
                  <option key={t} value={t}>
                    {label(ANOMALY_TYPE, t)} ({data.summary.byType[t]})
                  </option>
                ))}
              </Select>
            </FilterBar>
            <CardBody>
              {items.length === 0 ? (
                data.summary.total === 0 ? (
                  <EmptyState title="Aucune anomalie détectée">
                    <span className="text-success inline-flex items-center gap-1.5">
                      <CheckCircle2 className="size-4" aria-hidden /> Les données contrôlées
                      concordent.
                    </span>
                  </EmptyState>
                ) : (
                  <EmptyState title="Aucune anomalie pour ces filtres" />
                )
              ) : (
                <ul className="space-y-3">
                  {items.map((a, i) => (
                    <AnomalyCard key={`${a.type}-${a.reference.id}-${i}`} a={a} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Contrôles garantis par la base de données"
              description="Ces écarts sont impossibles : des contraintes PostgreSQL les refusent."
            />
            <CardBody>
              <ul className="space-y-2">
                {data.guaranteedByDatabase.map((g) => (
                  <li key={g.control} className="flex gap-2.5 text-sm">
                    <ShieldCheck className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      <span className="text-ink font-medium">{g.control}</span>{' '}
                      <span className="text-muted">— {g.guarantee}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <InfoNote>
            Le rapprochement avec le relevé marchand de CinetPay n’est pas disponible : aucune API
            de relevé n’est intégrée. Pour un paiement en attente, ouvrez-le et demandez une
            revérification auprès de CinetPay.
          </InfoNote>
        </div>
      )}
    </>
  );
}
