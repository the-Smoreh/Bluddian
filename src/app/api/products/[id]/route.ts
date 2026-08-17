import { z } from 'zod';
import { db, now } from '@/lib/db';
import { awardXp, evaluateAchievements, touchStreak } from '@/lib/game';
import { fail, guard, handler, json, readJson } from '@/lib/http';
import { getProduct } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = ['product', 'course', 'bundle', 'membership', 'service'] as const;
const STATUSES = ['idea', 'building', 'live', 'paused', 'archived'] as const;

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  kind: z.enum(KINDS).optional(),
  status: z.enum(STATUSES).optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().length(3).optional(),
  url: z.string().url().max(500).nullish(),
  emoji: z.string().max(24).optional(),
  notes: z.string().max(2000).optional(),
  launchAt: z.number().int().nullish(),
  lessonsTotal: z.number().int().min(0).max(1000).optional(),
  lessonsDone: z.number().int().min(0).max(1000).optional(),
  students: z.number().int().min(0).max(1_000_000).optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PATCH = handler<Params>(async (req, ctx) => {
  const g = await guard(req, { bucket: '/api/products/[id]' });
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const existing = getProduct(id);
  if (!existing) return fail(404, 'Product not found.');

  const parsed = await readJson(req, PatchBody);
  if (!parsed.ok) return parsed.response;
  const p = parsed.data;

  // Build the UPDATE from only the fields actually supplied, so a PATCH that
  // sets one field can't blank the rest.
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    values.push(value);
  };

  if (p.name !== undefined) set('name', p.name);
  if (p.kind !== undefined) set('kind', p.kind);
  if (p.status !== undefined) set('status', p.status);
  if (p.priceCents !== undefined) set('price_cents', p.priceCents);
  if (p.currency !== undefined) set('currency', p.currency.toUpperCase());
  if (p.url !== undefined) set('url', p.url ?? null);
  if (p.emoji !== undefined) set('emoji', p.emoji);
  if (p.notes !== undefined) set('notes', p.notes);
  if (p.launchAt !== undefined) set('launch_at', p.launchAt ?? null);

  const wentLive = p.status === 'live' && existing.status !== 'live';

  db.transaction(() => {
    if (sets.length) {
      set('updated_at', now());
      db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    }

    const touchesCourse =
      p.lessonsTotal !== undefined || p.lessonsDone !== undefined || p.students !== undefined;

    if (touchesCourse || p.kind === 'course') {
      db.prepare(
        `INSERT INTO course_meta (product_id, lessons_total, lessons_done, students, completion_pct, updated_at)
         VALUES (?, 0, 0, 0, 0, ?)
         ON CONFLICT(product_id) DO NOTHING`,
      ).run(id, now());

      const cSets: string[] = [];
      const cValues: unknown[] = [];
      if (p.lessonsTotal !== undefined) {
        cSets.push('lessons_total = ?');
        cValues.push(p.lessonsTotal);
      }
      if (p.lessonsDone !== undefined) {
        cSets.push('lessons_done = ?');
        cValues.push(p.lessonsDone);
      }
      if (p.students !== undefined) {
        cSets.push('students = ?');
        cValues.push(p.students);
      }
      if (cSets.length) {
        cSets.push('updated_at = ?');
        cValues.push(now());
        db.prepare(`UPDATE course_meta SET ${cSets.join(', ')} WHERE product_id = ?`).run(
          ...cValues,
          id,
        );
      }

      // Keep completion_pct derived rather than user-supplied.
      db.prepare(
        `UPDATE course_meta
         SET completion_pct = CASE WHEN lessons_total > 0
              THEN MIN(100, CAST(lessons_done * 100.0 / lessons_total AS INTEGER)) ELSE 0 END
         WHERE product_id = ?`,
      ).run(id);
    }
  })();

  // Shipping is the behaviour worth rewarding, so it's the one that pays XP.
  let awarded = 0;
  if (wentLive) {
    awardXp(400, `Shipped: ${p.name ?? existing.name}`);
    touchStreak();
    awarded = 400;
  } else if (p.lessonsDone !== undefined && p.lessonsDone > (existing.lessons_done ?? 0)) {
    const delta = p.lessonsDone - (existing.lessons_done ?? 0);
    awardXp(delta * 75, `Published ${delta} lesson${delta > 1 ? 's' : ''}`);
    touchStreak();
    awarded = delta * 75;
  }

  const unlocked = evaluateAchievements();
  return json({ ok: true, product: getProduct(id), awarded, unlocked });
});

export const DELETE = handler<Params>(async (req, ctx) => {
  const g = await guard(req, { bucket: '/api/products/[id]' });
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const existing = getProduct(id);
  if (!existing) return fail(404, 'Product not found.');

  // Sales keep their denormalised product_name, so deleting a product never
  // rewrites revenue history — it just unlinks it.
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  return json({ ok: true });
});
