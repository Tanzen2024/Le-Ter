'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Lock } from 'lucide-react';
import Link from 'next/link';

import { DetailList } from '@/components/data/data-table';
import { IdText, StatusBadge } from '@/components/data/status-badge';
import { ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatDateTime, formatDuration, formatNumber, shortId } from '@/lib/format';
import { END_REASON, GAME_ANOMALY, GAME_STATUS, label } from '@/lib/labels';

import { gameQuery } from './api';

export function GameDetailView({ id }: { id: string }) {
  const query = useQuery(gameQuery(id));
  const g = query.data?.game;
  if (query.error) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }
  if (!g) return <LoadingRows rows={8} />;
  return (
    <>
      <PageHeader
        title={`Partie ${shortId(g.id)}`}
        description={`Créée le ${formatDateTime(g.createdAt)}${g.tournament ? ` · ${g.tournament.name ?? 'Tournoi'}` : ''}`}
        actions={
          <Button variant="secondary" asChild>
            <Link href="/parties">
              <ArrowLeft /> Retour aux parties
            </Link>
          </Button>
        }
      />
      <div className="space-y-6">
        {g.anomalies.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {g.anomalies.map((a) => (
              <Badge key={a} tone="warning">
                <AlertTriangle className="size-3" aria-hidden /> {label(GAME_ANOMALY, a)}
              </Badge>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Déroulement" />
            <CardBody>
              <DetailList
                items={[
                  [
                    'Identifiant',
                    <span key="id" className="font-mono text-xs">
                      {g.id}
                    </span>,
                  ],
                  ['Statut', <StatusBadge key="s" map={GAME_STATUS} value={g.status} />],
                  ['Démarrée', formatDateTime(g.startedAt)],
                  ['Terminée', formatDateTime(g.finishedAt)],
                  ['Durée', formatDuration(g.durationSeconds)],
                  ['Fin', label(END_REASON, g.endReason)],
                  ['Gagnant', g.winner?.username ?? '—'],
                  ['Premier joueur (J1)', g.firstPlayerUsername ?? '—'],
                  ['Créateur', g.creatorUsername ?? '—'],
                  ['Mise enregistrée', g.stakeAmount === null ? '—' : formatNumber(g.stakeAmount)],
                  [
                    'Reprise de la partie',
                    g.replayOfGameId ? <IdText key="r" id={g.replayOfGameId} /> : '—',
                  ],
                  [
                    'Tournoi',
                    g.tournament ? (
                      <Link
                        key="t"
                        href={`/tournois/${g.tournament.id}`}
                        className="text-info hover:underline"
                      >
                        {g.tournament.name ?? 'Voir le tournoi'}
                      </Link>
                    ) : (
                      'Partie ordinaire'
                    ),
                  ],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Table (session)" />
            <CardBody>
              <DetailList
                items={[
                  ['Session', <IdText key="s" id={g.session.id} />],
                  ['Statut', g.session.status === 'open' ? 'Ouverte' : 'Fermée'],
                  ['Nom', g.session.name ?? '—'],
                  ['Places', g.session.maxPlayers ?? '—'],
                  ['Créée par', g.session.creatorUsername ?? '—'],
                  ['Parties de la session', formatNumber(g.session.gamesCount)],
                  [
                    'Détection anti-collusion',
                    g.session.suspicionDetectionEnabled ? 'Activée' : 'Désactivée',
                  ],
                  ['Alertes liées', formatNumber(g.detectionAlerts)],
                  ['Messages de chat', formatNumber(g.chatMessages)],
                ]}
              />
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title="Participants" description="Sièges dans l’ordre de la table." />
          <CardBody>
            <ul className="divide-line divide-y">
              {g.players.map((p) => (
                <li
                  key={p.playerId}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="bg-surface-muted text-ink-soft ring-line flex size-7 items-center justify-center rounded-full text-xs font-medium ring-1">
                      {p.seat + 1}
                    </span>
                    <Link
                      href={`/joueurs/${p.playerId}`}
                      className="text-ink font-medium hover:underline"
                    >
                      {p.username}
                    </Link>
                    {g.winner?.id === p.playerId && <Badge tone="success">Gagnant</Badge>}
                    {p.fledAt && <Badge tone="warning">A fui</Badge>}
                  </div>
                  <span className="text-muted text-xs">Arrivé le {formatDateTime(p.joinedAt)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <InfoNote>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Lock className="size-3.5" aria-hidden /> Confidentialité du jeu
          </span>
          <br />
          {g.privacy} Aucune action sur une partie n’est disponible : ses règles et ses effets sur
          le moteur de jeu ne sont pas définis.
        </InfoNote>
      </div>
    </>
  );
}
