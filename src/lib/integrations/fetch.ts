import 'server-only';

/**
 * Hardened outbound HTTP for third-party APIs.
 *
 * Every integration goes through this so we get, uniformly:
 *  - a hard timeout (a hung upstream must not pin a request forever)
 *  - a host allowlist (a compromised or misconfigured value can't be used to
 *    make this server hit arbitrary internal addresses — SSRF containment)
 *  - no redirect following (a 302 is a classic way to escape an allowlist)
 *  - bounded response size
 *  - errors that never echo the Authorization header back to a caller
 */

const ALLOWED_HOSTS = new Set([
  'api.anthropic.com',
  'api.whop.com',
  'api.shopify.com',
]);

/** Shopify shops are per-store subdomains, so they need a pattern, not a literal. */
const ALLOWED_PATTERNS = [/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i];

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024;

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

function assertAllowed(url: URL, provider: string) {
  if (url.protocol !== 'https:') {
    throw new UpstreamError('Refusing a non-HTTPS upstream request.', 0, provider);
  }
  const host = url.hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(host)) return;
  if (ALLOWED_PATTERNS.some((re) => re.test(host))) return;
  throw new UpstreamError(`Host not allowed: ${host}`, 0, provider);
}

export type ApiCall = {
  provider: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Retry on 429 / 5xx with backoff. */
  retries?: number;
};

export async function apiFetch<T = unknown>({
  provider,
  url,
  method = 'GET',
  headers = {},
  body,
  retries = 2,
}: ApiCall): Promise<T> {
  const target = new URL(url);
  assertAllowed(target, provider);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(target, {
        method,
        headers: {
          accept: 'application/json',
          'user-agent': 'Bluddian/1.0',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
        signal: controller.signal,
        cache: 'no-store',
      });

      if (res.status >= 300 && res.status < 400) {
        throw new UpstreamError('Upstream redirected; refusing to follow.', res.status, provider);
      }

      // Retry transient failures rather than surfacing them as hard errors.
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        const backoff = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000 + Math.random() * 400;
        await sleep(Math.min(backoff, 10_000));
        continue;
      }

      const text = await readBounded(res);

      if (!res.ok) {
        // Deliberately truncated: upstream error bodies can echo request data.
        throw new UpstreamError(
          `${provider} returned ${res.status}: ${text.slice(0, 300)}`,
          res.status,
          provider,
        );
      }

      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      lastError = err as Error;
      if (err instanceof UpstreamError && err.status !== 429 && err.status < 500) throw err;
      if (attempt >= retries) break;
      await sleep(2 ** attempt * 1000);
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError?.name === 'AbortError') {
    throw new UpstreamError(`${provider} timed out after ${TIMEOUT_MS / 1000}s.`, 504, provider);
  }
  throw lastError ?? new UpstreamError(`${provider} request failed.`, 502, provider);
}

async function readBounded(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error('Upstream response too large');

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new Error('Upstream response too large');
  return new TextDecoder().decode(buf);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
