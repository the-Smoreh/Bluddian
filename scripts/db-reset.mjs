#!/usr/bin/env node
/**
 * Deletes the local database. Destructive, so it asks first unless --force.
 * Your encrypted credentials live in this file too, so a reset means
 * re-entering every API key.
 */

import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const file = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'bluddian.db');
const force = process.argv.includes('--force');

if (!existsSync(file)) {
  console.log(`No database at ${file} — nothing to do.`);
  process.exit(0);
}

if (!force) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nThis deletes ${file}, including every sale, goal, and stored API key.\nType DELETE to confirm: `,
  );
  rl.close();

  if (answer.trim() !== 'DELETE') {
    console.log('Cancelled.');
    process.exit(1);
  }
}

// SQLite in WAL mode keeps two sidecar files; leaving them behind corrupts the
// next database created at the same path.
for (const suffix of ['', '-wal', '-shm']) {
  const target = `${file}${suffix}`;
  if (existsSync(target)) unlinkSync(target);
}

console.log('Database deleted. It will be recreated on next start.');
