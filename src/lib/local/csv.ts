'use client';

import type { NewSale } from '@/lib/local/actions';
import type { Platform } from '@/lib/local/types';

/**
 * CSV import for Whop and Shopify order exports.
 *
 * This exists because Whop's and Shopify's Admin APIs cannot be called from a
 * browser — they don't send CORS headers, by design, since they're meant for
 * servers. With no server in this architecture, the export file is the supported
 * path in, and it has a real advantage: it works offline, needs no API key, and
 * can't leak a credential.
 *
 * Both platforms change their column names periodically, so columns are matched
 * by a list of aliases rather than fixed positions, and a row that can't be
 * understood is reported instead of silently dropped.
 */

// ------------------------------------------------------------ CSV parsing --

/**
 * RFC 4180 parser. Hand-rolled rather than pulled from npm because the format
 * is small and the edge cases that matter — quoted commas, escaped quotes,
 * newlines inside fields, CRLF — are all handled below.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Strip a UTF-8 BOM, which Excel loves to add and which would otherwise
  // corrupt the first header name.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // handled by the \n branch
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// ------------------------------------------------------- column matching --

function findColumn(headers: string[], aliases: string[]): number {
  const normalised = headers.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, ''),
  );
  for (const alias of aliases) {
    const target = alias.toLowerCase().replace(/[\s_-]+/g, '');
    const exact = normalised.indexOf(target);
    if (exact !== -1) return exact;
  }
  // Fall back to a contains match, which catches "Total Price (USD)" etc.
  for (const alias of aliases) {
    const target = alias.toLowerCase().replace(/[\s_-]+/g, '');
    const partial = normalised.findIndex((h) => h.includes(target));
    if (partial !== -1) return partial;
  }
  return -1;
}

function toCents(raw: string): number {
  if (!raw) return 0;
  // Strip currency symbols and thousands separators, keep sign and decimal.
  const clean = raw.replace(/[^0-9.,-]/g, '').replace(/,(?=\d{3}\b)/g, '');
  const value = Number.parseFloat(clean.replace(',', '.'));
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function toTimestamp(raw: string): number | null {
  if (!raw) return null;

  const trimmed = raw.trim();

  // Unix seconds or milliseconds.
  if (/^\d{9,13}$/.test(trimmed)) {
    const n = Number(trimmed);
    return n > 1e11 ? n : n * 1000;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return parsed;

  // DD/MM/YYYY and MM/DD/YYYY are ambiguous; prefer the ISO-ish reading and
  // bail rather than guessing wrong and misplacing revenue in time.
  const match = trimmed.match(/^(\d{1,2})[/](\d{1,2})[/](\d{4})/);
  if (match) {
    const [, a, b, y] = match;
    return Date.UTC(Number(y), Number(a) - 1, Number(b));
  }

  return null;
}

// ----------------------------------------------------------- import types --

export type ImportPreview = {
  platform: Platform;
  rows: NewSale[];
  totalCents: number;
  skipped: number;
  warnings: string[];
  detectedColumns: Record<string, string>;
};

const COLUMNS = {
  id: ['id', 'order id', 'name', 'receipt id', 'payment id', 'order', 'transaction id'],
  date: ['paid at', 'created at', 'date', 'processed at', 'created', 'timestamp'],
  total: ['total', 'amount', 'final amount', 'total price', 'subtotal', 'gross', 'paid'],
  currency: ['currency', 'presentment currency'],
  status: ['financial status', 'status', 'payment status', 'state'],
  product: [
    'lineitem name',
    'product',
    'product title',
    'plan',
    'item',
    'description',
    'product name',
  ],
  email: ['email', 'customer email', 'user email', 'buyer email'],
  fees: ['fee', 'fees', 'whop fee', 'application fee', 'processing fee'],
  refund: ['refunded amount', 'refund', 'refunded', 'total refunded'],
} as const;

/**
 * Parse an export into sales, without writing anything. The caller shows a
 * preview first — importing money is not something to do blind.
 */
export function buildImportPreview(text: string, platform: Platform): ImportPreview {
  const rows = parseCsv(text);
  const warnings: string[] = [];

  if (rows.length < 2) {
    return {
      platform,
      rows: [],
      totalCents: 0,
      skipped: 0,
      warnings: ['That file has no data rows.'],
      detectedColumns: {},
    };
  }

  const headers = rows[0];
  const idx = {
    id: findColumn(headers, [...COLUMNS.id]),
    date: findColumn(headers, [...COLUMNS.date]),
    total: findColumn(headers, [...COLUMNS.total]),
    currency: findColumn(headers, [...COLUMNS.currency]),
    status: findColumn(headers, [...COLUMNS.status]),
    product: findColumn(headers, [...COLUMNS.product]),
    email: findColumn(headers, [...COLUMNS.email]),
    fees: findColumn(headers, [...COLUMNS.fees]),
    refund: findColumn(headers, [...COLUMNS.refund]),
  };

  const detectedColumns: Record<string, string> = {};
  for (const [key, position] of Object.entries(idx)) {
    if (position >= 0) detectedColumns[key] = headers[position].trim();
  }

  if (idx.total === -1) {
    return {
      platform,
      rows: [],
      totalCents: 0,
      skipped: rows.length - 1,
      warnings: [
        `Couldn't find an amount column. Looked for: ${COLUMNS.total.join(', ')}. Found: ${headers.join(', ')}`,
      ],
      detectedColumns,
    };
  }

  if (idx.date === -1) {
    warnings.push('No date column found — every row will be dated today.');
  }

  const cell = (row: string[], position: number): string =>
    position >= 0 && position < row.length ? row[position].trim() : '';

  const out: NewSale[] = [];
  // Shopify repeats the order across line-item rows; only the first carries the
  // order total, so later rows with a blank total must not become £0 sales.
  const seenIds = new Set<string>();
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const rawTotal = cell(row, idx.total);
    const gross = toCents(rawTotal);
    const externalId = cell(row, idx.id) || null;

    if (externalId && seenIds.has(externalId)) {
      skipped++;
      continue;
    }

    if (gross <= 0) {
      skipped++;
      continue;
    }
    if (externalId) seenIds.add(externalId);

    const rawStatus = cell(row, idx.status).toLowerCase();
    const refund = toCents(cell(row, idx.refund));

    const status: NewSale['status'] =
      refund > 0 || rawStatus.includes('refund')
        ? 'refunded'
        : rawStatus.includes('paid') ||
            rawStatus.includes('success') ||
            rawStatus.includes('complete') ||
            rawStatus === ''
          ? 'paid'
          : rawStatus.includes('pend') || rawStatus.includes('author')
            ? 'pending'
            : 'failed';

    out.push({
      platform,
      externalId,
      productName:
        cell(row, idx.product) || `${platform} order${externalId ? ` ${externalId}` : ''}`,
      grossCents: gross,
      feesCents: toCents(cell(row, idx.fees)),
      refundCents: refund,
      currency: cell(row, idx.currency) || 'USD',
      status,
      occurredAt: toTimestamp(cell(row, idx.date)) ?? Date.now(),
      customerEmail: cell(row, idx.email) || null,
    });
  }

  if (out.length === 0 && skipped > 0) {
    warnings.push(`All ${skipped} rows were skipped — no positive amounts found.`);
  }

  return {
    platform,
    rows: out,
    totalCents: out.reduce(
      (sum, r) => sum + (r.grossCents - (r.feesCents ?? 0) - (r.refundCents ?? 0)),
      0,
    ),
    skipped,
    warnings,
    detectedColumns,
  };
}

/** Guess which platform an export came from, so the user doesn't have to. */
export function detectPlatform(text: string): Platform {
  const head = text.slice(0, 2000).toLowerCase();
  if (head.includes('lineitem') || head.includes('fulfillment') || head.includes('myshopify')) {
    return 'shopify';
  }
  if (head.includes('whop') || head.includes('membership') || head.includes('receipt')) {
    return 'whop';
  }
  return 'manual';
}
