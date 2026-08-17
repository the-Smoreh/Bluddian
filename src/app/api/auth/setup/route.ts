import { cookies } from 'next/headers';
import { z } from 'zod';
import { audit, createSession, createUser, needsSetup, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth';
import { hashPassword, safeEqual } from '@/lib/crypto';
import { CSRF_COOKIE, fail, guard, handler, json, readJson } from '@/lib/http';
import { LIMITS } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  email: z.string().email().max(200),
  password: z
    .string()
    .min(12, 'Use at least 12 characters — this guards your revenue data.')
    .max(200),
  displayName: z.string().min(1).max(60).default('Founder'),
  setupCode: z.string().max(200).optional(),
});

/**
 * First-run account creation. Closes permanently once one user exists.
 *
 * If the deploy is internet-reachable there is a land-grab risk between deploy
 * and first login, so SETUP_CODE (when set) must be presented here.
 */
export const POST = handler(async (req) => {
  const g = await guard(req, { auth: false, csrf: false, limit: LIMITS.setup, bucket: 'setup' });
  if (!g.ok) return g.response;

  if (!needsSetup()) {
    return fail(409, 'This dashboard already has an owner. Sign in instead.');
  }

  const parsed = await readJson(req, Body);
  if (!parsed.ok) return parsed.response;
  const { email, password, displayName, setupCode } = parsed.data;

  const required = process.env.SETUP_CODE;
  if (required && (!setupCode || !safeEqual(setupCode, required))) {
    await audit('setup.rejected', 'bad setup code');
    return fail(403, 'Invalid setup code.');
  }

  const user = createUser(email, hashPassword(password), displayName);
  const { token, csrf } = createSession(
    user.id,
    g.ctx.ip,
    req.headers.get('user-agent') || 'unknown',
  );

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions);
  jar.set(CSRF_COOKIE, csrf, { ...sessionCookieOptions, httpOnly: false });

  await audit('setup.completed', email);
  return json({ ok: true, user: { email: user.email, displayName: user.display_name } });
});
