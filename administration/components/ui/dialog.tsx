'use client';

import { Dialog as Primitive } from 'radix-ui';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Primitive.Content>, 'title'> & {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="bg-ink/30 data-[state=open]:animate-fade-in fixed inset-0 z-50 backdrop-blur-[2px]" />
      <Primitive.Content
        className={cn(
          'border-line bg-surface shadow-raised data-[state=open]:animate-fade-in fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6',
          className,
        )}
        {...props}
      >
        <div className="mb-4 pr-8">
          <Primitive.Title className="text-ink text-base font-semibold">{title}</Primitive.Title>
          {description ? (
            <Primitive.Description className="text-muted mt-1 text-sm">
              {description}
            </Primitive.Description>
          ) : (
            <Primitive.Description className="sr-only">{title}</Primitive.Description>
          )}
        </div>
        {children}
        <Primitive.Close
          className="text-muted hover:bg-surface-muted hover:text-ink absolute top-4 right-4 rounded-md p-1"
          aria-label="Fermer"
        >
          <X className="size-4" />
        </Primitive.Close>
      </Primitive.Content>
    </Primitive.Portal>
  );
}

/** Panneau latéral (navigation mobile). */
export function SheetContent({
  children,
  title,
  ...props
}: Omit<ComponentProps<typeof Primitive.Content>, 'title'> & { title: string }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="bg-ink/30 data-[state=open]:animate-fade-in fixed inset-0 z-50" />
      <Primitive.Content
        className="bg-surface shadow-raised data-[state=open]:animate-fade-in fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw]"
        {...props}
      >
        <Primitive.Title className="sr-only">{title}</Primitive.Title>
        <Primitive.Description className="sr-only">{title}</Primitive.Description>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}
