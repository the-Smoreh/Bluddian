'use client';

import { update, requireState } from '@/lib/local/store';
import {
  newId,
  today,
  weekKey,
  type ClaudeUsage,
  type Database,
  type Goal,
  type GoalKind,
  type GoalPeriod,
  type Platform,
  type Product,
  type ProductKind,
  type ProductStatus,
  type Quest,
  type Sale,
} from '@/lib/local/types';
import { goalCurrentValue, revenueSummary } from '@/lib/local/selectors';

/**
 * Every write goes through here. Keeping mutations in one module means the XP
 * rules, streak rules, and idempotency rules can't drift between call sites.
 */

export type MutationResult = {
  awardedXp: number;
  levelUp: { level: number; title: string } | null;
  unlocked: string[];
  completedGoals: string[];
};

const EMPTY: MutationResult = { awardedXp: 0, levelUp: null, unlocked: [], completedGoals: [] };

// ------------------------------------------------------------ level curve --

const BASE_XP = 500;
const GROWTH = 1.25;

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  let total = 0;
  let cost = BASE_XP;
  for (let i = 1; i < level; i++) {
    total += Math.round(cost);
    cost *= GROWTH;
  }
  return total;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (level < 100 && xpForLevel(level + 1) <= xp) level++;
  return level;
}

const TITLES: Array<[number, string]> = [
  [1, 'Signed Up'],
  [3, 'Builder'],
  [5, 'Shipper'],
  [8, 'First Dollar'],
  [12, 'Operator'],
  [16, 'Closer'],
  [20, 'Scaler'],
  [25, 'Founder'],
  [32, 'Empire'],
];

export function rankTitle(level: number): string {
  let title = TITLES[0][1];
  for (const [min, name] of TITLES) if (level >= min) title = name;
  return title;
}

export type LevelInfo = {
  level: number;
  xp: number;
  intoLevel: number;
  needed: number;
  pct: number;
  title: string;
};

export function levelInfo(xp: number): LevelInfo {
  const level = levelFromXp(xp);
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const intoLevel = xp - floor;
  const needed = Math.max(1, next - floor);
  return {
    level,
    xp,
    intoLevel,
    needed,
    pct: Math.min(100, Math.round((intoLevel / needed) * 100)),
    title: rankTitle(level),
  };
}

// ----------------------------------------------------------- achievements --

export type AchievementDef = { code: string; name: string; detail: string };

export const ACHIEVEMENTS: AchievementDef[] = [
  { code: 'first_sale', name: 'First Blood', detail: 'Log your first sale.' },
  { code: 'rev_100', name: 'Triple Digits', detail: '$100 in net revenue.' },
  { code: 'rev_1k', name: 'Four Figures', detail: '$1,000 in net revenue.' },
  { code: 'rev_10k', name: 'Five Figures', detail: '$10,000 in net revenue.' },
  { code: 'rev_100k', name: 'Six Figures', detail: '$100,000 in net revenue.' },
  { code: 'first_product', name: 'Made a Thing', detail: 'Take a product live.' },
  { code: 'first_course', name: 'Teacher', detail: 'Take a course live.' },
  { code: 'goal_done', name: 'Called Your Shot', detail: 'Complete a money goal.' },
  { code: 'streak_7', name: 'Week Warrior', detail: '7-day activity streak.' },
  { code: 'streak_30', name: 'Unstoppable', detail: '30-day activity streak.' },
  { code: 'streak_60', name: 'Two Months Deep', detail: '60-day activity streak.' },
  { code: 'streak_100', name: 'Obsessed', detail: '100-day activity streak.' },
  { code: 'streak_365', name: 'A Full Year', detail: '365-day activity streak.' },
  { code: 'multi_platform', name: 'Omnichannel', detail: 'Revenue from Whop and Shopify.' },
];

// ---------------------------------------------------- internal primitives --

/** Mutates the draft directly; returns XP actually granted. */
function grantXp(draft: Database, amount: number, reason: string): number {
  draft.player = { ...draft.player, xp: Math.max(0, draft.player.xp + amount) };
  draft.xpEvents = [
    { id: newId(), amount, reason, createdAt: Date.now() },
    ...draft.xpEvents,
  ].slice(0, 200); // the ledger is a recent-history view, not an audit archive
  return amount;
}

/** Streak counts days with real activity, not app opens. */
function bumpStreak(draft: Database): string[] {
  const t = today();
  if (draft.player.lastActive === t) return [];

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const streakDays = draft.player.lastActive === yesterday ? draft.player.streakDays + 1 : 1;

  draft.player = {
    ...draft.player,
    streakDays,
    longestStreak: Math.max(streakDays, draft.player.longestStreak),
    lastActive: t,
  };

  const unlocked: string[] = [];
  if ([7, 30, 60, 100, 365].includes(streakDays)) {
    grantXp(draft, streakDays * 20, `${streakDays}-day streak`);
    if (unlockAchievement(draft, `streak_${streakDays}`)) unlocked.push(`streak_${streakDays}`);
  }
  return unlocked;
}

function unlockAchievement(draft: Database, code: string): boolean {
  if (draft.achievements[code]) return false;
  if (!ACHIEVEMENTS.some((a) => a.code === code)) return false;
  draft.achievements = { ...draft.achievements, [code]: Date.now() };
  grantXp(draft, 150, `Achievement unlocked`);
  return true;
}

/** Re-derive achievements from current data, so imports earn them too. */
function evaluateAchievements(draft: Database): string[] {
  const unlocked: string[] = [];
  const paid = draft.sales.filter((s) => s.status === 'paid');
  const revenue = paid.reduce((sum, s) => sum + s.netCents, 0);

  const check = (cond: boolean, code: string) => {
    if (cond && unlockAchievement(draft, code)) unlocked.push(code);
  };

  check(paid.length >= 1, 'first_sale');
  check(revenue >= 10_000, 'rev_100');
  check(revenue >= 100_000, 'rev_1k');
  check(revenue >= 1_000_000, 'rev_10k');
  check(revenue >= 10_000_000, 'rev_100k');
  check(draft.products.some((p) => p.status === 'live' && p.kind !== 'course'), 'first_product');
  check(draft.products.some((p) => p.status === 'live' && p.kind === 'course'), 'first_course');
  check(draft.goals.some((g) => g.status === 'done'), 'goal_done');

  const platforms = new Set(paid.map((s) => s.platform));
  check(platforms.has('whop') && platforms.has('shopify'), 'multi_platform');

  return unlocked;
}

/** Flip any active goal whose target is met, paying its XP exactly once. */
function reconcileGoals(draft: Database): string[] {
  const completed: string[] = [];

  draft.goals = draft.goals.map((goal) => {
    if (goal.status !== 'active' || goal.targetValue <= 0) return goal;
    if (goalCurrentValue(draft, goal) < goal.targetValue) return goal;

    grantXp(draft, goal.xpReward, `Goal complete: ${goal.title}`);
    completed.push(goal.title);
    return { ...goal, status: 'done' as const, completedAt: Date.now(), updatedAt: Date.now() };
  });

  return completed;
}

/** Wrap a mutation so XP/streak/goal/achievement side effects always run. */
function withRewards(
  recipe: (draft: Database) => { xp?: number; reason?: string; touchStreak?: boolean },
): MutationResult {
  const before = requireState().player.xp;
  let awarded = 0;
  const unlocked: string[] = [];
  let completed: string[] = [];

  update((draft) => {
    const outcome = recipe(draft) ?? {};

    if (outcome.xp && outcome.xp !== 0) {
      awarded = grantXp(draft, outcome.xp, outcome.reason ?? 'Progress');
    }
    if (outcome.touchStreak) unlocked.push(...bumpStreak(draft));

    completed = reconcileGoals(draft);
    unlocked.push(...evaluateAchievements(draft));
  });

  const after = requireState().player.xp;
  const beforeLevel = levelFromXp(before);
  const afterLevel = levelFromXp(after);

  return {
    awardedXp: awarded,
    levelUp:
      afterLevel > beforeLevel
        ? { level: afterLevel, title: rankTitle(afterLevel) }
        : null,
    unlocked,
    completedGoals: completed,
  };
}

// ---------------------------------------------------------------- sales ----

export type NewSale = {
  productId?: string | null;
  productName: string;
  grossCents: number;
  feesCents?: number;
  refundCents?: number;
  currency?: string;
  platform?: Platform;
  status?: Sale['status'];
  isRecurring?: boolean;
  occurredAt?: number;
  customerEmail?: string | null;
  externalId?: string | null;
};

export function addSale(input: NewSale): MutationResult {
  const gross = Math.max(0, Math.round(input.grossCents));
  const fees = Math.max(0, Math.round(input.feesCents ?? 0));
  const refund = Math.max(0, Math.round(input.refundCents ?? 0));
  const net = gross - fees - refund;

  const sale: Sale = {
    id: newId(),
    platform: input.platform ?? 'manual',
    externalId: input.externalId ?? null,
    productId: input.productId ?? null,
    productName: input.productName.slice(0, 200),
    grossCents: gross,
    feesCents: fees,
    refundCents: refund,
    netCents: net,
    currency: (input.currency ?? 'USD').toUpperCase(),
    status: input.status ?? 'paid',
    isRecurring: Boolean(input.isRecurring),
    customerEmail: input.customerEmail ?? null,
    occurredAt: input.occurredAt ?? Date.now(),
    createdAt: Date.now(),
  };

  // XP scales with the sale but is capped, so one big deal can't trivialise
  // the level curve.
  const xp = sale.status === 'paid' ? Math.min(1000, 25 + Math.round(net / 1000)) : 0;

  return withRewards((draft) => {
    draft.sales = [sale, ...draft.sales];
    return { xp, reason: `Sale: ${sale.productName}`, touchStreak: sale.status === 'paid' };
  });
}

export function deleteSale(id: string): void {
  update((draft) => {
    draft.sales = draft.sales.filter((s) => s.id !== id);
  });
}

// -------------------------------------------------------------- products --

export type NewProduct = {
  name: string;
  kind?: ProductKind;
  status?: ProductStatus;
  priceCents?: number;
  currency?: string;
  url?: string | null;
  notes?: string;
  lessonsTotal?: number;
};

export function addProduct(input: NewProduct): MutationResult {
  const product: Product = {
    id: newId(),
    name: input.name.slice(0, 120),
    kind: input.kind ?? 'product',
    platform: 'manual',
    externalId: null,
    status: input.status ?? 'idea',
    priceCents: Math.max(0, Math.round(input.priceCents ?? 0)),
    currency: (input.currency ?? 'USD').toUpperCase(),
    url: input.url || null,
    notes: input.notes ?? '',
    launchAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...(input.kind === 'course'
      ? { lessonsTotal: input.lessonsTotal ?? 0, lessonsDone: 0, students: 0 }
      : {}),
  };

  return withRewards((draft) => {
    draft.products = [product, ...draft.products];
    return {
      xp: product.status === 'live' ? 400 : 0,
      reason: `Shipped: ${product.name}`,
      touchStreak: true,
    };
  });
}

export type ProductPatch = Partial<
  Pick<
    Product,
    'name' | 'kind' | 'status' | 'priceCents' | 'currency' | 'url' | 'notes' | 'lessonsTotal' | 'lessonsDone' | 'students'
  >
>;

export function updateProduct(id: string, patch: ProductPatch): MutationResult {
  const existing = requireState().products.find((p) => p.id === id);
  if (!existing) return EMPTY;

  const wentLive = patch.status === 'live' && existing.status !== 'live';
  const lessonDelta =
    patch.lessonsDone !== undefined
      ? Math.max(0, patch.lessonsDone - (existing.lessonsDone ?? 0))
      : 0;

  // Shipping and publishing are the behaviours worth rewarding.
  const xp = wentLive ? 400 : lessonDelta * 75;
  const reason = wentLive
    ? `Shipped: ${patch.name ?? existing.name}`
    : `Published ${lessonDelta} lesson${lessonDelta === 1 ? '' : 's'}`;

  return withRewards((draft) => {
    draft.products = draft.products.map((p) =>
      p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
    );
    return { xp, reason, touchStreak: xp > 0 };
  });
}

export function deleteProduct(id: string): void {
  update((draft) => {
    draft.products = draft.products.filter((p) => p.id !== id);
    // Sales keep productName, so history survives; only the link is dropped.
    draft.sales = draft.sales.map((s) => (s.productId === id ? { ...s, productId: null } : s));
  });
}

// ----------------------------------------------------------------- goals --

export type NewGoal = {
  title: string;
  kind?: GoalKind;
  targetValue: number;
  period?: GoalPeriod;
  unit?: string;
  deadline?: number | null;
  xpReward?: number;
};

export function addGoal(input: NewGoal): MutationResult {
  const goal: Goal = {
    id: newId(),
    title: input.title.slice(0, 120),
    kind: input.kind ?? 'revenue',
    targetValue: Math.max(1, Math.round(input.targetValue)),
    manualValue: 0,
    unit: (input.unit ?? 'USD').toUpperCase(),
    period: input.period ?? 'all',
    deadline: input.deadline ?? null,
    xpReward: input.xpReward ?? 500,
    status: 'active',
    completedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return withRewards((draft) => {
    draft.goals = [goal, ...draft.goals];
    return {};
  });
}

export function nudgeGoal(id: string, delta: number): MutationResult {
  return withRewards((draft) => {
    draft.goals = draft.goals.map((g) =>
      g.id === id ? { ...g, manualValue: Math.max(0, g.manualValue + delta), updatedAt: Date.now() } : g,
    );
    return {};
  });
}

export function deleteGoal(id: string): void {
  update((draft) => {
    draft.goals = draft.goals.filter((g) => g.id !== id);
  });
}

// ---------------------------------------------------------------- quests --

const DAILY_TEMPLATES = [
  { title: 'Ship something', detail: 'Move any product or lesson forward today.', xp: 60, target: 1 },
  { title: 'Talk to a customer', detail: 'One real conversation. DM, email, call.', xp: 50, target: 1 },
  { title: 'Post to sell', detail: 'One piece of content pointing at an offer.', xp: 40, target: 1 },
];

const WEEKLY_TEMPLATES = [
  { title: 'Land 3 sales', detail: 'Any platform, any product.', xp: 250, target: 3 },
  { title: 'Publish a lesson', detail: 'One more lesson live in a course.', xp: 200, target: 1 },
  { title: 'Review the numbers', detail: 'Check revenue, costs, and margin.', xp: 100, target: 1 },
];

/** Create today's and this week's quests if missing, and drop stale ones. */
export function ensureQuests(): Quest[] {
  const day = today();
  const week = weekKey();
  const state = requireState();

  const hasAll =
    DAILY_TEMPLATES.every((t) =>
      state.quests.some((q) => q.title === t.title && q.periodKey === day),
    ) &&
    WEEKLY_TEMPLATES.every((t) =>
      state.quests.some((q) => q.title === t.title && q.periodKey === week),
    );

  if (hasAll) {
    return state.quests.filter((q) => q.periodKey === day || q.periodKey === week);
  }

  update((draft) => {
    // Keep only the current periods so the list can't grow without bound.
    const kept = draft.quests.filter((q) => q.periodKey === day || q.periodKey === week);

    const additions: Quest[] = [];
    for (const t of DAILY_TEMPLATES) {
      if (!kept.some((q) => q.title === t.title && q.periodKey === day)) {
        additions.push({ id: newId(), ...t, cadence: 'daily', progress: 0, periodKey: day, completedAt: null });
      }
    }
    for (const t of WEEKLY_TEMPLATES) {
      if (!kept.some((q) => q.title === t.title && q.periodKey === week)) {
        additions.push({ id: newId(), ...t, cadence: 'weekly', progress: 0, periodKey: week, completedAt: null });
      }
    }

    draft.quests = [...kept, ...additions];
  });

  return requireState().quests.filter((q) => q.periodKey === day || q.periodKey === week);
}

export function toggleQuest(id: string): MutationResult {
  const quest = requireState().quests.find((q) => q.id === id);
  if (!quest) return EMPTY;

  const wasComplete = quest.completedAt !== null;
  // Un-completing claws the XP back, so the counter can't be farmed.
  const xp = wasComplete ? -quest.xp : quest.xp;

  return withRewards((draft) => {
    draft.quests = draft.quests.map((q) =>
      q.id === id
        ? {
            ...q,
            progress: wasComplete ? 0 : q.target,
            completedAt: wasComplete ? null : Date.now(),
          }
        : q,
    );
    return {
      xp,
      reason: wasComplete ? `Quest reopened: ${quest.title}` : `Quest: ${quest.title}`,
      touchStreak: !wasComplete,
    };
  });
}

// --------------------------------------------------------- claude usage ----

export function addUsage(entry: {
  day: string;
  model: string;
  costCents: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  source?: ClaudeUsage['source'];
}): void {
  update((draft) => {
    const source = entry.source ?? 'manual';
    // One row per (day, model, source): re-importing replaces rather than
    // doubling, and manual entries never collide with synced ones.
    const rest = draft.usage.filter(
      (u) => !(u.day === entry.day && u.model === entry.model && u.source === source),
    );

    draft.usage = [
      {
        id: newId(),
        day: entry.day,
        model: entry.model,
        inputTokens: entry.inputTokens ?? 0,
        outputTokens: entry.outputTokens ?? 0,
        cacheRead: entry.cacheRead ?? 0,
        cacheWrite: entry.cacheWrite ?? 0,
        costCents: Math.max(0, Math.round(entry.costCents)),
        source,
      },
      ...rest,
    ];
  });
}

export function deleteUsage(id: string): void {
  update((draft) => {
    draft.usage = draft.usage.filter((u) => u.id !== id);
  });
}

// ----------------------------------------------------------- credentials --

export function setCredential(key: string, value: string): void {
  update((draft) => {
    draft.credentials = { ...draft.credentials, [key]: value.trim() };
  });
}

export function deleteCredential(key: string): void {
  update((draft) => {
    const next = { ...draft.credentials };
    delete next[key];
    draft.credentials = next;
  });
}

export function setSettings(patch: Partial<Database['settings']>): void {
  update((draft) => {
    draft.settings = { ...draft.settings, ...patch };
  });
}

export function recordSync(provider: string, status: 'ok' | 'error', message: string, items = 0): void {
  update((draft) => {
    draft.syncs = { ...draft.syncs, [provider]: { at: Date.now(), status, message, items } };
  });
}

/** Bulk insert from a CSV import, skipping rows already present. */
export function importSales(rows: NewSale[]): { added: number; skipped: number; result: MutationResult } {
  const state = requireState();
  const seen = new Set(
    state.sales.filter((s) => s.externalId).map((s) => `${s.platform}:${s.externalId}`),
  );

  const fresh: Sale[] = [];
  let skipped = 0;

  for (const row of rows) {
    const platform = row.platform ?? 'manual';
    const key = row.externalId ? `${platform}:${row.externalId}` : null;

    // Idempotency: re-importing the same export must not double your revenue.
    if (key && seen.has(key)) {
      skipped++;
      continue;
    }
    if (key) seen.add(key);

    const gross = Math.max(0, Math.round(row.grossCents));
    const fees = Math.max(0, Math.round(row.feesCents ?? 0));
    const refund = Math.max(0, Math.round(row.refundCents ?? 0));

    fresh.push({
      id: newId(),
      platform,
      externalId: row.externalId ?? null,
      productId: row.productId ?? null,
      productName: row.productName.slice(0, 200),
      grossCents: gross,
      feesCents: fees,
      refundCents: refund,
      netCents: gross - fees - refund,
      currency: (row.currency ?? 'USD').toUpperCase(),
      status: row.status ?? 'paid',
      isRecurring: Boolean(row.isRecurring),
      customerEmail: row.customerEmail ?? null,
      occurredAt: row.occurredAt ?? Date.now(),
      createdAt: Date.now(),
    });
  }

  const result = withRewards((draft) => {
    draft.sales = [...fresh, ...draft.sales];
    return { touchStreak: fresh.length > 0 };
  });

  return { added: fresh.length, skipped, result };
}

export { revenueSummary };
