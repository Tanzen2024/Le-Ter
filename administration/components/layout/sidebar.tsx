'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

import { Logo } from './logo';
import { NAV, sectionOf } from './nav';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = sectionOf(pathname)?.href;
  return (
    <nav aria-label="Navigation principale" className="flex flex-col gap-5 px-3 py-4">
      {NAV.map((group) => (
        <div key={group.label}>
          <p className="text-faint px-3 pb-1.5 text-[11px] font-medium tracking-wider uppercase">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              const current = active === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      current
                        ? 'bg-primary-soft text-primary font-medium'
                        : 'text-ink-soft hover:bg-surface-muted hover:text-ink',
                    )}
                  >
                    <Icon
                      aria-hidden
                      className={cn('size-4 shrink-0', current ? 'text-primary' : 'text-faint')}
                    />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="border-line bg-surface sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r lg:flex">
      <div className="border-line flex h-16 items-center border-b px-5">
        <Link href="/tableau-de-bord" aria-label="Tableau de bord">
          <Logo />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto">
        <SidebarNav />
      </div>
      <p className="border-line text-faint border-t px-5 py-3 text-[11px]">
        Accès réservé au super administrateur.
      </p>
    </aside>
  );
}
