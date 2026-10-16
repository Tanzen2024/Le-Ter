'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, FileText, Lock, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { DetailList } from '@/components/data/data-table';
import { StatusBadge } from '@/components/data/status-badge';
import { ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/form-controls';
import { ApiError } from '@/lib/api/errors';
import { formatDateTime, formatTokens } from '@/lib/format';
import type { AdminComplaintDetail, ComplaintPriority, ComplaintStatus } from '@/types/complaints';

import { assigneesQuery, attachmentUrl, complaintActions, complaintQuery } from './api';
import {
  ADMIN_TRANSITIONS,
  CHECK_TOOL,
  COMPLAINT_CATEGORY,
  COMPLAINT_EVENT,
  COMPLAINT_PRIORITY,
  COMPLAINT_STATUS,
} from './labels';

const errorText = (err: unknown) =>
  err instanceof ApiError && err.message ? err.message : 'Action impossible. Réessayez.';

/** Détail d'une réclamation (D-114) : faits vérifiés, analyse automatisée, échanges, décision. */
export function ComplaintDetailView({ id }: { id: string }) {
  const query = useQuery(complaintQuery(id));
  if (query.isPending) return <LoadingRows rows={8} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <ComplaintDetailContent detail={query.data} />;
}

export function ComplaintDetailContent({ detail }: { detail: AdminComplaintDetail }) {
  const { complaint } = detail;
  return (
    <>
      <PageHeader
        title={`${complaint.reference} — ${complaint.title}`}
        description={`${COMPLAINT_CATEGORY[complaint.category] ?? complaint.category} · déposée le ${formatDateTime(complaint.createdAt)} par ${complaint.player.username ?? complaint.player.id}`}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <SummaryCard detail={detail} />
          <VerifiedFactsCard detail={detail} />
          <AiAnalysisCard detail={detail} />
          <MessagesCard detail={detail} />
        </div>
        <div className="flex flex-col gap-4">
          <HandlingCard detail={detail} />
          <DecisionCard detail={detail} />
          <AttachmentsCard detail={detail} />
          <HistoryCard detail={detail} />
        </div>
      </div>
    </>
  );
}

function useRefresh(id: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'complaint', id] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'complaints'] });
  };
}

function SummaryCard({ detail }: { detail: AdminComplaintDetail }) {
  const c = detail.complaint;
  return (
    <Card>
      <CardHeader
        title="Déclaration du joueur"
        description="Texte saisi par le joueur : une déclaration, jamais un fait vérifié."
        actions={<StatusBadge map={COMPLAINT_STATUS} value={c.status} />}
      />
      <CardBody className="flex flex-col gap-3">
        <p className="text-ink text-sm whitespace-pre-wrap">{c.description}</p>
        <DetailList
          items={[
            [
              'Joueur',
              <Link key="p" className="text-info hover:underline" href={`/joueurs/${c.player.id}`}>
                {c.player.username ?? c.player.id}
              </Link>,
            ],
            ['Catégorie choisie', COMPLAINT_CATEGORY[c.category] ?? c.category],
            [
              'Catégorie suggérée',
              c.suggestedCategory
                ? (COMPLAINT_CATEGORY[c.suggestedCategory] ?? c.suggestedCategory)
                : '—',
            ],
            ['Heure déclarée', c.incidentAt ? formatDateTime(c.incidentAt) : '—'],
            ['Contestations', String(c.reopenCount)],
          ]}
        />
      </CardBody>
    </Card>
  );
}

function Facts({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return <span className="text-faint">Non lié ou introuvable pour ce joueur</span>;
  return (
    <pre className="bg-surface-muted text-ink-soft max-h-48 overflow-auto rounded-md p-2 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function VerifiedFactsCard({ detail }: { detail: AdminComplaintDetail }) {
  const { verified, complaint } = detail;
  const links = complaint.links;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="text-success size-4" /> Faits vérifiés (sources qui font
            autorité)
          </span>
        }
        description={`Relus à l’instant dans PostgreSQL (${formatDateTime(verified.readAt)}), bornés aux données de ce joueur.`}
      />
      <CardBody className="flex flex-col gap-3 text-sm">
        <DetailList
          items={[
            ['Solde du compte de jeu', formatTokens(verified.wallet.balance)],
            ['Réservé', formatTokens(verified.wallet.reserved)],
            ['Disponible', formatTokens(verified.wallet.available)],
          ]}
        />
        {links.gameId && (
          <div>
            <p className="text-muted mb-1 text-xs">Partie liée</p>
            <Facts value={verified.game} />
          </div>
        )}
        {links.paymentId && (
          <div>
            <p className="text-muted mb-1 text-xs">Recharge liée</p>
            <Facts value={verified.payment} />
          </div>
        )}
        {links.withdrawalId && (
          <div>
            <p className="text-muted mb-1 text-xs">Retrait lié</p>
            <Facts value={verified.withdrawal} />
          </div>
        )}
        {links.walletTransactionId && (
          <div>
            <p className="text-muted mb-1 text-xs">Transaction liée</p>
            <Facts value={verified.transaction} />
          </div>
        )}
        {links.tournamentId && (
          <div>
            <p className="text-muted mb-1 text-xs">Tournoi lié</p>
            <Facts value={verified.tournament} />
          </div>
        )}
        <div>
          <p className="text-muted mb-1 text-xs">Dernières écritures du compte de jeu</p>
          <ul className="text-ink-soft flex flex-col gap-0.5 text-xs">
            {verified.wallet.entries.length === 0 && <li>Aucune écriture</li>}
            {verified.wallet.entries.map((e) => (
              <li key={e.transactionId} className="font-mono">
                {formatDateTime(e.createdAt)} · {e.kind} · {e.status} · {formatTokens(e.tokens)}
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

function AiAnalysisCard({ detail }: { detail: AdminComplaintDetail }) {
  const { aiAnalysis, checks } = detail;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Bot className="text-info size-4" /> Analyse automatisée (IA)
          </span>
        }
        description="Généré par un modèle de langage : un résumé à vérifier, jamais une preuve ni une décision."
        actions={
          <Badge tone={aiAnalysis.status === 'COMPLETED' ? 'info' : 'neutral'}>
            {aiAnalysis.status === 'COMPLETED'
              ? 'Résumé disponible'
              : aiAnalysis.status === 'PENDING'
                ? 'En cours'
                : 'Indisponible (mode dégradé)'}
          </Badge>
        }
      />
      <CardBody className="flex flex-col gap-3 text-sm">
        {aiAnalysis.summary ? (
          <blockquote className="border-info/40 text-ink-soft border-l-2 pl-3 italic">
            {aiAnalysis.summary}
          </blockquote>
        ) : (
          <p className="text-muted">Aucun résumé automatisé pour ce dossier.</p>
        )}
        <div>
          <p className="text-muted mb-1 text-xs">
            Vérifications effectuées par les outils serveur (lecture seule)
          </p>
          <ul className="flex flex-col gap-1">
            {checks.length === 0 && <li className="text-faint text-xs">Aucune</li>}
            {checks.map((check) => (
              <li key={check.id}>
                <details>
                  <summary className="text-ink-soft cursor-pointer text-xs">
                    {CHECK_TOOL[check.tool] ?? check.tool} ·{' '}
                    {check.outcome === 'FOUND'
                      ? 'trouvé'
                      : check.outcome === 'NOT_FOUND'
                        ? 'introuvable'
                        : 'erreur'}{' '}
                    · {check.source === 'ASSISTANT' ? 'conversation' : 'analyse du dossier'} ·{' '}
                    {formatDateTime(check.createdAt)}
                  </summary>
                  <Facts value={check.facts} />
                </details>
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

function MessagesCard({ detail }: { detail: AdminComplaintDetail }) {
  const { complaint } = detail;
  const refresh = useRefresh(complaint.id);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const reply = useMutation({
    mutationFn: () => complaintActions.reply(complaint.id, body.trim(), internal),
    onSuccess: () => {
      setBody('');
      toast.success(internal ? 'Note interne ajoutée' : 'Réponse envoyée au joueur');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const requestInfo = useMutation({
    mutationFn: () => complaintActions.requestInfo(complaint.id, body.trim(), complaint.status),
    onSuccess: () => {
      setBody('');
      toast.success('Informations demandées au joueur');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const closed = complaint.status === 'CLOSED';
  const canRequestInfo = ADMIN_TRANSITIONS[complaint.status]?.includes('WAITING_FOR_PLAYER');
  return (
    <Card>
      <CardHeader
        title="Échanges"
        description="Les notes internes ne sont jamais visibles du joueur."
      />
      <CardBody className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {detail.messages.length === 0 && <li className="text-faint text-sm">Aucun message</li>}
          {detail.messages.map((m) => (
            <li
              key={m.id}
              className={
                m.visibility === 'INTERNAL'
                  ? 'border-warning/40 bg-warning/5 rounded-md border p-2'
                  : 'border-line rounded-md border p-2'
              }
            >
              <p className="text-muted flex items-center gap-1.5 text-xs">
                {m.visibility === 'INTERNAL' && <Lock className="size-3" />}
                {m.authorType === 'PLAYER' ? 'Joueur' : (m.author?.username ?? 'Support')} ·{' '}
                {formatDateTime(m.createdAt)}
                {m.visibility === 'INTERNAL' && ' · note interne'}
              </p>
              <p className="text-ink text-sm whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
        {!closed && (
          <>
            <Field id="complaint-reply" label="Message">
              <Textarea
                id="complaint-reply"
                value={body}
                maxLength={4000}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Réponse au joueur, demande d’information ou note interne"
              />
            </Field>
            <label className="text-muted flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
              />
              Note interne (non visible du joueur)
            </label>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!body.trim() || reply.isPending} onClick={() => reply.mutate()}>
                {internal ? 'Ajouter la note' : 'Répondre au joueur'}
              </Button>
              {canRequestInfo && !internal && (
                <Button
                  variant="secondary"
                  disabled={!body.trim() || requestInfo.isPending}
                  onClick={() => requestInfo.mutate()}
                >
                  Demander des informations
                </Button>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function HandlingCard({ detail }: { detail: AdminComplaintDetail }) {
  const { complaint } = detail;
  const refresh = useRefresh(complaint.id);
  const assignees = useQuery(assigneesQuery());
  const assign = useMutation({
    mutationFn: (assigneeId: string | null) => complaintActions.assign(complaint.id, assigneeId),
    onSuccess: () => {
      toast.success('Assignation enregistrée');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const priority = useMutation({
    mutationFn: (value: ComplaintPriority) => complaintActions.priority(complaint.id, value),
    onSuccess: () => {
      toast.success('Priorité modifiée');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  return (
    <Card>
      <CardHeader title="Prise en charge" description="Actions authentifiées et auditées." />
      <CardBody className="flex flex-col gap-3">
        <Field id="complaint-assignee" label="Responsable">
          <Select
            id="complaint-assignee"
            value={complaint.assignee?.id ?? ''}
            disabled={assign.isPending || complaint.status === 'CLOSED'}
            onChange={(e) => assign.mutate(e.target.value || null)}
          >
            <option value="">Non assignée</option>
            {assignees.data?.assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.username}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="complaint-priority" label="Priorité">
          <Select
            id="complaint-priority"
            value={complaint.priority}
            disabled={priority.isPending}
            onChange={(e) => priority.mutate(e.target.value as ComplaintPriority)}
          >
            {Object.entries(COMPLAINT_PRIORITY).map(([v, [t]]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
      </CardBody>
    </Card>
  );
}

const DECIDING = new Set(['RESOLVED', 'REJECTED']);

/**
 * Corrections financières : jamais depuis la réclamation. Elles se font dans le module métier
 * concerné (revérification d'un paiement, remboursement d'un retrait, versement d'un tournoi…),
 * avec ses contrôles et son propre audit ; la décision du dossier les référence ensuite.
 */
function CorrectionLinks({ detail }: { detail: AdminComplaintDetail }) {
  const { links, player } = detail.complaint;
  const targets: [string, string][] = [
    ...(links.paymentId
      ? [['Paiement lié', `/paiements/${links.paymentId}`] as [string, string]]
      : []),
    ...(links.withdrawalId
      ? [['Retrait lié', `/retraits/${links.withdrawalId}`] as [string, string]]
      : []),
    ...(links.tournamentId
      ? [['Tournoi lié', `/tournois/${links.tournamentId}`] as [string, string]]
      : []),
    ...(links.gameId ? [['Partie liée', `/parties/${links.gameId}`] as [string, string]] : []),
    ['Fiche du joueur', `/joueurs/${player.id}`],
  ];
  return (
    <div className="border-line rounded-md border p-3 text-xs" data-testid="correction-links">
      <p className="text-ink-soft mb-1.5">
        Une correction financière éventuelle se fait dans le module concerné (contrôles et audit
        propres), jamais ici ; mentionnez-la ensuite dans la décision.
      </p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {targets.map(([label, href]) => (
          <li key={href}>
            <Link className="text-info hover:underline" href={href}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecisionCard({ detail }: { detail: AdminComplaintDetail }) {
  const { complaint } = detail;
  const refresh = useRefresh(complaint.id);
  const [target, setTarget] = useState<ComplaintStatus | ''>('');
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const options = ADMIN_TRANSITIONS[complaint.status] ?? [];
  const change = useMutation({
    mutationFn: () =>
      complaintActions.status(complaint.id, {
        status: target as ComplaintStatus,
        expectedStatus: complaint.status,
        ...(DECIDING.has(target) && { decision: decision.trim() }),
        ...(reason.trim() && { reason: reason.trim() }),
      }),
    onSuccess: () => {
      toast.success('Statut modifié');
      setTarget('');
      setDecision('');
      setReason('');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const needsDecision = DECIDING.has(target);
  return (
    <Card>
      <CardHeader
        title="Décision humaine"
        description="Prise et motivée par un administrateur. Seules les transitions autorisées sont proposées."
      />
      <CardBody className="flex flex-col gap-3">
        {complaint.decision && (
          <InfoNote>
            <strong>Décision</strong> ({complaint.decidedBy?.username ?? '—'},{' '}
            {formatDateTime(complaint.decidedAt)}) : {complaint.decision}
          </InfoNote>
        )}
        <CorrectionLinks detail={detail} />
        {options.length === 0 ? (
          <p className="text-muted text-sm">Dossier clôturé : aucune transition possible.</p>
        ) : (
          <>
            <Field id="complaint-status" label="Nouveau statut">
              <Select
                id="complaint-status"
                value={target}
                onChange={(e) => setTarget(e.target.value as ComplaintStatus | '')}
              >
                <option value="">Choisir…</option>
                {options.map((s) => (
                  <option key={s} value={s}>
                    {COMPLAINT_STATUS[s]?.[0] ?? s}
                  </option>
                ))}
              </Select>
            </Field>
            {needsDecision && (
              <Field
                id="complaint-decision"
                label="Décision motivée (visible du joueur)"
                hint="10 caractères minimum. Une correction financière se fait dans le module concerné, puis se mentionne ici."
              >
                <Textarea
                  id="complaint-decision"
                  value={decision}
                  maxLength={2000}
                  onChange={(e) => setDecision(e.target.value)}
                />
              </Field>
            )}
            <Field id="complaint-reason" label="Motif interne (facultatif, audité)">
              <Textarea
                id="complaint-reason"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button
              disabled={
                !target || change.isPending || (needsDecision && decision.trim().length < 10)
              }
              onClick={() => change.mutate()}
            >
              Appliquer
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function AttachmentsCard({ detail }: { detail: AdminComplaintDetail }) {
  const { complaint } = detail;
  return (
    <Card>
      <CardHeader title="Pièces justificatives" description="Chaque ouverture est auditée." />
      <CardBody>
        {detail.attachments.length === 0 && <p className="text-faint text-sm">Aucune pièce</p>}
        <ul className="flex flex-col gap-2">
          {detail.attachments.map((a) => (
            <li key={a.id}>
              <a
                className="text-info flex items-center gap-1.5 text-sm hover:underline"
                href={attachmentUrl(complaint.id, a.id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileText className="size-4" />
                {a.contentType} · {Math.ceil(a.sizeBytes / 1024)} Ko · {formatDateTime(a.createdAt)}
              </a>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function HistoryCard({ detail }: { detail: AdminComplaintDetail }) {
  return (
    <Card>
      <CardHeader title="Historique complet" description="Journal en ajout seul." />
      <CardBody>
        <ol className="flex flex-col gap-1.5 text-xs">
          {detail.events.map((e) => (
            <li key={e.id} className="text-ink-soft">
              <span className="text-muted">{formatDateTime(e.createdAt)}</span> ·{' '}
              {COMPLAINT_EVENT[e.type] ?? e.type}
              {e.toStatus && ` → ${COMPLAINT_STATUS[e.toStatus]?.[0] ?? e.toStatus}`} ·{' '}
              {e.actor?.username ??
                (e.actorType === 'SYSTEM' ? 'système' : e.actorType.toLowerCase())}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
