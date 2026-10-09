import { cn } from '@/lib/utils';

/** Marque Le Ter : une carte inclinée sur une carte, couleurs de l'administration. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <rect
        x="9"
        y="7"
        width="12"
        height="17"
        rx="2.5"
        className="fill-accent"
        opacity="0.9"
        transform="rotate(-10 15 15.5)"
      />
      <rect x="12" y="8" width="12" height="17" rx="2.5" className="fill-surface" />
      <path
        d="M18 12.5c1.2 1.6 2.6 2.7 2.6 4.1a2.6 2.6 0 0 1-5.2 0c0-1.4 1.4-2.5 2.6-4.1Z"
        className="fill-primary"
      />
      <path d="M18 18.6v2.2" stroke="currentColor" strokeWidth="1.2" className="text-primary" />
    </svg>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <div className="leading-tight">
          <p className="text-ink text-sm font-semibold">Le Ter</p>
          <p className="text-muted text-[11px] font-medium tracking-wide uppercase">
            Administration
          </p>
        </div>
      )}
    </div>
  );
}
