import { db, today } from '@/lib/db';
import { awardXp, touchStreak } from '@/lib/game';

/**
 * Every read the dashboard needs. Kept in one place so the SQL is auditable
 * and the pages stay presentational.
 *
 * All revenue figures are NET cents (gross - fees - refunds) unless the name
 * says otherwise, because net is the number that actually matters to you.
 */

// ------------------------------------------------------------------ types --

export type Product = {
  id: string;
  name: string;
  kind: 'product' | 'course' | 'bundle' | 'membership' | 'service';
  platform: 'whop' | 'shopify' | 'manual';
  external_id: string | null;
  status: 'idea' | 'building' | 'live' | 'paused' | 'archived';
  price_cents: number;
  currency: string;
  url: string | null;
  emoji: string;
  notes: string;
  launch_at: number | null;
  created_at: number;
  updated_at: number;
};

export type ProductWithStats = Product & {
  revenue_cents: number;
  sales_count: number;
  lessons_total?: number;
  lessons_done?: number;
  students?: number;
};

export type Sale = {
  id: string;
  platform: string;
  external_id: string | null;
  product_id: string | null;
  product_name: string;
  gross_cents: number;
  fees_cents: number;
  refund_cents: number;
  net_cents: number;
  currency: string;
  status: string;
  is_recurring: number;
  occurred_at: number;
  created_at: number;
};

export type Goal = {
  id: string;
  title: string;
  kind: 'revenue' | 'sales' | 'students' | 'custom';
  target_value: number;
  start_value: number;
  manual_value: number;
  unit: string;
  period: 'all' | 'month' | 'quarter' | 'year';
  deadline: number | null;
  xp_reward: number;
  status: 'active' | 'done' | 'failed' | 'archived';
  completed_at: number | null;
  created_at: number;
  updated_at: number;
};

export type GoalProgress = Goal & {
  current: number;
  pct: number;
  remaining: number;
  daysLeft: number | null;
  paceNeededPerDay: number | null;
  onTrack: boolean | null;
};

// ------------------------------------------------------------- date ranges --

/** Start-of-period timestamps in UTC, matching how sales are day-bucketed. */
export function periodStart(period: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all', ref = new Date()): number {
  const d = new Date(ref);
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

// ---------------------------------------------------------------- revenue --

export function revenueSince(since: number, until = Date.now()): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(net_cents), 0) AS n FROM sales
       WHERE status = 'paid' AND occurred_at >= ? AND occurred_at <= ?`,
    )
    .get(since, until) as { n: number };
  return row.n;
}

export function salesCountSince(since: number, until = Date.now()): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sales
       WHERE status = 'paid' AND occurred_at >= ? AND occurred_at <= ?`,
    )
    .get(since, until) as { n: number };
  return row.n;
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

export function revenueSummary(): RevenueSummary {
  const monthStart = periodStart('month');
  const prevMonthStart = (() => {
    const d = new Date(monthStart);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
  })();

  const allTime = revenueSince(0);
  const month = revenueSince(monthStart);
  const lastMonth = revenueSince(prevMonthStart, monthStart - 1);
  const salesTotal = salesCountSince(0);

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(fees_cents), 0) AS fees, COALESCE(SUM(refund_cents), 0) AS refunds
       FROM sales`,
    )
    .get() as { fees: number; refunds: number };

  // MRR proxy: recurring revenue recognised in the last 30 days.
  const mrr = db
    .prepare(
      `SELECT COALESCE(SUM(net_cents), 0) AS n FROM sales
       WHERE status = 'paid' AND is_recurring = 1 AND occurred_at >= ?`,
    )
    .get(Date.now() - 30 * 86_400_000) as { n: number };

  return {
    allTime,
    today: revenueSince(periodStart('day')),
    week: revenueSince(periodStart('week')),
    month,
    year: revenueSince(periodStart('year')),
    lastMonth,
    monthDelta: lastMonth > 0 ? ((month - lastMonth) / lastMonth) * 100 : null,
    salesTotal,
    salesMonth: salesCountSince(monthStart),
    aovCents: salesTotal > 0 ? Math.round(allTime / salesTotal) : 0,
    refundedCents: totals.refunds,
    feesCents: totals.fees,
    mrrCents: mrr.n,
  };
}

export type DayPoint = { day: string; value: number; count: number };

/** Daily net revenue for the last `days` days, zero-filled so charts are honest. */
export function revenueByDay(days = 30): DayPoint[] {
  const start = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  ) - (days - 1) * 86_400_000;

  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', occurred_at / 1000, 'unixepoch') AS day,
              COALESCE(SUM(net_cents), 0) AS value,
              COUNT(*) AS count
       FROM sales
       WHERE status = 'paid' AND occurred_at >= ?
       GROUP BY day`,
    )
    .all(start) as DayPoint[];

  const map = new Map(rows.map((r) => [r.day, r]));
  const out: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    out.push(map.get(day) ?? { day, value: 0, count: 0 });
  }
  return out;
}

export type PlatformSlice = { platform: string; revenue: number; count: number };

export function revenueByPlatform(): PlatformSlice[] {
  return db
    .prepare(
      `SELECT platform, COALESCE(SUM(net_cents), 0) AS revenue, COUNT(*) AS count
       FROM sales WHERE status = 'paid'
       GROUP BY platform ORDER BY revenue DESC`,
    )
    .all() as PlatformSlice[];
}

export function recentSales(limit = 15): Sale[] {
  return db
    .prepare('SELECT * FROM sales ORDER BY occurred_at DESC LIMIT ?')
    .all(limit) as Sale[];
}

export function listSales(limit = 100, offset = 0): Sale[] {
  return db
    .prepare('SELECT * FROM sales ORDER BY occurred_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as Sale[];
}

// --------------------------------------------------------------- products --

export function listProducts(opts: { kind?: string; includeArchived?: boolean } = {}): ProductWithStats[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts.kind === 'course') clauses.push(`p.kind = 'course'`);
  else if (opts.kind === 'product') clauses.push(`p.kind != 'course'`);

  if (!opts.includeArchived) clauses.push(`p.status != 'archived'`);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  return db
    .prepare(
      `SELECT p.*,
              COALESCE(s.revenue, 0) AS revenue_cents,
              COALESCE(s.cnt, 0)     AS sales_count,
              cm.lessons_total, cm.lessons_done, cm.students
       FROM products p
       LEFT JOIN (
         SELECT product_id, SUM(net_cents) AS revenue, COUNT(*) AS cnt
         FROM sales WHERE status = 'paid' GROUP BY product_id
       ) s ON s.product_id = p.id
       LEFT JOIN course_meta cm ON cm.product_id = p.id
       ${where}
       ORDER BY
         CASE p.status WHEN 'live' THEN 0 WHEN 'building' THEN 1 WHEN 'idea' THEN 2
                       WHEN 'paused' THEN 3 ELSE 4 END,
         revenue_cents DESC, p.created_at DESC`,
      )
    .all(...params) as ProductWithStats[];
}

export function getProduct(id: string): ProductWithStats | null {
  return (
    (db
      .prepare(
        `SELECT p.*, COALESCE(SUM(s.net_cents), 0) AS revenue_cents, COUNT(s.id) AS sales_count,
                cm.lessons_total, cm.lessons_done, cm.students
         FROM products p
         LEFT JOIN sales s ON s.product_id = p.id AND s.status = 'paid'
         LEFT JOIN course_meta cm ON cm.product_id = p.id
         WHERE p.id = ? GROUP BY p.id`,
      )
      .get(id) as ProductWithStats) ?? null
  );
}

export function productStatusCounts(): Record<string, number> {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS n FROM products GROUP BY status`)
    .all() as { status: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

// ------------------------------------------------------------------ goals --

/** Resolve a goal's live value from real data (or its manual counter). */
export function goalCurrentValue(goal: Goal): number {
  const since =
    goal.period === 'all'
      ? 0
      : periodStart(goal.period === 'month' ? 'month' : goal.period === 'quarter' ? 'quarter' : 'year');

  switch (goal.kind) {
    case 'revenue':
      return revenueSince(since) - goal.start_value;
    case 'sales':
      return salesCountSince(since) - goal.start_value;
    case 'students': {
      const row = db
        .prepare('SELECT COALESCE(SUM(students), 0) AS n FROM course_meta')
        .get() as { n: number };
      return row.n - goal.start_value;
    }
    default:
      return goal.manual_value;
  }
}

export function withProgress(goal: Goal): GoalProgress {
  const current = Math.max(0, goalCurrentValue(goal));
  const target = Math.max(1, goal.target_value);
  const pct = Math.min(100, (current / target) * 100);
  const remaining = Math.max(0, target - current);

  let daysLeft: number | null = null;
  let paceNeededPerDay: number | null = null;
  let onTrack: boolean | null = null;

  if (goal.deadline) {
    const msLeft = goal.deadline - Date.now();
    daysLeft = Math.ceil(msLeft / 86_400_000);
    if (daysLeft > 0) {
      paceNeededPerDay = remaining / daysLeft;
      const elapsed = Math.max(1, (Date.now() - goal.created_at) / 86_400_000);
      const actualPerDay = current / elapsed;
      onTrack = actualPerDay >= paceNeededPerDay || remaining === 0;
    } else {
      onTrack = remaining === 0;
    }
  }

  return { ...goal, current, pct, remaining, daysLeft, paceNeededPerDay, onTrack };
}

export function listGoals(includeArchived = false): GoalProgress[] {
  const rows = db
    .prepare(
      `SELECT * FROM goals ${includeArchived ? '' : `WHERE status != 'archived'`}
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
                deadline IS NULL, deadline ASC, created_at DESC`,
    )
    .all() as Goal[];
  return rows.map(withProgress);
}

/**
 * Flip any active goal whose target is met to `done`, awarding its XP once.
 * Called after mutations that could move a goal's number.
 */
export function reconcileGoals(): GoalProgress[] {
  const completed: GoalProgress[] = [];

  const active = db.prepare(`SELECT * FROM goals WHERE status = 'active'`).all() as Goal[];
  for (const goal of active) {
    const p = withProgress(goal);
    if (p.current >= goal.target_value && goal.target_value > 0) {
      db.prepare(`UPDATE goals SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?`).run(
        Date.now(),
        Date.now(),
        goal.id,
      );
      awardXp(goal.xp_reward, `Goal complete: ${goal.title}`);
      touchStreak();
      completed.push({ ...p, status: 'done', completed_at: Date.now() });
    }
  }
  return completed;
}

// ----------------------------------------------------------- claude usage --

export type ClaudeSummary = {
  costTodayCents: number;
  costMonthCents: number;
  costAllCents: number;
  tokensMonth: number;
  cacheSavingsPct: number;
  topModel: string | null;
  lastSync: number | null;
  byDay: DayPoint[];
  byModel: { model: string; cost: number; tokens: number }[];
};

export function claudeSummary(days = 30): ClaudeSummary {
  const monthPrefix = today().slice(0, 7);

  const costToday = (
    db
      .prepare('SELECT COALESCE(SUM(cost_cents), 0) AS n FROM claude_usage WHERE day = ?')
      .get(today()) as { n: number }
  ).n;

  const costMonth = (
    db
      .prepare(`SELECT COALESCE(SUM(cost_cents), 0) AS n FROM claude_usage WHERE day LIKE ?`)
      .get(`${monthPrefix}%`) as { n: number }
  ).n;

  const costAll = (
    db.prepare('SELECT COALESCE(SUM(cost_cents), 0) AS n FROM claude_usage').get() as { n: number }
  ).n;

  const monthTokens = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total,
              COALESCE(SUM(cache_read), 0) AS cached
       FROM claude_usage WHERE day LIKE ?`,
    )
    .get(`${monthPrefix}%`) as { total: number; cached: number };

  const byModel = db
    .prepare(
      `SELECT model, COALESCE(SUM(cost_cents), 0) AS cost,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
       FROM claude_usage GROUP BY model ORDER BY cost DESC LIMIT 8`,
    )
    .all() as { model: string; cost: number; tokens: number }[];

  const start = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = db
    .prepare(
      `SELECT day, COALESCE(SUM(cost_cents), 0) AS value, COUNT(*) AS count
       FROM claude_usage WHERE day >= ? GROUP BY day ORDER BY day`,
    )
    .all(start) as DayPoint[];

  const map = new Map(rows.map((r) => [r.day, r]));
  const byDay: DayPoint[] = [];
  const base = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    const day = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    byDay.push(map.get(day) ?? { day, value: 0, count: 0 });
  }

  const lastSync = (
    db
      .prepare(
        `SELECT MAX(finished_at) AS t FROM sync_runs WHERE provider = 'anthropic' AND status = 'ok'`,
      )
      .get() as { t: number | null }
  ).t;

  const denom = monthTokens.total + monthTokens.cached;

  return {
    costTodayCents: costToday,
    costMonthCents: costMonth,
    costAllCents: costAll,
    tokensMonth: monthTokens.total,
    cacheSavingsPct: denom > 0 ? (monthTokens.cached / denom) * 100 : 0,
    topModel: byModel[0]?.model ?? null,
    lastSync,
    byDay,
    byModel,
  };
}

// ------------------------------------------------------------------- misc --

export function lastSyncFor(provider: string): { at: number | null; status: string | null; message: string } {
  const row = db
    .prepare(
      `SELECT status, message, COALESCE(finished_at, started_at) AS at
       FROM sync_runs WHERE provider = ? ORDER BY started_at DESC LIMIT 1`,
    )
    .get(provider) as { status: string; message: string; at: number } | undefined;
  return { at: row?.at ?? null, status: row?.status ?? null, message: row?.message ?? '' };
}

/** Net profit view: revenue minus what Claude cost you. */
export function profitSummary() {
  const rev = revenueSummary();
  const claude = claudeSummary(1);
  return {
    netMonth: rev.month - claude.costMonthCents,
    netAllTime: rev.allTime - claude.costAllCents,
    burnMonth: claude.costMonthCents,
    marginPct: rev.month > 0 ? ((rev.month - claude.costMonthCents) / rev.month) * 100 : null,
  };
}
