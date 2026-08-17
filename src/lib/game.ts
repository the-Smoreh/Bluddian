import { db, newId, now, today, weekKey } from '@/lib/db';

/**
 * The game layer. Real money is the score; this turns it into something with
 * feedback loops — levels, streaks, quests, achievements.
 *
 * Design rule: XP is *earned from real outcomes* (shipping, selling, hitting
 * goals), never from opening the app. A dashboard that rewards checking the
 * dashboard is a slot machine, not a business tool.
 */

export type Player = {
  id: number;
  xp: number;
  streak_days: number;
  longest_streak: number;
  last_active: string;
  updated_at: number;
};

/**
 * Level curve: each level costs 25% more than the last, starting at 500 XP.
 * Level 10 ≈ 18k XP, level 25 ≈ 200k. Slow enough to stay meaningful.
 */
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

export type LevelInfo = {
  level: number;
  xp: number;
  currentFloor: number;
  nextFloor: number;
  intoLevel: number;
  needed: number;
  pct: number;
  title: string;
};

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

export function levelInfo(xp: number): LevelInfo {
  const level = levelFromXp(xp);
  const currentFloor = xpForLevel(level);
  const nextFloor = xpForLevel(level + 1);
  const intoLevel = xp - currentFloor;
  const needed = Math.max(1, nextFloor - currentFloor);
  return {
    level,
    xp,
    currentFloor,
    nextFloor,
    intoLevel,
    needed,
    pct: Math.min(100, Math.round((intoLevel / needed) * 100)),
    title: rankTitle(level),
  };
}

export function getPlayer(): Player {
  return db.prepare('SELECT * FROM player WHERE id = 1').get() as Player;
}

/** Award XP and log why. Returns the level before/after so the UI can celebrate. */
export function awardXp(amount: number, reason: string): { levelUp: boolean; level: number; xp: number } {
  const before = getPlayer();
  const beforeLevel = levelFromXp(before.xp);
  const xp = Math.max(0, before.xp + amount);

  db.prepare('UPDATE player SET xp = ?, updated_at = ? WHERE id = 1').run(xp, now());
  db.prepare('INSERT INTO xp_events (id, amount, reason, created_at) VALUES (?, ?, ?, ?)').run(
    newId(),
    amount,
    reason,
    now(),
  );

  const afterLevel = levelFromXp(xp);
  return { levelUp: afterLevel > beforeLevel, level: afterLevel, xp };
}

/**
 * Streak: consecutive days on which you logged *real activity* (a sale, a
 * shipped lesson, a completed quest) — not app opens.
 */
export function touchStreak(): Player {
  const p = getPlayer();
  const t = today();
  if (p.last_active === t) return p;

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const streak = p.last_active === yesterday ? p.streak_days + 1 : 1;
  const longest = Math.max(streak, p.longest_streak);

  db.prepare(
    'UPDATE player SET streak_days = ?, longest_streak = ?, last_active = ?, updated_at = ? WHERE id = 1',
  ).run(streak, longest, t, now());

  // Milestone bonuses make long streaks worth protecting.
  if ([7, 30, 60, 100, 365].includes(streak)) {
    awardXp(streak * 20, `${streak}-day streak`);
    unlock(`streak_${streak}`);
  }
  return getPlayer();
}

// ----------------------------------------------------------------- quests --

export type Quest = {
  id: string;
  title: string;
  detail: string;
  cadence: 'daily' | 'weekly' | 'once';
  xp: number;
  target: number;
  progress: number;
  period_key: string;
  completed_at: number | null;
  created_at: number;
};

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

/** Create today's/this week's quests if they don't exist yet. Idempotent. */
export function ensureQuests(): Quest[] {
  const day = today();
  const week = weekKey();
  const t = now();

  const insert = db.prepare(
    `INSERT OR IGNORE INTO quests (id, title, detail, cadence, xp, target, progress, period_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  );

  const tx = db.transaction(() => {
    for (const q of DAILY_TEMPLATES) {
      insert.run(newId(), q.title, q.detail, 'daily', q.xp, q.target, day, t);
    }
    for (const q of WEEKLY_TEMPLATES) {
      insert.run(newId(), q.title, q.detail, 'weekly', q.xp, q.target, week, t);
    }
  });
  tx();

  return db
    .prepare(
      `SELECT * FROM quests WHERE period_key IN (?, ?)
       ORDER BY cadence DESC, completed_at IS NOT NULL, xp DESC`,
    )
    .all(day, week) as Quest[];
}

/** Advance a quest. Awards XP exactly once, on the transition to complete. */
export function progressQuest(id: string, delta = 1): { quest: Quest; awarded: number } | null {
  const quest = db.prepare('SELECT * FROM quests WHERE id = ?').get(id) as Quest | undefined;
  if (!quest) return null;

  const wasComplete = quest.completed_at !== null;
  const progress = Math.max(0, Math.min(quest.target, quest.progress + delta));
  const isComplete = progress >= quest.target;

  db.prepare('UPDATE quests SET progress = ?, completed_at = ? WHERE id = ?').run(
    progress,
    isComplete ? (quest.completed_at ?? now()) : null,
    id,
  );

  let awarded = 0;
  if (isComplete && !wasComplete) {
    awardXp(quest.xp, `Quest: ${quest.title}`);
    touchStreak();
    awarded = quest.xp;
  } else if (!isComplete && wasComplete) {
    // Un-completing claws the XP back so the counter can't be farmed.
    awardXp(-quest.xp, `Quest undone: ${quest.title}`);
    awarded = -quest.xp;
  }

  return { quest: db.prepare('SELECT * FROM quests WHERE id = ?').get(id) as Quest, awarded };
}

// ----------------------------------------------------------- achievements --

export type AchievementDef = {
  code: string;
  name: string;
  detail: string;
  icon: string;
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { code: 'first_sale', name: 'First Blood', detail: 'Log your first sale.', icon: 'zap' },
  { code: 'rev_100', name: 'Triple Digits', detail: '$100 in net revenue.', icon: 'coin' },
  { code: 'rev_1k', name: 'Four Figures', detail: '$1,000 in net revenue.', icon: 'coin' },
  { code: 'rev_10k', name: 'Five Figures', detail: '$10,000 in net revenue.', icon: 'crown' },
  { code: 'rev_100k', name: 'Six Figures', detail: '$100,000 in net revenue.', icon: 'crown' },
  { code: 'first_product', name: 'Made a Thing', detail: 'Take a product live.', icon: 'package' },
  { code: 'first_course', name: 'Teacher', detail: 'Take a course live.', icon: 'book' },
  { code: 'goal_done', name: 'Called Your Shot', detail: 'Complete a money goal.', icon: 'target' },
  { code: 'streak_7', name: 'Week Warrior', detail: '7-day activity streak.', icon: 'flame' },
  { code: 'streak_30', name: 'Unstoppable', detail: '30-day activity streak.', icon: 'flame' },
  { code: 'streak_100', name: 'Obsessed', detail: '100-day activity streak.', icon: 'flame' },
  { code: 'streak_365', name: 'A Full Year', detail: '365-day activity streak.', icon: 'flame' },
  { code: 'streak_60', name: 'Two Months Deep', detail: '60-day activity streak.', icon: 'flame' },
  { code: 'multi_platform', name: 'Omnichannel', detail: 'Revenue from Whop and Shopify.', icon: 'grid' },
];

export function unlock(code: string): boolean {
  const def = ACHIEVEMENTS.find((a) => a.code === code);
  if (!def) return false;
  const res = db
    .prepare('INSERT OR IGNORE INTO achievements (code, earned_at) VALUES (?, ?)')
    .run(code, now());
  if (res.changes > 0) {
    awardXp(150, `Achievement: ${def.name}`);
    return true;
  }
  return false;
}

export function earnedAchievements(): Record<string, number> {
  const rows = db.prepare('SELECT code, earned_at FROM achievements').all() as {
    code: string;
    earned_at: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.code, r.earned_at]));
}

/**
 * Re-derive achievements from current data. Cheap enough to call after any
 * mutation, and it means achievements are correct even for imported history.
 */
export function evaluateAchievements(): string[] {
  const unlocked: string[] = [];

  const rev = db
    .prepare(`SELECT COALESCE(SUM(net_cents), 0) AS n FROM sales WHERE status = 'paid'`)
    .get() as { n: number };
  const salesCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE status = 'paid'`).get() as { n: number }
  ).n;

  const check = (cond: boolean, code: string) => {
    if (cond && unlock(code)) unlocked.push(code);
  };

  check(salesCount >= 1, 'first_sale');
  check(rev.n >= 10_000, 'rev_100');
  check(rev.n >= 100_000, 'rev_1k');
  check(rev.n >= 1_000_000, 'rev_10k');
  check(rev.n >= 10_000_000, 'rev_100k');

  const liveProducts = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM products WHERE status = 'live' AND kind != 'course'`)
      .get() as { n: number }
  ).n;
  const liveCourses = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM products WHERE status = 'live' AND kind = 'course'`)
      .get() as { n: number }
  ).n;
  check(liveProducts >= 1, 'first_product');
  check(liveCourses >= 1, 'first_course');

  const doneGoals = (
    db.prepare(`SELECT COUNT(*) AS n FROM goals WHERE status = 'done'`).get() as { n: number }
  ).n;
  check(doneGoals >= 1, 'goal_done');

  const platforms = db
    .prepare(`SELECT DISTINCT platform FROM sales WHERE status = 'paid'`)
    .all() as { platform: string }[];
  const names = new Set(platforms.map((p) => p.platform));
  check(names.has('whop') && names.has('shopify'), 'multi_platform');

  return unlocked;
}
