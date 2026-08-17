'use client';

import { useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { buildImportPreview, detectPlatform, type ImportPreview } from '@/lib/local/csv';
import { importSales } from '@/lib/local/actions';
import { fmtMoney, fmtNumber } from '@/lib/money';
import type { Platform } from '@/lib/local/types';

/**
 * CSV import with a mandatory preview step.
 *
 * Importing money is the one action here that can quietly corrupt every number
 * in the app, so nothing is written until you've seen the row count, the total,
 * and which columns were matched. Re-importing the same file is safe — rows
 * carry their platform order ID and duplicates are skipped.
 */
export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [platform, setPlatform] = useState<Platform>('shopify');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function onFile(file: File) {
    setBusy(true);
    setFileName(file.name);
    try {
      const text = await file.text();
      const detected = detectPlatform(text);
      const chosen = detected === 'manual' ? platform : detected;
      setPlatform(chosen);
      setPreview(buildImportPreview(text, chosen));
    } catch {
      toast.error('Could not read that file');
    } finally {
      setBusy(false);
    }
  }

  function reparse(next: Platform) {
    setPlatform(next);
    if (preview) setPreview({ ...preview, platform: next, rows: preview.rows.map((r) => ({ ...r, platform: next })) });
  }

  function confirm() {
    if (!preview || preview.rows.length === 0) return;

    const { added, skipped, result } = importSales(preview.rows);

    toast.success(
      `Imported ${fmtNumber(added)} sale${added === 1 ? '' : 's'}`,
      skipped > 0 ? `${skipped} already there, skipped` : undefined,
    );
    if (result.levelUp) toast.levelUp(result.levelUp.level, result.levelUp.title);
    for (const title of result.completedGoals) {
      toast.push({ kind: 'level', title: 'Goal complete', detail: title });
    }

    reset();
    onClose();
  }

  function reset() {
    setPreview(null);
    setFileName('');
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import orders"
    >
      <div className="space-y-4 pb-2">
        {!preview ? (
          <>
            <div className="rounded-xl border border-line bg-raised/40 p-4">
              <p className="text-sm font-semibold">Where to get the file</p>
              <ul className="mt-2 space-y-2 text-xs leading-relaxed text-muted">
                <li>
                  <strong className="text-fg">Shopify:</strong> Admin → Orders → Export → plain CSV.
                </li>
                <li>
                  <strong className="text-fg">Whop:</strong> Dashboard → Payments → Export.
                </li>
              </ul>
              <p className="mt-3 text-xs text-faint">
                Their live APIs can&apos;t be called from a phone browser, so the export file is the
                way in. It also means no API key is needed and nothing leaves the device.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="import-platform">Platform</label>
              <select
                id="import-platform"
                className="input"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
              >
                <option value="shopify">Shopify</option>
                <option value="whop">Whop</option>
                <option value="manual">Other / generic CSV</option>
              </select>
              <p className="mt-1.5 text-xs text-faint">
                Auto-detected from the file where possible.
              </p>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="btn-primary w-full"
              disabled={busy}
            >
              <Icon name="package" size={16} />
              {busy ? 'Reading…' : 'Choose CSV file'}
            </button>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-line bg-raised/40 p-4">
              <p className="truncate text-xs text-faint">{fileName}</p>
              <p className="mt-1 text-3xl font-bold text-gold nums">
                {fmtMoney(preview.totalCents)}
              </p>
              <p className="mt-1 text-sm text-muted nums">
                {fmtNumber(preview.rows.length)} sale{preview.rows.length === 1 ? '' : 's'} ready
                {preview.skipped > 0 ? ` · ${preview.skipped} rows ignored` : ''}
              </p>
            </div>

            <div>
              <label className="label" htmlFor="confirm-platform">Attribute to</label>
              <select
                id="confirm-platform"
                className="input"
                value={platform}
                onChange={(e) => reparse(e.target.value as Platform)}
              >
                <option value="shopify">Shopify</option>
                <option value="whop">Whop</option>
                <option value="manual">Manual / other</option>
              </select>
            </div>

            {Object.keys(preview.detectedColumns).length > 0 ? (
              <div>
                <p className="label">Columns matched</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(preview.detectedColumns).map(([field, header]) => (
                    <span key={field} className="chip">
                      {field} → {header}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {preview.warnings.length > 0 ? (
              <div className="rounded-xl border border-warn/40 bg-warn/10 p-3">
                {preview.warnings.map((w) => (
                  <p key={w} className="flex items-start gap-2 text-xs text-warn">
                    <Icon name="x" size={13} className="mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
            ) : null}

            {preview.rows.length > 0 ? (
              <div>
                <p className="label">First few</p>
                <ul className="divide-y divide-line/60 rounded-xl border border-line">
                  {preview.rows.slice(0, 4).map((r, i) => (
                    <li key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">{r.productName}</span>
                      <span className="shrink-0 text-faint">
                        {new Date(r.occurredAt ?? Date.now()).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <span className="shrink-0 font-semibold text-gold nums">
                        {fmtMoney(r.grossCents, r.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex gap-2">
              <button type="button" onClick={reset} className="btn-ghost flex-1">
                Back
              </button>
              <button
                type="button"
                onClick={confirm}
                className="btn-primary flex-1"
                disabled={preview.rows.length === 0}
              >
                Import {fmtNumber(preview.rows.length)}
              </button>
            </div>

            <p className="text-xs text-faint">
              Safe to run twice — orders already imported are skipped rather than duplicated.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
