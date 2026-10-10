'use client';

import { Clock } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { LOCALE } from '@/lib/format';
import {
  formatTime,
  from12Hour,
  parseTime,
  to12Hour,
  toTimeValue,
  uses12Hour,
  type ClockTime,
  type Period,
} from '@/lib/time';
import { cn } from '@/lib/utils';

const LABELS = {
  fr: {
    placeholder: 'Choisir une heure',
    hours: 'Heures',
    minutes: 'Minutes',
    period: 'Période',
    done: 'Valider',
  },
  en: {
    placeholder: 'Choose a time',
    hours: 'Hours',
    minutes: 'Minutes',
    period: 'Period',
    done: 'Done',
  },
};

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const HOURS_12 = [12, ...Array.from({ length: 11 }, (_, i) => i + 1)];
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS: Period[] = ['AM', 'PM'];

/**
 * Sélecteur d'heure : champ avec icône d'horloge ouvrant des colonnes Heures, Minutes et,
 * si la locale l'utilise, AM/PM. Remplace `<input type="time">`, dont l'affichage suit la
 * langue du NAVIGATEUR (12 h sur un navigateur anglais) et non celle de l'administration.
 * La valeur émise reste `HH:mm` sur 24 h. Clavier : flèches haut/bas, Début/Fin dans chaque
 * colonne, Échap pour fermer.
 */
export function TimePicker({
  id,
  value,
  onChange,
  onBlur,
  locale = LOCALE,
  className,
  ...aria
}: {
  id: string;
  value: string | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  locale?: string;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const labels = locale.toLowerCase().startsWith('en') ? LABELS.en : LABELS.fr;
  const twelve = uses12Hour(locale);
  const current = parseTime(value);
  const time: ClockTime = current ?? { hours: 0, minutes: 0 };
  const { hour, period } = to12Hour(time.hours);
  const [open, setOpen] = useState(false);
  const set = (next: ClockTime) => onChange(toTimeValue(next));

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
    >
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          {...aria}
          className={cn(
            'border-line bg-surface text-ink shadow-card hover:border-line-strong focus-visible:border-accent focus-visible:ring-accent/25 aria-[invalid=true]:border-danger flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none',
            className,
          )}
        >
          <span className={cn(!current && 'text-faint')}>
            {current ? formatTime(current, locale) : labels.placeholder}
          </span>
          <Clock aria-hidden className="text-muted size-4 shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="border-line bg-surface shadow-raised data-[state=open]:animate-fade-in z-50 rounded-lg border p-2"
        >
          <div className="flex gap-2">
            {twelve ? (
              <Column
                label={labels.hours}
                items={HOURS_12}
                selected={hour}
                format={pad}
                onSelect={(h) => set({ ...time, hours: from12Hour(h, period) })}
                autoFocus
              />
            ) : (
              <Column
                label={labels.hours}
                items={HOURS_24}
                selected={time.hours}
                format={pad}
                onSelect={(hours) => set({ ...time, hours })}
                autoFocus
              />
            )}
            <Column
              label={labels.minutes}
              items={MINUTES}
              selected={time.minutes}
              format={pad}
              onSelect={(minutes) => set({ ...time, minutes })}
            />
            {twelve && (
              <Column
                label={labels.period}
                items={PERIODS}
                selected={period}
                format={String}
                onSelect={(p) => set({ ...time, hours: from12Hour(hour, p) })}
              />
            )}
          </div>
          <div className="mt-2 flex justify-end">
            <Popover.Close asChild>
              <Button size="sm">{labels.done}</Button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Colonne = liste d'options (rôle listbox) ; la valeur choisie est visible à l'ouverture. */
function Column<T extends string | number>({
  label,
  items,
  selected,
  format,
  onSelect,
  autoFocus = false,
}: {
  label: string;
  items: T[];
  selected: T;
  format: (item: T) => string;
  onSelect: (item: T) => void;
  autoFocus?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const index = Math.max(0, items.indexOf(selected));
  const optionId = (i: number) => `${label}-${i}`.replace(/\s/g, '-');

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'center' });
  }, [selected]);
  useEffect(() => {
    if (autoFocus) list.current?.focus();
  }, [autoFocus]);

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: items.length - 1,
    };
    const next = moves[event.key];
    const item = next === undefined ? undefined : items[(next + items.length) % items.length];
    if (item === undefined) return;
    event.preventDefault();
    onSelect(item);
  };

  return (
    <div className="flex w-16 flex-col">
      <span className="text-muted pb-1 text-center text-xs font-medium">{label}</span>
      <div
        ref={list}
        role="listbox"
        aria-label={label}
        aria-activedescendant={optionId(index)}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="border-line focus-visible:ring-accent/25 h-48 overflow-y-auto rounded-md border focus-visible:ring-2 focus-visible:outline-none"
      >
        {items.map((item, i) => (
          <div
            key={String(item)}
            id={optionId(i)}
            role="option"
            aria-selected={i === index}
            onClick={() => onSelect(item)}
            className={cn(
              'cursor-pointer py-1.5 text-center text-sm tabular-nums',
              i === index
                ? 'bg-primary text-primary-ink font-semibold'
                : 'text-ink hover:bg-surface-muted',
            )}
          >
            {format(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
