import { z } from 'zod';
import { audit, destroyAllSessions } from '@/lib/auth';
import { db, now } from '@/lib/db';
import { encrypt, newTotpSecret, totpUri, tryDecrypt, verifyPassword, verifyTotp } from '@/lib/crypto';
import { fail, guard, handler, json, readJson } from '@/lib/http';
import { LIMITS } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('begin') }),
  z.object({ action: z.literal('confirm'), secret: z.string().min(16).max(64), code: z.string().max(10) }),
  z.object({ action: z.literal('disable'), password: z.string().min(1).max(200) }),
]);

/**
 * TOTP enrolment.
 *
 * The candidate secret is handed to the client once, held only in that form's
 * state, and is not written to the database until a valid code proves the
 * authenticator actually stored it. That avoids the classic failure where 2FA
 * is switched on against a secret the user never scanned.
 */
export const POST = handler(async (req) => {
  const g = await guard(req, { limit: LIMITS.totp, bucket: 'totp-manage' });
  if (!g.ok) return g.response;

  const user = g.ctx.auth!.user;
  const parsed = await readJson(req, Body);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.action === 'begin') {
    if (user.totp_enabled) return fail(409, 'Two-factor is already on.');
    const secret = newTotpSecret();
    return json({ secret, uri: totpUri(secret, user.email) });
  }

  if (body.action === 'confirm') {
    if (!verifyTotp(body.secret, body.code)) {
      return fail(400, 'That code did not match. Check your authenticator and try again.');
    }
    db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1, updated_at = ? WHERE id = ?').run(
      encrypt(body.secret),
      now(),
      user.id,
    );
    await audit('totp.enabled');
    return json({ ok: true, enabled: true });
  }

  // disable — re-authenticate with the password, since this weakens the account
  if (!verifyPassword(body.password, user.password_hash)) {
    await audit('totp.disable_failed');
    return fail(401, 'Wrong password.');
  }

  db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, updated_at = ? WHERE id = ?').run(
    now(),
    user.id,
  );
  await audit('totp.disabled');
  return json({ ok: true, enabled: false });
});

const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12, 'Use at least 12 characters.').max(200),
});

/** Change password. Invalidates every other session as a side effect. */
export const PATCH = handler(async (req) => {
  const g = await guard(req, { limit: LIMITS.login, bucket: 'password-change' });
  if (!g.ok) return g.response;

  const user = g.ctx.auth!.user;
  const parsed = await readJson(req, PasswordBody);
  if (!parsed.ok) return parsed.response;

  if (!verifyPassword(parsed.data.currentPassword, user.password_hash)) {
    await audit('password.change_failed');
    return fail(401, 'Wrong current password.');
  }

  const { hashPassword } = await import('@/lib/crypto');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(parsed.data.newPassword),
    now(),
    user.id,
  );

  // Anyone who had a session from the old password is now signed out.
  destroyAllSessions(user.id);
  await audit('password.changed');

  return json({ ok: true, message: 'Password changed. Sign in again.' });
});

/** Decrypt-check used by the settings page to show 2FA state. */
export const GET = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;
  const user = g.ctx.auth!.user;
  const healthy = user.totp_enabled ? Boolean(user.totp_secret && tryDecrypt(user.totp_secret)) : true;
  return json({ enabled: Boolean(user.totp_enabled), healthy });
});
