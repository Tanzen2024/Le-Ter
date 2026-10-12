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
import { WALLET_STATUS, WITHDRAWAL_STATUS } from '@/lib/labels';
import type { WithdrawalVerificationResult } from '@/types/admin';

import { verifyWithdrawal, withdrawalQuery } from './api';
import { WithdrawalReconciliationCard } from './withdrawal-reconciliation';

const OUTCOME: Record<string, string> = {
  settled:
    'Statut final confirmé par CinetPay : le retrait a été réglé (remboursement appliqué une seule fois s’il a échoué).',
  processing: 'CinetPay indique que le transfert est toujours en cours : rien n’a changé.',
  unresolved:
    'Le transfert est introuvable chez CinetPay ou son envoi n’a pas abouti : aucun changement, il sera revérifié.',
  already_final: 'Le retrait est déjà dans un statut final : aucune vérification nécessaire.',
  error: 'La vérification n’a pas abouti : aucun changement n’a été appliqué.',
};

const REASONS: Record<string, string> = {
  merchant_transaction_id: 'Référence marchande différente chez CinetPay',
  transaction_id: 'Référence CinetPay différente',
  amount: 'Montant différent chez CinetPay',
  currency: 'Devise différente chez CinetPay',
  provider_error: 'CinetPay n’a pas répondu',
  provider_not_configured: 'Transferts CinetPay non configurés sur ce serveur',
};

/** Codes techniques enregistrés sur un retrait (jamais de secret ni de numéro). */
const ERROR_CODES: Record<string, string> = {
  PROVIDER_FAILED: 'Échec final confirmé par CinetPay',
  PROVIDER_NOT_FOUND: 'Transfert introuvable chez CinetPay',
  PROVIDER_MISMATCH: 'Statut relu incohérent (référence, montant ou devise)',
  PROVIDER_LOOKUP_FAILED: 'Relecture du statut impossible (CinetPay injoignable)',
  PROVIDER_REJECTED: 'Refus annoncé par CinetPay à l’envoi (non remboursé sans preuve)',
  RECIPIENT_CHANGED: 'Numéro d’inscription modifié depuis la création : envoi bloqué',
  TRANSFERS_DISABLED: 'Nouveaux transferts désactivés : jamais envoyé',
  MANUAL_REFUND_CONFIRMED: 'Remboursé par rapprochement (double validation)',
  PAID_AFTER_REFUND: 'ANOMALIE : CinetPay annonce un succès après remboursement',
};

const codeLabel = (code: string | null) => (code ? (ERROR_CODES[code] ?? code) : '—');

export function WithdrawalDetailView({ id }: { id: string }) {
  const client = useQueryClient();
  const query = useQuery(withdrawalQuery(id));
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<WithdrawalVerificationResult | null>(null);
  const w = query.data?.withdrawal;
  if (query.error)
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  if (!w) return <LoadingRows rows={8} />;

  async function verify() {
    setResult(await verifyWithdrawal(id));
    await client.invalidateQueries({ queryKey: ['admin', 'withdrawal', id] });
    await client.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
  }

  return (
    <>
      <PageHeader
        title={`Retrait ${w.reference}`}
        description={`${w.user.username ?? 'Joueur'} · créé le ${formatDateTime(w.createdAt)}`}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/retraits">
                <ArrowLeft /> Retraits
              </Link>
            </Button>
            {w.verification.available && (
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
                Statut enregistré : {WITHDRAWAL_STATUS[result.status]?.[0] ?? result.status}
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Retrait" />
            <CardBody>
              <DetailList
                items={[
                  ['Statut', <StatusBadge key="s" map={WITHDRAWAL_STATUS} value={w.status} />],
                  ['Jetons retirés', formatTokens(w.tokens)],
                  ['Montant envoyé', formatXaf(w.amount)],
                  [
                    'Frais CinetPay (compte marchand)',
                    w.providerFee === null ? 'Non communiqués' : formatXaf(w.providerFee),
                  ],
                  ['Opérateur', w.operatorLabel],
                  [
                    'Destinataire',
                    <span key="n" className="font-mono text-xs">
                      {w.msisdn}
                    </span>,
                  ],
                  ['Statut brut CinetPay', w.providerStatus ?? '—'],
                  ['Motif d’échec', codeLabel(w.failureCode)],
                  [
                    'Référence de retrait',
                    <span key="m" className="font-mono text-xs">
                      {w.reference}
                    </span>,
                  ],
                  [
                    'Référence CinetPay',
                    w.providerReference ? (
                      <span key="r" className="font-mono text-xs">
                        {w.providerReference}
                      </span>
                    ) : (
                      'Absente'
                    ),
                  ],
                  ['Créé', formatDateTime(w.createdAt)],
                  ['Finalisé', formatDateTime(w.completedAt)],
                  [
                    'Joueur',
                    <Link
                      key="u"
                      href={`/joueurs/${w.user.id}`}
                      className="text-info hover:underline"
                    >
                      {w.user.username ?? w.user.id}
                    </Link>,
                  ],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Compte de jeu et envoi" />
            <CardBody className="space-y-4">
              <DetailList
                items={[
                  [
                    'Transaction du compte de jeu',
                    <StatusBadge key="w" map={WALLET_STATUS} value={w.walletTransaction.status} />,
                  ],
                  ['Envois au fournisseur', String(w.submission.attempts)],
                  ['Dernier envoi', formatDateTime(w.submission.lastAttemptAt)],
                  ['Dernière vérification', formatDateTime(w.submission.lastCheckedAt)],
                ]}
              />
              {w.lastErrorCode && (
                <UnavailableNotice title="Dernière erreur technique">
                  {codeLabel(w.lastErrorCode)} · {formatDateTime(w.lastErrorAt)}
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
            {w.verification.history.length === 0 ? (
              <p className="text-muted text-sm">Aucune revérification demandée.</p>
            ) : (
              <ul className="space-y-3">
                {w.verification.history.map((e) => (
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
        <WithdrawalReconciliationCard withdrawal={w} />
        {!w.verification.providerConfigured && (
          <UnavailableNotice title="Revérification indisponible">
            Les transferts CinetPay ne sont pas activés sur ce serveur.
          </UnavailableNotice>
        )}
        <InfoNote>
          La revérification relit le statut du transfert chez CinetPay depuis le serveur, par la
          référence de retrait, avec les mêmes contrôles que la notification (références, montant,
          devise). Elle ne peut jamais marquer un retrait réussi sans confirmation de CinetPay, et
          un échec n’est remboursé qu’une seule fois.
        </InfoNote>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Revérifier ce retrait auprès de CinetPay ?"
        description="Le serveur interroge CinetPay et applique le statut final s’il en existe un. L’opération et son résultat sont inscrits au journal d’audit."
        confirmLabel="Revérifier"
        onConfirm={verify}
      />
    </>
  );
}
