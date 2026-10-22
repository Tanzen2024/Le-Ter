'use client';

import { CalendarRange } from 'lucide-react';

import { Input, Select } from '@/components/ui/form-controls';
import { localDay, localDayStartIso } from '@/lib/format';

import { periodRange } from './period';

/**
 * Période d'une vue des recettes (D-120) : Aujourd'hui, 7 / 30 / 90 jours, 12 mois, ou période
 * personnalisée (jours locaux Africa/Douala, bornes incluses). Portée par l'URL
 * (`periode`, `du`, `au`) comme les autres filtres : partageable et combinable.
 */
export const RANGE_PERIODS = [
  { value: 'today', label: 'Aujourd’hui' },
  { value: '7', label: '7 derniers jours' },
  { value: '30', label: '30 derniers jours' },
  { value: '90', label: '90 derniers jours' },
  { value: '365', label: '12 derniers mois' },
  { value: 'custom', label: 'Période personnalisée' },
] as const;

export type RangePeriod = (typeof RANGE_PERIODS)[number]['value'];

export function isRangePeriod(value: string): value is RangePeriod {
  return RANGE_PERIODS.some((p) => p.value === value);
}

function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Bornes `[from, to)` envoyées au serveur. Période personnalisée incomplète : `undefined`
 * (la requête attend les deux dates). `du` après `au` : les dates sont remises dans l'ordre.
 */
export function rangeOf(
  period: RangePeriod,
  du: string,
  au: string,
  now = new Date(),
): { from: string; to: string } | undefined {
  if (period === 'today') return periodRange(1, now);
  if (period !== 'custom') return periodRange(Number(period), now);
  if (!du || !au) return undefined;
  const [first, last] = du <= au ? [du, au] : [au, du];
  return { from: localDayStartIso(first), to: localDayStartIso(nextDay(last)) };
}

/** Libellé court de la période (indices des indicateurs). */
export function rangeLabel(period: RangePeriod, du: string, au: string): string {
  if (period === 'custom') return du && au ? `du ${du} au ${au}` : 'période à préciser';
  return RANGE_PERIODS.find((p) => p.value === period)?.label.toLowerCase() ?? '';
}

export function RangePeriodFilter({
  period,
  du,
  au,
  onChange,
  allLabel,
}: {
  /** `''` : aucune borne (seulement si `allLabel` est fourni). */
  period: RangePeriod | '';
  du: string;
  au: string;
  onChange: (values: { periode?: string; du?: string; au?: string }) => void;
  /** Option « sans période » en tête de liste (listes d'historique). */
  allLabel?: string;
}) {
  const today = localDay(new Date());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-muted flex items-center gap-2 text-sm">
        <CalendarRange className="text-faint size-4" aria-hidden />
        <span className="sr-only">Période</span>
        <Select
          aria-label="Période"
          value={period}
          onChange={(e) => onChange({ periode: e.target.value, du: '', au: '' })}
          className="w-auto"
        >
          {allLabel !== undefined && <option value="">{allLabel}</option>}
          {RANGE_PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </label>
      {period === 'custom' && (
        <>
          <Input
            type="date"
            aria-label="Du"
            value={du}
            max={today}
            onChange={(e) => onChange({ periode: 'custom', du: e.target.value, au })}
            className="w-auto"
          />
          <Input
            type="date"
            aria-label="Au"
            value={au}
            max={today}
            onChange={(e) => onChange({ periode: 'custom', du, au: e.target.value })}
            className="w-auto"
          />
        </>
      )}
    </div>
  );
}
