/* eslint-disable no-restricted-globals */

/**
 * Bluddian service worker.
 *
 * Caching strategy is chosen per resource type, and the rule that matters most
 * is the one about your data:
 *
 *   - Static build output (/_next/static, icons): cache-first. Content-hashed,
 *     so it can never go stale.
 *   - Navigations (HTML): network-first, falling back to a cached shell, then
 *     to /offline. You always see live numbers when you have signal.
 *   - API responses: NEVER cached. Revenue, credentials and session state are
 *     exactly the things that must not be served from a stale local copy, and
 *     caching authenticated responses is how a service worker leaks data.
 */

const VERSION = 'v1';
const STATIC_CACHE = `bluddian-static-${VERSION}`;
const PAGE_CACHE = `bluddian-pages-${VERSION}`;
const OFFLINE_URL = '/offline';

const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // Don't let one missing file block the whole install.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('bluddian-') && !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only ever handle our own origin.
  if (url.origin !== self.location.origin) return;

  // Hard rule: never cache API traffic or auth pages.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/login') ||
    url.pathname.startsWith('/setup')
  ) {
    return;
  }

  // Content-hashed build output: cache-first is safe and fast.
  if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Page navigations: always try the network so numbers are current.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response('Offline', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    });
  }
}

/** Lets a future update prompt the page to activate immediately. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
