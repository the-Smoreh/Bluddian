import { db, now } from '@/lib/db';

/**
 * Token-bucket rate limiter backed by SQLite.
 *
 * Why not in-memory only? A memory bucket resets when the process restarts,
 * which turns "restart the server" into a brute-force reset button. Persisting
 * the bucket means a login budget survives crashes and deploys. The write cost
 * is a single indexed upsert, which SQLite handles comfortably at this scale.
 *
 * A bucket refills at `capacity / windowMs` tokens per ms. A request costs 1
 * token. Empty bucket => reject with a Retry-After derived from the refill rate.
 */

export type Limit = {
  /** Max burst — how many requests can land back-to-back. */
  capacity: number;
  /** Time to refill from empty to full, in ms. */
  windowMs: number;
};

export type LimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
};

/**
 * Tuned for a single-user app. Anything sharing this server is you, so these
 * are generous for normal use and still tight enough that an attacker gets
 * nowhere. Login is deliberately brutal.
 */
export const LIMITS = {
  /** Blanket per-IP ceiling applied in middleware to every request. */
  global: { capacity: 300, windowMs: 60_000 },
  /** Any mutating API call. */
  write: { capacity: 60, windowMs: 60_000 },
  /** Read-only API calls. */
  read: { capacity: 120, windowMs: 60_000 },
  /** Password attempts. 8 tries, then ~2 min per additional try. */
  login: { capacity: 8, windowMs: 900_000 },
  /** 2FA codes — a 6-digit space needs a hard ceiling. */
  totp: { capacity: 10, windowMs: 300_000 },
  /** First-run account creation. */
  setup: { capacity: 5, windowMs: 3_600_000 },
  /** Outbound-triggering endpoints: don't let a loop bill your API accounts. */
  sync: { capacity: 10, windowMs: 300_000 },
  /** Inbound webhooks — higher, they're HMAC-verified anyway. */
  webhook: { capacity: 120, windowMs: 60_000 },
} as const satisfies Record<string, Limit>;

const SELECT = 'SELECT tokens, updated_at FROM rate_limits WHERE bucket = ?';
const UPSERT = `INSERT INTO rate_limits (bucket, tokens, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(bucket) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at`;

/**
 * Consume one token from `key`. Returns whether the request may proceed.
 * Never throws — if the limiter itself fails we fail open rather than lock
 * the owner out of their own dashboard.
 */
export function consume(key: string, limit: Limit, cost = 1): LimitResult {
  const refillPerMs = limit.capacity / limit.windowMs;
  const t = now();

  try {
    const row = db.prepare(SELECT).get(key) as { tokens: number; updated_at: number } | undefined;

    let tokens = limit.capacity;
    if (row) {
      const elapsed = Math.max(0, t - row.updated_at);
      tokens = Math.min(limit.capacity, row.tokens + elapsed * refillPerMs);
    }

    if (tokens < cost) {
      const deficit = cost - tokens;
      return {
        ok: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil(deficit / refillPerMs / 1000)),
        limit: limit.capacity,
      };
    }

    tokens -= cost;
    db.prepare(UPSERT).run(key, tokens, t);
    return {
      ok: true,
      remaining: Math.floor(tokens),
      retryAfterSec: 0,
      limit: limit.capacity,
    };
  } catch {
    return { ok: true, remaining: limit.capacity, retryAfterSec: 0, limit: limit.capacity };
  }
}

/** Give a token back — used when an action turns out not to be billable. */
export function refund(key: string, limit: Limit, amount = 1): void {
  try {
    const row = db.prepare(SELECT).get(key) as { tokens: number } | undefined;
    if (!row) return;
    db.prepare(UPSERT).run(key, Math.min(limit.capacity, row.tokens + amount), now());
  } catch {
    /* best effort */
  }
}

/** Clear a bucket outright, e.g. after a successful login. */
export function reset(key: string): void {
  try {
    db.prepare('DELETE FROM rate_limits WHERE bucket = ?').run(key);
  } catch {
    /* best effort */
  }
}

/** Drop buckets untouched for a day so the table can't grow without bound. */
export function sweep(): void {
  try {
    db.prepare('DELETE FROM rate_limits WHERE updated_at < ?').run(now() - 86_400_000);
  } catch {
    /* best effort */
  }
}

/**
 * Client identity for rate-limit bucketing.
 *
 * Forwarding headers are consulted ONLY when TRUST_PROXY=1, because any client
 * can set them. Without a trusted proxy in front, every request must collapse
 * into a single shared bucket — that is strictly less convenient and strictly
 * more correct.
 *
 * The untrusted fallback is deliberately a constant, not a header value. An
 * earlier version fell back to a header that middleware populated from
 * X-Forwarded-For, which meant an attacker could mint a fresh bucket per
 * request just by rotating that header and bypass the limiter entirely. For a
 * single-user dashboard, one shared bucket is the right default: the only
 * legitimate traffic is you.
 */
export function clientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY !== '1') return 'shared';

  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    // Left-most entry is the original client when the chain is trustworthy.
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }

  const real = headers.get('x-real-ip');
  if (real) return real.trim();

  return 'shared';
}
