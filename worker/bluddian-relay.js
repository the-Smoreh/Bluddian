/**
 * Bluddian relay — a Cloudflare Worker.
 *
 * WHY THIS EXISTS
 * Shopify's and Whop's APIs are server-only: they deliberately send no CORS
 * headers, so a browser refuses to hand their responses to page JavaScript.
 * This worker is the smallest possible thing that unblocks that — it forwards
 * one request and adds the CORS header the browser is waiting for.
 *
 * WHAT IT DOES NOT DO — by design:
 *   - No storage. No KV, no D1, no cache. Nothing is retained between requests.
 *   - No logging of credentials, request bodies, or responses.
 *   - No open proxying. It only reaches an allowlisted set of hosts, and only
 *     for callers holding your shared secret.
 *
 * Your API keys stay encrypted on your phone. They pass through this worker in
 * transit, over HTTPS, the same way they would pass through any backend you ran
 * yourself — which is exactly what this is, minus the server.
 *
 * DEPLOY: dash.cloudflare.com → Workers & Pages → Create → paste this →
 *         add a Secret named RELAY_TOKEN → Deploy.
 */

const ALLOWED_HOSTS = [
  /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i, // Shopify Admin API (per-store)
  /^api\.whop\.com$/i, // Whop
];

const ALLOWED_METHODS = new Set(['GET', 'POST']);

// Requests are small JSON; anything larger is not something we forward.
const MAX_BODY_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Send a POST.' }, 405, origin);
    }

    // ---- caller authentication ------------------------------------------
    // Without this the worker would be an open proxy that anyone could point
    // at any allowlisted host. The token makes it yours alone.
    const expected = env.RELAY_TOKEN;
    if (!expected) {
      return json({ error: 'Relay is missing its RELAY_TOKEN secret.' }, 503, origin);
    }
    if (!timingSafeEqual(request.headers.get('X-Relay-Token') ?? '', expected)) {
      return json({ error: 'Bad relay token.' }, 401, origin);
    }

    // ---- parse the instruction ------------------------------------------
    let spec;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) {
        return json({ error: 'Request too large.' }, 413, origin);
      }
      spec = JSON.parse(raw);
    } catch {
      return json({ error: 'Malformed JSON.' }, 400, origin);
    }

    const { url, method = 'GET', headers = {}, body } = spec ?? {};
    if (typeof url !== 'string') {
      return json({ error: 'Missing "url".' }, 400, origin);
    }

    let target;
    try {
      target = new URL(url);
    } catch {
      return json({ error: 'Invalid "url".' }, 400, origin);
    }

    if (target.protocol !== 'https:') {
      return json({ error: 'HTTPS only.' }, 400, origin);
    }
    if (!ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
      // The allowlist is what stops this being usable to attack anything else.
      return json({ error: `Host not allowed: ${target.hostname}` }, 403, origin);
    }
    if (!ALLOWED_METHODS.has(method)) {
      return json({ error: `Method not allowed: ${method}` }, 405, origin);
    }

    // ---- forward ---------------------------------------------------------
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const upstream = await fetch(target, {
        method,
        headers: {
          accept: 'application/json',
          'user-agent': 'Bluddian-Relay/1',
          ...pickForwardableHeaders(headers),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'manual',
      });

      const text = await upstream.text();

      return new Response(
        JSON.stringify({
          status: upstream.status,
          ok: upstream.ok,
          // Passed through as text; the app parses it. Keeps the worker
          // ignorant of every platform's payload shape.
          body: text,
        }),
        { status: 200, headers: { 'content-type': 'application/json', ...corsHeaders(origin) } },
      );
    } catch (err) {
      const timedOut = err?.name === 'AbortError';
      return json(
        { error: timedOut ? 'Upstream timed out.' : 'Upstream request failed.' },
        timedOut ? 504 : 502,
        origin,
      );
    } finally {
      clearTimeout(timer);
    }
  },
};

/** Only forward auth/content headers — never cookies or forwarding headers. */
function pickForwardableHeaders(headers) {
  const allowed = [
    'authorization',
    'x-shopify-access-token',
    'x-api-key',
    'anthropic-version',
    'content-type',
  ];
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (allowed.includes(key.toLowerCase()) && typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Relay-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(payload, status, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  });
}

/** Constant-time compare so the token can't be recovered by timing. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
