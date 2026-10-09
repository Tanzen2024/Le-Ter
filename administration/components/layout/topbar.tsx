'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronRight, LogOut, Menu, Search, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger, SheetContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/form-controls';
import { dashboardQuery } from '@/features/dashboard/api';
import { useAdminSession, useLogout } from '@/hooks/use-session';
import { formatDateTime } from '@/lib/format';

import { Logo } from './logo';
import { sectionOf } from './nav';
import { SidebarNav } from './sidebar';

/** Alertes à traiter, calculées par le backend (aucun système de notification inventé). */
function Notifications() {
  const { data } = useQuery(dashboardQuery());
  const items = data
    ? [
        {
          count: data.alerts.newDetectionAlerts,
          label: 'alertes anti-collusion nouvelles',
          href: '/anti-collusion?status=NEW',
        },
        {
          count: data.alerts.pendingTournamentApprovals,
          label: 'tournois à approuver',
          href: '/tournois?status=PENDING_APPROVAL',
        },
        {
          count: data.alerts.stalePendingPayments,
          label: 'paiements en attente anciens',
          href: '/paiements?status=PENDING',
        },
        {
          count: data.reconciliationAnomalies.total,
          label: 'anomalies de rapprochement',
          href: '/rapprochement',
        },
        {
          count: data.alerts.overdueTurns,
          label: 'parties à l’échéance dépassée',
          href: '/parties?anomaly=OVERDUE_TURN',
        },
      ].filter((i) => i.count > 0)
    : [];
  const total = items.reduce((sum, i) => sum + i.count, 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Points d’attention : ${total}`}
          className="relative"
        >
          <Bell />
          {total > 0 && (
            <span className="bg-danger absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold text-white">
              {total > 9 ? '9+' : total}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuLabel className="text-muted text-xs font-medium">
          Points d’attention
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="text-muted px-2.5 py-3 text-sm">Rien à signaler pour le moment.</p>
        ) : (
          items.map((i) => (
            <DropdownMenuItem key={i.href} asChild>
              <Link href={i.href}>
                <span className="text-ink font-semibold tabular-nums">{i.count}</span> {i.label}
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountMenu() {
  const { data } = useAdminSession();
  const logout = useLogout();
  const initials = data
    ? `${data.user.firstName[0] ?? ''}${data.user.lastName[0] ?? ''}`.toUpperCase()
    : '·';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:bg-surface-muted flex items-center gap-2.5 rounded-lg py-1 pr-2 pl-1 text-left transition-colors"
          aria-label="Menu du compte"
        >
          <span className="bg-primary text-primary-ink flex size-8 items-center justify-center rounded-full text-xs font-semibold">
            {initials}
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="text-ink block text-sm font-medium">{data?.user.username ?? '…'}</span>
            <span className="text-muted block text-[11px]">Super administrateur</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <p className="text-ink text-sm font-medium">
            {data ? `${data.user.firstName} ${data.user.lastName}` : '…'}
          </p>
          <p className="text-muted text-xs">{data?.user.email}</p>
          {data && (
            <p className="text-muted mt-1 text-[11px]">
              Session jusqu’à {formatDateTime(data.session.expiresAt)}
            </p>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profil">
            <UserRound /> Profil et session
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            logout.mutate();
          }}
          className="text-danger data-[highlighted]:text-danger"
        >
          <LogOut /> {logout.isPending ? 'Déconnexion…' : 'Se déconnecter'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Recherche de joueurs (pseudo, email, téléphone, identifiant). */
function PlayerSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (q) router.push(`/joueurs?q=${encodeURIComponent(q)}`);
  }
  return (
    <form role="search" onSubmit={submit} className="relative hidden w-full max-w-xs md:block">
      <Search
        aria-hidden
        className="text-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Rechercher un joueur…"
        aria-label="Rechercher un joueur"
        className="pl-9"
      />
    </form>
  );
}

export function Topbar() {
  const pathname = usePathname();
  const section = sectionOf(pathname);
  const isDetail = section ? pathname !== section.href : false;
  const [open, setOpen] = useState(false);
  return (
    <header className="border-line bg-surface/90 sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4 backdrop-blur sm:px-6">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Ouvrir la navigation"
          >
            <Menu />
          </Button>
        </DialogTrigger>
        <SheetContent title="Navigation">
          <div className="border-line flex h-16 items-center border-b px-5">
            <Logo />
          </div>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Dialog>

      <nav aria-label="Fil d’Ariane" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 text-sm">
          <li className="text-muted hidden sm:block">Administration</li>
          {section && (
            <>
              <ChevronRight aria-hidden className="text-faint hidden size-3.5 sm:block" />
              <li className={isDetail ? 'text-muted' : 'text-ink truncate font-medium'}>
                {isDetail ? (
                  <Link href={section.href} className="hover:text-ink">
                    {section.label}
                  </Link>
                ) : (
                  section.label
                )}
              </li>
            </>
          )}
          {isDetail && (
            <>
              <ChevronRight aria-hidden className="text-faint size-3.5" />
              <li className="text-ink truncate font-medium">Détail</li>
            </>
          )}
        </ol>
      </nav>

      <PlayerSearch />
      <Notifications />
      <AccountMenu />
    </header>
  );
}
