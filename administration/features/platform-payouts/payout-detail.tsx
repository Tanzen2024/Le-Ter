'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { DetailList } from '@/components/data/data-table';
import { StatusBadge } from '@/components/data/status-badge';
import { ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatDateTime, formatXaf } from '@/lib/format';
import { entry, label, PAYOUT_BLOCKER, PLATFORM_PAYOUT_STATUS } from '@/lib/labels';
import type { PlatformPayoutDetail } from '@/types/admin';

import { decidePayout, payoutQuery, type PayoutDecision } from './api';
import { NoteDialog } from './note-dialog';

/** Événements de l'historique (serveur) en français. */
const EVENT: Record<string, string> = {
  CREATED: 'Demande créée',
  APPROVED_AND_RESERVED: 'Approuvée, fonds réservés',
  REJECTED: 'Rejetée',
  CANCELLED: 'Annulée',
  RELEASED_FOR_EXECUTION: 'Mise en exécution',
  SUBMISSION_CLAIMED: 'Envoi revendiqué par l’exécuteur',
  SUBMISSION_DEFERRED: 'Envoi reporté (contrôle préalable)',
  NOT_SENT: 'Non envoyé (certain), reprogrammé',
  PROVIDER_ACCEPTED: 'Accepté par CinetPay (non final)',
  SUBMISSION_OUTCOME_UNKNOWN: 'Issue de l’envoi inconnue',
  SUBMISSION_INTERRUPTED: 'Envoi interrompu (redémarrage)',
  PROVIDER_PROCESSING: 'En cours chez CinetPay',
  PROVIDER_CONFIRMED_SUCCESS: 'Succès confirmé par relecture CinetPay',
  PROVIDER_CONFIRMED_FAILURE: 'Échec confirmé par relecture CinetPay',
  PROVIDER_MISMATCH: 'Statut relu incohérent',
  RECONCILIATION_REQUIRED: 'Rapprochement requis',
};

const DIALOGS: Record<
  Exclude<PayoutDecision, 'check'>,
  { title: string; description: string; confirm: string; required: boolean; tone?: 'danger' }
> = {
  approve: {
    title: 'Approuver et réserver',
    description:
      'Le serveur recalcule le montant retirable ; s’il le couvre, le montant et les frais estimés sont réservés. Aucun transfert n’est envoyé.',
    confirm: 'Approuver',
    required: false,
  },
  reject: {
    title: 'Rejeter la demande',
    description: 'Statut final.',
    confirm: 'Rejeter',
    required: true,
    tone: 'danger',
  },
  cancel: {
    title: 'Annuler avant exécution',
    description: 'La réservation éventuelle est libérée. Impossible après l’envoi.',
    confirm: 'Annuler la demande',
    required: true,
    tone: 'danger',
  },
  release: {
    title: 'Mettre en exécution',
    description:
      'Trésorerie confirmée exigée ; l’exécuteur relira encore le solde avant l’unique envoi à CinetPay.',
    confirm: 'Mettre en exécution',
    required: false,
  },
};

export function PayoutDetailView({ id }: { id: string }) {
  const client = useQueryClient();
  const query = useQuery(payoutQuery(id));
  const [dialog, setDialog] = useState<Exclude<PayoutDecision, 'check'> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const p = query.data?.payout;

  if (query.error)
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  if (!p) return <LoadingRows rows={8} />;

  async function act(decision: PayoutDecision, note?: string) {
    const result = await decidePayout(id, decision, note);
    setMessage(`Statut enregistré : ${entry(PLATFORM_PAYOUT_STATUS, result.status)[0]}`);
    await client.invalidateQueries({ queryKey: ['admin', 'platform-finance'] });
  }

  const actions = (Object.keys(DIALOGS) as (keyof typeof DIALOGS)[]).filter(
    (a) => p.actions[a].allowed || p.actions[a].reason,
  );

  return (
    <>
      <PageHeader
        title={`Retrait ${p.reference}`}
        description={`${p.purpose} · créé le ${formatDateTime(p.createdAt)}`}
        actions={
          <Button variant="secondary" asChild>
            <Link href="/retraits-plateforme">
              <ArrowLeft /> Retraits de la plateforme
            </Link>
          </Button>
        }
      />
      {message && (
        <p role="status" className="bg-success-soft text-success mb-4 rounded-lg px-4 py-3 text-sm">
          {message}
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Demande"
            actions={<StatusBadge map={PLATFORM_PAYOUT_STATUS} value={p.status} />}
          />
          <CardBody>
            <DetailList items={detailItems(p)} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Actions"
            description="Droits calculés par le serveur pour votre compte"
          />
          <CardBody className="space-y-3">
            {actions.map((a) => (
              <div key={a}>
                <Button
                  className="w-full"
                  variant={DIALOGS[a].tone === 'danger' ? 'secondary' : 'primary'}
                  disabled={!p.actions[a].allowed}
                  onClick={() => setDialog(a)}
                >
                  {DIALOGS[a].confirm}
                </Button>
                {!p.actions[a].allowed && p.actions[a].reason && (
                  <p className="text-muted mt-1 text-xs">
                    {label(PAYOUT_BLOCKER, p.actions[a].reason)}
                  </p>
                )}
              </div>
            ))}
            {p.actions.check.allowed && (
              <Button
                className="w-full"
                variant="secondary"
                onClick={() =>
                  void act('check').catch(() =>
                    setMessage('Relecture impossible : aucun changement.'),
                  )
                }
              >
                Relire le statut chez CinetPay
              </Button>
            )}
            {actions.length === 0 && !p.actions.check.allowed && (
              <InfoNote>Aucune action possible dans cet état.</InfoNote>
            )}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader
          title="Historique"
          description="Événements enregistrés par le serveur (ajout seul)"
        />
        <CardBody>
          <ol className="space-y-3">
            {p.events.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-ink font-medium">{EVENT[e.event] ?? e.event}</span>
                <span className="text-muted">
                  {' · '}
                  {formatDateTime(e.createdAt)} · {e.actor?.username ?? 'Système'}
                </span>
                {Object.keys(e.details).length > 0 && (
                  <span className="text-muted block font-mono text-xs">
                    {JSON.stringify(e.details)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
      {dialog && (
        <NoteDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={DIALOGS[dialog].title}
          description={DIALOGS[dialog].description}
          confirmLabel={DIALOGS[dialog].confirm}
          tone={DIALOGS[dialog].tone === 'danger' ? 'danger' : 'primary'}
          required={DIALOGS[dialog].required}
          noteLabel="Motif"
          onConfirm={(note) => act(dialog, note)}
        />
      )}
    </>
  );
}

function detailItems(p: PlatformPayoutDetail): [string, React.ReactNode][] {
  return [
    ['Montant demandé', formatXaf(p.amount)],
    ['Frais estimés', formatXaf(p.estimatedFee)],
    ['Montant définitif', p.finalAmount === null ? 'Non confirmé' : formatXaf(p.finalAmount)],
    ['Frais définitifs', p.finalFee === null ? 'Non confirmés' : formatXaf(p.finalFee)],
    ['Bénéficiaire', `${p.beneficiary.label} · ${p.beneficiary.msisdn} · MTN Mobile Money`],
    ['Référence interne', p.reference],
    ['Référence CinetPay', p.providerReference ?? '—'],
    ['Statut CinetPay relu', p.providerStatus ?? '—'],
    ['Initiateur', p.initiatedBy.username ?? '—'],
    [
      'Approbateur',
      p.approvedBy ? `${p.approvedBy.username ?? '—'} · ${formatDateTime(p.approvedAt)}` : '—',
    ],
    [
      'Mise en exécution',
      p.releasedBy ? `${p.releasedBy.username ?? '—'} · ${formatDateTime(p.releasedAt)}` : '—',
    ],
    [
      'Décision (rejet, annulation)',
      p.decidedBy ? `${p.decidedBy.username ?? '—'} · ${p.decisionNote ?? ''}` : '—',
    ],
    ['Envois', `${p.submissionAttempts} (un seul envoi possible)`],
    [
      'Dernière relecture',
      p.lastCheckedAt
        ? `${formatDateTime(p.lastCheckedAt)} · introuvable ${p.notFoundChecks} fois`
        : '—',
    ],
    [
      'Dernière erreur',
      p.lastErrorCode ? `${p.lastErrorCode} · ${formatDateTime(p.lastErrorAt)}` : '—',
    ],
    ['Résultat du rapprochement', p.reconciliationResult ?? '—'],
    ['Mise à jour', formatDateTime(p.updatedAt)],
  ];
}
