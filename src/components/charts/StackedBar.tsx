'use client';

import { fmtMoney } from '@/lib/money';

/**
 * Part-to-whole across platforms — a horizontal stacked bar, not a donut.
 * A donut makes close values hard to compare and wastes vertical space on a
 * phone; a single stacked row plus a labelled legend reads instantly.
 *
 * Color follows the ENTITY, not its rank: Whop is always blue even when it's
 * the smallest slice, so filtering or a change in ordering never repaints the
 * segments a reader has already learned.
 */

const SERIES: Record<string, { color: string; label: string }> = {
  whop: { color: 'var(--series-1)', label: 'Whop' },
  manual: { color: 'var(--series-2)', label: 'Manual' },
  shopify: { color: 'var(--series-3)', label: 'Shopify' },
};

const OTHER = { color: 'rgb(var(--c-faint))', label: 'Other' };

export type Slice = { platform: string; revenue: number; count: number };

export function StackedBar({ data, currency = 'USD' }: { data: Slice[]; currency?: string }) {
  const positive = data.filter((d) => d.revenue > 0);
  const total = positive.reduce((sum, d) => sum + d.revenue, 0);

  if (total <= 0) {
    return (
      <p className="py-4 text-center text-xs text-faint">
        No revenue recorded yet — log a sale or run a sync.
      </p>
    );
  }

  const series = (p: string) => SERIES[p] ?? OTHER;

  return (
    <div>
      {/* The 2px gaps come from the flex gap, never from a stroke on the fills. */}
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img"
           aria-label={positive
             .map((d) => `${series(d.platform).label} ${fmtMoney(d.revenue, currency)}`)
             .join(', ')}>
        {positive.map((d) => (
          <span
            key={d.platform}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(d.revenue / total) * 100}%`,
              background: series(d.platform).color,
              minWidth: 4,
            }}
          />
        ))}
      </div>

      {/* Legend is always present for >= 2 series, and each entry is directly
          labelled with its value, so identity is never carried by color alone. */}
      <ul className="mt-3 space-y-1.5">
        {positive.map((d) => {
          const s = series(d.platform);
          return (
            <li key={d.platform} className="flex items-center gap-2.5 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: s.color }}
                aria-hidden="true"
              />
              <span className="flex-1 truncate text-muted">{s.label}</span>
              <span className="text-xs text-faint nums">{d.count}×</span>
              <span className="font-semibold text-fg nums">
                {fmtMoney(d.revenue, currency, { compact: true })}
              </span>
              <span className="w-9 text-right text-xs text-faint nums">
                {Math.round((d.revenue / total) * 100)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
