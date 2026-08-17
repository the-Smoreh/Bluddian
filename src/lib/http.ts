import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { currentAuth, type Auth } from '@/lib/auth';
import { safeEqual } from '@/lib/crypto';
import { clientIp, consume, LIMITS, type Limit } from '@/lib/ratelimit';

/**
 * Shared plumbing for every API route: rate limiting, CSRF, auth, body size,
 * and error shaping. Routes should not hand-roll any of this.
 */

export const CSRF_COOKIE = 'bl_csrf';
export const CSRF_HEADER = 'x-bluddian-csrf';

const MAX_BODY_BYTES = 256 * 1024; // 256 KB — this app posts small JSON only

export function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

function tooMany(retryAfterSec: number) {
  return NextResponse.json(
    { error: 'Slow down — too many requests.', retryAfter: retryAfterSec },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  );
}

/**
 * Read and validate a JSON body, refusing anything oversized. We check the
 * declared Content-Length AND the actual byte count, since Content-Length can
 * lie or be absent on a chunked request.
 */
export async function readJson<T extends z.ZodTypeAny>(
  req: NextRequest,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) {
    return { ok: false, response: fail(413, 'Request body too large.') };
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, response: fail(400, 'Could not read request body.') };
  }

  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, response: fail(413, 'Request body too large.') };
  }

  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, response: fail(400, 'Malformed JSON.') };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.join('.') || 'body';
    return { ok: false, response: fail(422, `${where}: ${first?.message ?? 'invalid'}`) };
  }

  return { ok: true, data: result.data };
}

/**
 * CSRF: double-submit. The session row holds a secret that is also set in a
 * readable cookie; a mutating request must echo it in a header. An attacker on
 * another origin can cause the browser to send our cookies but cannot read
 * them to set the header, so the echo fails.
 *
 * We additionally require Origin/Sec-Fetch-Site to look same-origin, which
 * catches the case of a cross-site form post that never runs JS at all.
 */
function csrfOk(req: NextRequest, auth: Auth): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;

  const origin = req.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get('host')) return false;
    } catch {
      return false;
    }
  }

  const presented = req.headers.get(CSRF_HEADER);
  if (!presented) return false;
  return safeEqual(presented, auth.session.csrf_secret);
}

export type GuardOptions = {
  /** Which bucket to charge. Defaults to `read` for GET, `write` otherwise. */
  limit?: Limit;
  /** Bucket name suffix, so different routes don't share a budget. */
  bucket?: string;
  /** Set false for public routes (login, setup, webhooks). */
  auth?: boolean;
  /** Set false to skip CSRF (webhooks authenticate via HMAC instead). */
  csrf?: boolean;
};

export type Guarded = { auth: Auth | null; ip: string };

/**
 * Run every protection in the right order and either return the request
 * context or a ready-to-send rejection.
 *
 * Order matters: rate limit first so an unauthenticated flood is rejected as
 * cheaply as possible, then auth, then CSRF.
 */
export async function guard(
  req: NextRequest,
  options: GuardOptions = {},
): Promise<{ ok: true; ctx: Guarded } | { ok: false; response: NextResponse }> {
  const requireAuthed = options.auth !== false;
  const requireCsrf = options.csrf !== false && req.method !== 'GET' && req.method !== 'HEAD';
  const ip = clientIp(req.headers);

  const isRead = req.method === 'GET' || req.method === 'HEAD';
  const limit = options.limit ?? (isRead ? LIMITS.read : LIMITS.write);
  const bucketName = options.bucket ?? new URL(req.url).pathname;

  const rl = consume(`${bucketName}:${ip}`, limit);
  if (!rl.ok) return { ok: false, response: tooMany(rl.retryAfterSec) };

  let auth: Auth | null = null;
  if (requireAuthed || requireCsrf) {
    auth = await currentAuth();
  }

  if (requireAuthed && !auth) {
    return { ok: false, response: fail(401, 'Not signed in.') };
  }

  if (requireCsrf) {
    if (!auth || !csrfOk(req, auth)) {
      return { ok: false, response: fail(403, 'CSRF check failed. Refresh the page and retry.') };
    }
  }

  return { ok: true, ctx: { auth, ip } };
}

/**
 * Wrap a handler so an unexpected throw becomes a 500 without leaking internals.
 * `Ctx` carries the route's params for dynamic segments; static routes ignore it.
 */
export function handler<Ctx = unknown>(fn: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      // Full detail to the server log; a generic message to the client.
      console.error('[api]', req.method, req.nextUrl.pathname, err);
      return fail(500, 'Something went wrong on the server.');
    }
  };
}
