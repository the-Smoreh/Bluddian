import { z } from 'zod';
import { ensureQuests, getPlayer, levelInfo, progressQuest } from '@/lib/game';
import { fail, guard, handler, json, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const player = getPlayer();
  return json({ quests: ensureQuests(), player, level: levelInfo(player.xp) });
});

const PatchBody = z.object({
  id: z.string().uuid(),
  delta: z.number().int().min(-10).max(10).default(1),
});

export const PATCH = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const parsed = await readJson(req, PatchBody);
  if (!parsed.ok) return parsed.response;

  const result = progressQuest(parsed.data.id, parsed.data.delta);
  if (!result) return fail(404, 'Quest not found.');

  const player = getPlayer();
  return json({
    ok: true,
    quest: result.quest,
    awarded: result.awarded,
    player,
    level: levelInfo(player.xp),
  });
});
