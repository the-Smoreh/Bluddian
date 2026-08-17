'use client';

import type { Database, Goal, Product, Sale } from '@/lib/local/types';
import { today } from '@/lib/local/types';

/**
 * Every derived number the dashboard shows, as pure functions over the
 * in-memory database. No SQL, no async, no caching — a few thousand array
 * operations are far below a frame budget, and pure functions are trivially
 * testable.
 *
 * All revenue figures are NET cents (gross − fees − refunds) unless the name
 * says otherwise, because net is the number that actually matters.
 */

// -------------------------------------------------------------- date math --

export function periodStart(
  period: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all',
  ref = new Date(),
): number {
  const d = ref;
  switch (period) {
    case 'day':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    case 'week': {
      const day = d.getUTCDay() || 7;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 1);
    }
    case 'month':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    case 'quarter':
      return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
    case 'year':
      return Date.UTC(d.getUTCFullYear(), 0, 1);
    default:
      return 0;
  }
}

const isPaid = (s: Sale) => s.status === 'paid';

// ---------------------------------------------------------------- revenue --

export function revenueSince(db: Database, since: number, until = Date.now()): number {
  let total = 0;
  for (const s of db.sales) {
    if (isPaid(s) && s.occurredAt >= since && s.occurredAt <= until) total += s.netCents;
  }
  return total;
}

export function salesCountSince(db: Database, since: number, until = Date.now()): number {
  let n = 0;
  for (const s of db.sales) {
    if (isPaid(s) && s.occurredAt >= since && s.occurredAt <= until) n++;
  }
  return n;
}

export type RevenueSummary = {
  allTime: number;
  today: number;
  week: number;
  month: number;
  year: number;
  lastMonth: number;
  monthDelta: number | null;
  salesTotal: number;
  salesMonth: number;
  aovCents: number;
  refundedCents: number;
  feesCents: number;
  mrrCents: number;
};

export function revenueSummary(db: Database): RevenueSummary {
  const monthStart = periodStart('month');
  const prev = new Date(monthStart);
  const prevMonthStart = Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() - 1, 1);

  const allTime = revenueSince(db, 0);
  const month = revenueSince(db, monthStart);
  const lastMonth = revenueSince(db, prevMonthStart, monthStart - 1);
  const salesTotal = salesCountSince(db, 0);

  let fees = 0;
  let refunds = 0;
  let mrr = 0;
  const mrrCutoff = Date.now() - 30 * 86_400_000;

  for (const s of db.sales) {
    fees += s.feesCents;
    refunds += s.refundCents;
    if (isPaid(s) && s.isRecurring && s.occurredAt >= mrrCutoff) mrr += s.netCents;
  }

  return {
    allTime,
    today: revenueSince(db, periodStart('day')),
    week: revenueSince(db, periodStart('week')),
    month,
    year: revenueSince(db, periodStart('year')),
    lastMonth,
    monthDelta: lastMonth > 0 ? ((month - lastMonth) / lastMonth) * 100 : null,
    salesTotal,
    salesMonth: salesCountSince(db, monthStart),
    aovCents: salesTotal > 0 ? Math.round(allTime / salesTotal) : 0,
    refundedCents: refunds,
    feesCents: fees,
    mrrCents: mrr,
  };
}

export type DayPoint = { day: string; value: number; count: number };

/** Zero-filled daily series, so an empty day reads as zero rather than absent. */
export function revenueByDay(db: Database, days = 30): DayPoint[] {
  const now = new Date();
  const startDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
    (days - 1) * 86_400_000;

  const buckets = new Map<string, { value: number; count: number }>();
  for (const s of db.sales) {
    if (!isPaid(s) || s.occurredAt < startDay) continue;
    const key = new Date(s.occurredAt).toISOString().slice(0, 10);
    const cur = buckets.get(key) ?? { value: 0, count: 0 };
    cur.value += s.netCents;
    cur.count += 1;
    buckets.set(key, cur);
  }

  const out: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(startDay + i * 86_400_000).toISOString().slice(0, 10);
    const hit = buckets.get(day);
    out.push({ day, value: hit?.value ?? 0, count: hit?.count ?? 0 });
  }
  return out;
}

export type PlatformSlice = { platform: string; revenue: number; count: number };

export function revenueByPlatform(db: Database): PlatformSlice[] {
  const map = new Map<string, PlatformSlice>();
  for (const s of db.sales) {
    if (!isPaid(s)) continue;
    const cur = map.get(s.platform) ?? { platform: s.platform, revenue: 0, count: 0 };
    cur.revenue += s.netCents;
    cur.count += 1;
    map.set(s.platform, cur);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export function recentSales(db: Database, limit = 15): Sale[] {
  return [...db.sales].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, limit);
}

// --------------------------------------------------------------- products --

export type ProductWithStats = Product & { revenueCents: number; salesCount: number };

export function productsWithStats(
  db: Database,
  opts: { kind?: 'product' | 'course'; includeArchived?: boolean } = {},
): ProductWithStats[] {
  const revenue = new Map<string, { revenue: number; count: number }>();
  for (const s of db.sales) {
    if (!isPaid(s) || !s.productId) continue;
    const cur = revenue.get(s.productId) ?? { revenue: 0, count: 0 };
    cur.revenue += s.netCents;
    cur.count += 1;
    revenue.set(s.productId, cur);
  }

  const rank: Record<Product['status'], number> = {
    live: 0,
    building: 1,
    idea: 2,
    paused: 3,
    archived: 4,
  };

  return db.products
    .filter((p) => {
      if (!opts.includeArchived && p.status === 'archived') return false;
      if (opts.kind === 'course') return p.kind === 'course';
      if (opts.kind === 'product') return p.kind !== 'course';
      return true;
    })
    .map((p) => ({
      ...p,
      revenueCents: revenue.get(p.id)?.revenue ?? 0,
      salesCount: revenue.get(p.id)?.count ?? 0,
    }))
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        b.revenueCents - a.revenueCents ||
        b.createdAt - a.createdAt,
    );
}

export function productStatusCounts(db: Database): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of db.products) counts[p.status] = (counts[p.status] ?? 0) + 1;
  return counts;
}

// ------------------------------------------------------------------ goals --

export type GoalProgress = Goal & {
  current: number;
  pct: number;
  remaining: number;
  daysLeft: number | null;
  paceNeededPerDay: number | null;
  onTrack: boolean | null;
};

/**
 * A goal measures its whole window — no baseline is subtracted. A monthly goal
 * includes what you already earned this month, because that is what "$10k
 * month" means to the person who set it.
 */
export function goalCurrentValue(db: Database, goal: Goal): number {
  const since =
    goal.period === 'all'
      ? 0
      : periodStart(
          goal.period === 'month' ? 'month' : goal.period === 'quarter' ? 'quarter' : 'year',
        );

  switch (goal.kind) {
    case 'revenue':
      return revenueSince(db, since);
    case 'sales':
      return salesCountSince(db, since);
    case 'students':
      return db.products.reduce((sum, p) => sum + (p.students ?? 0), 0);
    default:
      return goal.manualValue;
  }
}

export function withProgress(db: Database, goal: Goal): GoalProgress {
  const current = Math.max(0, goalCurrentValue(db, goal));
  const target = Math.max(1, goal.targetValue);
  const remaining = Math.max(0, target - current);

  let daysLeft: number | null = null;
  let paceNeededPerDay: number | null = null;
  let onTrack: boolean | null = null;

  if (goal.deadline) {
    daysLeft = Math.ceil((goal.deadline - Date.now()) / 86_400_000);
    if (daysLeft > 0) {
      paceNeededPerDay = remaining / daysLeft;
      const elapsedDays = Math.max(1, (Date.now() - goal.createdAt) / 86_400_000);
      onTrack = current / elapsedDays >= paceNeededPerDay || remaining === 0;
    } else {
      onTrack = remaining === 0;
    }
  }

  return {
    ...goal,
    current,
    pct: Math.min(100, (current / target) * 100),
    remaining,
    daysLeft,
    paceNeededPerDay,
    onTrack,
  };
}

export function goalsWithProgress(db: Database, includeArchived = false): GoalProgress[] {
  const rank: Record<Goal['status'], number> = { active: 0, done: 1, failed: 2, archived: 3 };

  return db.goals
    .filter((g) => includeArchived || g.status !== 'archived')
    .map((g) => withProgress(db, g))
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        (a.deadline ? 0 : 1) - (b.deadline ? 0 : 1) ||
        (a.deadline ?? 0) - (b.deadline ?? 0) ||
        b.createdAt - a.createdAt,
    );
}

// ----------------------------------------------------------- claude usage --

export type ClaudeSummary = {
  costTodayCents: number;
  costMonthCents: number;
  costAllCents: number;
  tokensMonth: number;
  cacheSavingsPct: number;
  topModel: string | null;
  byDay: DayPoint[];
  byModel: { model: string; cost: number; tokens: number }[];
};

export function claudeSummary(db: Database, days = 30): ClaudeSummary {
  const t = today();
  const monthPrefix = t.slice(0, 7);

  let costToday = 0;
  let costMonth = 0;
  let costAll = 0;
  let monthTokens = 0;
  let monthCached = 0;

  const models = new Map<string, { cost: number; tokens: number }>();
  const dayBuckets = new Map<string, number>();

  for (const u of db.usage) {
    costAll += u.costCents;
    if (u.day === t) costToday += u.costCents;

    if (u.day.startsWith(monthPrefix)) {
      costMonth += u.costCents;
      monthTokens += u.inputTokens + u.outputTokens;
      monthCached += u.cacheRead;
    }

    const m = models.get(u.model) ?? { cost: 0, tokens: 0 };
    m.cost += u.costCents;
    m.tokens += u.inputTokens + u.outputTokens;
    models.set(u.model, m);

    dayBuckets.set(u.day, (dayBuckets.get(u.day) ?? 0) + u.costCents);
  }

  const now = new Date();
  const startDay =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * 86_400_000;

  const byDay: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(startDay + i * 86_400_000).toISOString().slice(0, 10);
    byDay.push({ day, value: dayBuckets.get(day) ?? 0, count: 0 });
  }

  const byModel = [...models.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  const denom = monthTokens + monthCached;

  return {
    costTodayCents: costToday,
    costMonthCents: costMonth,
    costAllCents: costAll,
    tokensMonth: monthTokens,
    cacheSavingsPct: denom > 0 ? (monthCached / denom) * 100 : 0,
    topModel: byModel[0]?.model ?? null,
    byDay,
    byModel,
  };
}

/** Revenue minus what the tooling cost — the honest number. */
export function profitSummary(db: Database) {
  const rev = revenueSummary(db);
  const claude = claudeSummary(db, 1);
  return {
    netMonth: rev.month - claude.costMonthCents,
    netAllTime: rev.allTime - claude.costAllCents,
    burnMonth: claude.costMonthCents,
    marginPct: rev.month > 0 ? ((rev.month - claude.costMonthCents) / rev.month) * 100 : null,
  };
}
