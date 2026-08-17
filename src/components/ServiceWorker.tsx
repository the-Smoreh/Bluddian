'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker that makes this installable and offline-capable.
 * Kept as its own client component so the root layout stays a server component.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      // Service workers require a secure context; skip quietly on plain HTTP.
      return;
    }

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        console.warn('[sw] registration failed', err);
      });
    };

    // Wait for idle so registration never competes with first paint.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
