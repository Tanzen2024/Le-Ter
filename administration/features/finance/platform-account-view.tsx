'use client';

import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { DataTable, DetailList, Pagination, type Column } from '@/components/data/data-table';
import { FilterBar } from '@/components/data/filter-bar';
import { StatCard } from '@/components/data/stat-card';
import { ErrorState, LoadingRows, UnavailableNotice } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form-controls';
import { useListState } from '@/hooks/use-list-state';
import { formatDateTime, formatNumber, formatPercentFromBps, formatXaf } from '@/lib/format';
import { label, LEDGER_KIND } from '@/lib/labels';
import type { LedgerEntry } from '@/types/admin';

import { ledgerQuery, platformAccountQuery } from './api';

const columns: Column<LedgerEntry>[] = [
  { key: 'date', header: 'Date', cell: (e) => formatDateTime(e.createdAt) },
  {
    key: 'kind',
    header: 'Écriture',
    cell: (e) => <span className="text-ink">{label(LEDGER_KIND, e.kind)}</span>,
  },
  { key: 'origin', header: 'Origine', cell: (e) => e.origin.name },
  {
    key: 'rate',
    header: 'Taux',
    hideOnMobile: true,
    align: 'right',
    cell: (e) => formatPercentFromBps(e.feeBps),
  },
  {
    key: 'pool',
    header: 'Cagnotte brute',
    hideOnMobile: true,
    align: 'right',
    cell: (e) => formatXaf(e.grossPool),
  },
  {
    key: 'amount',
    header: 'Montant (entrée)',
    align: 'right',
    cell: (e) => <span className="text-success font-medium">+{formatXaf(e.amount)}</span>,
  },
];

/** Compte financier de la plateforme Le-Ter (D-060) : journal `platform_ledger`, lecture seule. */
export function PlatformAccountView() {
  const router = useRouter();
  const account = useQuery(platformAccountQuery());
  const { filters, page, setFilter, setPage, reset } = useListState(['kind'] as const);
  const entries = useQuery(ledgerQuery({ page, kind: filters.kind }));
  const a = account.data;

  return (
    <>
      <PageHeader
        title="Compte financier de la plateforme"
        description="Compte central des commissions de Le-Ter (D-060). Ce n’est ni un compte utilisateur ni un compte bancaire."
      />
      {account.error ? (
        <Card className="mb-6">
          <ErrorState error={account.error} onRetry={() => account.refetch()} />
        </Card>
      ) : !a ? (
        <Card className="mb-6">
          <LoadingRows rows={4} />
        </Card>
      ) : (
        <div className="mb-6 space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Solde comptable calculé"
              value={formatXaf(a.computedBalance.amount)}
              hint="Somme des écritures"
              icon={Landmark}
            />
            {a.byKind.map((k) => (
              <StatCard
                key={k.kind}
                label={label(LEDGER_KIND, k.kind)}
                value={formatXaf(k.amount)}
                hint={`${formatNumber(k.count)} écritures`}
                tone="success"
              />
            ))}
            <StatCard
              label="Rapprochement"
              value={
                a.reconciliation.status === 'BALANCED'
                  ? 'Équilibré'
                  : `${a.reconciliation.tournamentAnomalies} écart(s)`
              }
              hint={
                <Link
                  href="/rapprochement?domaine=TOURNAMENT"
                  className="text-info hover:underline"
                >
                  Voir le détail
                </Link>
              }
              tone={a.reconciliation.status === 'BALANCED' ? 'success' : 'danger'}
            />
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Identité du compte" />
              <CardBody>
                <DetailList
                  items={[
                    ['Nom', a.name],
                    [
                      'Identifiant technique',
                      <span key="t" className="font-mono text-xs">
                        {a.technicalId}
                      </span>,
                    ],
                    ['Nature', a.nature],
                    ['Devise', a.currency],
                    ['Écritures', formatNumber(a.entries)],
                    [
                      'Période couverte',
                      a.firstEntryAt
                        ? `${formatDateTime(a.firstEntryAt)} → ${formatDateTime(a.lastEntryAt)}`
                        : 'Aucune écriture',
                    ],
                    [
                      'Solde',
                      <span key="b">
                        {formatXaf(a.computedBalance.amount)}{' '}
                        <span className="text-muted text-xs">({a.computedBalance.label})</span>
                      </span>,
                    ],
                    [
                      'Rapprochement',
                      a.reconciliation.status === 'BALANCED' ? (
                        <Badge key="r" tone="success">
                          Équilibré
                        </Badge>
                      ) : (
                        <Badge key="r" tone="danger">
                          Écarts à examiner
                        </Badge>
                      ),
                    ],
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Limites du modèle" />
              <CardBody className="space-y-3">
                <UnavailableNotice title="Trésorerie réelle">{a.treasury.label}</UnavailableNotice>
                <UnavailableNotice title="Sorties">{a.outgoing.label}</UnavailableNotice>
                <UnavailableNotice title="Parties ordinaires">
                  {a.ordinaryGamesCommission.label}
                </UnavailableNotice>
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title="Nature des écritures" />
            <CardBody>
              <ul className="space-y-2 text-sm">
                {a.byKind.length === 0 ? (
                  <li className="text-muted">Aucune écriture enregistrée.</li>
                ) : (
                  a.byKind.map((k) => (
                    <li key={k.kind}>
                      <span className="text-ink font-medium">{label(LEDGER_KIND, k.kind)}</span>{' '}
                      <span className="text-muted">— {k.description}</span>
                    </li>
                  ))
                )}
              </ul>
            </CardBody>
          </Card>
        </div>
      )}
      <Card>
        <CardHeader
          title="Historique des écritures"
          description="Entrées seulement ; aucune écriture n’est modifiable depuis l’administration."
        />
        <FilterBar onReset={reset}>
          <Select
            aria-label="Type d’écriture"
            value={filters.kind}
            onChange={(e) => setFilter('kind', e.target.value)}
            className="w-auto"
          >
            <option value="">Toutes les écritures</option>
            {Object.entries(LEDGER_KIND).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
        </FilterBar>
        <DataTable
          caption="Écritures du compte de la plateforme"
          columns={columns}
          rows={entries.data?.items}
          rowKey={(e) => e.id}
          loading={entries.isFetching}
          error={entries.error}
          onRetry={() => entries.refetch()}
          empty="Aucune écriture"
          onRowClick={(e) => router.push(`/tournois/${e.origin.id}`)}
        />
        {entries.data && (
          <Pagination
            page={page}
            limit={entries.data.limit}
            total={entries.data.total}
            onPage={setPage}
          />
        )}
      </Card>
    </>
  );
}
