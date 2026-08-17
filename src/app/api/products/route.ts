import { z } from 'zod';
import { db, newId, now } from '@/lib/db';
import { evaluateAchievements, touchStreak } from '@/lib/game';
import { fail, guard, handler, json, readJson } from '@/lib/http';
import { listProducts } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = ['product', 'course', 'bundle', 'membership', 'service'] as const;
const STATUSES = ['idea', 'building', 'live', 'paused', 'archived'] as const;

const CreateBody = z.object({
  name: z.string().min(1, 'Give it a name.').max(120),
  kind: z.enum(KINDS).default('product'),
  status: z.enum(STATUSES).default('idea'),
  priceCents: z.number().int().min(0).max(100_000_000).default(0),
  currency: z.string().length(3).default('USD'),
  url: z.string().url().max(500).nullish(),
  emoji: z.string().max(24).default('package'),
  notes: z.string().max(2000).default(''),
  launchAt: z.number().int().nullish(),
  lessonsTotal: z.number().int().min(0).max(1000).optional(),
});

export const GET = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const kind = req.nextUrl.searchParams.get('kind') ?? undefined;
  const includeArchived = req.nextUrl.searchParams.get('archived') === '1';

  return json({ products: listProducts({ kind, includeArchived }) });
});

export const POST = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const parsed = await readJson(req, CreateBody);
  if (!parsed.ok) return parsed.response;
  const p = parsed.data;

  const id = newId();
  const t = now();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO products (id, name, kind, platform, status, price_cents, currency, url, emoji, notes, launch_at, created_at, updated_at)
       VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      p.name,
      p.kind,
      p.status,
      p.priceCents,
      p.currency.toUpperCase(),
      p.url ?? null,
      p.emoji,
      p.notes,
      p.launchAt ?? null,
      t,
      t,
    );

    if (p.kind === 'course') {
      db.prepare(
        `INSERT INTO course_meta (product_id, lessons_total, lessons_done, students, completion_pct, updated_at)
         VALUES (?, ?, 0, 0, 0, ?)`,
      ).run(id, p.lessonsTotal ?? 0, t);
    }
  })();

  touchStreak();
  const unlocked = evaluateAchievements();

  return json({ ok: true, id, unlocked }, { status: 201 });
});
