import { cookies } from 'next/headers';
import { z } from 'zod';
import {
  audit,
  createSession,
  findUserByEmail,
  sessionCookieOptions,
  SESSION_COOKIE,
} from '@/lib/auth';
import { hashPassword, tryDecrypt, verifyPassword, verifyTotp } from '@/lib/crypto';
import { CSRF_COOKIE, fail, guard, handler, json, readJson } from '@/lib/http';
import { consume, LIMITS, reset } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
  code: z.string().max(10).optional(),
});

// A pre-computed hash to verify against when the account doesn't exist, so an
// unknown email costs the same time as a known one and can't be enumerated.
const DUMMY_HASH = hashPassword('bluddian-timing-equaliser');

export const POST = handler(async (req) => {
  const g = await guard(req, { auth: false, csrf: false, limit: LIMITS.login, bucket: 'login' });
  if (!g.ok) return g.response;

  const parsed = await readJson(req, Body);
  if (!parsed.ok) return parsed.response;
  const { email, password, code } = parsed.data;

  const user = findUserByEmail(email);

  // Always run a verification, even with no user, to equalise timing.
  const passwordOk = user
    ? verifyPassword(password, user.password_hash)
    : (verifyPassword(password, DUMMY_HASH), false);

  if (!user || !passwordOk) {
    await audit('login.failed', email);
    return fail(401, 'Wrong email or password.');
  }

  // ---- second factor -----------------------------------------------------
  if (user.totp_enabled && user.totp_secret) {
    if (!code) {
      // Not an error — the client shows the code field and posts again.
      return json({ needsTotp: true }, { status: 200 });
    }

    // Charge a separate, tighter budget: a 6-digit space needs its own ceiling.
    const totpLimit = consume(`totp:${email}`, LIMITS.totp);
    if (!totpLimit.ok) {
      return fail(429, 'Too many codes. Wait a minute.', { retryAfter: totpLimit.retryAfterSec });
    }

    const secret = tryDecrypt(user.totp_secret);
    if (!secret || !verifyTotp(secret, code)) {
      await audit('login.totp_failed', email);
      return fail(401, 'That code is wrong or expired.');
    }
    reset(`totp:${email}`);
  }

  // ---- success -----------------------------------------------------------
  const { token, csrf } = createSession(
    user.id,
    g.ctx.ip,
    req.headers.get('user-agent') || 'unknown',
  );

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions);
  jar.set(CSRF_COOKIE, csrf, { ...sessionCookieOptions, httpOnly: false });

  // Clear the brute-force budget so normal use never hits the wall.
  reset(`login:${g.ctx.ip}`);
  await audit('login.success', email);

  return json({ ok: true, user: { email: user.email, displayName: user.display_name } });
});
