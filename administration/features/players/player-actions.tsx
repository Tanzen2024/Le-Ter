'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Eye, MoreHorizontal, UserCheck, UserX } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { StatusBadge } from '@/components/data/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAdminSession } from '@/hooks/use-session';
import { formatDateTime } from '@/lib/format';
import { ACCOUNT_STATUS } from '@/lib/labels';
import type { PlayerRow } from '@/types/admin';

import { playerActions } from './api';
import { ReasonDialog } from './moderation-dialogs';

/** Statut du compte, suspension et restriction du chat en cours (D-079). */
export function AccountBadges({
  player,
}: {
  player: Pick<PlayerRow, 'status' | 'suspension' | 'chatRestriction'>;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusBadge map={ACCOUNT_STATUS} value={player.status} />
      {player.suspension && (
        <Badge
          tone="warning"
          dot
          title={
            player.suspension.endsAt
              ? `Jusqu’au ${formatDateTime(player.suspension.endsAt)}`
              : 'Durée indéterminée'
          }
        >
          Suspendu
        </Badge>
      )}
      {player.chatRestriction && (
        <Badge tone="info" title="Envoi de messages refusé">
          Chat restreint
        </Badge>
      )}
    </span>
  );
}

/** Invalide toutes les vues d'un joueur : liste, fiche, état de modération et historiques. */
export function useRefreshPlayer() {
  const client = useQueryClient();
  return async (id: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['admin', 'players'] }),
      client.invalidateQueries({ queryKey: ['admin', 'player', id] }),
    ]);
  };
}

/** Dialogue d'activation / désactivation, partagé par la liste et la fiche. */
export function AccountToggleDialog({
  player,
  open,
  onOpenChange,
}: {
  player: Pick<PlayerRow, 'id' | 'username' | 'status'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshPlayer();
  const enabling = player.status === 'disabled';
  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      tone={enabling ? 'primary' : 'danger'}
      title={enabling ? `Activer le compte de ${player.username}` : `Désactiver ${player.username}`}
      description={
        enabling
          ? 'Le joueur pourra se reconnecter normalement. Les sessions révoquées ne sont pas restaurées.'
          : 'Toutes ses sessions sont révoquées et toute nouvelle connexion est refusée. Aucune donnée, partie ni transaction n’est supprimée ; une partie en cours se termine avec les tours automatiques.'
      }
      confirmLabel={enabling ? 'Activer le compte' : 'Désactiver le compte'}
      onConfirm={async (reason) => {
        const result = await playerActions.setEnabled(player.id, enabling, reason);
        toast.success(
          !result.changed
            ? 'Aucun changement : le compte était déjà dans cet état.'
            : enabling
              ? 'Compte activé.'
              : `Compte désactivé${result.revokedSessions ? ' et session révoquée' : ''}.`,
        );
        await refresh(player.id);
      }}
    />
  );
}

/**
 * Menu contextuel d'une ligne de la liste. Les clics n'ouvrent pas la fiche (la ligne entière
 * est cliquable) ; l'action sur son propre compte est désactivée (le serveur la refuse aussi).
 */
export function PlayerRowActions({ player }: { player: PlayerRow }) {
  const session = useAdminSession();
  const isSelf = session.data?.user.id === player.id;
  const [open, setOpen] = useState(false);
  const enabling = player.status === 'disabled';

  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions pour ${player.username}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link href={`/joueurs/${player.id}`}>
              <Eye /> Ouvrir la fiche
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={isSelf && !enabling}
            onSelect={() => setOpen(true)}
            className={enabling ? undefined : 'text-danger data-[highlighted]:text-danger'}
          >
            {enabling ? <UserCheck /> : <UserX />}
            {enabling ? 'Activer le compte' : 'Désactiver le compte'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AccountToggleDialog player={player} open={open} onOpenChange={setOpen} />
    </div>
  );
}
