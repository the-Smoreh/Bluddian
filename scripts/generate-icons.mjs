#!/usr/bin/env node
/**
 * Generates the PWA launcher icons as real PNGs, with no image dependency.
 *
 * Android's install prompt requires PNG (an SVG icon won't trigger it), so we
 * rasterise here rather than shipping vectors. The encoder below writes a
 * minimal but fully valid RGBA PNG using zlib, which node already has.
 *
 * Run: npm run icons
 */

import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'public', 'icons');

// ------------------------------------------------------------- PNG encoder --

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** pixels: Uint8Array of RGBA, length = size * size * 4 */
function encodePng(pixels, size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with a filter byte; 0 = None.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- drawing --

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Draws the launcher icon: a rounded tile with a violet→cyan diagonal gradient
 * and three ascending bars — the "revenue going up" mark.
 *
 * `inset` shrinks the artwork for the maskable variant, which Android may crop
 * to a circle; the safe zone is the inner 80%.
 */
function drawIcon(size, { maskable = false } = {}) {
  const px = new Uint8Array(size * size * 4);
  const radius = maskable ? 0 : size * 0.22;
  const inset = maskable ? size * 0.14 : 0;

  const set = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    const alpha = clamp01(a);
    // Source-over compositing against whatever is already there.
    px[i] = Math.round(lerp(px[i], r, alpha));
    px[i + 1] = Math.round(lerp(px[i + 1], g, alpha));
    px[i + 2] = Math.round(lerp(px[i + 2], b, alpha));
    px[i + 3] = Math.round(lerp(px[i + 3], 255, alpha));
  };

  // Signed distance to a rounded rectangle, used for anti-aliased edges.
  const roundedRectCoverage = (x, y, left, top, right, bottom, r) => {
    const cx = Math.max(left + r, Math.min(x, right - r));
    const cy = Math.max(top + r, Math.min(y, bottom - r));
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // 1px feather.
    return clamp01(r - dist + 0.5);
  };

  // ---- background tile ----
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coverage = roundedRectCoverage(
        x + 0.5,
        y + 0.5,
        0,
        0,
        size,
        size,
        radius || 0.0001,
      );
      if (coverage <= 0) continue;

      // Diagonal gradient: #7c5cff -> #22d3ee
      const t = clamp01((x / size) * 0.55 + (y / size) * 0.45);
      const r = Math.round(lerp(124, 34, t));
      const g = Math.round(lerp(92, 211, t));
      const b = Math.round(lerp(255, 238, t));
      set(x, y, r, g, b, coverage);
    }
  }

  // ---- three ascending bars ----
  const area = size - inset * 2;
  const barW = area * 0.16;
  const gap = area * 0.09;
  const groupW = barW * 3 + gap * 2;
  const startX = inset + (area - groupW) / 2;
  const baseY = inset + area * 0.76;
  const heights = [area * 0.24, area * 0.4, area * 0.56];
  const barRadius = barW * 0.28;

  heights.forEach((h, i) => {
    const left = startX + i * (barW + gap);
    const right = left + barW;
    const top = baseY - h;

    for (let y = Math.floor(top) - 1; y < Math.ceil(baseY) + 1; y++) {
      for (let x = Math.floor(left) - 1; x < Math.ceil(right) + 1; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const coverage = roundedRectCoverage(x + 0.5, y + 0.5, left, top, right, baseY, barRadius);
        if (coverage > 0) set(x, y, 255, 255, 255, coverage * 0.97);
      }
    }
  });

  return px;
}

// ------------------------------------------------------------------- main --

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'maskable-512.png', size: 512, maskable: true },
];

for (const { file, size, maskable } of targets) {
  const png = encodePng(drawIcon(size, { maskable }), size);
  writeFileSync(path.join(OUT_DIR, file), png);
  const hash = createHash('sha256').update(png).digest('hex').slice(0, 8);
  console.log(`  ${file.padEnd(20)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB  ${hash}`);
}

console.log(`\nWrote ${targets.length} icons to public/icons/`);
