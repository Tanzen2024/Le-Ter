'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { EmptyState } from '@/components/feedback/states';
import { formatNumber, formatXaf } from '@/lib/format';
import { LEDGER_SOURCE, LEDGER_SOURCES } from '@/lib/labels';
import type { SourceAmount } from '@/types/admin';

/**
 * Couleur FIXE de chaque origine (jamais selon le rang) : palette validée (lumière, chroma,
 * séparation daltonisme, contraste), dans cet ordre.
 */
const SOURCE_COLOR: Record<string, string> = {
  FAP_FAP: 'var(--color-chart-2)',
  TOURNAMENT: 'var(--color-chart-1)',
  GARAM_TIA: 'var(--color-chart-3)',
};

/**
 * Parts en pour mille par la méthode du plus fort reste : la somme affichée fait toujours
 * exactement 100,0 % (aucun arrondi qui donnerait 99,9 % ou 100,1 %).
 */
export function sharesPerMille(amounts: readonly number[]): number[] {
  const total = amounts.reduce((sum, a) => sum + a, 0);
  if (total <= 0) return amounts.map(() => 0);
  const exact = amounts.map((a) => (a * 1000) / total);
  const shares = exact.map(Math.floor);
  let rest = 1000 - shares.reduce((sum, s) => sum + s, 0);
  const order = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    shares[i] = (shares[i] ?? 0) + 1;
    rest -= 1;
  }
  return shares;
}

const formatShare = (perMille: number) =>
  `${(perMille / 10).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

/**
 * Répartition des recettes de la caisse UNIQUE par ORIGINE (D-120) : une barre empilée
 * horizontale (partie d'un tout), segments séparés de 2 px, et sa légende-tableau (couleur,
 * libellé, montant, part, écritures), lisible sans la couleur. Trois origines d'une seule
 * caisse, jamais trois caisses.
 */
export function SourceBreakdown({ bySource }: { bySource: SourceAmount[] }) {
  const rows = LEDGER_SOURCES.map(
    (source) => bySource.find((s) => s.source === source) ?? { source, count: 0, amount: 0 },
  );
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const shares = sharesPerMille(rows.map((r) => r.amount));
  const datum = Object.fromEntries(rows.map((r) => [r.source, r.amount]));
  const visible = rows.filter((r) => r.amount > 0);

  return (
    <div className="space-y-4">
      {total <= 0 ? (
        <EmptyState title="Aucune recette sur la période">
          Aucune écriture de la caisse ne correspond à ces filtres.
        </EmptyState>
      ) : (
        <div
          style={{ height: 36 }}
          role="img"
          aria-label={`Répartition des recettes par source : ${rows
            .map((r, i) => `${LEDGER_SOURCE[r.source]} ${formatShare(shares[i] ?? 0)}`)
            .join(', ')}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={[datum]}
              layout="vertical"
              margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
              barCategoryGap={0}
            >
              <XAxis type="number" hide domain={[0, total]} />
              <YAxis type="category" hide />
              <Tooltip
                cursor={false}
                content={({ active, payload }) => {
                  const item = active ? payload?.[0] : undefined;
                  if (!item) return null;
                  const source = String(item.dataKey);
                  const index = rows.findIndex((r) => r.source === source);
                  return (
                    <div className="border-line bg-surface shadow-raised rounded-lg border px-3 py-2">
                      <p className="text-ink text-sm font-semibold tabular-nums">
                        {formatXaf(Number(item.value ?? 0))}
                      </p>
                      <p className="text-muted mt-0.5 text-xs">
                        {LEDGER_SOURCE[source]} · {formatShare(shares[index] ?? 0)}
                      </p>
                    </div>
                  );
                }}
              />
              {visible.map((r, i) => (
                <Bar
                  key={r.source}
                  dataKey={r.source}
                  stackId="sources"
                  fill={SOURCE_COLOR[r.source]}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  radius={
                    visible.length === 1
                      ? [4, 4, 4, 4]
                      : i === 0
                        ? [4, 0, 0, 4]
                        : i === visible.length - 1
                          ? [0, 4, 4, 0]
                          : 0
                  }
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <table className="w-full text-sm">
        <caption className="sr-only">Recettes par source</caption>
        <thead>
          <tr className="text-muted text-left text-xs">
            <th scope="col" className="py-1.5 font-medium">
              Source
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Montant
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Part
            </th>
            <th scope="col" className="hidden py-1.5 text-right font-medium sm:table-cell">
              Écritures
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.source} className="border-line border-t">
              <td className="text-ink py-1.5">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: SOURCE_COLOR[r.source] }}
                  />
                  {LEDGER_SOURCE[r.source]}
                </span>
              </td>
              <td className="text-ink py-1.5 text-right whitespace-nowrap tabular-nums">
                {formatXaf(r.amount)}
              </td>
              <td className="text-ink-soft py-1.5 text-right whitespace-nowrap tabular-nums">
                {formatShare(shares[i] ?? 0)}
              </td>
              <td className="text-muted hidden py-1.5 text-right tabular-nums sm:table-cell">
                {formatNumber(r.count)}
              </td>
            </tr>
          ))}
          <tr className="border-line border-t font-semibold">
            <td className="text-ink py-1.5">Total</td>
            <td className="text-ink py-1.5 text-right whitespace-nowrap tabular-nums">
              {formatXaf(total)}
            </td>
            <td className="text-ink-soft py-1.5 text-right tabular-nums">
              {total > 0 ? '100,0 %' : '—'}
            </td>
            <td className="text-muted hidden py-1.5 text-right tabular-nums sm:table-cell">
              {formatNumber(rows.reduce((sum, r) => sum + r.count, 0))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
