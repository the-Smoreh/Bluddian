'use client';

import { useEffect } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Registers the service worker that makes the app installable and offline-
 * capable. With no backend, the worker's only job is caching the app shell —
 * your data lives in IndexedDB and never passes through it.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Service workers (and WebAuthn) require a secure context. localhost counts.
    const secure =
      window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    if (!secure) return;

    const register = () => {
      navigator.serviceWorker
        .register(`${BASE}/sw.js`, { scope: `${BASE}/` })
        .catch((err) => console.warn('[sw] registration failed', err));
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
