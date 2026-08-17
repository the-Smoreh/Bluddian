import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Edge middleware. Deliberately does NOT touch the database — that keeps it on
 * the edge runtime and fast. Database-backed rate limiting happens per-route in
 * `guard()`; this layer handles transport security and a cheap auth redirect.
 */

const SESSION_COOKIES = ['__Host-bl_session', 'bl_session'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isDev = process.env.NODE_ENV !== 'production';

  // Per-response nonce. Next automatically stamps this onto its own inline
  // bootstrap scripts when it sees a nonce in the CSP, which is what lets us
  // avoid 'unsafe-inline' for scripts entirely.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = [
    `default-src 'self'`,
    // strict-dynamic: scripts loaded BY a nonced script inherit trust, which is
    // how Next's chunk loader works. Older browsers fall back to 'self'.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Inline styles are needed for Next's style injection and our CSS vars.
    // Style injection is a far weaker vector than script injection.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    // No third-party endpoints: this app only ever talks to its own server.
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    `manifest-src 'self'`,
    `worker-src 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  // Note: no IP header is derived here. Rate-limit identity is resolved in
  // clientIp(), which only reads forwarding headers when TRUST_PROXY=1 —
  // copying X-Forwarded-For into another header name would just launder a
  // spoofable value into one that looks trustworthy.

  const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));

  // Cheap gate only. The cookie's *validity* is checked server-side on render;
  // this just avoids flashing the app shell to someone with no cookie at all.
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/setup') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/offline') ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/icons/');

  let response: NextResponse;
  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    response = NextResponse.redirect(url);
  } else if (hasSession && (pathname === '/login' || pathname === '/setup')) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  if (!isDev) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next's own static output and the icon files, which
    // need no headers and would only add latency.
    '/((?!_next/static|_next/image|favicon.ico|icons/).*)',
  ],
};
