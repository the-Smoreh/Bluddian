import { z } from 'zod';
import { db } from '@/lib/db';
import { awardXp, evaluateAchievements, touchStreak } from '@/lib/game';
import { upsertSale } from '@/lib/integrations/upsert';
import { fail, guard, handler, json, readJson } from '@/lib/http';
import { listSales, reconcileGoals } from '@/lib/queries';
import { newId } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  productId: z.string().uuid().nullish(),
  productName: z.string().min(1, 'What was sold?').max(200),
  grossCents: z.number().int().min(0).max(100_000_000),
  feesCents: z.number().int().min(0).max(100_000_000).default(0),
  currency: z.string().length(3).default('USD'),
  platform: z.enum(['whop', 'shopify', 'manual']).default('manual'),
  isRecurring: z.boolean().default(false),
  occurredAt: z.number().int().positive().optional(),
  customerEmail: z.string().email().max(200).nullish(),
});

export const GET = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const limit = Math.min(200, Number(req.nextUrl.searchParams.get('limit')) || 50);
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset')) || 0);

  return json({ sales: listSales(limit, offset) });
});

/** Manual sale entry — for anything that doesn't come from a connected platform. */
export const POST = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const parsed = await readJson(req, CreateBody);
  if (!parsed.ok) return parsed.response;
  const s = parsed.data;

  // Resolve the product's external key so upsertSale can link it the same way
  // a platform sync would.
  let productExternalId: string | null = null;
  if (s.productId) {
    const row = db
      .prepare('SELECT external_id, platform FROM products WHERE id = ?')
      .get(s.productId) as { external_id: string | null; platform: string } | undefined;
    if (!row) return fail(404, 'That product does not exist.');
    productExternalId = row.external_id;
  }

  const created = upsertSale({
    platform: s.platform,
    // Manual rows still need a stable unique key for the idempotency index.
    externalId: `manual-${newId()}`,
    productExternalId,
    productId: s.productId ?? null,
    productName: s.productName,
    grossCents: s.grossCents,
    feesCents: s.feesCents,
    currency: s.currency.toUpperCase(),
    status: 'paid',
    isRecurring: s.isRecurring,
    occurredAt: s.occurredAt ?? Date.now(),
    customerEmail: s.customerEmail ?? null,
  });

  const net = s.grossCents - s.feesCents;
  // XP scales with the sale, capped so one big deal doesn't trivialise the curve.
  const xp = Math.min(1000, 25 + Math.round(net / 1000));
  awardXp(xp, `Sale: ${s.productName}`);
  touchStreak();

  const completedGoals = reconcileGoals();
  const unlocked = evaluateAchievements();

  return json({ ok: true, created, awarded: xp, completedGoals, unlocked }, { status: 201 });
});

const DeleteBody = z.object({ id: z.string().min(1).max(100) });

export const DELETE = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const parsed = await readJson(req, DeleteBody);
  if (!parsed.ok) return parsed.response;

  const res = db.prepare('DELETE FROM sales WHERE id = ?').run(parsed.data.id);
  if (res.changes === 0) return fail(404, 'Sale not found.');

  return json({ ok: true });
});
