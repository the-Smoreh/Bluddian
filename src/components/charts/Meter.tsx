'use client';

import { useMounted } from '@/lib/useAnimated';

/**
 * A single ratio against a limit — the correct form for goal progress, XP to
 * next level, and course completion. Deliberately NOT a ring or a two-slice
 * donut: a linear meter on a same-ramp track is easier to read at a glance,
 * survives a narrow phone column, and leaves the value beside it as text.
 */

export function Meter({
  value,
  max,
  tone = 'money',
  height = 10,
  label,
  className = '',
}: {
  value: number;
  max: number;
  tone?: 'money' | 'cost' | 'good' | 'accent';
  height?: number;
  /** Accessible description; the visible number lives next to the meter. */
  label?: string;
  className?: string;
}) {
  const mounted = useMounted();
  const safeMax = Math.max(1, max);
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));

  const fill =
    tone === 'money'
      ? 'rgb(var(--viz-money))'
      : tone === 'cost'
        ? 'rgb(var(--viz-cost))'
        : tone === 'good'
          ? 'rgb(var(--c-good))'
          : 'rgb(var(--c-accent))';

  return (
    <div
      className={`w-full overflow-hidden rounded-full ${className}`}
      style={{ height, background: 'rgb(var(--viz-track))' }}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="h-full rounded-full"
        style={{
          // Fills from empty on first paint, then eases between values as the
          // underlying number changes.
          width: mounted ? `${pct}%` : '0%',
          transition: 'width 850ms cubic-bezier(0.22, 1, 0.36, 1)',
          background: fill,
        }}
      />
    </div>
  );
}

/**
 * Segmented variant used for streaks — discrete days read better as ticks than
 * as a continuous bar, because the unit (a day) is countable.
 */
export function SegmentMeter({
  filled,
  total,
  tone = 'rgb(232 179 65)',
}: {
  filled: number;
  total: number;
  tone?: string;
}) {
  return (
    <div
      className="flex gap-1"
      role="meter"
      aria-valuenow={filled}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="h-1.5 flex-1 rounded-full"
          style={{
            background: i < filled ? tone : 'rgb(var(--viz-track))',
            transition: 'background-color 320ms ease-out',
            transitionDelay: `${i * 60}ms`,
          }}
        />
      ))}
    </div>
  );
}
