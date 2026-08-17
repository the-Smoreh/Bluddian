'use client';

/**
 * The entire database shape. It lives as one encrypted JSON blob in IndexedDB
 * on your phone.
 *
 * Why one blob rather than SQLite-in-the-browser: a single-user dashboard tops
 * out in the low thousands of records, which JS filters through in under a
 * millisecond. A blob gives atomic writes, trivial encryption of *everything*
 * at once (including API keys), effortless export/backup, and no WASM payload.
 * SQLite would buy query power this app never needs.
 *
 * Money is ALWAYS integer cents. Timestamps are epoch milliseconds.
 */

export const DB_VERSION = 1;

export type Platform = 'whop' | 'shopify' | 'manual';
export type ProductKind = 'product' | 'course' | 'bundle' | 'membership' | 'service';
export type ProductStatus = 'idea' | 'building' | 'live' | 'paused' | 'archived';
export type SaleStatus = 'paid' | 'pending' | 'refunded' | 'failed';
export type GoalKind = 'revenue' | 'sales' | 'students' | 'custom';
export type GoalPeriod = 'all' | 'month' | 'quarter' | 'year';
export type GoalStatus = 'active' | 'done' | 'failed' | 'archived';

export type Product = {
  id: string;
  name: string;
  kind: ProductKind;
  platform: Platform;
  externalId: string | null;
  status: ProductStatus;
  priceCents: number;
  currency: string;
  url: string | null;
  notes: string;
  launchAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Course-only fields; undefined for everything else. */
  lessonsTotal?: number;
  lessonsDone?: number;
  students?: number;
};

export type Sale = {
  id: string;
  platform: Platform;
  externalId: string | null;
  productId: string | null;
  productName: string;
  grossCents: number;
  feesCents: number;
  refundCents: number;
  netCents: number;
  currency: string;
  status: SaleStatus;
  isRecurring: boolean;
  customerEmail: string | null;
  occurredAt: number;
  createdAt: number;
};

export type Goal = {
  id: string;
  title: string;
  kind: GoalKind;
  targetValue: number;
  manualValue: number;
  unit: string;
  period: GoalPeriod;
  deadline: number | null;
  xpReward: number;
  status: GoalStatus;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type Quest = {
  id: string;
  title: string;
  detail: string;
  cadence: 'daily' | 'weekly';
  xp: number;
  target: number;
  progress: number;
  periodKey: string;
  completedAt: number | null;
};

export type ClaudeUsage = {
  id: string;
  day: string; // YYYY-MM-DD
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  costCents: number;
  source: 'api' | 'manual' | 'import';
};

export type XpEvent = {
  id: string;
  amount: number;
  reason: string;
  createdAt: number;
};

export type Player = {
  xp: number;
  streakDays: number;
  longestStreak: number;
  lastActive: string; // YYYY-MM-DD
};

export type SyncRecord = {
  at: number;
  status: 'ok' | 'error';
  message: string;
  items: number;
};

/**
 * Third-party credentials. These sit INSIDE the encrypted blob, so they inherit
 * the vault's encryption automatically — there is no separate keystore to get
 * wrong, and nothing can read them without your fingerprint or PIN.
 */
export type Credentials = Record<string, string>;

export type Database = {
  version: number;
  player: Player;
  products: Product[];
  sales: Sale[];
  goals: Goal[];
  quests: Quest[];
  usage: ClaudeUsage[];
  xpEvents: XpEvent[];
  achievements: Record<string, number>;
  credentials: Credentials;
  syncs: Record<string, SyncRecord>;
  settings: {
    displayName: string;
    currency: string;
    autoLockMinutes: number;
  };
};

export function emptyDatabase(displayName = 'Founder'): Database {
  return {
    version: DB_VERSION,
    player: { xp: 0, streakDays: 0, longestStreak: 0, lastActive: '' },
    products: [],
    sales: [],
    goals: [],
    quests: [],
    usage: [],
    xpEvents: [],
    achievements: {},
    credentials: {},
    syncs: {},
    settings: { displayName, currency: 'USD', autoLockMinutes: 15 },
  };
}

/**
 * Forward-compatible load: fills in anything a future/older blob is missing so
 * an upgrade never boots into a broken state.
 */
export function normalise(raw: Partial<Database> | null): Database {
  const base = emptyDatabase();
  if (!raw) return base;

  return {
    ...base,
    ...raw,
    version: DB_VERSION,
    player: { ...base.player, ...raw.player },
    settings: { ...base.settings, ...raw.settings },
    products: raw.products ?? [],
    sales: raw.sales ?? [],
    goals: raw.goals ?? [],
    quests: raw.quests ?? [],
    usage: raw.usage ?? [],
    xpEvents: raw.xpEvents ?? [],
    achievements: raw.achievements ?? {},
    credentials: raw.credentials ?? {},
    syncs: raw.syncs ?? {},
  };
}

export function newId(): string {
  // randomUUID needs a secure context; the fallback keeps dev-over-HTTP working.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function today(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function weekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
