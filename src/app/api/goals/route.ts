import { z } from 'zod';
import { db, newId, now } from '@/lib/db';
import { evaluateAchievements } from '@/lib/game';
import { fail, guard, handler, json, readJson } from '@/lib/http';
import { listGoals, reconcileGoals, withProgress, type Goal } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = ['revenue', 'sales', 'students', 'custom'] as const;
const PERIODS = ['all', 'month', 'quarter', 'year'] as const;

const CreateBody = z.object({
  title: z.string().min(1, 'Name the goal.').max(120),
  kind: z.enum(KINDS).default('revenue'),
  targetValue: z.number().int().min(1, 'Target must be above zero.').max(1_000_000_000),
  period: z.enum(PERIODS).default('all'),
  unit: z.string().max(12).default('USD'),
  deadline: z.number().int().positive().nullish(),
  xpReward: z.number().int().min(0).max(50_000).default(500),
});

export const GET = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;
  return json({ goals: listGoals(req.nextUrl.searchParams.get('archived') === '1') });
});

export const POST = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const parsed = await readJson(req, CreateBody);
  if (!parsed.ok) return parsed.response;
  const goal = parsed.data;

  /**
   * Goals measure their whole window, with no baseline subtracted.
   *
   * An earlier version baselined at creation time so a new goal always opened
   * at zero. That read as a bug in practice: "$10k month" set on the 20th
   * showed $0 against $8.9k already earned that month, and "first 100 sales"
   * showed 0 with 62 sales banked. What people mean by a period goal is the
   * period's real total, so that is what it reports — even if that means a
   * goal opens partly, or fully, complete.
   */
  const startValue = 0;

  const id = newId();
  const t = now();

  db.prepare(
    `INSERT INTO goals (id, title, kind, target_value, start_value, manual_value, unit, period, deadline, xp_reward, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    id,
    goal.title,
    goal.kind,
    goal.targetValue,
    startValue,
    goal.unit.toUpperCase(),
    goal.period,
    goal.deadline ?? null,
    goal.xpReward,
    t,
    t,
  );

  const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Goal;
  return json({ ok: true, goal: withProgress(row) }, { status: 201 });
});

const PatchBody = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120).optional(),
  targetValue: z.number().int().min(1).max(1_000_000_000).optional(),
  deadline: z.number().int().positive().nullish(),
  status: z.enum(['active', 'done', 'failed', 'archived']).optional(),
  /** For kind=custom: set the counter directly, or nudge it. */
  manualValue: z.number().int().min(0).max(1_000_000_000).optional(),
  manualDelta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
});

export const PATCH = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const parsed = await readJson(req, PatchBody);
  if (!parsed.ok) return parsed.response;
  const p = parsed.data;

  const existing = db.prepare('SELECT * FROM goals WHERE id = ?').get(p.id) as Goal | undefined;
  if (!existing) return fail(404, 'Goal not found.');

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };

  if (p.title !== undefined) set('title', p.title);
  if (p.targetValue !== undefined) set('target_value', p.targetValue);
  if (p.deadline !== undefined) set('deadline', p.deadline ?? null);
  if (p.status !== undefined) {
    set('status', p.status);
    set('completed_at', p.status === 'done' ? now() : null);
  }
  if (p.manualValue !== undefined) set('manual_value', p.manualValue);
  else if (p.manualDelta !== undefined) {
    set('manual_value', Math.max(0, existing.manual_value + p.manualDelta));
  }

  if (sets.length) {
    set('updated_at', now());
    db.prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id = ?`).run(...values, p.id);
  }

  const completedGoals = reconcileGoals();
  const unlocked = evaluateAchievements();
  const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(p.id) as Goal;

  return json({ ok: true, goal: withProgress(row), completedGoals, unlocked });
});

const DeleteBody = z.object({ id: z.string().uuid() });

export const DELETE = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const parsed = await readJson(req, DeleteBody);
  if (!parsed.ok) return parsed.response;

  const res = db.prepare('DELETE FROM goals WHERE id = ?').run(parsed.data.id);
  if (res.changes === 0) return fail(404, 'Goal not found.');

  return json({ ok: true });
});
