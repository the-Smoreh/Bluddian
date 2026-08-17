'use client';

import { readVaultData, writeVaultData } from '@/lib/local/vault';
import { normalise, type Database } from '@/lib/local/types';

/**
 * The in-memory database plus its persistence.
 *
 * Reads are synchronous against a plain object — every screen renders straight
 * from memory with no loading states and no waterfalls. Writes mutate a fresh
 * snapshot, notify React, then persist encrypted in the background, debounced
 * so a burst of edits produces one write instead of ten.
 *
 * React consumes this through useSyncExternalStore, so the snapshot identity
 * must change on every mutation — hence the copy-on-write in `update`.
 */

type Listener = () => void;

let dek: CryptoKey | null = null;
let state: Database | null = null;
let listeners = new Set<Listener>();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savePending = false;
let saveError: string | null = null;

const SAVE_DEBOUNCE_MS = 400;

// ------------------------------------------------------------- lifecycle --

/** Load and decrypt the database after a successful unlock. */
export async function openStore(key: CryptoKey): Promise<Database> {
  dek = key;
  const raw = await readVaultData<Partial<Database>>(key);
  state = normalise(raw);
  emit();
  return state;
}

/** Create a brand-new database for a fresh vault. */
export async function initStore(key: CryptoKey, initial: Database): Promise<Database> {
  dek = key;
  state = initial;
  await writeVaultData(key, state);
  emit();
  return state;
}

/** Drop the key and all decrypted data from memory. */
export function closeStore(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  dek = null;
  state = null;
  savePending = false;
  emit();
}

export function isOpen(): boolean {
  return state !== null && dek !== null;
}

// ---------------------------------------------------------------- access --

export function getState(): Database | null {
  return state;
}

/** Throws if called while locked — a programming error, not a user path. */
export function requireState(): Database {
  if (!state) throw new Error('Store is locked');
  return state;
}

// -------------------------------------------------------------- mutation --

/**
 * Apply a change. The recipe receives a shallow-cloned draft; replace the
 * arrays you touch rather than mutating them in place, so React sees new
 * references where it matters.
 */
export function update(recipe: (draft: Database) => void): Database {
  if (!state) throw new Error('Store is locked');

  const draft: Database = { ...state };
  recipe(draft);
  state = draft;

  emit();
  scheduleSave();
  return state;
}

function scheduleSave(): void {
  savePending = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
}

/** Force an immediate encrypted write. Used before locking or backgrounding. */
export async function flush(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dek || !state || !savePending) return;

  const snapshot = state;
  const key = dek;

  try {
    await writeVaultData(key, snapshot);
    savePending = false;
    saveError = null;
  } catch (err) {
    // Surfaced in the UI rather than swallowed: a failed write means data loss
    // on the next reload, which the user must know about immediately.
    saveError = err instanceof Error ? err.message : 'Could not save to device storage';
    console.error('[store] save failed', err);
  }
  emit();
}

export function hasUnsavedChanges(): boolean {
  return savePending;
}

export function getSaveError(): string | null {
  return saveError;
}

// ------------------------------------------------------------ reactivity --

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners = new Set(listeners).add(listener);
  return () => {
    const next = new Set(listeners);
    next.delete(listener);
    listeners = next;
  };
}

/** Snapshot for useSyncExternalStore. Identity changes on every mutation. */
export function getSnapshot(): Database | null {
  return state;
}

// -------------------------------------------------------------- backup ----

/**
 * Plaintext export for backup. Deliberately explicit: this leaves the vault
 * unencrypted, so the UI must say so plainly before handing over the file.
 */
export function exportJson(): string {
  const db = requireState();
  // Credentials are stripped — a backup file is the last place API keys should
  // be, and they're re-enterable in seconds.
  const { credentials, ...safe } = db;
  void credentials;
  return JSON.stringify({ ...safe, exportedAt: Date.now() }, null, 2);
}

export function importJson(json: string): { products: number; sales: number } {
  const parsed = JSON.parse(json) as Partial<Database>;
  const incoming = normalise(parsed);

  update((draft) => {
    // Keep whatever credentials are already configured on this device.
    draft.products = incoming.products;
    draft.sales = incoming.sales;
    draft.goals = incoming.goals;
    draft.usage = incoming.usage;
    draft.xpEvents = incoming.xpEvents;
    draft.achievements = incoming.achievements;
    draft.player = incoming.player;
    draft.quests = incoming.quests;
  });

  return { products: incoming.products.length, sales: incoming.sales.length };
}
