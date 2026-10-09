'use client';

import { CalendarRange } from 'lucide-react';

import { Select } from '@/components/ui/form-controls';
import { localDay, localDayStartIso } from '@/lib/format';

export const PERIODS = [
  { value: '7', label: '7 derniers jours' },
  { value: '30', label: '30 derniers jours' },
  { value: '90', label: '90 derniers jours' },
  { value: '365', label: '12 derniers mois' },
] as const;

export type PeriodValue = (typeof PERIODS)[number]['value'];

export function isPeriod(value: string): value is PeriodValue {
  return PERIODS.some((p) => p.value === value);
}

/**
 * Période en jours LOCAUX (Africa/Douala) : du début du jour J-(n-1) au début de demain.
 * Les bornes envoyées au serveur sont des instants ISO explicites `[from, to)`.
 */
export function periodRange(days: number, now = new Date()): { from: string; to: string } {
  const today = localDay(now);
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return {
    from: localDayStartIso(start.toISOString().slice(0, 10)),
    to: localDayStartIso(tomorrow.toISOString().slice(0, 10)),
  };
}

export function PeriodSelect({
  value,
  onChange,
}: {
  value: PeriodValue;
  onChange: (value: PeriodValue) => void;
}) {
  return (
    <label className="text-muted flex items-center gap-2 text-sm">
      <CalendarRange className="text-faint size-4" aria-hidden />
      <span className="sr-only">Période</span>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value as PeriodValue)}
        className="w-auto"
      >
        {PERIODS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
