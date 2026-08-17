# Security

This app holds your revenue history and the API keys to your money platforms.
This document says exactly what protects them and — just as importantly — what
doesn't.

## Threat model

Assumed: a single trusted user (you), on an internet-reachable server, facing
opportunistic internet-wide attackers rather than someone specifically targeting
you. Bots that scan for exposed dashboards, credential stuffing, and drive-by
CSRF are the realistic risks.

**Explicitly out of scope:** an attacker with filesystem access to the server, or
a compromised phone. Both of those end the game regardless of what this code does
— the encryption key lives in the environment on the same box as the database, so
root reads both.

---

## What protects the API keys

**Encrypted at rest.** Every stored credential is AES-256-GCM under
`APP_ENCRYPTION_KEY`, a 32-byte key from the environment. GCM is authenticated,
so a tampered or wrong-key blob fails loudly instead of decrypting to garbage.

**No read-back path.** There is no endpoint that returns a plaintext credential.
The only client-facing shape (`listCredentials()`) returns a 4-character hint and
cannot structurally contain a secret. Once a key is saved you can replace it or
delete it — you cannot retrieve it, and neither can anyone who takes over your
session.

**Import barrier.** `src/lib/credentials.ts` imports `server-only`, so any
attempt to pull it into a client component is a build failure rather than a
silent bundle leak.

**Never logged.** The audit log records *which field* changed, never any part of
a value. Upstream error bodies are truncated before surfacing, since they can
echo request data.

**Env beats database.** A credential supplied by environment variable wins over
one stored through the UI, so a platform-injected secret can't be silently
overridden by someone who reaches the settings screen.

## What protects the account

| Control | Detail |
|---|---|
| Password hashing | scrypt, N=2^15 (~32 MiB per hash), 16-byte random salt, constant-time compare |
| Session tokens | 32 random bytes; the database stores only a SHA-256, so a stolen sessions table can't be replayed |
| Cookies | `httpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix in production (no Domain attribute, so no subdomain can write one) |
| Two-factor | TOTP, ±1 step drift; the secret is only persisted after a valid code proves the authenticator stored it |
| Password change | Requires the current password, then invalidates every session |
| Setup | Closes permanently after one account; gated behind `SETUP_CODE` while open |
| User enumeration | An unknown email runs a dummy scrypt verify, so it costs the same time as a known one |

## What protects against abuse

**Rate limiting** is a token bucket persisted in SQLite — deliberately not
in-memory, because a memory bucket turns "restart the server" into a
brute-force reset button.

| Bucket | Budget | Rationale |
|---|---|---|
| Login | 8 / 15 min | Then ~2 min per further attempt |
| TOTP | 10 / 5 min | A 6-digit space needs its own hard ceiling |
| Setup | 5 / hour | First-run land-grab |
| Sync | 10 / 5 min | Each call costs real money upstream — this is the endpoint that could be turned into a billing attack |
| Writes | 60 / min | |
| Reads | 120 / min | |
| Webhooks | 120 / min | Higher; they're HMAC-verified anyway |

Buckets key on client IP. `TRUST_PROXY` is **off** by default: trusting
`X-Forwarded-For` unconditionally would let anyone mint a fresh bucket per
request by spoofing the header, defeating the limiter entirely. Turn it on only
when something you control is rewriting that header.

**CSRF** is double-submit plus origin checking. The session holds a secret that's
also set in a readable cookie; mutating requests must echo it in a header. A
cross-origin page can make the browser send your cookies but cannot read them to
set the header. `Sec-Fetch-Site` and `Origin` are checked too, which catches
plain cross-site form posts that never run JS.

**Request limits.** JSON bodies are capped at 256 KB, checked against both the
declared `Content-Length` and the actual byte count, since the header can lie or
be absent.

**Webhooks** verify an HMAC over the **raw** body before any parsing, compare in
constant time, and return 503 rather than accepting anything when no secret is
configured. The Whop verifier enforces a 5-minute timestamp window where the
signature format carries one, which makes captured requests unusable as replays.

**Outbound requests** go through one hardened path: HTTPS only, a host allowlist,
no redirect following (a 302 is the classic way out of an allowlist), a 15s
timeout, and a 5 MB response cap. The Shopify shop domain is validated against a
strict pattern before it's used as a request host.

## Browser-side

A nonce-based CSP is set per-request in middleware, with `strict-dynamic` for
scripts and **no** `unsafe-inline` for scripts. `connect-src` is `'self'` only —
the page never talks to a third party. Plus `frame-ancestors 'none'`, HSTS,
`nosniff`, `Referrer-Policy: no-referrer`, and a restrictive `Permissions-Policy`.

The service worker **never caches `/api/*`** or the auth pages. Caching
authenticated responses is a standard way for a PWA to leak data to whoever picks
up the phone next; page navigations are network-first so numbers are never stale.

The app is marked `noindex, nofollow`.

---

## Your responsibilities

1. **Use HTTPS.** Secure cookies and service workers both require it.
2. **Turn on two-factor.** It's in Settings and takes about thirty seconds.
3. **Back up the database file** — it's the only copy of your history.
4. **Keep `APP_ENCRYPTION_KEY` safe and unchanged.** Changing it makes stored keys
   unreadable.
5. **Scope your API keys** to read-only wherever the platform allows it. Nothing
   here needs write access to your stores.
6. **Rotate any key that was ever committed to git.** Deleting the commit is not
   enough — forks and caches keep it.

## Reporting

It's your app. If you find a problem in it, fix it or ask Claude to.
