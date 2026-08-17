import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCredential } from '@/lib/credentials';
import { toCents, upsertSale } from '@/lib/integrations/upsert';
import { evaluateAchievements, awardXp, touchStreak } from '@/lib/game';
import { reconcileGoals } from '@/lib/queries';
import { clientIp, consume, LIMITS } from '@/lib/ratelimit';
import { handler } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 1024 * 1024;

/**
 * Shopify order webhook.
 *
 * Unauthenticated by cookie — authenticated by HMAC over the raw body. That
 * means three rules must hold, and all three are easy to get wrong:
 *   1. Verify against the RAW bytes, before any JSON parsing.
 *   2. Compare in constant time.
 *   3. Reject, loudly, when no secret is configured — never fall through to
 *      "accept everything" just because setup is incomplete.
 */
export const POST = handler(async (req) => {
  const ip = clientIp(req.headers);
  const rl = consume(`webhook:shopify:${ip}`, LIMITS.webhook);
  if (!rl.ok) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  const secret = getCredential('shopify', 'webhook_secret');
  if (!secret) {
    // 503 rather than 401: the request may well be legitimate, we're just not
    // able to verify it yet. Shopify will retry once the secret is set.
    return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 503 });
  }

  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY) {
    return NextResponse.json({ error: 'too large' }, { status: 413 });
  }

  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY) {
    return NextResponse.json({ error: 'too large' }, { status: 413 });
  }

  const presented = req.headers.get('x-shopify-hmac-sha256') ?? '';
  const expected = createHmac('sha256', secret).update(raw, 'utf8').digest('base64');

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    console.warn('[webhook:shopify] bad signature from', ip);
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  const topic = req.headers.get('x-shopify-topic') ?? '';
  let order: Record<string, unknown>;
  try {
    order = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const id = order.admin_graphql_api_id ?? order.id;
  if (!id) return NextResponse.json({ ok: true, skipped: 'no id' });

  const financial = String(order.financial_status ?? '').toUpperCase();
  const refunds = Array.isArray(order.refunds) ? order.refunds : [];
  const refundCents = refunds.reduce<number>((sum, r) => {
    const txs = (r as Record<string, unknown>).transactions;
    if (!Array.isArray(txs)) return sum;
    return sum + txs.reduce<number>((s, t) => s + toCents((t as Record<string, unknown>).amount), 0);
  }, 0);

  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const first = lineItems[0] as Record<string, unknown> | undefined;
  const customer = order.customer as Record<string, unknown> | undefined;

  const status =
    topic.includes('cancelled') || financial === 'VOIDED'
      ? 'failed'
      : refundCents > 0 || financial.includes('REFUNDED')
        ? 'refunded'
        : financial === 'PAID'
          ? 'paid'
          : 'pending';

  const isNew = upsertSale({
    platform: 'shopify',
    externalId: String(id),
    productExternalId: first?.product_id
      ? `gid://shopify/Product/${String(first.product_id)}`
      : null,
    productName: first?.title
      ? lineItems.length > 1
        ? `${String(first.title)} +${lineItems.length - 1} more`
        : String(first.title)
      : String(order.name ?? 'Shopify order'),
    grossCents: toCents(order.total_price ?? order.current_total_price),
    refundCents,
    currency: String(order.currency ?? 'USD').toUpperCase(),
    status: status as 'paid' | 'pending' | 'refunded' | 'failed',
    occurredAt: Date.parse(String(order.created_at ?? '')) || Date.now(),
    customerExternalId: customer?.id ? String(customer.id) : null,
    customerEmail: (order.email as string) ?? (customer?.email as string) ?? null,
    customerName: customer
      ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || null
      : null,
  });

  if (isNew && status === 'paid') {
    awardXp(50, 'Shopify sale (live)');
    touchStreak();
  }
  reconcileGoals();
  evaluateAchievements();

  return NextResponse.json({ ok: true });
});
