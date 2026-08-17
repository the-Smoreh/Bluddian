import 'server-only';
import { db, newId, now } from '@/lib/db';
import { getCredential, providerConfigured } from '@/lib/credentials';
import { apiFetch, UpstreamError } from '@/lib/integrations/fetch';
import type { SyncResult } from '@/lib/integrations/sync';

/**
 * Anthropic Admin API — usage and cost reporting.
 *
 * Requires an *Admin* key (sk-ant-admin...), which is separate from a regular
 * API key. Only org owners can mint one. If you don't have one, the Claude tab
 * still works via manual entry; this just automates it.
 *
 * Two endpoints are used:
 *   /v1/organizations/usage_report/messages  -> token counts per model
 *   /v1/organizations/cost_report            -> authoritative USD amounts
 *
 * We prefer the cost report for money and the usage report for tokens, because
 * deriving cost from tokens requires a pricing table that goes stale.
 */

const BASE = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

type UsageBucket = {
  starting_at?: string;
  ending_at?: string;
  results?: Array<Record<string, unknown>>;
};

type Paged<T> = { data?: T[]; has_more?: boolean; next_page?: string | null };

function headers(): Record<string, string> {
  const key = getCredential('anthropic', 'admin_api_key');
  if (!key) throw new UpstreamError('Anthropic admin key not configured.', 0, 'anthropic');
  return { 'x-api-key': key, 'anthropic-version': API_VERSION };
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v ? v : fallback;
}

/** Walk `next_page` cursors, with a hard cap so a bad cursor can't loop forever. */
async function fetchAllPages(path: string, params: URLSearchParams): Promise<UsageBucket[]> {
  const out: UsageBucket[] = [];
  let page: string | null = null;

  for (let i = 0; i < 20; i++) {
    const qs = new URLSearchParams(params);
    if (page) qs.set('page', page);

    const res: Paged<UsageBucket> = await apiFetch({
      provider: 'anthropic',
      url: `${BASE}${path}?${qs.toString()}`,
      headers: headers(),
    });

    out.push(...(res.data ?? []));
    if (!res.has_more || !res.next_page) break;
    page = res.next_page;
  }
  return out;
}

/**
 * Pull the last `days` days of usage + cost and upsert one row per
 * (day, model, workspace). Re-running is safe — rows are replaced, not added.
 */
export async function syncAnthropic(days = 30): Promise<SyncResult> {
  if (!providerConfigured('anthropic')) {
    throw new Error('Anthropic is not connected. Add an admin API key in Settings.');
  }

  const startsAt = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  // ---- tokens, grouped by model -----------------------------------------
  const usageParams = new URLSearchParams({
    starting_at: `${startsAt}T00:00:00Z`,
    bucket_width: '1d',
    limit: '31',
  });
  usageParams.append('group_by[]', 'model');

  const usageBuckets = await fetchAllPages('/v1/organizations/usage_report/messages', usageParams);

  type Agg = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  };
  const byKey = new Map<string, Agg>();

  const bump = (day: string, model: string, patch: Partial<Agg>) => {
    const key = `${day}|${model}`;
    const cur = byKey.get(key) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    byKey.set(key, {
      input: cur.input + (patch.input ?? 0),
      output: cur.output + (patch.output ?? 0),
      cacheRead: cur.cacheRead + (patch.cacheRead ?? 0),
      cacheWrite: cur.cacheWrite + (patch.cacheWrite ?? 0),
      cost: cur.cost + (patch.cost ?? 0),
    });
  };

  for (const bucket of usageBuckets) {
    const day = str(bucket.starting_at).slice(0, 10);
    if (!day) continue;

    for (const row of bucket.results ?? []) {
      const model = str(row.model, 'unknown');

      // Cache-creation tokens are reported either flat or nested by TTL,
      // depending on the account. Handle both rather than guessing.
      const creation = row.cache_creation as Record<string, unknown> | undefined;
      const cacheWrite =
        num(row.cache_creation_input_tokens) +
        (creation
          ? Object.values(creation).reduce<number>((sum, v) => sum + num(v), 0)
          : 0);

      bump(day, model, {
        input: num(row.uncached_input_tokens) + num(row.input_tokens),
        output: num(row.output_tokens),
        cacheRead: num(row.cache_read_input_tokens),
        cacheWrite,
      });
    }
  }

  // ---- money, from the authoritative cost report -------------------------
  // The cost report groups by workspace/description rather than model, so its
  // totals are applied per-day and attributed to the day's dominant model.
  const costByDay = new Map<string, number>();
  try {
    const costParams = new URLSearchParams({
      starting_at: `${startsAt}T00:00:00Z`,
      bucket_width: '1d',
      limit: '31',
    });
    const costBuckets = await fetchAllPages('/v1/organizations/cost_report', costParams);

    for (const bucket of costBuckets) {
      const day = str(bucket.starting_at).slice(0, 10);
      if (!day) continue;
      for (const row of bucket.results ?? []) {
        // `amount` is a decimal string of the currency's major unit.
        const amount = num(row.amount);
        costByDay.set(day, (costByDay.get(day) ?? 0) + Math.round(amount * 100));
      }
    }
  } catch (err) {
    // Cost reporting can be unavailable on some plans. Tokens are still useful.
    console.warn('[anthropic] cost report unavailable:', (err as Error).message);
  }

  // Spread each day's cost across that day's models in proportion to tokens.
  const dayTotals = new Map<string, number>();
  for (const [key, agg] of byKey) {
    const day = key.split('|')[0];
    const weight = agg.input + agg.output + agg.cacheRead * 0.1 + agg.cacheWrite * 1.25;
    dayTotals.set(day, (dayTotals.get(day) ?? 0) + weight);
  }

  const upsert = db.prepare(
    `INSERT INTO claude_usage
       (id, day, model, workspace, input_tokens, output_tokens, cache_read, cache_write, cost_cents, source, created_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 'admin_api', ?)
     ON CONFLICT(day, model, workspace, source) DO UPDATE SET
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       cache_read = excluded.cache_read,
       cache_write = excluded.cache_write,
       cost_cents = excluded.cost_cents`,
  );

  let written = 0;
  const tx = db.transaction(() => {
    for (const [key, agg] of byKey) {
      const [day, model] = key.split('|');
      const dayCost = costByDay.get(day) ?? 0;
      const dayWeight = dayTotals.get(day) ?? 0;
      const weight = agg.input + agg.output + agg.cacheRead * 0.1 + agg.cacheWrite * 1.25;
      const cost = dayWeight > 0 ? Math.round(dayCost * (weight / dayWeight)) : 0;

      upsert.run(
        newId(),
        day,
        model,
        agg.input,
        agg.output,
        agg.cacheRead,
        agg.cacheWrite,
        cost,
        now(),
      );
      written++;
    }
  });
  tx();

  const totalCost = [...costByDay.values()].reduce((a, b) => a + b, 0);
  return {
    items: written,
    message: `Synced ${written} usage rows across ${dayTotals.size} days${
      totalCost > 0 ? ` ($${(totalCost / 100).toFixed(2)} total)` : ' (cost report unavailable)'
    }.`,
  };
}

/** Verify the stored key works, without writing anything. */
export async function testAnthropic(): Promise<{ ok: boolean; message: string }> {
  try {
    const params = new URLSearchParams({
      starting_at: `${new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`,
      bucket_width: '1d',
      limit: '1',
    });
    await apiFetch({
      provider: 'anthropic',
      url: `${BASE}/v1/organizations/usage_report/messages?${params}`,
      headers: headers(),
      retries: 0,
    });
    return { ok: true, message: 'Anthropic admin key works.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Failed' };
  }
}
