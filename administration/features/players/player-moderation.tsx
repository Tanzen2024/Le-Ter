'use client';

import { useQuery } from '@tanstack/react-query';
import {
  LogOut,
  MessageSquareOff,
  MessageSquareText,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { DataTable, DetailList, Pagination, type Column } from '@/components/data/data-table';
import { StatusBadge } from '@/components/data/status-badge';
import { InfoNote } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/form-controls';
import { AuditEventLine } from '@/features/audit/audit-event-line';
import { idempotencyKey } from '@/lib/api/client';
import { formatDateTime, formatNumber } from '@/lib/format';
import { label, SANCTION_KIND, SANCTION_STATE } from '@/lib/labels';
import type { AdminNote, PlayerDetail, PlayerModeration, Sanction } from '@/types/admin';

import {
  playerActions,
  playerModerationLogQuery,
  playerNotesQuery,
  playerSanctionsQuery,
} from './api';
import {
  DEFAULT_LIMITS,
  fieldErrors,
  ReasonDialog,
  RestrictionDialog,
  WarningDialog,
} from './moderation-dialogs';
import { AccountToggleDialog, useRefreshPlayer } from './player-actions';

const until = (endsAt: string | null) =>
  endsAt ? `jusqu’au ${formatDateTime(endsAt)}` : 'durée indéterminée';

type Dialog =
  | 'account'
  | 'suspend'
  | 'lift-suspension'
  | 'revoke'
  | 'restrict-chat'
  | 'lift-chat'
  | 'warn'
  | null;

/**
 * Actions sur le compte (D-079). Chaque action est confirmée, appliquée et auditée par le
 * serveur ; les boutons incompatibles avec l'état courant sont désactivés. Aucune action ne
 * crédite, débite ni ne modifie une partie.
 */
export function ModerationActionsCard({
  player,
  moderation,
}: {
  player: PlayerDetail;
  moderation: PlayerModeration | undefined;
}) {
  const refresh = useRefreshPlayer();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [warnKey, setWarnKey] = useState(() => idempotencyKey('warn'));
  const limits = moderation?.limits ?? DEFAULT_LIMITS;
  const isSelf = moderation?.isSelf ?? true;
  const suspended = moderation?.suspension ?? null;
  const chat = moderation?.chatRestriction ?? null;
  const loading = !moderation;
  const disabled = player.status === 'disabled';
  const close = (open: boolean) => !open && setDialog(null);
  const done = async (message: string) => {
    toast.success(message);
    await refresh(player.id);
  };

  return (
    <Card>
      <CardHeader title="Actions sur le compte" description="Confirmées puis auditées." />
      <CardBody className="space-y-2">
        <Button
          variant={disabled ? 'primary' : 'secondary'}
          className="w-full justify-start"
          disabled={loading || (isSelf && !disabled)}
          onClick={() => setDialog('account')}
        >
          {disabled ? <UserCheck /> : <UserX />}
          {disabled ? 'Activer le compte' : 'Désactiver le compte'}
        </Button>
        {suspended ? (
          <Button
            variant="secondary"
            className="w-full justify-start"
            onClick={() => setDialog('lift-suspension')}
          >
            <ShieldCheck /> Lever la suspension
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="w-full justify-start"
            disabled={loading || isSelf}
            onClick={() => setDialog('suspend')}
          >
            <ShieldAlert /> Suspendre le joueur
          </Button>
        )}
        <Button
          variant="secondary"
          className="w-full justify-start"
          disabled={loading || isSelf || moderation?.security.activeSessions === 0}
          onClick={() => setDialog('revoke')}
        >
          <LogOut /> Déconnecter tous les appareils
        </Button>
        {chat ? (
          <Button
            variant="secondary"
            className="w-full justify-start"
            onClick={() => setDialog('lift-chat')}
          >
            <MessageSquareText /> Rétablir le chat
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="w-full justify-start"
            disabled={loading}
            onClick={() => setDialog('restrict-chat')}
          >
            <MessageSquareOff /> Restreindre le chat
          </Button>
        )}
        <Button
          variant="secondary"
          className="w-full justify-start"
          disabled={loading}
          onClick={() => setDialog('warn')}
        >
          <TriangleAlert /> Envoyer un avertissement
        </Button>
        {isSelf && !loading && (
          <p className="text-muted text-xs">
            Votre propre compte : désactivation, suspension et déconnexion sont interdites.
          </p>
        )}
        <p className="text-muted text-xs">
          Aucune suppression de compte, aucun crédit ni débit n’est proposé par l’administration.
        </p>
      </CardBody>

      <AccountToggleDialog player={player} open={dialog === 'account'} onOpenChange={close} />
      <RestrictionDialog
        open={dialog === 'suspend'}
        onOpenChange={close}
        limits={limits}
        title={`Suspendre ${player.username}`}
        description="Ses sessions sont révoquées et tout accès est refusé jusqu’à la levée ou l’échéance. Une partie en cours continue avec les tours automatiques ; ni fuite ni défaite n’est imposée, aucun solde n’est modifié."
        confirmLabel="Suspendre"
        onConfirm={async (body) => {
          await playerActions.suspend(player.id, body);
          await done('Joueur suspendu.');
        }}
      />
      <ReasonDialog
        open={dialog === 'lift-suspension'}
        onOpenChange={close}
        limits={limits}
        title="Lever la suspension"
        description={
          suspended
            ? `Suspension en cours (${until(suspended.endsAt)}). Un compte désactivé reste désactivé.`
            : 'Aucune suspension en cours.'
        }
        reasonLabel="Motif de la levée"
        confirmLabel="Lever la suspension"
        onConfirm={async (reason) => {
          await playerActions.liftSuspension(player.id, reason);
          await done('Suspension levée.');
        }}
      />
      <ReasonDialog
        open={dialog === 'revoke'}
        onOpenChange={close}
        limits={limits}
        tone="danger"
        reasonRequired={false}
        title="Déconnecter tous les appareils"
        description="Les sessions du joueur sont révoquées immédiatement côté serveur. Il pourra se reconnecter normalement si son compte est accessible."
        confirmLabel="Révoquer les sessions"
        onConfirm={async (reason) => {
          const result = await playerActions.revokeSessions(player.id, reason || undefined);
          await done(
            result.revokedSessions > 0
              ? 'Sessions révoquées.'
              : 'Aucune session active : rien à révoquer.',
          );
        }}
      />
      <RestrictionDialog
        open={dialog === 'restrict-chat'}
        onOpenChange={close}
        limits={limits}
        title={`Restreindre le chat de ${player.username}`}
        description="Le joueur ne peut plus envoyer de message dans aucune partie ; il garde l’accès au jeu et peut lire le chat."
        confirmLabel="Restreindre le chat"
        onConfirm={async (body) => {
          await playerActions.restrictChat(player.id, body);
          await done('Chat restreint.');
        }}
      />
      <ReasonDialog
        open={dialog === 'lift-chat'}
        onOpenChange={close}
        limits={limits}
        title="Rétablir le chat"
        description={chat ? `Restriction en cours (${until(chat.endsAt)}).` : 'Aucune restriction.'}
        reasonLabel="Motif de la levée"
        confirmLabel="Rétablir le chat"
        onConfirm={async (reason) => {
          await playerActions.liftChatRestriction(player.id, reason);
          await done('Chat rétabli.');
        }}
      />
      <WarningDialog
        open={dialog === 'warn'}
        onOpenChange={close}
        limits={limits}
        onConfirm={async (body) => {
          const result = await playerActions.warn(player.id, body, warnKey);
          setWarnKey(idempotencyKey('warn'));
          await done(
            result.delivered
              ? 'Avertissement enregistré et transmis au joueur (notification dans l’application).'
              : 'Avertissement enregistré, NON transmis au joueur (aucun message visible saisi).',
          );
        }}
      />
    </Card>
  );
}

/** État de sécurité : dates de session et mesures en cours ; jamais de jeton ni de secret. */
export function SecuritySection({
  player,
  moderation,
}: {
  player: PlayerDetail;
  moderation: PlayerModeration | undefined;
}) {
  if (!moderation) return null;
  const { security, suspension, chatRestriction } = moderation;
  return (
    <Card>
      <CardHeader
        title="Sécurité"
        description="État de l’accès, calculé par le serveur à son heure."
      />
      <CardBody>
        <DetailList
          items={[
            [
              'Compte',
              player.status === 'active' ? 'Actif' : 'Désactivé (connexion et sessions refusées)',
            ],
            [
              'Suspension',
              suspension ? (
                <span key="s">
                  <Badge tone="warning" dot>
                    En cours
                  </Badge>{' '}
                  {until(suspension.endsAt)} · {suspension.reason}
                </span>
              ) : (
                'Aucune'
              ),
            ],
            [
              'Chat',
              chatRestriction ? (
                <span key="c">
                  <Badge tone="info">Restreint</Badge> {until(chatRestriction.endsAt)} ·{' '}
                  {chatRestriction.reason}
                </span>
              ) : (
                'Autorisé'
              ),
            ],
            ['Dernière connexion', formatDateTime(security.lastLoginAt)],
            ['Dernière activité de session', formatDateTime(security.lastSessionActivityAt)],
            ['Sessions actives', formatNumber(security.activeSessions)],
          ]}
        />
      </CardBody>
    </Card>
  );
}

const sanctionColumns: Column<Sanction>[] = [
  {
    key: 'kind',
    header: 'Mesure',
    cell: (s) => (
      <span>
        <span className="text-ink">{label(SANCTION_KIND, s.kind)}</span>
        <span className="text-muted block text-xs">{formatDateTime(s.createdAt)}</span>
      </span>
    ),
  },
  {
    key: 'state',
    header: 'État',
    cell: (s) => <StatusBadge map={SANCTION_STATE} value={s.state} />,
  },
  {
    key: 'detail',
    header: 'Motif et détails',
    cell: (s) => (
      <div className="max-w-md min-w-0 space-y-0.5 text-sm whitespace-pre-wrap">
        <p className="text-ink break-words">{s.reason}</p>
        {s.kind !== 'WARNING' && <p className="text-muted text-xs">Fin : {until(s.endsAt)}</p>}
        {s.kind === 'WARNING' && (
          <p className="text-muted text-xs">
            {s.delivered
              ? `Transmis au joueur : « ${s.playerMessage ?? ''} »`
              : 'Non transmis au joueur (enregistrement seul)'}
          </p>
        )}
        {s.comment && <p className="text-muted text-xs break-words">Interne : {s.comment}</p>}
        {s.lifted && (
          <p className="text-muted text-xs break-words">
            Levée le {formatDateTime(s.lifted.at)} par {s.lifted.by.username ?? '—'} :{' '}
            {s.lifted.reason}
          </p>
        )}
      </div>
    ),
  },
  {
    key: 'by',
    header: 'Par',
    cell: (s) => s.createdBy.username ?? '—',
    hideOnMobile: true,
  },
];

export function SanctionsSection({ playerId }: { playerId: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery(playerSanctionsQuery(playerId, page));
  return (
    <Card>
      <CardHeader
        title="Suspensions, restrictions et avertissements"
        description="Historique complet ; les mesures ne sont jamais supprimées."
      />
      <DataTable
        caption="Mesures de modération du joueur"
        columns={sanctionColumns}
        rows={query.data?.items}
        rowKey={(s) => s.id}
        loading={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        empty="Aucune mesure de modération"
      />
      {query.data && (
        <Pagination
          page={page}
          limit={query.data.limit}
          total={query.data.total}
          onPage={setPage}
        />
      )}
    </Card>
  );
}

/**
 * Notes internes : visibles par les seuls administrateurs, jamais par le joueur. L'auteur est
 * l'administrateur connecté, fixé par le serveur. Correction = suppression tracée + nouvelle
 * note ; le texte est affiché comme du texte (jamais interprété).
 */
export function NotesSection({ playerId }: { playerId: string }) {
  const refresh = useRefreshPlayer();
  const [page, setPage] = useState(1);
  const query = useQuery(playerNotesQuery(playerId, page));
  const [body, setBody] = useState('');
  const [key, setKey] = useState(() => idempotencyKey('note'));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState<AdminNote | null>(null);

  async function add() {
    if (!body.trim()) {
      setError('La note est vide.');
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await playerActions.addNote(playerId, body.trim(), key);
      setBody('');
      setKey(idempotencyKey('note'));
      toast.success('Note ajoutée.');
      setPage(1);
      await refresh(playerId);
    } catch (err) {
      setError(fieldErrors(err).body ?? 'Échec de l’enregistrement de la note.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Notes internes"
        description="Réservées à l’administration ; jamais visibles par le joueur."
      />
      <CardBody className="space-y-4">
        <div className="space-y-2">
          <Field id="note-body" label="Nouvelle note" error={error}>
            <Textarea
              id="note-body"
              value={body}
              maxLength={DEFAULT_LIMITS.note.max}
              onChange={(e) => {
                setBody(e.target.value);
                // Nouveau texte : nouvelle intention, nouvelle clé.
                setKey(idempotencyKey('note'));
              }}
            />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-faint text-xs">
              {body.length} / {DEFAULT_LIMITS.note.max}
            </span>
            <Button size="sm" onClick={add} disabled={pending}>
              {pending ? 'Enregistrement…' : 'Ajouter la note'}
            </Button>
          </div>
        </div>
        {query.data?.items.length === 0 && (
          <p className="text-muted text-sm">Aucune note pour ce joueur.</p>
        )}
        <ul className="divide-line divide-y">
          {query.data?.items.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0 text-sm">
                {n.deleted ? (
                  <p className="text-muted italic">
                    Note supprimée le {formatDateTime(n.deleted.at)} par{' '}
                    {n.deleted.by.username ?? '—'} : {n.deleted.reason}
                  </p>
                ) : (
                  <p className="text-ink break-words whitespace-pre-wrap">{n.body}</p>
                )}
                <p className="text-muted mt-1 text-xs">
                  {n.author.username ?? 'Administrateur'} · {formatDateTime(n.createdAt)}
                </p>
              </div>
              {!n.deleted && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Supprimer la note"
                  onClick={() => setDeleting(n)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {query.data && query.data.total > query.data.limit && (
          <Pagination
            page={page}
            limit={query.data.limit}
            total={query.data.total}
            onPage={setPage}
          />
        )}
      </CardBody>
      <ReasonDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        tone="danger"
        title="Supprimer la note"
        description="Suppression logique : l’auteur, la date et le motif restent tracés."
        reasonLabel="Motif de la suppression"
        confirmLabel="Supprimer"
        onConfirm={async (reason) => {
          if (!deleting) return;
          await playerActions.deleteNote(playerId, deleting.id, reason);
          toast.success('Note supprimée.');
          await refresh(playerId);
        }}
      />
    </Card>
  );
}

/** Journal de modération : lignes du journal d'audit portant sur ce joueur. */
export function ModerationLogSection({ playerId }: { playerId: string }) {
  const [page, setPage] = useState(1);
  const [includeViews, setIncludeViews] = useState(false);
  const query = useQuery(playerModerationLogQuery(playerId, page, includeViews));
  return (
    <Card>
      <CardHeader
        title="Journal de modération"
        description="Extrait du journal d’audit : qui, quoi, quand, motif et résultat."
        actions={
          <label className="text-ink-soft flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeViews}
              onChange={(e) => {
                setIncludeViews(e.target.checked);
                setPage(1);
              }}
            />
            Inclure les consultations
          </label>
        }
      />
      <CardBody className="space-y-3">
        {query.error ? (
          <InfoNote>Journal indisponible : {String((query.error as Error).message)}</InfoNote>
        ) : query.data?.items.length === 0 ? (
          <p className="text-muted text-sm">Aucun événement.</p>
        ) : (
          query.data?.items.map((e) => (
            <div key={e.id} className="space-y-0.5">
              <AuditEventLine event={e} />
              {typeof e.details.reason === 'string' && (
                <p className="text-muted ml-6.5 text-xs break-words">Motif : {e.details.reason}</p>
              )}
            </div>
          ))
        )}
        {query.data && query.data.total > query.data.limit && (
          <Pagination
            page={page}
            limit={query.data.limit}
            total={query.data.total}
            onPage={setPage}
          />
        )}
      </CardBody>
    </Card>
  );
}
