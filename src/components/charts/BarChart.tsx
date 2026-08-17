'use client';

import { useState } from 'react';
import type { DayPoint } from '@/lib/local/selectors';
import { fmtDayShort, fmtMoney } from '@/lib/money';

/**
 * Single-series daily bars. One hue for every bar — the height already encodes
 * magnitude, so shading bars darker-where-bigger would burn the color channel
 * on information the chart shows twice.
 *
 * Marks: 4px rounded tops anchored to the baseline, a 2px surface gap between
 * neighbours (a gap, never a stroke), and a zero-value stub so an empty day is
 * visibly zero rather than missing.
 */
export function BarChart({
  data,
  tone = 'money',
  height = 120,
  currency = 'USD',
}: {
  data: DayPoint[];
  tone?: 'money' | 'cost';
  height?: number;
  currency?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const color = tone === 'money' ? 'rgb(var(--viz-money))' : 'rgb(var(--viz-cost))';

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-line text-xs text-faint"
        style={{ height }}
      >
        No data yet
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const activeDatum = active !== null ? data[active] : null;

  return (
    <div>
      <div className="mb-2 flex h-5 items-baseline justify-between text-xs">
        {activeDatum ? (
          <>
            <span className="font-semibold text-fg nums">
              {fmtMoney(activeDatum.value, currency, { compact: true })}
            </span>
            <span className="text-muted">{fmtDayShort(activeDatum.day)}</span>
          </>
        ) : (
          <>
            <span className="text-faint">Peak {fmtMoney(max, currency, { compact: true })}</span>
            <span className="text-faint">Tap a bar</span>
          </>
        )}
      </div>

      <div
        className="flex items-end gap-[2px]"
        style={{ height }}
        role="img"
        aria-label={`Daily totals for ${data.length} days, peak ${fmtMoney(max, currency)}.`}
        onPointerLeave={() => setActive(null)}
      >
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          const isActive = active === i;
          return (
            <button
              key={d.day}
              type="button"
              // The button spans the full column height so the touch target is
              // the whole strip, not the drawn bar.
              className="group relative flex h-full flex-1 items-end"
              onPointerDown={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${fmtDayShort(d.day)}: ${fmtMoney(d.value, currency)}`}
            >
              <span
                className="w-full rounded-t transition-all duration-300"
                style={{
                  // A 2px floor keeps zero days visible as zero.
                  height: `max(2px, ${pct}%)`,
                  background: color,
                  opacity: active === null ? 0.85 : isActive ? 1 : 0.32,
                  borderRadius: '4px 4px 2px 2px',
                }}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] text-faint">
        <span>{fmtDayShort(data[0].day)}</span>
        <span>{fmtDayShort(data[data.length - 1].day)}</span>
      </div>
    </div>
  );
}
