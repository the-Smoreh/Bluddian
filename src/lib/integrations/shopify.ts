import 'server-only';
import { getCredential, providerConfigured } from '@/lib/credentials';
import { apiFetch, UpstreamError } from '@/lib/integrations/fetch';
import { toCents, upsertProduct, upsertSale } from '@/lib/integrations/upsert';
import type { SyncResult } from '@/lib/integrations/sync';

/**
 * Shopify Admin GraphQL API.
 *
 * GraphQL rather than REST on purpose: cursor pagination lives in the response
 * body, so it works with our JSON-only hardened fetch (REST paginates via the
 * Link header, which we intentionally don't expose).
 */

const API_VERSION = '2025-01';

function shopDomain(): string {
  const raw = getCredential('shopify', 'shop_domain');
  if (!raw) throw new UpstreamError('Shopify shop domain not configured.', 0, 'shopify');

  // Accept a full URL or a bare domain, then validate hard — this string ends
  // up as the request host, so it must not be attacker-shaped.
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) {
    throw new UpstreamError(
      `Invalid shop domain "${host}". It must look like yourstore.myshopify.com`,
      0,
      'shopify',
    );
  }
  return host;
}

function headers(): Record<string, string> {
  const token = getCredential('shopify', 'admin_token');
  if (!token) throw new UpstreamError('Shopify admin token not configured.', 0, 'shopify');
  return { 'X-Shopify-Access-Token': token };
}

type GqlResponse<T> = { data?: T; errors?: Array<{ message: string }> };

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await apiFetch<GqlResponse<T>>({
    provider: 'shopify',
    url: `https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`,
    method: 'POST',
    headers: headers(),
    body: { query, variables },
  });

  if (res.errors?.length) {
    throw new UpstreamError(`Shopify: ${res.errors.map((e) => e.message).join('; ')}`, 400, 'shopify');
  }
  if (!res.data) throw new UpstreamError('Shopify returned no data.', 502, 'shopify');
  return res.data;
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
        customer { id email displayName }
        lineItems(first: 5) {
          nodes { title product { id } }
        }
      }
    }
  }`;

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 100, after: $cursor, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        status
        onlineStoreUrl
        priceRangeV2 { minVariantPrice { amount currencyCode } }
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
  customer?: { id?: string; email?: string; displayName?: string } | null;
  lineItems?: { nodes?: Array<{ title?: string; product?: { id?: string } | null }> };
};

type ProductNode = {
  id: string;
  title: string;
  status: string;
  onlineStoreUrl: string | null;
  priceRangeV2?: { minVariantPrice?: { amount?: string; currencyCode?: string } };
};

export async function syncShopify(days = 90): Promise<SyncResult> {
  if (!providerConfigured('shopify')) {
    throw new Error('Shopify is not connected. Add your shop domain and admin token in Settings.');
  }

  // ---- products ----------------------------------------------------------
  let productCount = 0;
  let cursor: string | null = null;

  for (let page = 0; page < 10; page++) {
    const data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: ProductNode[] } } =
      await gql(PRODUCTS_QUERY, { cursor });

    for (const p of data.products.nodes) {
      upsertProduct({
        platform: 'shopify',
        externalId: p.id,
        name: p.title,
        kind: 'product',
        priceCents: toCents(p.priceRangeV2?.minVariantPrice?.amount),
        currency: p.priceRangeV2?.minVariantPrice?.currencyCode ?? 'USD',
        url: p.onlineStoreUrl,
        status: p.status === 'ACTIVE' ? 'live' : p.status === 'ARCHIVED' ? 'archived' : 'building',
      });
      productCount++;
    }

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  // ---- orders ------------------------------------------------------------
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  let orderCount = 0;
  cursor = null;

  for (let page = 0; page < 20; page++) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: OrderNode[] } } =
      await gql(ORDERS_QUERY, { cursor, query: `created_at:>=${since}` });

    for (const o of data.orders.nodes) {
      const financial = (o.displayFinancialStatus ?? '').toUpperCase();
      const refunded = toCents(o.totalRefundedSet?.shopMoney?.amount);

      const status: 'paid' | 'pending' | 'refunded' | 'failed' =
        financial === 'REFUNDED' || financial === 'PARTIALLY_REFUNDED'
          ? 'refunded'
          : financial === 'PAID'
            ? 'paid'
            : financial === 'VOIDED' || financial === 'EXPIRED'
              ? 'failed'
              : 'pending';

      const first = o.lineItems?.nodes?.[0];
      const extra = (o.lineItems?.nodes?.length ?? 0) - 1;

      upsertSale({
        platform: 'shopify',
        externalId: o.id,
        productExternalId: first?.product?.id ?? null,
        productName: first?.title
          ? extra > 0
            ? `${first.title} +${extra} more`
            : first.title
          : o.name,
        grossCents: toCents(o.currentTotalPriceSet?.shopMoney?.amount),
        refundCents: refunded,
        currency: o.currentTotalPriceSet?.shopMoney?.currencyCode ?? 'USD',
        status,
        occurredAt: Date.parse(o.createdAt) || Date.now(),
        customerExternalId: o.customer?.id ?? null,
        customerEmail: o.customer?.email ?? null,
        customerName: o.customer?.displayName ?? null,
      });
      orderCount++;
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  return {
    items: orderCount + productCount,
    message: `Shopify: ${orderCount} orders, ${productCount} products.`,
  };
}

export async function testShopify(): Promise<{ ok: boolean; message: string }> {
  try {
    const data = await gql<{ shop: { name: string } }>('{ shop { name } }');
    return { ok: true, message: `Connected to ${data.shop.name}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Failed' };
  }
}
