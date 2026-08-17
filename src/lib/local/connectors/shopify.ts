'use client';

import { ConnectorError, type Connector, type ConnectorCreds, type RelayCall } from '@/lib/local/connectors/types';
import type { NewSale } from '@/lib/local/actions';

/**
 * Shopify Admin GraphQL adapter.
 *
 * GraphQL rather than REST because cursor pagination lives in the response
 * body. REST paginates via the `Link` header, which the relay does not forward
 * — and shouldn't, since forwarding arbitrary headers is how a relay turns into
 * a general-purpose proxy.
 */

const API_VERSION = '2025-01';

function shopHost(creds: ConnectorCreds): string {
  const raw = (creds.shop_domain ?? '').trim().toLowerCase();
  const host = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  // Validated hard: this string becomes a request host.
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) {
    throw new ConnectorError(
      `"${host || 'empty'}" is not a shop domain. It must look like yourstore.myshopify.com`,
      'config',
    );
  }
  return host;
}

async function gql<T>(
  creds: ConnectorCreds,
  call: RelayCall,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = (creds.admin_token ?? '').trim();
  if (!token) throw new ConnectorError('Missing Shopify admin token.', 'config');

  const res = await call({
    url: `https://${shopHost(creds)}/admin/api/${API_VERSION}/graphql.json`,
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'content-type': 'application/json' },
    body: { query, variables },
  });

  if (res.status === 401 || res.status === 403) {
    throw new ConnectorError(
      'Shopify rejected the token. Check it starts with shpat_ and has read_orders + read_products.',
      'auth',
    );
  }
  if (!res.ok) {
    throw new ConnectorError(`Shopify returned ${res.status}: ${res.text.slice(0, 160)}`);
  }

  const payload = res.json as { data?: T; errors?: Array<{ message: string }> };
  if (payload?.errors?.length) {
    throw new ConnectorError(`Shopify: ${payload.errors.map((e) => e.message).join('; ')}`);
  }
  if (!payload?.data) throw new ConnectorError('Shopify returned no data.');

  return payload.data;
}

const ORDERS_QUERY = `
  query Orders($cursor: String, $query: String) {
    orders(first: 100, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount } }
        customer { email }
        lineItems(first: 5) { nodes { title } }
      }
    }
  }`;

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  currentTotalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
  totalRefundedSet?: { shopMoney?: { amount?: string } };
  customer?: { email?: string } | null;
  lineItems?: { nodes?: Array<{ title?: string }> };
};

function toCents(v: unknown): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export const shopifyConnector: Connector = {
  id: 'shopify',
  label: 'Shopify',
  blurb: 'Orders and revenue from your store.',
  needsRelay: true,

  fields: [
    {
      name: 'shop_domain',
      label: 'Shop domain',
      help: 'Found in your Shopify admin URL.',
      required: true,
      secret: false,
      placeholder: 'yourstore.myshopify.com',
    },
    {
      name: 'admin_token',
      label: 'Admin API access token',
      help: 'Settings → Apps and sales channels → Develop apps → create an app → Admin API access token. Needs read_orders and read_products.',
      required: true,
      secret: true,
      placeholder: 'shpat_...',
    },
  ],

  async test(creds, call) {
    const data = await gql<{ shop: { name: string } }>(creds, call, '{ shop { name } }');
    return `Connected to ${data.shop.name}.`;
  },

  async fetchSales(creds, since, call) {
    const sinceIso = new Date(since).toISOString();
    const sales: NewSale[] = [];
    let cursor: string | null = null;

    // Bounded: 20 pages x 100 = 2000 orders per sync, plenty for a catch-up
    // and a hard stop against a pathological cursor loop.
    for (let page = 0; page < 20; page++) {
      const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: OrderNode[] } } =
        await gql(creds, call, ORDERS_QUERY, { cursor, query: `created_at:>=${sinceIso}` });

      for (const o of data.orders.nodes) {
        const financial = (o.displayFinancialStatus ?? '').toUpperCase();
        const refund = toCents(o.totalRefundedSet?.shopMoney?.amount);

        const status: NewSale['status'] =
          financial === 'REFUNDED' || financial === 'PARTIALLY_REFUNDED'
            ? 'refunded'
            : financial === 'PAID'
              ? 'paid'
              : financial === 'VOIDED' || financial === 'EXPIRED'
                ? 'failed'
                : 'pending';

        const items = o.lineItems?.nodes ?? [];
        const first = items[0]?.title;
        const extra = items.length - 1;

        sales.push({
          platform: 'shopify',
          externalId: o.id,
          productName: first ? (extra > 0 ? `${first} +${extra} more` : first) : o.name,
          grossCents: toCents(o.currentTotalPriceSet?.shopMoney?.amount),
          refundCents: refund,
          currency: o.currentTotalPriceSet?.shopMoney?.currencyCode ?? 'USD',
          status,
          occurredAt: Date.parse(o.createdAt) || Date.now(),
          customerEmail: o.customer?.email ?? null,
        });
      }

      if (!data.orders.pageInfo.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
    }

    return { sales, message: `Shopify: ${sales.length} orders since ${sinceIso.slice(0, 10)}.` };
  },
};
