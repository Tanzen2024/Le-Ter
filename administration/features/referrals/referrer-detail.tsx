'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { DetailList } from '@/components/data/data-table';
import { IdText } from '@/components/data/status-badge';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/form-controls';
import { formatDateTime, formatNumber, formatTokens } from '@/lib/format';

import {
  referralKeys,
  referrerQuery,
  requestReevaluation,
  reviewAttribution,
  type RefereeDetail,
} from './api';
import { AuditLines, CampaignBadge, REVIEW_LABEL } from './referral-ui';

type Decision = 'FLAG' | 'CLEAR' | 'REJECT';

const DECISIONS: Record<Decision, { label: string; title: string; description: string }> = {
  FLAG: {
    label: 'Mettre en vérification',
    title: 'Mettre cette attribution en vérification ?',
    description: 'Le filleul cesse d’être compté dans les paliers à venir. Les récompenses déjà créditées restent acquises.',
  },
  CLEAR: {
    label: 'Valider',
    title: 'Valider cette attribution ?',
    description: 'Le filleul est de nouveau compté s’il est qualifié ; le parrain est réévalué par le serveur.',
  },
  REJECT: {
    label: 'Écarter',
    title: 'Écarter cette attribution ?',
    description: 'Le filleul ne comptera plus. Aucune récompense déjà créditée n’est reprise.',
  },
};

/**
 * Détail d'un parrain (D-161) : filleuls, recharges confirmées, paliers, crédits du registre et
 * historique. La consultation est auditée par le serveur. Aucune action ne crédite des jetons.
 */
export function ReferrerDetailView({ id }: { id: string }) {
  const client = useQueryClient();
  const query = useQuery(referrerQuery(id));
  const [review, setReview] = useState<{ referee: RefereeDetail; decision: Decision }>();
  const [reason, setReason] = useState('');
  const d = query.data;
  const refresh = () => client.invalidateQueries({ queryKey: referralKeys.all });

  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!d) return <LoadingRows rows={8} />;
  const threshold = d.campaign.rules.qualificationThreshold;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Parrain : ${d.user.username}`}
        description={
          <>
            <Link href="/parrainage" className="text-info hover:underline">
              ← Parrainage
            </Link>{' '}
            · fiche consultée et inscrite au journal d’audit.
          </>
        }
        actions={
          <>
            <CampaignBadge status={d.campaign.status} />
            <Button
              variant="secondary"
              onClick={async () => {
                await requestReevaluation(d.user.id);
                toast.success('Réévaluation demandée : le serveur relit le registre (sans double crédit).');
                await refresh();
              }}
            >
              Réévaluer
            </Button>
          </>
        }
      />
      <Card>
        <CardHeader title="Synthèse" />
        <CardBody>
          <DetailList
            items={[
              ['Joueur', `${d.user.username} (n° ${d.user.playerNumber}, ${d.user.status})`],
              ['Code personnel', <span key="c" className="font-mono">{d.code}</span>],
              ['Code créé le', formatDateTime(d.codeCreatedAt)],
              ['Filleuls attribués', formatNumber(d.referees.length)],
              ['Filleuls comptés', formatNumber(d.referees.filter((r) => r.counted).length)],
              ['Paliers crédités', formatNumber(d.rewards.length)],
              ['Total crédité', formatTokens(d.rewards.reduce((s, r) => s + r.amount, 0))],
              [
                'Prochain palier',
                d.nextTier
                  ? `Palier ${d.nextTier.tier} à ${d.nextTier.referralsRequired} filleuls comptés (encore ${d.nextTier.remaining}) : +${formatTokens(d.nextTier.reward)}`
                  : 'Plafond atteint',
              ],
              ['Paliers atteints non crédités', formatNumber(d.withheldTiers)],
              [
                'File d’évaluation',
                d.queue
                  ? `En attente depuis ${formatDateTime(d.queue.enqueuedAt)} · ${d.queue.attempts} tentative(s)${d.queue.lastError ? ` · erreur : ${d.queue.lastError}` : ''}`
                  : 'Aucune demande en attente',
              ],
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Filleuls"
          description={`Chaque filleul doit atteindre seul ${formatTokens(threshold)} de recharges confirmées (achats « succeeded » du compte de jeu).`}
        />
        <CardBody>
          {d.referees.length === 0 ? (
            <p className="text-muted text-sm">Aucun filleul.</p>
          ) : (
            <ul className="divide-line divide-y">
              {d.referees.map((r) => {
                const [reviewText, reviewTone] = REVIEW_LABEL[r.reviewStatus];
                const ratio = Math.min(1, r.confirmedDeposits / threshold);
                return (
                  <li key={r.attributionId} className="space-y-2 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-ink font-medium">{r.username}</span>
                      <span className="text-muted text-xs">n° {r.playerNumber}</span>
                      {r.qualifiedAt ? (
                        <Badge tone="success" dot>
                          Qualifié le {formatDateTime(r.qualifiedAt)} (règles v{r.qualificationRulesVersion})
                        </Badge>
                      ) : (
                        <Badge tone="info" dot>
                          En cours
                        </Badge>
                      )}
                      <Badge tone={r.counted ? 'primary' : 'neutral'}>{r.counted ? 'Compté' : 'Non compté'}</Badge>
                      <Badge tone={reviewTone}>{reviewText}</Badge>
                      {r.refereeStatus !== 'active' && <Badge tone="danger">Compte {r.refereeStatus}</Badge>}
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`Recharges confirmées de ${r.username}`}
                      aria-valuemin={0}
                      aria-valuemax={threshold}
                      aria-valuenow={Math.min(r.confirmedDeposits, threshold)}
                      className="bg-surface-muted h-2 overflow-hidden rounded-full"
                    >
                      <div className="bg-primary h-full" style={{ width: `${ratio * 100}%` }} />
                    </div>
                    <p className="text-muted text-xs">
                      {formatTokens(r.confirmedDeposits)} confirmés / {formatTokens(threshold)} · attribué le{' '}
                      {formatDateTime(r.attributedAt)} ({r.source === 'LINK' ? 'lien' : 'saisie'}, code {r.referralCode})
                      {r.reviewReason && ` · motif du contrôle : « ${r.reviewReason} »`}
                    </p>
                    {r.deposits.length > 0 && (
                      <details className="text-xs">
                        <summary className="text-info cursor-pointer">
                          {r.deposits.length} recharge(s) confirmée(s)
                        </summary>
                        <ul className="mt-1 space-y-0.5">
                          {r.deposits.map((dep) => (
                            <li key={dep.walletTransactionId} className="flex gap-2">
                              <IdText id={dep.walletTransactionId} />
                              <span>{formatTokens(dep.tokens)}</span>
                              <span className="text-faint">{formatDateTime(dep.completedAt)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {(['FLAG', 'CLEAR', 'REJECT'] as const)
                        .filter((decision) =>
                          decision === 'FLAG'
                            ? r.reviewStatus !== 'FLAGGED'
                            : decision === 'CLEAR'
                              ? r.reviewStatus === 'FLAGGED' || r.reviewStatus === 'REJECTED'
                              : r.reviewStatus !== 'REJECTED',
                        )
                        .map((decision) => (
                          <Button
                            key={decision}
                            size="sm"
                            variant={decision === 'REJECT' ? 'danger' : 'secondary'}
                            onClick={() => setReview({ referee: r, decision })}
                          >
                            {DECISIONS[decision].label}
                          </Button>
                        ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Récompenses créditées"
          description="Chaque palier est crédité une seule fois (clé d’idempotence unique) dans le registre du compte de jeu."
        />
        <CardBody>
          {d.rewards.length === 0 ? (
            <p className="text-muted text-sm">Aucune récompense.</p>
          ) : (
            <ul className="divide-line divide-y text-sm">
              {d.rewards.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="text-ink font-medium">Palier {r.tier}</span>
                  <span>+{formatTokens(r.amount)}</span>
                  <span className="text-muted">
                    à {r.referralsRequired} filleuls · règles v{r.rulesVersion}
                  </span>
                  <span className="text-muted">
                    écriture <IdText id={r.walletTransactionId} /> ·{' '}
                    <span className="font-mono text-xs">{r.idempotencyKey}</span>
                  </span>
                  <span className="text-faint ml-auto text-xs">{formatDateTime(r.creditedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Historique (audit)" />
        <CardBody>
          <AuditLines items={d.history} />
        </CardBody>
      </Card>

      <InfoNote>
        Aucune action de cette page ne crédite ni ne débite des jetons : le serveur qualifie et crédite
        seul, à partir des recharges confirmées.
      </InfoNote>

      {review && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setReview(undefined);
              setReason('');
            }
          }}
          title={DECISIONS[review.decision].title}
          description={DECISIONS[review.decision].description}
          confirmLabel={DECISIONS[review.decision].label}
          tone={review.decision === 'REJECT' ? 'danger' : 'primary'}
          onConfirm={async () => {
            await reviewAttribution(review.referee.attributionId, review.decision, reason.trim());
            toast.success('Contrôle enregistré et audité.');
            await refresh();
          }}
        >
          <Field id="review-reason" label={`Motif (obligatoire) — ${review.referee.username}`}>
            <Textarea id="review-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </ConfirmDialog>
      )}
    </div>
  );
}
