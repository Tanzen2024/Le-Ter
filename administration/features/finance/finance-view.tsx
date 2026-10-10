'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  HandCoins,
  Landmark,
  ShoppingCart,
  Ticket,
  Trophy,
  Wallet,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';

import { DataTable, Pagination } from '@/components/data/data-table';
import { FilterBar, SearchInput } from '@/components/data/filter-bar';
import { StatCard } from '@/components/data/stat-card';
import { ErrorState, InfoNote } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { isPeriod, PeriodSelect } from '@/features/shared/period';
import { useListState } from '@/hooks/use-list-state';
import { formatNumber, formatTokens, formatXaf, localDayStartIso } from '@/lib/format';
import { WALLET_KIND, WALLET_STATUS } from '@/lib/labels';
import type { FinanceOverview } from '@/types/admin';

import { financeOverviewQuery, transactionsQuery } from './api';
import { transactionColumns } from './columns';
import {
  MovementsDetail,
  PurchasesDetail,
  ReconciliationDetail,
  RevenueDetail,
} from './finance-detail-cards';
import { UnsupportedOperations } from './unsupported-operations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Somme de statuts de paiement EXCLUSIFS (un paiement n'a qu'un statut : aucun double compte). */
function purchasesBy(o: FinanceOverview | undefined, ...statuses: string[]) {
  if (!o) return undefined;
  return o.purchases.byStatus
    .filter((p) => statuses.includes(p.status))
    .reduce((t, p) => ({ count: t.count + p.count, amount: t.amount + p.amount }), {
      count: 0,
      amount: 0,
    });
}

/** Mouvements réussis (débit ou crédit effectif) d'une nature (mêmes critères que le rapprochement). */
function succeededMovements(o: FinanceOverview | undefined, kind: string) {
  if (!o) return undefined;
  const m = o.walletMovements.find((w) => w.kind === kind && w.status === 'succeeded');
  return { count: m?.count ?? 0, tokens: m?.tokens ?? 0 };
}

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
        // 12 cartes : 8 indicateurs principaux (rangées 1 et 2), 4 cartes de détail (rangée 3).
        // Colonnes selon la largeur de la zone de contenu (et non de la fenêtre).
        <div className="@container mb-6">
          <ul
            aria-label="Indicateurs financiers"
            className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-4"
          >
            <li>
              <StatCard
                label="Achats confirmés (période)"
                value={formatXaf(purchasesBy(o, 'SUCCESS')?.amount)}
                hint="Encaissés pour le compte des joueurs : pas un revenu"
                icon={ShoppingCart}
                tone="info"
                loading={!o}
              />
            </li>
            <li>
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
            </li>
            <li>
              <StatCard
                label="Recettes de la plateforme (période)"
                value={formatXaf(o?.platformRevenue.total)}
                hint="Écritures du compte de la plateforme (platform_ledger)"
                icon={HandCoins}
                tone="success"
                loading={!o}
              />
            </li>
            <li>
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
            </li>
            <li>
              <StatCard
                label="Paiements en attente (période)"
                value={formatNumber(purchasesBy(o, 'PENDING')?.count)}
                hint={o && `${formatXaf(purchasesBy(o, 'PENDING')?.amount)} non encore confirmés`}
                icon={Clock}
                tone="warning"
                loading={!o}
              />
            </li>
            <li>
              <StatCard
                label="Paiements échoués ou expirés (période)"
                value={formatNumber(purchasesBy(o, 'FAILED', 'EXPIRED')?.count)}
                hint={
                  o &&
                  `${formatXaf(purchasesBy(o, 'FAILED', 'EXPIRED')?.amount)} · aucun crédit effectué`
                }
                icon={XCircle}
                tone="danger"
                loading={!o}
              />
            </li>
            <li>
              <StatCard
                label="Inscriptions de tournoi débitées (période)"
                value={formatTokens(succeededMovements(o, 'tournament_entry')?.tokens)}
                hint={
                  o &&
                  `${formatNumber(succeededMovements(o, 'tournament_entry')?.count)} débits effectifs sur les comptes de jeu (jetons, pas une recette)`
                }
                icon={Ticket}
                tone="info"
                loading={!o}
              />
            </li>
            <li>
              <StatCard
                label="Gains de tournoi versés (période)"
                value={formatTokens(succeededMovements(o, 'tournament_prize')?.tokens)}
                hint={
                  o &&
                  `${formatNumber(succeededMovements(o, 'tournament_prize')?.count)} crédits effectifs aux joueurs (jetons)`
                }
                icon={Trophy}
                tone="accent"
                loading={!o}
              />
            </li>
            <li>
              <PurchasesDetail overview={o} />
            </li>
            <li>
              <MovementsDetail overview={o} />
            </li>
            <li>
              <RevenueDetail overview={o} />
            </li>
            <li>
              <ReconciliationDetail overview={o} />
            </li>
          </ul>
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
