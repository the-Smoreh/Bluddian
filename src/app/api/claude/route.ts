import { z } from 'zod';
import { db, newId, now } from '@/lib/db';
import { fail, guard, handler, json, readJson } from '@/lib/http';
import { claudeSummary } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const days = Math.min(365, Number(req.nextUrl.searchParams.get('days')) || 30);
  return json({ summary: claudeSummary(days) });
});

const ManualBody = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  model: z.string().min(1).max(80).default('manual entry'),
  costCents: z.number().int().min(0).max(10_000_000),
  inputTokens: z.number().int().min(0).max(10_000_000_000).default(0),
  outputTokens: z.number().int().min(0).max(10_000_000_000).default(0),
});

/**
 * Manual usage entry, for when you don't have an org Admin key (they're owner-
 * only) but still want cost tracked. Stored with source='manual' so it never
 * collides with, or gets overwritten by, an API sync of the same day.
 */
export const POST = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const parsed = await readJson(req, ManualBody);
  if (!parsed.ok) return parsed.response;
  const u = parsed.data;

  db.prepare(
    `INSERT INTO claude_usage
       (id, day, model, workspace, input_tokens, output_tokens, cache_read, cache_write, cost_cents, source, created_at)
     VALUES (?, ?, ?, '', ?, ?, 0, 0, ?, 'manual', ?)
     ON CONFLICT(day, model, workspace, source) DO UPDATE SET
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       cost_cents = excluded.cost_cents`,
  ).run(newId(), u.day, u.model, u.inputTokens, u.outputTokens, u.costCents, now());

  return json({ ok: true, summary: claudeSummary(30) }, { status: 201 });
});

const DeleteBody = z.object({ id: z.string().min(1).max(100) });

export const DELETE = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const parsed = await readJson(req, DeleteBody);
  if (!parsed.ok) return parsed.response;

  const res = db.prepare('DELETE FROM claude_usage WHERE id = ?').run(parsed.data.id);
  if (res.changes === 0) return fail(404, 'Usage row not found.');

  return json({ ok: true });
});
