'use client';

import { AutoLock, VaultGate, useVault } from '@/components/VaultGate';
import { BottomNav } from '@/components/Shell';
import { useDatabase } from '@/lib/local/useStore';
import { getSaveError } from '@/lib/local/store';
import { Icon } from '@/components/Icon';

/**
 * Wraps every page in the unlock gate and the persistent chrome, so no
 * individual page has to remember to check whether the vault is open.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <VaultGate>
      <UnlockedFrame>{children}</UnlockedFrame>
    </VaultGate>
  );
}

function UnlockedFrame({ children }: { children: React.ReactNode }) {
  const db = useDatabase();
  useVault();

  // The gate guarantees an open store, but the first paint after unlock can
  // land a tick early.
  if (!db) return null;

  const saveError = getSaveError();

  return (
    <>
      {saveError ? <SaveErrorBanner message={saveError} /> : null}
      {children}
      <BottomNav />
      <AutoLock minutes={db.settings.autoLockMinutes} />
    </>
  );
}

/**
 * A failed write means the next reload silently loses data. That has to be
 * loud, not a console warning.
 */
function SaveErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="fixed inset-x-0 z-[80] mx-auto max-w-lg px-4"
      style={{ top: 'calc(var(--safe-top) + 0.5rem)' }}
      role="alert"
    >
      <div className="flex items-start gap-2.5 rounded-xl border border-bad/50 bg-bad/15 px-3.5 py-3 backdrop-blur-xl">
        <span className="mt-0.5 shrink-0 text-bad">
          <Icon name="x" size={16} />
        </span>
        <div>
          <p className="text-sm font-semibold text-bad">Couldn&apos;t save to this device</p>
          <p className="mt-0.5 text-xs text-muted">
            {message}. Free up storage — changes since your last save may be lost on reload.
          </p>
        </div>
      </div>
    </div>
  );
}
