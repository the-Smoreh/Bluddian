import 'server-only';
import { db, newId, now } from '@/lib/db';

/** Bookkeeping around every sync so the UI can show what happened and when. */

export type SyncResult = { items: number; message: string };

export async function runSync(
  provider: string,
  fn: () => Promise<SyncResult>,
): Promise<{ ok: boolean; items: number; message: string }> {
  const id = newId();
  db.prepare(
    `INSERT INTO sync_runs (id, provider, status, started_at) VALUES (?, ?, 'running', ?)`,
  ).run(id, provider, now());

  try {
    const result = await fn();
    db.prepare(
      `UPDATE sync_runs SET status = 'ok', message = ?, items = ?, finished_at = ? WHERE id = ?`,
    ).run(result.message.slice(0, 500), result.items, now(), id);
    return { ok: true, items: result.items, message: result.message };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    db.prepare(
      `UPDATE sync_runs SET status = 'error', message = ?, finished_at = ? WHERE id = ?`,
    ).run(message.slice(0, 500), now(), id);
    console.error(`[sync:${provider}]`, err);
    return { ok: false, items: 0, message };
  }
}

/** Prevent two syncs of the same provider overlapping and double-inserting. */
export function isSyncRunning(provider: string): boolean {
  const row = db
    .prepare(
      `SELECT started_at FROM sync_runs WHERE provider = ? AND status = 'running'
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(provider) as { started_at: number } | undefined;
  if (!row) return false;

  // A run older than 5 minutes is assumed dead (process restarted mid-sync).
  if (now() - row.started_at > 300_000) {
    db.prepare(
      `UPDATE sync_runs SET status = 'error', message = 'Timed out', finished_at = ?
       WHERE provider = ? AND status = 'running'`,
    ).run(now(), provider);
    return false;
  }
  return true;
}
