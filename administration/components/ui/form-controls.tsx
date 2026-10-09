import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

const field =
  'h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink shadow-card transition-colors placeholder:text-faint hover:border-line-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(field, className)} {...props} />;
}

/** Liste native : accessible au clavier et aux lecteurs d'écran, partout. */
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(field, 'cursor-pointer pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-ink-soft text-xs font-medium', className)} {...props} />;
}

/** Champ complet : libellé, contrôle, aide ou erreur (annoncée aux lecteurs d'écran). */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : (
        hint && <p className="text-muted text-xs">{hint}</p>
      )}
    </div>
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'h-auto min-h-20 py-2', className)} {...props} />;
}
