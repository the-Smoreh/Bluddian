import { z } from 'zod';
import { audit } from '@/lib/auth';
import { evaluateAchievements } from '@/lib/game';
import { syncAnthropic, testAnthropic } from '@/lib/integrations/anthropic';
import { syncShopify, testShopify } from '@/lib/integrations/shopify';
import { syncWhop, testWhop } from '@/lib/integrations/whop';
import { isSyncRunning, runSync } from '@/lib/integrations/sync';
import { fail, guard, handler, json, readJson } from '@/lib/http';
import { LIMITS } from '@/lib/ratelimit';
import { reconcileGoals } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Syncs page through third-party APIs; give them room without hanging forever. */
export const maxDuration = 60;

const PROVIDERS = ['anthropic', 'whop', 'shopify'] as const;
type Provider = (typeof PROVIDERS)[number];

type Params = { params: Promise<{ provider: string }> };

const Body = z.object({
  action: z.enum(['sync', 'test']).default('sync'),
  days: z.number().int().min(1).max(365).optional(),
});

export const POST = handler<Params>(async (req, ctx) => {
  // The tight `sync` budget matters here: each call costs real money upstream
  // and this is the one endpoint that can be turned into a billing attack.
  const g = await guard(req, { limit: LIMITS.sync, bucket: 'sync' });
  if (!g.ok) return g.response;

  const { provider } = await ctx.params;
  if (!PROVIDERS.includes(provider as Provider)) {
    return fail(404, 'Unknown provider.');
  }
  const p = provider as Provider;

  const parsed = await readJson(req, Body);
  if (!parsed.ok) return parsed.response;
  const { action, days } = parsed.data;

  if (action === 'test') {
    const result =
      p === 'anthropic'
        ? await testAnthropic()
        : p === 'whop'
          ? await testWhop()
          : await testShopify();
    return json(result, { status: result.ok ? 200 : 400 });
  }

  if (isSyncRunning(p)) {
    return fail(409, `A ${p} sync is already running.`);
  }

  const result = await runSync(p, async () => {
    if (p === 'anthropic') return syncAnthropic(days ?? 30);
    if (p === 'whop') return syncWhop();
    return syncShopify(days ?? 90);
  });

  if (result.ok) {
    reconcileGoals();
    evaluateAchievements();
  }
  await audit(`sync.${p}`, result.message);

  return json(result, { status: result.ok ? 200 : 502 });
});
