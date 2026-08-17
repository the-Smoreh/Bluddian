import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCredential } from '@/lib/credentials';
import { toCents, upsertSale } from '@/lib/integrations/upsert';
import { awardXp, evaluateAchievements, touchStreak } from '@/lib/game';
import { reconcileGoals } from '@/lib/queries';
import { clientIp, consume, LIMITS } from '@/lib/ratelimit';
import { handler } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 1024 * 1024;
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Whop payment webhook.
 *
 * Whop has shipped a couple of signature formats over time, so this accepts
 * both a bare HMAC and the `t=<unix>,v1=<hmac>` form. When a timestamp is
 * present it is enforced, which is what makes captured requests unusable as
 * replays; the bare form has no timestamp to check, so idempotent upserts are
 * what protect us there.
 */
export const POST = handler(async (req) => {
  const ip = clientIp(req.headers);
  const rl = consume(`webhook:whop:${ip}`, LIMITS.webhook);
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429 });

  const secret = getCredential('whop', 'webhook_secret');
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 503 });
  }

  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY) return NextResponse.json({ error: 'too large' }, { status: 413 });

  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY) {
    return NextResponse.json({ error: 'too large' }, { status: 413 });
  }

  const header =
    req.headers.get('x-whop-signature') ??
    req.headers.get('whop-signature') ??
    '';

  if (!verifyWhopSignature(header, raw, secret)) {
    console.warn('[webhook:whop] bad signature from', ip);
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const action = String(event.action ?? event.event ?? '');
  const data = (event.data ?? event) as Record<string, unknown>;

  // Only payment events move money; membership events are informational.
  if (!action.includes('payment') && !action.includes('succeeded')) {
    return NextResponse.json({ ok: true, ignored: action });
  }

  const id = data.id ?? data.receipt_id;
  if (!id) return NextResponse.json({ ok: true, skipped: 'no id' });

  const refunded = toCents(data.refunded_amount);
  const status = action.includes('failed')
    ? 'failed'
    : refunded > 0
      ? 'refunded'
      : 'paid';

  const user = data.user as Record<string, unknown> | undefined;
  const product = data.product;

  const isNew = upsertSale({
    platform: 'whop',
    externalId: String(id),
    productExternalId: typeof product === 'string' ? product : null,
    productName: String(data.product_title ?? data.plan_title ?? 'Whop sale'),
    grossCents: toCents(data.final_amount ?? data.amount ?? data.subtotal),
    feesCents: toCents(data.whop_fee),
    refundCents: refunded,
    currency: String(data.currency ?? 'USD').toUpperCase(),
    status: status as 'paid' | 'refunded' | 'failed',
    isRecurring: Boolean(data.membership),
    occurredAt: toMs(data.created_at),
    customerExternalId: typeof data.user === 'string' ? data.user : (user?.id as string) ?? null,
    customerEmail: (user?.email as string) ?? null,
    customerName: (user?.username as string) ?? null,
  });

  if (isNew && status === 'paid') {
    awardXp(50, 'Whop sale (live)');
    touchStreak();
  }
  reconcileGoals();
  evaluateAchievements();

  return NextResponse.json({ ok: true });
});

function verifyWhopSignature(header: string, raw: string, secret: string): boolean {
  if (!header) return false;

  // Stripe-style: t=<unix seconds>,v1=<hex hmac over "t.body">
  if (header.includes('t=') && header.includes('v1=')) {
    const parts = Object.fromEntries(
      header.split(',').map((kv) => {
        const [k, ...rest] = kv.trim().split('=');
        return [k, rest.join('=')];
      }),
    );
    const ts = Number(parts.t);
    if (!Number.isFinite(ts)) return false;

    // Reject anything outside the replay window in either direction.
    if (Math.abs(Date.now() - ts * 1000) > REPLAY_WINDOW_MS) return false;

    const expected = createHmac('sha256', secret).update(`${parts.t}.${raw}`, 'utf8').digest('hex');
    return equal(parts.v1 ?? '', expected);
  }

  // Bare HMAC — accept hex or base64 since both are in the wild.
  const hex = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  const b64 = createHmac('sha256', secret).update(raw, 'utf8').digest('base64');
  const clean = header.replace(/^sha256=/, '');
  return equal(clean, hex) || equal(clean, b64);
}

function equal(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function toMs(v: unknown): number {
  if (typeof v === 'number') return v > 1e11 ? v : v * 1000;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n > 1e11 ? n : n * 1000;
    const p = Date.parse(v);
    if (Number.isFinite(p)) return p;
  }
  return Date.now();
}
