/* eslint-disable no-restricted-globals */

/**
 * Bluddian service worker.
 *
 * This app has no backend, so the service worker's job is simple and total:
 * cache the entire app shell so it launches instantly and works with the radio
 * off. Every byte it caches is application code — your actual data never passes
 * through here, because it never goes over the network at all. It lives
 * encrypted in IndexedDB, which the Cache API cannot see.
 *
 * Strategy:
 *   - App shell + build output: cache-first, since Next fingerprints filenames.
 *   - Navigations: cache-first with a background refresh, so launching offline
 *     is indistinguishable from launching online.
 */

const VERSION = 'v2-local';
const CACHE = `bluddian-${VERSION}`;

// Rewritten by scripts/postbuild.mjs for sub-path deploys (GitHub Pages).
const BASE_PATH = '';

const PRECACHE = [
  '/',
  '/money/',
  '/build/',
  '/goals/',
  '/claude/',
  '/settings/',
  '/offline/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
].map((p) => `${BASE_PATH}${p}`);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is all-or-nothing; add individually so one 404 can't abort the
      // install and leave the app with no offline shell at all.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('bluddian-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(handle(request));
});

async function handle(request) {
  const cached = await caches.match(request, { ignoreSearch: true });

  if (cached) {
    // Serve instantly, then quietly refresh for next launch.
    void revalidate(request);
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // A navigation with nothing cached is the only real offline failure.
    if (request.mode === 'navigate') {
      const shell = await caches.match(`${BASE_PATH}/`);
      if (shell) return shell;
      const offline = await caches.match(`${BASE_PATH}/offline/`);
      if (offline) return offline;
    }
    return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
  }
}

async function revalidate(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response);
    }
  } catch {
    /* offline; the cached copy stands */
  }
}

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
