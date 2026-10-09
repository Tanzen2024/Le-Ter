'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { DataTable, DetailList, Pagination } from '@/components/data/data-table';
import { StatCard } from '@/components/data/stat-card';
import { IdText, StatusBadge } from '@/components/data/status-badge';
import { ErrorState, LoadingRows, UnavailableNotice } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { gameColumns } from '@/features/games/columns';
import { transactionColumns } from '@/features/finance/columns';
import { formatDateTime, formatNumber, formatTokens, formatXaf } from '@/lib/format';
import { ACCOUNT_STATUS, ROLE } from '@/lib/labels';

import { playerGamesQuery, playerQuery, playerTransactionsQuery } from './api';

export function PlayerDetailView({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery(playerQuery(id));
  const [gamesPage, setGamesPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  const games = useQuery(playerGamesQuery(id, gamesPage));
  const transactions = useQuery(playerTransactionsQuery(id, txPage));
  const p = query.data?.user;

  if (query.error) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }
  if (!p) return <LoadingRows rows={8} />;

  return (
    <>
      <PageHeader
        title={p.username}
        description={`${p.firstName} ${p.lastName} · inscrit le ${formatDateTime(p.createdAt)}`}
        actions={
          <Button variant="secondary" asChild>
            <Link href="/joueurs">
              <ArrowLeft /> Retour à la liste
            </Link>
          </Button>
        }
      />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Solde du compte de jeu"
            value={formatTokens(p.balance)}
            hint={`Dont réservé : ${formatTokens(p.reserved)}`}
          />
          <StatCard
            label="Parties jouées"
            value={formatNumber(p.gamesPlayed)}
            hint={`${formatNumber(p.gamesWon)} gagnées`}
            tone="accent"
          />
          <StatCard
            label="Achats confirmés"
            value={formatXaf(p.payments.succeededAmount)}
            hint={`${p.payments.succeeded} sur ${p.payments.total} paiements`}
            tone="success"
          />
          <StatCard
            label="Inscriptions à des tournois"
            value={formatNumber(p.tournamentRegistrations)}
            hint="Inscriptions actives"
            tone="info"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Profil" description="Informations utiles au support." />
            <CardBody>
              <DetailList
                items={[
                  [
                    'Identifiant',
                    <span key="id" className="font-mono text-xs">
                      {p.id}
                    </span>,
                  ],
                  ['Pseudo', p.username],
                  ['Nom', `${p.firstName} ${p.lastName}`],
                  ['E-mail', p.email],
                  ['Téléphone', `${p.phone}${p.phoneVerified ? ' (vérifié)' : ' (non vérifié)'}`],
                  ['Rôle', <StatusBadge key="r" map={ROLE} value={p.role} />],
                  [
                    'Statut du compte',
                    <StatusBadge key="s" map={ACCOUNT_STATUS} value={p.status} />,
                  ],
                  ['Dernière modification', formatDateTime(p.updatedAt)],
                  ['Dernière partie', formatDateTime(p.lastGameAt)],
                  [
                    'Partie active',
                    p.activeGameId ? (
                      <Link
                        key="g"
                        href={`/parties/${p.activeGameId}`}
                        className="text-info hover:underline"
                      >
                        <IdText id={p.activeGameId} />
                      </Link>
                    ) : (
                      'Aucune'
                    ),
                  ],
                  [
                    'Table (session) ouverte',
                    p.activeSessionId ? <IdText key="ss" id={p.activeSessionId} /> : 'Aucune',
                  ],
                  ['Paiements en attente', formatNumber(p.payments.pending)],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Actions sur le compte" />
            <CardBody className="space-y-3">
              <Button variant="secondary" className="w-full" disabled aria-disabled>
                <ShieldOff /> Suspendre le compte
              </Button>
              <UnavailableNotice title="Suspension indisponible">
                {p.actions.suspend.reason}
              </UnavailableNotice>
              <p className="text-muted text-xs">
                Aucune suppression de compte n’est proposée par l’administration.
              </p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Historique des parties"
            description="Les cartes et les mains ne sont jamais affichées."
          />
          <DataTable
            caption="Parties du joueur"
            columns={gameColumns}
            rows={games.data?.items}
            rowKey={(g) => g.id}
            loading={games.isFetching}
            error={games.error}
            onRetry={() => games.refetch()}
            empty="Aucune partie"
            onRowClick={(g) => router.push(`/parties/${g.id}`)}
          />
          {games.data && (
            <Pagination
              page={gamesPage}
              limit={games.data.limit}
              total={games.data.total}
              onPage={setGamesPage}
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Historique des transactions"
            description="Opérations du compte de jeu (jetons)."
          />
          <DataTable
            caption="Transactions du joueur"
            columns={transactionColumns}
            rows={transactions.data?.items}
            rowKey={(t) => t.id}
            loading={transactions.isFetching}
            error={transactions.error}
            onRetry={() => transactions.refetch()}
            empty="Aucune transaction"
          />
          {transactions.data && (
            <Pagination
              page={txPage}
              limit={transactions.data.limit}
              total={transactions.data.total}
              onPage={setTxPage}
            />
          )}
        </Card>
      </div>
    </>
  );
}
