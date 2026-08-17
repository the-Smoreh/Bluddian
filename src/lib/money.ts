/**
 * Money is stored and passed around as integer cents everywhere in this app.
 * Floats only appear at the moment of rendering. Keep it that way.
 */

export function fmtMoney(
  cents: number,
  currency = 'USD',
  opts: { compact?: boolean } = {},
): string {
  const value = cents / 100;
  if (opts.compact && Math.abs(value) >= 10_000) {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    return formatter.format(value);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function fmtCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    n,
  );
}

export function fmtPct(n: number, digits = 0): string {
  return `${n >= 0 ? '' : ''}${n.toFixed(digits)}%`;
}

/** "$1,200" -> 120000 cents. Tolerates commas, symbols, and blank input. */
export function parseMoneyToCents(input: string): number {
  const clean = input.replace(/[^0-9.-]/g, '');
  if (!clean) return 0;
  const value = Number.parseFloat(clean);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['week', 604_800_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(-diff / ms), unit);
  }
  return 'just now';
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function fmtDayShort(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
