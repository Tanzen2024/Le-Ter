'use client';

import { DropdownMenu as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;

export function DropdownMenuContent({
  className,
  align = 'end',
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={6}
        className={cn(
          'border-line bg-surface shadow-raised data-[state=open]:animate-fade-in z-50 min-w-52 rounded-lg border p-1',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        'text-ink-soft data-[highlighted]:bg-surface-muted data-[highlighted]:text-ink flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label className={cn('px-2.5 py-2', className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <Primitive.Separator className="bg-line my-1 h-px" />;
}
