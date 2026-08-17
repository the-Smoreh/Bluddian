import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { db, newId, now } from '@/lib/db';
import { randomToken, sha256 } from '@/lib/crypto';

/**
 * Session handling. The cookie holds a random 32-byte token; the database
 * stores only its SHA-256. Verification hashes the presented token and looks
 * up the digest, so the sessions table is useless to anyone who steals it.
 */

// __Host- forbids a Domain attribute and requires Secure + Path=/, which stops
// a subdomain from writing a session cookie for us. Only usable over HTTPS,
// so plain-HTTP local dev falls back to an unprefixed name.
const SECURE = process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1';
export const SESSION_COOKIE = SECURE ? '__Host-bl_session' : 'bl_session';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SLIDING_REFRESH_MS = 24 * 60 * 60 * 1000; // extend at most once a day

export type User = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: number;
  recovery_codes: string | null;
  created_at: number;
  updated_at: number;
};

export type Session = {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_secret: string;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
};

// ------------------------------------------------------------------ users --

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

/** True until the very first account is created. Gates the /setup route. */
export function needsSetup(): boolean {
  return userCount() === 0;
}

export function findUserByEmail(email: string): User | null {
  return (db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.trim().toLowerCase()) as User) ?? null;
}

export function findUserById(id: string): User | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User) ?? null;
}

export function createUser(email: string, passwordHash: string, displayName: string): User {
  const t = now();
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, totp_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, email.trim().toLowerCase(), displayName, passwordHash, t, t);
  return findUserById(id)!;
}

// --------------------------------------------------------------- sessions --

export type NewSession = { token: string; csrf: string; session: Session };

export function createSession(userId: string, ip: string, userAgent: string): NewSession {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const t = now();
  const id = newId();

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_secret, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, sha256(token), csrf, ip, userAgent.slice(0, 300), t, t, t + SESSION_TTL_MS);

  return { token, csrf, session: db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session };
}

export function lookupSession(token: string): Session | null {
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token)) as
    | Session
    | undefined;
  if (!row) return null;

  if (row.expires_at <= now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return null;
  }

  // Sliding expiry, but only written once a day to keep reads cheap.
  const t = now();
  if (t - row.last_seen_at > SLIDING_REFRESH_MS) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(
      t,
      t + SESSION_TTL_MS,
      row.id,
    );
  }
  return row;
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyAllSessions(userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions(): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
}

// ----------------------------------------------------------- request auth --

export type Auth = { user: User; session: Session };

/**
 * Resolve the current request's user. `cache` dedupes this across all the
 * server components in a single render, so a page with six auth-aware
 * sections still performs one lookup.
 */
export const currentAuth = cache(async (): Promise<Auth | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = lookupSession(token);
  if (!session) return null;

  const user = findUserById(session.user_id);
  if (!user) return null;

  return { user, session };
});

/** For server components that must not render for a signed-out visitor. */
export async function requireAuth(): Promise<Auth> {
  const auth = await currentAuth();
  if (!auth) {
    const { redirect } = await import('next/navigation');
    redirect('/login');
  }
  return auth!;
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
};

// ------------------------------------------------------------- audit log --

export async function audit(action: string, detail = ''): Promise<void> {
  try {
    const h = await headers();
    const { clientIp } = await import('@/lib/ratelimit');
    db.prepare(
      'INSERT INTO audit_log (id, action, detail, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(newId(), action, detail.slice(0, 500), clientIp(h), (h.get('user-agent') || '').slice(0, 300), now());
  } catch {
    /* auditing must never break the request it is describing */
  }
}
