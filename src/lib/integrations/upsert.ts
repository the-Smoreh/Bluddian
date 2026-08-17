import 'server-only';
import { db, newId, now } from '@/lib/db';

/**
 * Shared write path for anything that produces a sale or a product, so Whop,
 * Shopify, webhooks, and manual entry all land in the same shape.
 *
 * Idempotency is enforced by UNIQUE(platform, external_id): re-running a sync
 * updates rows instead of duplicating revenue. This is the single most
 * important property here — double-counted revenue makes the whole app lie.
 */

export type UpsertProduct = {
  platform: 'whop' | 'shopify' | 'manual';
  externalId: string;
  name: string;
  kind?: 'product' | 'course' | 'bundle' | 'membership' | 'service';
  priceCents?: number;
  currency?: string;
  url?: string | null;
  status?: 'idea' | 'building' | 'live' | 'paused' | 'archived';
};

export function upsertProduct(p: UpsertProduct): string {
  const existing = db
    .prepare('SELECT id FROM products WHERE platform = ? AND external_id = ?')
    .get(p.platform, p.externalId) as { id: string } | undefined;

  const t = now();

  if (existing) {
    // Never clobber `status`, `notes`, or `emoji` — those are the user's own
    // annotations and the upstream API knows nothing about them.
    db.prepare(
      `UPDATE products SET name = ?, price_cents = ?, currency = ?, url = ?, updated_at = ?
       WHERE id = ?`,
    ).run(p.name, p.priceCents ?? 0, p.currency ?? 'USD', p.url ?? null, t, existing.id);
    return existing.id;
  }

  const id = newId();
  db.prepare(
    `INSERT INTO products (id, name, kind, platform, external_id, status, price_cents, currency, url, emoji, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'package', ?, ?)`,
  ).run(
    id,
    p.name,
    p.kind ?? 'product',
    p.platform,
    p.externalId,
    p.status ?? 'live',
    p.priceCents ?? 0,
    p.currency ?? 'USD',
    p.url ?? null,
    t,
    t,
  );
  return id;
}

export type UpsertSale = {
  platform: 'whop' | 'shopify' | 'manual';
  externalId: string;
  productExternalId?: string | null;
  /** Direct link, used by manual entry where there is no external id. */
  productId?: string | null;
  productName: string;
  grossCents: number;
  feesCents?: number;
  refundCents?: number;
  currency?: string;
  status?: 'paid' | 'pending' | 'refunded' | 'failed';
  isRecurring?: boolean;
  occurredAt: number;
  customerEmail?: string | null;
  customerName?: string | null;
  customerExternalId?: string | null;
};

/** Returns true when this call created a new sale (vs updating a known one). */
export function upsertSale(s: UpsertSale): boolean {
  const productId =
    s.productId ??
    (s.productExternalId
      ? ((
          db
            .prepare('SELECT id FROM products WHERE platform = ? AND external_id = ?')
            .get(s.platform, s.productExternalId) as { id: string } | undefined
        )?.id ?? null)
      : null);

  // Determine novelty BEFORE writing. better-sqlite3 reports changes=1 for an
  // ON CONFLICT update as well as an insert, so inferring it from the result is
  // unreliable — and getting it wrong would let a replayed webhook award XP
  // every time it arrives.
  const isNew =
    (db
      .prepare('SELECT 1 AS hit FROM sales WHERE platform = ? AND external_id = ?')
      .get(s.platform, s.externalId) as { hit: number } | undefined) === undefined;

  let customerId: string | null = null;
  if (s.customerExternalId || s.customerEmail) {
    const externalId = s.customerExternalId ?? s.customerEmail!;
    const existing = db
      .prepare('SELECT id FROM customers WHERE platform = ? AND external_id = ?')
      .get(s.platform, externalId) as { id: string } | undefined;

    if (existing) {
      customerId = existing.id;
    } else {
      customerId = newId();
      db.prepare(
        `INSERT INTO customers (id, platform, external_id, email, name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(customerId, s.platform, externalId, s.customerEmail ?? null, s.customerName ?? null, now());
    }
  }

  const fees = s.feesCents ?? 0;
  const refund = s.refundCents ?? 0;
  const net = s.grossCents - fees - refund;

  db
    .prepare(
      `INSERT INTO sales
         (id, platform, external_id, product_id, customer_id, product_name,
          gross_cents, fees_cents, refund_cents, net_cents, currency, status,
          is_recurring, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, external_id) DO UPDATE SET
         gross_cents  = excluded.gross_cents,
         fees_cents   = excluded.fees_cents,
         refund_cents = excluded.refund_cents,
         net_cents    = excluded.net_cents,
         status       = excluded.status,
         product_id   = COALESCE(excluded.product_id, sales.product_id),
         product_name = excluded.product_name`,
    )
    .run(
      newId(),
      s.platform,
      s.externalId,
      productId,
      customerId,
      s.productName.slice(0, 200),
      s.grossCents,
      fees,
      refund,
      net,
      s.currency ?? 'USD',
      s.status ?? 'paid',
      s.isRecurring ? 1 : 0,
      s.occurredAt,
      now(),
    );

  return isNew;
}

/** Currency amounts arrive as strings, floats, or minor units. Normalise. */
export function toCents(value: unknown, alreadyMinor = false): number {
  if (value == null) return 0;
  const n = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(n)) return 0;
  return alreadyMinor ? Math.round(n) : Math.round(n * 100);
}
