import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Single SQLite connection, created once per process. In dev, Next's hot
 * reload re-evaluates modules, so we stash the handle on globalThis to avoid
 * opening a new file handle (and re-running migrations) on every edit.
 */

const globalForDb = globalThis as unknown as { __bluddianDb?: Database.Database };

function open(): Database.Database {
  const file = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'bluddian.db');
  mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  // The schema is written to be idempotent (CREATE TABLE IF NOT EXISTS), so
  // replaying it on every boot is safe and keeps deploys a single step.
  const schemaPath = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
  if (!existsSync(schemaPath)) {
    throw new Error(`schema.sql not found at ${schemaPath}`);
  }
  db.exec(readFileSync(schemaPath, 'utf8'));

  // Seed the singleton player row.
  db.prepare(
    `INSERT OR IGNORE INTO player (id, xp, streak_days, longest_streak, last_active, updated_at)
     VALUES (1, 0, 0, 0, '', ?)`,
  ).run(Date.now());
}

export function getDb(): Database.Database {
  if (!globalForDb.__bluddianDb) {
    globalForDb.__bluddianDb = open();
  }
  return globalForDb.__bluddianDb;
}

export const db = new Proxy({} as Database.Database, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

export function newId(): string {
  return randomUUID();
}

export function now(): number {
  return Date.now();
}

/** YYYY-MM-DD in UTC. Every day-keyed row in the app uses this. */
export function today(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** ISO week key like 2026-W33, used for weekly quest periods. */
export function weekKey(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
