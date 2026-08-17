'use client';

import { useId, useMemo, useState } from 'react';
import type { DayPoint } from '@/lib/local/selectors';
import { fmtDayShort, fmtMoney } from '@/lib/money';

/**
 * Single-series trend over time. One hue, no legend — the card title names the
 * series, so a legend box would just be chrome.
 *
 * Interaction: this is a touch device, so "hover" is a drag. Touching anywhere
 * on the plot moves a crosshair to the nearest day and shows its value. The hit
 * area spans the full height of the chart, not just the line.
 */

export function TrendChart({
  data,
  tone = 'money',
  height = 132,
  currency = 'USD',
  /** Charts a count instead of money when false. */
  isMoney = true,
}: {
  data: DayPoint[];
  tone?: 'money' | 'cost';
  height?: number;
  currency?: string;
  isMoney?: boolean;
}) {
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);

  const color = tone === 'money' ? 'rgb(var(--viz-money))' : 'rgb(var(--viz-cost))';

  const W = 320;
  const H = height;
  const PAD_T = 10;
  const PAD_B = 18;

  const { path, areaPath, points, max } = useMemo(() => {
    if (data.length === 0) {
      return { path: '', areaPath: '', points: [] as { x: number; y: number }[], max: 0 };
    }

    const values = data.map((d) => d.value);
    // Headroom above the peak so the line never touches the card edge.
    const peak = Math.max(...values, 1);
    const max = peak * 1.15;
    const step = data.length > 1 ? W / (data.length - 1) : W;

    const points = data.map((d, i) => ({
      x: i * step,
      y: PAD_T + (1 - d.value / max) * (H - PAD_T - PAD_B),
    }));

    // Catmull-Rom style smoothing keeps a 30-point series readable without
    // implying data between the daily samples.
    const path = points
      .map((p, i) => {
        if (i === 0) return `M ${p.x} ${p.y}`;
        const prev = points[i - 1];
        const cx = (prev.x + p.x) / 2;
        return `C ${cx} ${prev.y} ${cx} ${p.y} ${p.x} ${p.y}`;
      })
      .join(' ');

    const areaPath = `${path} L ${W} ${H - PAD_B} L 0 ${H - PAD_B} Z`;

    return { path, areaPath, points, max };
  }, [data, H]);

  if (data.length === 0) return <EmptyPlot height={height} />;

  const activePoint = active !== null ? points[active] : null;
  const activeDatum = active !== null ? data[active] : null;

  const handleMove = (clientX: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (data.length - 1));
    setActive(Math.max(0, Math.min(data.length - 1, index)));
  };

  const format = (v: number) => (isMoney ? fmtMoney(v, currency, { compact: true }) : String(v));

  return (
    <div className="relative">
      {/* Readout sits above the plot so a thumb never covers it. */}
      <div className="mb-1 flex h-5 items-baseline justify-between text-xs">
        {activeDatum ? (
          <>
            <span className="font-semibold text-fg nums">{format(activeDatum.value)}</span>
            <span className="text-muted">{fmtDayShort(activeDatum.day)}</span>
          </>
        ) : (
          <>
            <span className="text-faint">Peak {format(Math.max(...data.map((d) => d.value)))}</span>
            <span className="text-faint">{data.length}d</span>
          </>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        className="touch-pan-y"
        onPointerDown={(e) => handleMove(e.clientX, e.currentTarget)}
        onPointerMove={(e) => {
          if (e.buttons > 0 || e.pointerType === 'touch') handleMove(e.clientX, e.currentTarget);
        }}
        onPointerLeave={() => setActive(null)}
        onPointerUp={() => setActive(null)}
        role="img"
        aria-label={`Trend over ${data.length} days. Peak ${format(Math.max(...data.map((d) => d.value)))}.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive baseline only — no gridlines competing with a 2px line. */}
        <line
          x1="0"
          y1={H - PAD_B}
          x2={W}
          y2={H - PAD_B}
          stroke="rgb(var(--viz-grid) / 0.09)"
          strokeWidth="1"
        />

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {activePoint ? (
          <g>
            <line
              x1={activePoint.x}
              y1={PAD_T - 6}
              x2={activePoint.x}
              y2={H - PAD_B}
              stroke="rgb(var(--viz-grid) / 0.25)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {/* 2px surface ring keeps the marker legible over the area fill. */}
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r="5"
              fill={color}
              stroke="rgb(var(--c-surface))"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}
      </svg>

      <div className="flex justify-between px-0.5 text-[10px] text-faint">
        <span>{fmtDayShort(data[0].day)}</span>
        <span>{fmtDayShort(data[data.length - 1].day)}</span>
      </div>
    </div>
  );
}

/**
 * Compact inline sparkline for stat tiles. No axis, no interaction — it exists
 * to give the number a direction, and the number is the real content.
 */
export function Sparkline({
  data,
  tone = 'money',
  width = 72,
  height = 24,
}: {
  data: number[];
  tone?: 'money' | 'cost' | 'good';
  width?: number;
  height?: number;
}) {
  const color =
    tone === 'money'
      ? 'rgb(var(--viz-money))'
      : tone === 'cost'
        ? 'rgb(var(--viz-cost))'
        : 'rgb(var(--c-good))';

  if (data.length < 2) {
    return <div style={{ width, height }} aria-hidden="true" />;
  }

  const max = Math.max(...data, 1);
  const step = width / (data.length - 1);
  const path = data
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${height - (v / max) * (height - 3) - 1.5}`)
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptyPlot({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-dashed border-line text-xs text-faint"
      style={{ height }}
    >
      No data yet
    </div>
  );
}
