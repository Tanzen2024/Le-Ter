'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { DetailList } from '@/components/data/data-table';
import { StatusBadge } from '@/components/data/status-badge';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ErrorState, InfoNote, LoadingRows, UnavailableNotice } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { AuditEventLine } from '@/features/audit/audit-event-line';
import { formatDateTime, formatTokens, formatXaf } from '@/lib/format';
import { PAYMENT_STATUS, WALLET_STATUS } from '@/lib/labels';
import type { VerificationResult } from '@/types/admin';

import { paymentQuery, verifyPayment } from './api';

const OUTCOME: Record<string, string> = {
  settled:
    'Statut final confirmé par CinetPay : le paiement a été réglé (crédit appliqué une seule fois s’il est réussi).',
  already_processed: 'Le paiement avait déjà été réglé : aucun nouveau traitement.',
  pending: 'CinetPay indique que le paiement est toujours en cours : rien n’a changé.',
  already_final: 'Le paiement est déjà dans un statut final : aucune vérification nécessaire.',
  error: 'La vérification n’a pas abouti : aucun changement n’a été appliqué.',
};

const REASONS: Record<string, string> = {
  amount_mismatch: 'Montant différent chez CinetPay',
  currency_mismatch: 'Devise différente chez CinetPay',
  reference_mismatch: 'Références différentes chez CinetPay',
  provider_unavailable: 'Référence CinetPay absente : vérification impossible',
  provider_error: 'CinetPay n’a pas répondu',
};

export function PaymentDetailView({ id }: { id: string }) {
  const client = useQueryClient();
  const query = useQuery(paymentQuery(id));
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const p = query.data?.payment;
  if (query.error)
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  if (!p) return <LoadingRows rows={8} />;

  async function verify() {
    const outcome = await verifyPayment(id);
    setResult(outcome);
    await client.invalidateQueries({ queryKey: ['admin', 'payment', id] });
    await client.invalidateQueries({ queryKey: ['admin', 'payments'] });
  }

  return (
    <>
      <PageHeader
        title={`Paiement ${p.merchantTransactionId}`}
        description={`${p.username} · créé le ${formatDateTime(p.createdAt)}`}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/paiements">
                <ArrowLeft /> Paiements
              </Link>
            </Button>
            {p.verification.available && (
              <Button onClick={() => setConfirming(true)}>
                <RefreshCw /> Revérifier auprès de CinetPay
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-6">
        {result && (
          <div
            role="status"
            className={
              result.outcome === 'error'
                ? 'bg-danger-soft text-danger rounded-lg px-4 py-3 text-sm'
                : 'bg-success-soft text-success rounded-lg px-4 py-3 text-sm'
            }
          >
            <p className="font-medium">{OUTCOME[result.outcome] ?? result.outcome}</p>
            {result.reason && (
              <p className="mt-0.5">Motif : {REASONS[result.reason] ?? result.reason}</p>
            )}
            {result.status && (
              <p className="mt-0.5">
                Statut enregistré : {PAYMENT_STATUS[result.status]?.[0] ?? result.status}
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Paiement" />
            <CardBody>
              <DetailList
                items={[
                  ['Statut', <StatusBadge key="s" map={PAYMENT_STATUS} value={p.status} />],
                  ['Montant', formatXaf(p.amount)],
                  ['Devise', p.currency],
                  ['Statut brut CinetPay', p.providerStatus ?? '—'],
                  ['Moyen de paiement', p.paymentMethod ?? '—'],
                  [
                    'Référence marchand',
                    <span key="m" className="font-mono text-xs">
                      {p.merchantTransactionId}
                    </span>,
                  ],
                  [
                    'Référence CinetPay',
                    p.providerReference ? (
                      <span key="r" className="font-mono text-xs">
                        {p.providerReference}
                      </span>
                    ) : (
                      'Absente'
                    ),
                  ],
                  [
                    'Identifiant',
                    <span key="i" className="font-mono text-xs">
                      {p.id}
                    </span>,
                  ],
                  ['Créé', formatDateTime(p.createdAt)],
                  ['Mis à jour', formatDateTime(p.updatedAt)],
                  ['Finalisé', formatDateTime(p.completedAt)],
                  [
                    'Joueur',
                    <Link
                      key="u"
                      href={`/joueurs/${p.userId}`}
                      className="text-info hover:underline"
                    >
                      {p.username}
                    </Link>,
                  ],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Achat du compte de jeu" />
            <CardBody className="space-y-4">
              <DetailList
                items={[
                  [
                    'Statut',
                    <StatusBadge key="w" map={WALLET_STATUS} value={p.walletTransaction.status} />,
                  ],
                  ['Jetons', formatTokens(p.walletTransaction.tokens)],
                ]}
              />
              {p.initializationFailure && (
                <UnavailableNotice title="Échec d’initialisation">
                  {p.initializationFailure}
                </UnavailableNotice>
              )}
              {p.settlementAnomaly && (
                <UnavailableNotice title="Anomalie de règlement">
                  {p.settlementAnomaly}
                </UnavailableNotice>
              )}
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader
            title="Historique des vérifications"
            description="Revérifications demandées depuis l’administration (journal d’audit)."
          />
          <CardBody>
            {p.verification.history.length === 0 ? (
              <p className="text-muted text-sm">Aucune revérification demandée.</p>
            ) : (
              <ul className="space-y-3">
                {p.verification.history.map((e) => (
                  <li key={e.id}>
                    <AuditEventLine event={e} />
                    <p className="text-muted ml-6.5 text-xs">
                      Résultat :{' '}
                      {String(
                        (e.details.result as { outcome?: string } | undefined)?.outcome ?? '—',
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        {!p.verification.providerConfigured && (
          <UnavailableNotice title="Revérification indisponible">
            CinetPay n’est pas configuré sur ce serveur.
          </UnavailableNotice>
        )}
        <InfoNote>
          La revérification relit le statut chez CinetPay depuis le serveur, avec les mêmes
          contrôles que la notification (références, montant, devise). Elle ne peut jamais marquer
          un paiement réussi sans confirmation de CinetPay. Remboursement : non pris en charge.
        </InfoNote>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Revérifier ce paiement auprès de CinetPay ?"
        description="Le serveur interroge CinetPay et applique le statut final s’il en existe un. L’opération et son résultat sont inscrits au journal d’audit."
        confirmLabel="Revérifier"
        onConfirm={verify}
      />
    </>
  );
}
