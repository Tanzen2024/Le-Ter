'use client';

import { useId, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { formatDay, formatNumber } from '@/lib/format';

export interface SeriesPoint {
  day: string;
  value: number;
}

/**
 * Une série dans le temps (un seul indicateur : pas de second axe, pas de légende — le
 * titre nomme la série). Réticule et infobulle au survol, vue tableau accessible.
 * Données réelles uniquement : une série vide affiche un état vide, jamais des zéros
 * inventés au-delà de ce que le serveur renvoie.
 */
export function TimeSeriesChart({
  data,
  kind,
  color,
  valueLabel,
  format = formatNumber,
  height = 220,
}: {
  data: SeriesPoint[];
  kind: 'area' | 'column';
  color: 'chart-1' | 'chart-2';
  valueLabel: string;
  format?: (value: number) => string;
  height?: number;
}) {
  const [table, setTable] = useState(false);
  const gradientId = useId();
  const stroke = `var(--color-${color})`;
  const hasData = data.some((d) => d.value > 0);

  const axisProps = {
    tickLine: false,
    axisLine: false,
    tick: { fill: 'var(--color-muted)', fontSize: 11 },
  } as const;

  const renderTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: readonly { value?: unknown }[];
    label?: unknown;
  }) => {
    if (!active || !payload?.length) return null;
    const value = Number(payload[0]?.value ?? 0);
    return (
      <div className="border-line bg-surface shadow-raised rounded-lg border px-3 py-2">
        <p className="text-ink text-sm font-semibold tabular-nums">{format(value)}</p>
        <p className="text-muted mt-0.5 flex items-center gap-1.5 text-xs">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: stroke }} />
          {valueLabel} · {formatDay(String(label))}
        </p>
      </div>
    );
  };

  return (
    <div>
      {!hasData ? (
        <EmptyState title="Aucune donnée sur la période">
          Le serveur n’a enregistré aucune valeur pour cet indicateur.
        </EmptyState>
      ) : table ? (
        <div className="max-h-[260px] overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{valueLabel} par jour</caption>
            <thead>
              <tr className="text-muted text-left text-xs">
                <th scope="col" className="py-1.5 font-medium">
                  Jour
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  {valueLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-line border-t">
                  <td className="text-ink-soft py-1.5">{formatDay(d.day)}</td>
                  <td className="text-ink py-1.5 text-right tabular-nums">{format(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }} role="img" aria-label={`${valueLabel} par jour`}>
          <ResponsiveContainer width="100%" height="100%">
            {kind === 'area' ? (
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
                <XAxis dataKey="day" tickFormatter={formatDay} minTickGap={24} {...axisProps} />
                <YAxis
                  width={44}
                  allowDecimals={false}
                  tickFormatter={(v: number) => formatNumber(v)}
                  {...axisProps}
                />
                <Tooltip
                  content={renderTooltip}
                  cursor={{ stroke: 'var(--color-line-strong)', strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={stroke}
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  activeDot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            ) : (
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
                <XAxis dataKey="day" tickFormatter={formatDay} minTickGap={24} {...axisProps} />
                <YAxis
                  width={56}
                  allowDecimals={false}
                  tickFormatter={(v: number) => formatNumber(v)}
                  {...axisProps}
                />
                <Tooltip content={renderTooltip} cursor={{ fill: 'var(--color-surface-muted)' }} />
                <Bar
                  dataKey="value"
                  fill={stroke}
                  maxBarSize={24}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      {hasData && (
        <div className="mt-2 flex justify-end">
          <Button variant="link" size="sm" onClick={() => setTable((v) => !v)}>
            {table ? 'Voir le graphique' : 'Voir les données'}
          </Button>
        </div>
      )}
    </div>
  );
}
