import 'server-only';
import { getCredential, providerConfigured } from '@/lib/credentials';
import { apiFetch, UpstreamError } from '@/lib/integrations/fetch';
import { toCents, upsertProduct, upsertSale } from '@/lib/integrations/upsert';
import type { SyncResult } from '@/lib/integrations/sync';

/**
 * Whop v5 REST API.
 *
 * Whop's payload shapes vary by account and have changed across versions, so
 * every field is read defensively with fallbacks rather than destructured. A
 * missing field degrades one row; it never throws the whole sync away.
 */

const BASE = 'https://api.whop.com/api/v5';

type WhopPage<T> = {
  data?: T[];
  pagination?: { current_page?: number; total_page?: number; next_page?: number | null };
};

function headers(): Record<string, string> {
  const key = getCredential('whop', 'api_key');
  if (!key) throw new UpstreamError('Whop API key not configured.', 0, 'whop');
  return { authorization: `Bearer ${key}` };
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  // Whop sometimes inlines a whole object where an ID is expected.
  if (v && typeof v === 'object') {
    const id = (v as Record<string, unknown>).id;
    if (typeof id === 'string') return id;
  }
  return null;
}

/** Whop timestamps are unix *seconds*; some fields are ISO strings. */
function toMs(v: unknown): number {
  if (typeof v === 'number') return v > 1e11 ? v : v * 1000;
  if (typeof v === 'string') {
    const asNum = Number(v);
    if (Number.isFinite(asNum) && asNum > 0) return asNum > 1e11 ? asNum : asNum * 1000;
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

async function paged<T>(path: string, max = 10): Promise<T[]> {
  const out: T[] = [];
  const companyId = getCredential('whop', 'company_id');

  for (let page = 1; page <= max; page++) {
    const qs = new URLSearchParams({ page: String(page), per: '50' });
    if (companyId) qs.set('company_id', companyId);

    const res: WhopPage<T> = await apiFetch({
      provider: 'whop',
      url: `${BASE}${path}?${qs.toString()}`,
      headers: headers(),
    });

    const rows = res.data ?? [];
    out.push(...rows);

    const total = res.pagination?.total_page ?? 1;
    if (rows.length === 0 || page >= total) break;
  }
  return out;
}

export async function syncWhop(): Promise<SyncResult> {
  if (!providerConfigured('whop')) {
    throw new Error('Whop is not connected. Add an API key in Settings.');
  }

  // ---- products first, so payments can link to them ----------------------
  let productCount = 0;
  try {
    const products = await paged<Record<string, unknown>>('/company/products');
    for (const p of products) {
      const id = asString(pick(p, 'id', 'product_id'));
      if (!id) continue;

      const name = String(pick(p, 'title', 'name', 'route') ?? 'Untitled Whop product');
      const visibility = String(pick(p, 'visibility') ?? '');

      upsertProduct({
        platform: 'whop',
        externalId: id,
        name,
        kind: 'membership',
        priceCents: toCents(pick(p, 'price', 'initial_price', 'renewal_price')),
        currency: String(pick(p, 'base_currency', 'currency') ?? 'USD').toUpperCase(),
        url: asString(pick(p, 'direct_link', 'route')),
        status: visibility === 'archived' ? 'archived' : 'live',
      });
      productCount++;
    }
  } catch (err) {
    // A products-endpoint failure shouldn't block revenue import.
    console.warn('[whop] product sync failed:', (err as Error).message);
  }

  // ---- payments ----------------------------------------------------------
  const payments = await paged<Record<string, unknown>>('/company/payments');
  let saleCount = 0;

  for (const p of payments) {
    const id = asString(pick(p, 'id', 'receipt_id'));
    if (!id) continue;

    const rawStatus = String(pick(p, 'status', 'payment_status') ?? 'paid').toLowerCase();
    const refunded = toCents(pick(p, 'refunded_amount', 'amount_refunded'));

    const status: 'paid' | 'pending' | 'refunded' | 'failed' =
      refunded > 0
        ? 'refunded'
        : rawStatus.includes('paid') || rawStatus === 'succeeded' || rawStatus === 'completed'
          ? 'paid'
          : rawStatus.includes('fail') || rawStatus === 'canceled'
            ? 'failed'
            : 'pending';

    const gross = toCents(pick(p, 'final_amount', 'subtotal', 'amount', 'usd_amount'));
    const productId = asString(pick(p, 'product', 'product_id', 'plan'));

    const user = p.user as Record<string, unknown> | undefined;

    upsertSale({
      platform: 'whop',
      externalId: id,
      productExternalId: productId,
      productName: String(pick(p, 'product_title', 'plan_title') ?? 'Whop sale'),
      grossCents: gross,
      // Whop reports the platform fee under several names depending on plan.
      feesCents: toCents(pick(p, 'whop_fee', 'fees', 'application_fee')),
      refundCents: refunded,
      currency: String(pick(p, 'currency') ?? 'USD').toUpperCase(),
      status,
      isRecurring: Boolean(pick(p, 'membership', 'subscription_id')),
      occurredAt: toMs(pick(p, 'created_at', 'paid_at', 'settled_at')),
      customerExternalId: asString(pick(p, 'user', 'user_id')),
      customerEmail: user ? (asString(user.email) ?? null) : null,
      customerName: user ? (asString(pick(user, 'username', 'name')) ?? null) : null,
    });
    saleCount++;
  }

  return {
    items: saleCount + productCount,
    message: `Whop: ${saleCount} payments, ${productCount} products.`,
  };
}

export async function testWhop(): Promise<{ ok: boolean; message: string }> {
  try {
    await apiFetch({
      provider: 'whop',
      url: `${BASE}/company/products?page=1&per=1`,
      headers: headers(),
      retries: 0,
    });
    return { ok: true, message: 'Whop API key works.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Failed' };
  }
}
