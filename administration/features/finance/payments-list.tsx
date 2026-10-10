'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { DataTable, Pagination } from '@/components/data/data-table';
import { FilterBar, SearchInput } from '@/components/data/filter-bar';
import { InfoNote } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { useListState } from '@/hooks/use-list-state';
import { formatXaf, localDayStartIso } from '@/lib/format';
import { PAYMENT_STATUS } from '@/lib/labels';

import { paymentsQuery } from './api';
import { paymentColumns } from './columns';

function nextDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const AMOUNTS = ['500', '1000', '2000', '5000'];

export function PaymentsList() {
  const router = useRouter();
  const { filters, page, setFilter, setPage, reset } = useListState([
    'q',
    'status',
    'amount',
    'du',
    'au',
  ] as const);
  const query = useQuery(
    paymentsQuery({
      page,
      q: filters.q,
      status: filters.status,
      minAmount: filters.amount || undefined,
      maxAmount: filters.amount || undefined,
      from: filters.du ? localDayStartIso(filters.du) : undefined,
      to: filters.au ? localDayStartIso(nextDay(filters.au)) : undefined,
    }),
  );
  return (
    <>
      <PageHeader
        title="Paiements CinetPay"
        description="Achats de jetons (1 FCFA = 1 jeton). La consultation d’un paiement est inscrite au journal d’audit."
      />
      <InfoNote className="mb-4">
        Un paiement n’est confirmé qu’après relecture de son statut chez CinetPay par le serveur.
        Remboursements et retraits ne sont pas pris en charge par l’intégration actuelle.
      </InfoNote>
      <Card>
        <FilterBar onReset={reset}>
          <SearchInput
            value={filters.q}
            onChange={(v) => setFilter('q', v)}
            placeholder="Référence marchand, CinetPay ou identifiant"
            label="Rechercher un paiement"
          />
          <Select
            aria-label="Statut"
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(PAYMENT_STATUS).map(([v, [t]]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Montant"
            value={filters.amount}
            onChange={(e) => setFilter('amount', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les montants</option>
            {AMOUNTS.map((a) => (
              <option key={a} value={a}>
                {formatXaf(Number(a))}
              </option>
            ))}
          </Select>
          <label className="text-muted flex items-center gap-1.5 text-xs">
            Du{' '}
            <Input
              type="date"
              value={filters.du}
              onChange={(e) => setFilter('du', e.target.value)}
              className="w-auto"
            />
          </label>
          <label className="text-muted flex items-center gap-1.5 text-xs">
            au{' '}
            <Input
              type="date"
              value={filters.au}
              onChange={(e) => setFilter('au', e.target.value)}
              className="w-auto"
            />
          </label>
        </FilterBar>
        <DataTable
          caption="Paiements CinetPay"
          columns={paymentColumns}
          rows={query.data?.items}
          rowKey={(p) => p.id}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          empty="Aucun paiement ne correspond à ces critères"
          onRowClick={(p) => router.push(`/paiements/${p.id}`)}
        />
        {query.data && (
          <Pagination
            page={page}
            limit={query.data.limit}
            total={query.data.total}
            onPage={setPage}
          />
        )}
      </Card>
    </>
  );
}
