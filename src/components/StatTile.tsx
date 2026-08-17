import { Icon, type IconName } from '@/components/Icon';
import { Sparkline } from '@/components/charts/TrendChart';

/**
 * A stat tile IS the chart when the answer is one number. Adding a plot behind
 * every number would be decoration; the optional sparkline is here only to give
 * a number a direction, never to be read for values.
 */
export function StatTile({
  label,
  value,
  sub,
  delta,
  icon,
  tone = 'default',
  spark,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Percent change vs the previous comparable period. */
  delta?: number | null;
  icon?: IconName;
  tone?: 'default' | 'money' | 'cost' | 'good';
  spark?: number[];
}) {
  const valueColor =
    tone === 'money'
      ? 'text-gold'
      : tone === 'cost'
        ? 'text-brand'
        : tone === 'good'
          ? 'text-good'
          : 'text-fg';

  return (
    <div className="card-pad">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
        {icon ? (
          <span className="shrink-0 text-faint">
            <Icon name={icon} size={15} />
          </span>
        ) : null}
      </div>

      <p className={`mt-1.5 text-[1.65rem] font-bold leading-none tracking-tight nums ${valueColor}`}>
        {value}
      </p>

      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0">
          {sub ? <p className="truncate text-xs text-faint">{sub}</p> : null}
          {delta !== undefined && delta !== null ? <Delta value={delta} /> : null}
        </div>
        {spark && spark.length > 1 ? (
          <Sparkline data={spark} tone={tone === 'cost' ? 'cost' : 'money'} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Direction is carried by an arrow icon and a sign, not by color alone — the
 * color is reinforcement for readers who can use it.
 */
function Delta({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span
      className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${
        up ? 'text-good' : 'text-bad'
      }`}
    >
      <Icon name={up ? 'trendUp' : 'trendDown'} size={13} />
      <span className="nums">
        {up ? '+' : ''}
        {value.toFixed(0)}%
      </span>
      <span className="font-normal text-faint">vs last month</span>
    </span>
  );
}
