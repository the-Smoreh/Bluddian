'use client';

import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from '@/lib/local/store';
import type { Database } from '@/lib/local/types';

/**
 * Read the database inside a component. Re-renders whenever any mutation runs.
 *
 * The server snapshot is always null: this app has no server rendering of user
 * data — the vault is locked until the browser opens it, so there is nothing to
 * render on the server by definition.
 */
export function useDatabase(): Database | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/** Same, but for screens that only render behind the unlock gate. */
export function useDb(): Database {
  const db = useDatabase();
  if (!db) throw new Error('useDb called while the vault is locked');
  return db;
}
