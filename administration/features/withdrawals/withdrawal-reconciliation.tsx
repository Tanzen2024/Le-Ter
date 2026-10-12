'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { InfoNote, UnavailableNotice } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import { AuditEventLine } from '@/features/audit/audit-event-line';
import { useAdminSession } from '@/hooks/use-session';
import { ApiError } from '@/lib/api/errors';
import { formatDateTime, formatTokens } from '@/lib/format';
import type { WithdrawalDetail, WithdrawalRefundRequest } from '@/types/admin';

import { decideWithdrawalRefund, escalateWithdrawal, proposeWithdrawalRefund } from './api';

const REQUEST_STATUS: Record<
  WithdrawalRefundRequest['status'],
  [string, 'warning' | 'success' | 'neutral']
> = {
  PENDING: ['En attente d’un second administrateur', 'warning'],
  APPROVED: ['Approuvée — remboursé', 'success'],
  REJECTED: ['Rejetée', 'neutral'],
};

/** Champs renvoyés en erreur par le serveur (400) : affichés sous le formulaire. */
function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError && err.fields ? err.fields : {};
}

/**
 * Rapprochement d'un retrait bloqué (D-076). Aucune action ne déclare un retrait réussi.
 * Un remboursement exige : 24 h écoulées, une confirmation ÉCRITE de CinetPay (référence),
 * une relecture « introuvable » à la proposition ET à l'approbation, et deux administrateurs.
 */
export function WithdrawalReconciliationCard({ withdrawal }: { withdrawal: WithdrawalDetail }) {
  const client = useQueryClient();
  const session = useAdminSession();
  const me = session.data?.user.id;
  const r = withdrawal.reconciliation;
  const [ticket, setTicket] = useState('');
  const [justification, setJustification] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmPropose, setConfirmPropose] = useState(false);
  const [decision, setDecision] = useState<{
    request: WithdrawalRefundRequest;
    approve: boolean;
  }>();
  const [note, setNote] = useState('');
  const [escalation, setEscalation] = useState({ providerTicket: '', note: '' });

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['admin', 'withdrawal', withdrawal.id] });
    await client.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
  };

  async function propose() {
    try {
      const result = await proposeWithdrawalRefund(withdrawal.id, {
        providerTicket: ticket.trim(),
        justification: justification.trim(),
      });
      toast.success(
        result.outcome === 'proposed'
          ? 'Demande enregistrée : un autre administrateur doit l’approuver.'
          : 'CinetPay a confirmé un statut final : retrait réglé sans demande.',
      );
      setTicket('');
      setJustification('');
    } catch (err) {
      setErrors(fieldErrors(err));
      throw err;
    } finally {
      await refresh();
    }
  }

  async function decide() {
    if (!decision) return;
    try {
      await decideWithdrawalRefund(
        withdrawal.id,
        decision.request.id,
        decision.approve ? 'approve' : 'reject',
        note.trim() || undefined,
      );
      toast.success(decision.approve ? 'Remboursement approuvé.' : 'Demande rejetée.');
      setNote('');
    } finally {
      await refresh();
    }
  }

  async function escalate() {
    try {
      await escalateWithdrawal(withdrawal.id, {
        ...(escalation.providerTicket.trim() && {
          providerTicket: escalation.providerTicket.trim(),
        }),
        note: escalation.note.trim(),
      });
      toast.success('Escalade inscrite au journal d’audit.');
      setEscalation({ providerTicket: '', note: '' });
      setErrors({});
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err instanceof ApiError ? err.message : 'Escalade impossible.');
    } finally {
      await refresh();
    }
  }

  const pending = r.refundRequests.find((q) => q.status === 'PENDING');

  return (
    <Card id="rapprochement">
      <CardHeader
        title="Rapprochement"
        description="Retrait bloqué : vérification, escalade vers CinetPay et remboursement à double validation. Aucune action ne permet de déclarer un retrait réussi."
      />
      <CardBody className="space-y-5">
        {!r.newTransfersEnabled && (
          <UnavailableNotice title="Nouveaux transferts désactivés">
            Aucun transfert n’est envoyé ; la relecture des retraits existants continue.
          </UnavailableNotice>
        )}

        {r.refundRequests.length > 0 && (
          <ul className="space-y-3">
            {r.refundRequests.map((q) => {
              const [label, tone] = REQUEST_STATUS[q.status];
              return (
                <li key={q.id} className="border-line rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={tone} dot>
                      {label}
                    </Badge>
                    <span className="text-muted text-xs">
                      Proposée par {q.proposedBy.username ?? q.proposedBy.id} le{' '}
                      {formatDateTime(q.proposedAt)}
                    </span>
                  </div>
                  <p className="text-ink mt-2">
                    Confirmation CinetPay :{' '}
                    <span className="font-mono text-xs">{q.providerTicket}</span>
                  </p>
                  <p className="text-ink-soft mt-1">{q.justification}</p>
                  <p className="text-muted mt-1 text-xs">
                    Statut relu à la proposition : {q.providerStatusAtProposal}
                    {q.providerStatusAtDecision &&
                      ` · à la décision : ${q.providerStatusAtDecision}`}
                  </p>
                  {q.decidedBy && (
                    <p className="text-muted mt-1 text-xs">
                      Décision de {q.decidedBy.username ?? q.decidedBy.id} le{' '}
                      {formatDateTime(q.decidedAt)}
                      {q.decisionNote && ` — ${q.decisionNote}`}
                    </p>
                  )}
                  {q.status === 'PENDING' && (
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => setDecision({ request: q, approve: false })}
                      >
                        Rejeter
                      </Button>
                      {q.proposedBy.id === me ? (
                        <span className="text-muted self-center text-xs">
                          Approbation réservée à un autre administrateur.
                        </span>
                      ) : (
                        <Button
                          variant="danger"
                          onClick={() => setDecision({ request: q, approve: true })}
                        >
                          Approuver le remboursement
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {r.open && !pending && (
          <form
            noValidate
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setErrors({});
              setConfirmPropose(true);
            }}
          >
            <p className="text-ink text-sm font-medium">Proposer un remboursement</p>
            {!r.canProposeRefund && (
              <p className="text-muted text-xs">
                Possible à partir du {formatDateTime(r.refundEligibleFrom)}, si CinetPay est
                joignable.
              </p>
            )}
            <Field
              id="refund-ticket"
              label="Référence de la confirmation écrite de CinetPay"
              hint="Ticket ou courriel du support attestant que le transfert n’a pas été exécuté."
              error={errors.providerTicket}
            >
              <Input
                id="refund-ticket"
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
              />
            </Field>
            <Field
              id="refund-justification"
              label="Justification"
              hint="20 caractères au moins. Ne recopiez aucun numéro de téléphone."
              error={errors.justification}
            >
              <Textarea
                id="refund-justification"
                rows={3}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={!r.canProposeRefund}>
                Proposer le remboursement de {formatTokens(withdrawal.tokens)}
              </Button>
            </div>
          </form>
        )}

        {r.open && (
          <form
            noValidate
            className="border-line space-y-3 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void escalate();
            }}
          >
            <p className="text-ink text-sm font-medium">Escalader auprès de CinetPay</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field id="esc-ticket" label="Ticket (facultatif)" error={errors.providerTicket}>
                <Input
                  id="esc-ticket"
                  value={escalation.providerTicket}
                  onChange={(e) => setEscalation((s) => ({ ...s, providerTicket: e.target.value }))}
                />
              </Field>
              <Field id="esc-note" label="Note" className="md:col-span-2" error={errors.note}>
                <Input
                  id="esc-note"
                  value={escalation.note}
                  onChange={(e) => setEscalation((s) => ({ ...s, note: e.target.value }))}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="secondary">
                Enregistrer l’escalade
              </Button>
            </div>
          </form>
        )}

        {r.events.length > 0 && (
          <ul className="border-line space-y-2 border-t pt-4">
            {r.events.map((e) => (
              <li key={e.id}>
                <AuditEventLine event={e} />
              </li>
            ))}
          </ul>
        )}

        <InfoNote>
          Un « introuvable » chez CinetPay ne prouve pas à lui seul que l’argent n’est pas parti :
          la confirmation écrite du fournisseur et la validation par un second administrateur sont
          exigées. Le serveur relit le transfert à chaque étape ; un succès confirmé est appliqué et
          bloque tout remboursement.
        </InfoNote>
      </CardBody>

      <ConfirmDialog
        open={confirmPropose}
        onOpenChange={setConfirmPropose}
        title="Proposer ce remboursement ?"
        description="Le serveur relit le transfert chez CinetPay. Les jetons ne seront rendus qu’après l’approbation d’un AUTRE administrateur. L’opération est auditée."
        confirmLabel="Proposer"
        onConfirm={propose}
      />
      {decision && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDecision(undefined)}
          title={decision.approve ? 'Approuver le remboursement ?' : 'Rejeter la demande ?'}
          description={
            decision.approve
              ? `Le serveur relit le transfert : s’il est toujours introuvable, ${formatTokens(withdrawal.tokens)} sont rendus au joueur, une seule fois. Décision auditée.`
              : 'Le retrait reste ouvert et les jetons réservés. Motif obligatoire, audité.'
          }
          confirmLabel={decision.approve ? 'Approuver' : 'Rejeter'}
          tone={decision.approve ? 'danger' : 'primary'}
          onConfirm={decide}
        >
          <Field
            id="decision-note"
            label={decision.approve ? 'Note (facultative)' : 'Motif du rejet'}
          >
            <Input id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </ConfirmDialog>
      )}
    </Card>
  );
}
