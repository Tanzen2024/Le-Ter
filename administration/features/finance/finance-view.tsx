'use client';

import { useQuery } from '@tanstack/react-query';
import { HandCoins, Landmark, ShoppingCart, Wallet } from 'lucide-react';
import Link from 'next/link';

import { DataTable, Pagination } from '@/components/data/data-table';
import { FilterBar, SearchInput } from '@/components/data/filter-bar';
import { StatCard } from '@/components/data/stat-card';
import { StatusBadge } from '@/components/data/status-badge';
import { ErrorState, InfoNote } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { isPeriod, PeriodSelect } from '@/features/shared/period';
import { useListState } from '@/hooks/use-list-state';
import { formatNumber, formatTokens, formatXaf, localDayStartIso } from '@/lib/format';
import { label, LEDGER_KIND, PAYMENT_STATUS, WALLET_KIND, WALLET_STATUS } from '@/lib/labels';

import { financeOverviewQuery, transactionsQuery } from './api';
import { transactionColumns } from './columns';
import { UnsupportedOperations } from './unsupported-operations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nextDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function FinanceView() {
  const { filters, page, setFilter, setPage, reset } = useListState([
    'periode',
    'q',
    'kind',
    'status',
    'userId',
    'du',
    'au',
  ] as const);
  const period = isPeriod(filters.periode) ? filters.periode : '30';
  const overview = useQuery(financeOverviewQuery(Number(period)));
  const tx = useQuery(
    transactionsQuery({
      page,
      q: filters.q,
      kind: filters.kind,
      status: filters.status,
      userId: UUID.test(filters.userId) ? filters.userId : undefined,
      from: filters.du ? localDayStartIso(filters.du) : undefined,
      to: filters.au ? localDayStartIso(nextDay(filters.au)) : undefined,
    }),
  );
  const o = overview.data;
  const succeeded = o?.purchases.byStatus.find((p) => p.status === 'SUCCESS');

  return (
    <>
      <PageHeader
        title="Finances"
        description="Trois réalités distinctes, jamais additionnées : achats des joueurs, soldes des joueurs, recettes de la plateforme. Devise unique : FCFA (XAF)."
        actions={<PeriodSelect value={period} onChange={(v) => setFilter('periode', v)} />}
      />
      {overview.error ? (
        <Card className="mb-6">
          <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
        </Card>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Achats confirmés (période)"
            value={formatXaf(succeeded?.amount ?? 0)}
            hint="Encaissés pour le compte des joueurs : pas un revenu"
            icon={ShoppingCart}
            tone="info"
            loading={!o}
          />
          <StatCard
            label="Soldes des joueurs"
            value={formatTokens(o?.playerBalances.balance)}
            hint={
              o &&
              `Dont réservé : ${formatTokens(o.playerBalances.reserved)} · ${formatNumber(o.playerBalances.wallets)} comptes`
            }
            icon={Wallet}
            tone="warning"
            loading={!o}
          />
          <StatCard
            label="Recettes de la plateforme (période)"
            value={formatXaf(o?.platformRevenue.total)}
            hint="Commissions comptabilisées"
            icon={HandCoins}
            tone="success"
            loading={!o}
          />
          <StatCard
            label="Solde comptable de la plateforme"
            value={formatXaf(o?.platformAccountBalance)}
            hint={
              <Link href="/compte-plateforme" className="text-info hover:underline">
                Voir le compte
              </Link>
            }
            icon={Landmark}
            tone="primary"
            loading={!o}
          />
        </div>
      )}

      {o && (
        <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card>
            <CardHeader
              title="Achats CinetPay par statut"
              description="Paiements créés sur la période."
            />
            <CardBody>
              {o.purchases.byStatus.length === 0 ? (
                <p className="text-muted text-sm">Aucun paiement sur la période.</p>
              ) : (
                <ul className="space-y-2">
                  {o.purchases.byStatus.map((p) => (
                    <li key={p.status} className="flex items-center justify-between gap-3 text-sm">
                      <StatusBadge map={PAYMENT_STATUS} value={p.status} />
                      <span className="text-ink tabular-nums">
                        {formatNumber(p.count)} · {formatXaf(p.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Mouvements des comptes de jeu"
              description="Sur la période, en jetons."
            />
            <CardBody>
              {o.walletMovements.length === 0 ? (
                <p className="text-muted text-sm">Aucun mouvement sur la période.</p>
              ) : (
                <ul className="space-y-2">
                  {o.walletMovements.map((m) => (
                    <li
                      key={`${m.kind}-${m.status}`}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-ink-soft">
                        {label(WALLET_KIND, m.kind)}{' '}
                        <StatusBadge map={WALLET_STATUS} value={m.status} />
                      </span>
                      <span className="text-ink tabular-nums">{formatTokens(m.tokens)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Recettes par nature"
              description="Écritures du compte de la plateforme sur la période."
            />
            <CardBody>
              {o.platformRevenue.byKind.length === 0 ? (
                <p className="text-muted text-sm">Aucune recette enregistrée sur la période.</p>
              ) : (
                <ul className="space-y-2">
                  {o.platformRevenue.byKind.map((k) => (
                    <li key={k.kind} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink-soft">{label(LEDGER_KIND, k.kind)}</span>
                      <span className="text-ink tabular-nums">{formatXaf(k.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted mt-3 text-xs">
                Aucune commission n’existe sur les parties ordinaires (règle non définie).
              </p>
            </CardBody>
          </Card>
        </div>
      )}

      <Card className="mb-6">
        <CardHeader
          title="Transactions des comptes de jeu"
          description="Toutes les opérations enregistrées, la plus récente d’abord."
        />
        <FilterBar onReset={reset}>
          <SearchInput
            value={filters.q}
            onChange={(v) => setFilter('q', v)}
            placeholder="Référence exacte (transaction, CinetPay, marchand)"
            label="Rechercher par référence"
          />
          <Select
            aria-label="Type d’opération"
            value={filters.kind}
            onChange={(e) => setFilter('kind', e.target.value)}
            className="w-auto"
          >
            <option value="">Toutes les opérations</option>
            {Object.entries(WALLET_KIND).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Statut"
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(WALLET_STATUS).map(([v, [t]]) => (
              <option key={v} value={v}>
                {t}
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
        {filters.userId && (
          <p className="text-muted px-4 pt-3 text-xs">
            Filtré sur un joueur.{' '}
            <button className="text-info hover:underline" onClick={() => setFilter('userId', '')}>
              Retirer
            </button>
          </p>
        )}
        <DataTable
          caption="Transactions des comptes de jeu"
          columns={transactionColumns}
          rows={tx.data?.items}
          rowKey={(t) => t.id}
          loading={tx.isFetching}
          error={tx.error}
          onRetry={() => tx.refetch()}
          empty="Aucune transaction ne correspond à ces critères"
        />
        {tx.data && (
          <Pagination page={page} limit={tx.data.limit} total={tx.data.total} onPage={setPage} />
        )}
      </Card>

      {o && <UnsupportedOperations operations={o.unsupported} />}
      <InfoNote className="mt-6">
        Aucun solde n’est modifiable depuis l’administration et aucun paiement n’y est jamais marqué
        comme réussi : seule la confirmation de CinetPay, relue par le serveur, crédite un compte de
        jeu.
      </InfoNote>
    </>
  );
}
