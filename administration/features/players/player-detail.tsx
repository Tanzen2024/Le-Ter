'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { DataTable, DetailList, Pagination } from '@/components/data/data-table';
import { StatCard } from '@/components/data/stat-card';
import { IdText, StatusBadge } from '@/components/data/status-badge';
import { ErrorState, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { gameColumns } from '@/features/games/columns';
import { transactionColumns } from '@/features/finance/columns';
import { formatDateTime, formatNumber, formatTokens, formatXaf } from '@/lib/format';
import { ROLE } from '@/lib/labels';
import { cn } from '@/lib/utils';

import {
  playerGamesQuery,
  playerModerationQuery,
  playerQuery,
  playerTransactionsQuery,
} from './api';
import { AccountBadges } from './player-actions';
import {
  ModerationActionsCard,
  ModerationLogSection,
  NotesSection,
  SanctionsSection,
  SecuritySection,
} from './player-moderation';

const TABS = [
  ['profil', 'Profil'],
  ['securite', 'Sécurité'],
  ['activite', 'Activité'],
  ['moderation', 'Modération'],
] as const;
type Tab = (typeof TABS)[number][0];

/** Téléphone masqué par défaut (indicatif et deux derniers chiffres), affiché sur demande. */
function MaskedPhone({ phone, verified }: { phone: string; verified: boolean }) {
  const [shown, setShown] = useState(false);
  const masked = phone.length <= 6 ? '••••' : `${phone.slice(0, 4)}••••${phone.slice(-2)}`;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-xs">{shown ? phone : masked}</span>
      <span className="text-muted text-xs">{verified ? '(vérifié)' : '(non vérifié)'}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Masquer le téléphone' : 'Afficher le téléphone'}
      >
        {shown ? <EyeOff /> : <Eye />}
      </Button>
    </span>
  );
}

export function PlayerDetailView({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery(playerQuery(id));
  const moderation = useQuery(playerModerationQuery(id));
  const [tab, setTab] = useState<Tab>('profil');
  const [gamesPage, setGamesPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  const games = useQuery({ ...playerGamesQuery(id, gamesPage), enabled: tab === 'activite' });
  const transactions = useQuery({
    ...playerTransactionsQuery(id, txPage),
    enabled: tab === 'activite',
  });
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
          <div className="min-w-0 space-y-6 xl:col-span-2">
            <div
              role="tablist"
              aria-label="Sections de la fiche"
              className="border-line flex gap-1 overflow-x-auto border-b"
            >
              {TABS.map(([key, text]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`tab-${key}`}
                  aria-selected={tab === key}
                  aria-controls={`panel-${key}`}
                  onClick={() => setTab(key)}
                  className={cn(
                    '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                    tab === key
                      ? 'border-primary text-ink'
                      : 'text-muted hover:text-ink border-transparent',
                  )}
                >
                  {text}
                </button>
              ))}
            </div>

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'profil' && (
                <Card>
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
                        [
                          'Téléphone',
                          <MaskedPhone key="ph" phone={p.phone} verified={p.phoneVerified} />,
                        ],
                        ['Rôle', <StatusBadge key="r" map={ROLE} value={p.role} />],
                        ['État du compte', <AccountBadges key="s" player={p} />],
                        ['Inscription', formatDateTime(p.createdAt)],
                        ['Dernière modification', formatDateTime(p.updatedAt)],
                        [
                          'Dernière activité de session',
                          formatDateTime(moderation.data?.security.lastSessionActivityAt),
                        ],
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
              )}

              {tab === 'securite' &&
                (moderation.error ? (
                  <Card>
                    <ErrorState error={moderation.error} onRetry={() => moderation.refetch()} />
                  </Card>
                ) : moderation.data ? (
                  <SecuritySection player={p} moderation={moderation.data} />
                ) : (
                  <LoadingRows rows={6} />
                ))}

              {tab === 'activite' && (
                <div className="space-y-6">
                  <Card>
                    <CardHeader
                      title="Historique des parties"
                      description="Résultats enregistrés par le moteur ; les cartes et les mains ne sont jamais affichées."
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
                      description="Opérations du compte de jeu (jetons), en lecture seule."
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
              )}

              {tab === 'moderation' && (
                <div className="space-y-6">
                  <SanctionsSection playerId={p.id} />
                  <NotesSection playerId={p.id} />
                  <ModerationLogSection playerId={p.id} />
                </div>
              )}
            </div>
          </div>

          <ModerationActionsCard player={p} moderation={moderation.data} />
        </div>
      </div>
    </>
  );
}
