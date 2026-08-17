'use client';

import { ConnectorError, type Connector, type ConnectorCreds, type RelayCall } from '@/lib/local/connectors/types';
import type { NewSale } from '@/lib/local/actions';

/**
 * Whop v5 adapter.
 *
 * Whop's payload shape varies by account and has changed across versions, so
 * every field is read through `pick` with fallbacks rather than destructured. A
 * missing field degrades one row instead of throwing the whole sync away.
 */

const BASE = 'https://api.whop.com/api/v5';

function authHeaders(creds: ConnectorCreds): Record<string, string> {
  const key = (creds.api_key ?? '').trim();
  if (!key) throw new ConnectorError('Missing Whop API key.', 'config');
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

function toCents(v: unknown): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Whop timestamps are unix seconds; some fields arrive as ISO strings. */
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

async function get(
  creds: ConnectorCreds,
  call: RelayCall,
  path: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams(params);
  const companyId = (creds.company_id ?? '').trim();
  if (companyId) qs.set('company_id', companyId);

  const res = await call({ url: `${BASE}${path}?${qs}`, headers: authHeaders(creds) });

  if (res.status === 401 || res.status === 403) {
    throw new ConnectorError('Whop rejected the API key. Check it in Developer → API keys.', 'auth');
  }
  if (!res.ok) {
    throw new ConnectorError(`Whop returned ${res.status}: ${res.text.slice(0, 160)}`);
  }
  return (res.json ?? {}) as Record<string, unknown>;
}

export const whopConnector: Connector = {
  id: 'whop',
  label: 'Whop',
  blurb: 'Payments, memberships, and products.',
  needsRelay: true,

  fields: [
    {
      name: 'api_key',
      label: 'API key',
      help: 'Whop dashboard → Developer → API keys. Read access is enough.',
      required: true,
      secret: true,
    },
    {
      name: 'company_id',
      label: 'Company ID',
      help: 'Optional. Scopes the sync to one company if you run several.',
      required: false,
      secret: false,
      placeholder: 'biz_...',
    },
  ],

  async test(creds, call) {
    const data = await get(creds, call, '/company/products', { per: '1', page: '1' });
    const rows = Array.isArray(data.data) ? data.data.length : 0;
    return `Whop key works (${rows > 0 ? 'products visible' : 'no products yet'}).`;
  },

  async fetchSales(creds, since, call) {
    const sales: NewSale[] = [];
    let reachedOlder = false;

    for (let page = 1; page <= 20 && !reachedOlder; page++) {
      const data = await get(creds, call, '/company/payments', {
        page: String(page),
        per: '50',
      });

      const rows = (Array.isArray(data.data) ? data.data : []) as Record<string, unknown>[];
      if (rows.length === 0) break;

      for (const p of rows) {
        const id = asString(pick(p, 'id', 'receipt_id'));
        if (!id) continue;

        const occurredAt = toMs(pick(p, 'created_at', 'paid_at', 'settled_at'));

        // Payments come newest-first, so once we cross the watermark the rest
        // of the history is already imported — stop paging.
        if (occurredAt < since) {
          reachedOlder = true;
          continue;
        }

        const rawStatus = String(pick(p, 'status', 'payment_status') ?? 'paid').toLowerCase();
        const refunded = toCents(pick(p, 'refunded_amount', 'amount_refunded'));

        const status: NewSale['status'] =
          refunded > 0
            ? 'refunded'
            : rawStatus.includes('paid') || rawStatus === 'succeeded' || rawStatus === 'completed'
              ? 'paid'
              : rawStatus.includes('fail') || rawStatus === 'canceled'
                ? 'failed'
                : 'pending';

        const user = p.user as Record<string, unknown> | undefined;

        sales.push({
          platform: 'whop',
          externalId: id,
          productName: String(pick(p, 'product_title', 'plan_title') ?? 'Whop sale'),
          grossCents: toCents(pick(p, 'final_amount', 'subtotal', 'amount', 'usd_amount')),
          feesCents: toCents(pick(p, 'whop_fee', 'fees', 'application_fee')),
          refundCents: refunded,
          currency: String(pick(p, 'currency') ?? 'USD').toUpperCase(),
          status,
          isRecurring: Boolean(pick(p, 'membership', 'subscription_id')),
          occurredAt,
          customerEmail: user ? asString(user.email) : null,
        });
      }
    }

    return { sales, message: `Whop: ${sales.length} payments.` };
  },
};
