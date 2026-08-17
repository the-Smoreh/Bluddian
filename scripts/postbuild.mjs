#!/usr/bin/env node
/**
 * Rewrites the manifest and service worker for a sub-path deploy.
 *
 * Next rewrites its own asset URLs for `basePath`, but files served verbatim
 * from public/ — the manifest and the service worker — keep whatever paths were
 * written into them. Under GitHub Pages that means an install prompt that never
 * appears and a worker that caches nothing. This patches both.
 *
 * No-op when BASE_PATH is unset, which is the normal root-domain case.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.BASE_PATH ?? '';
const OUT = path.join(process.cwd(), 'out');

if (!base) {
  console.log('postbuild: BASE_PATH unset — nothing to rewrite.');
  process.exit(0);
}

// ---- manifest ----
const manifestPath = path.join(OUT, 'manifest.webmanifest');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

manifest.id = `${base}/`;
manifest.start_url = `${base}/`;
manifest.scope = `${base}/`;
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: `${base}${icon.src}` }));
if (Array.isArray(manifest.shortcuts)) {
  manifest.shortcuts = manifest.shortcuts.map((s) => ({ ...s, url: `${base}${s.url}` }));
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

// ---- service worker ----
const swPath = path.join(OUT, 'sw.js');
let sw = await readFile(swPath, 'utf8');

// Only the precache list and the offline fallbacks carry literal paths.
sw = sw.replace(/const BASE_PATH = '';/, `const BASE_PATH = '${base}';`);

await writeFile(swPath, sw);

console.log(`postbuild: rewrote manifest + service worker for base path "${base}"`);
