import { Icon, type IconName } from '@/components/Icon';
import { Sparkline } from '@/components/charts/TrendChart';

/**
 * A stat tile IS the chart when the answer is one number.
 *
 * Redesigned to stop shouting: the label is small and quiet, the number is
 * large and neutral, and colour appears only where it means something. The
 * previous version tinted every value gold, which spent the strongest signal
 * in the palette on "this is a number" — leaving nothing to say "this is
 * money".
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
  // Only the headline money figure earns gold. Supporting values stay neutral
  // so the eye lands on the one that matters.
  const valueColor = tone === 'money' ? 'text-gold' : 'text-fg';

  return (
    <div className="card px-3.5 py-3">
      <div className="flex items-center gap-1.5">
        {icon ? (
          <span className="shrink-0 text-faint">
            <Icon name={icon} size={13} />
          </span>
        ) : null}
        <p className="metric-label truncate">{label}</p>
      </div>

      <p className={`stat mt-2 ${valueColor}`}>{value}</p>

      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          {delta !== undefined && delta !== null ? (
            <Delta value={delta} />
          ) : sub ? (
            <p className="truncate text-[0.75rem] text-faint">{sub}</p>
          ) : null}
        </div>
        {spark && spark.length > 1 ? (
          <Sparkline data={spark} tone={tone === 'cost' ? 'cost' : 'money'} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Direction is carried by an arrow and a sign, not by colour alone — colour is
 * reinforcement for readers who can use it.
 */
function Delta({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[0.75rem] font-medium ${
        up ? 'text-good' : 'text-bad'
      }`}
    >
      <Icon name={up ? 'trendUp' : 'trendDown'} size={12} />
      <span className="nums">
        {up ? '+' : ''}
        {value.toFixed(0)}%
      </span>
    </span>
  );
}
