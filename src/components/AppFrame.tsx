'use client';

import { useEffect, useRef } from 'react';
import { AutoLock, VaultGate, useVault } from '@/components/VaultGate';
import { BottomNav } from '@/components/Shell';
import { useToast } from '@/components/Toast';
import { useDatabase } from '@/lib/local/useStore';
import { getSaveError, isOpen } from '@/lib/local/store';
import { shouldAutoSync, syncAll } from '@/lib/local/connectors';
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
      <AutoSync />
    </>
  );
}

/**
 * Pulls new sales shortly after unlock, and again whenever the app is brought
 * back to the foreground after a while.
 *
 * Deliberately silent on success with nothing new: a toast every time you open
 * the app would be noise. It only speaks up when money actually arrived, or
 * when a sync fails and you need to know your numbers are stale.
 */
function AutoSync() {
  const toast = useToast();
  const ran = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!isOpen() || !shouldAutoSync()) return;

      const results = await syncAll();
      if (cancelled) return;

      const added = Object.values(results).reduce((sum, r) => sum + r.added, 0);
      const failed = Object.entries(results).filter(([, r]) => !r.ok);

      if (added > 0) {
        toast.success(`${added} new sale${added === 1 ? '' : 's'}`, 'Pulled in automatically');
      }
      for (const [id, result] of failed) {
        toast.error(`${id} sync failed`, result.message);
      }
    };

    // Delayed so it never competes with first paint after unlock.
    const initial = setTimeout(() => {
      if (!ran.current) {
        ran.current = true;
        void run();
      }
    }, 1500);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearTimeout(initial);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [toast]);

  return null;
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
