'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { closeStore, flush, initStore, openStore } from '@/lib/local/store';
import { emptyDatabase } from '@/lib/local/types';
import {
  biometricEnrolled,
  createVault,
  getMeta,
  lockRemaining,
  platformAuthenticatorAvailable,
  unlockWithBiometric,
  unlockWithPin,
  vaultExists,
  VaultError,
  type VaultMeta,
} from '@/lib/local/vault';
import { requestPersistence } from '@/lib/local/idb';
import { DashboardSkeleton } from '@/components/Skeleton';

/**
 * The unlock gate. Nothing below it renders until the vault is open, because
 * until then the data is still ciphertext — there is genuinely nothing to show.
 */

type VaultApi = {
  dek: CryptoKey | null;
  lock: () => void;
  refreshMeta: () => Promise<void>;
  meta: VaultMeta | null;
};

const Ctx = createContext<VaultApi | null>(null);

export function useVault(): VaultApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVault must be used inside <VaultGate>');
  return ctx;
}

type Phase = 'loading' | 'setup' | 'locked' | 'open';

export function VaultGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [dek, setDek] = useState<CryptoKey | null>(null);
  const [meta, setMeta] = useState<VaultMeta | null>(null);
  const [hasBio, setHasBio] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);

  const refreshMeta = useCallback(async () => {
    setMeta((await getMeta()) ?? null);
    setHasBio(await biometricEnrolled());
  }, []);

  useEffect(() => {
    void (async () => {
      const exists = await vaultExists();
      setBioAvailable(await platformAuthenticatorAvailable());
      await refreshMeta();
      setPhase(exists ? 'locked' : 'setup');
    })();
  }, [refreshMeta]);

  const lock = useCallback(() => {
    void flush().then(() => {
      closeStore();
      setDek(null);
      setPhase('locked');
      void refreshMeta();
    });
  }, [refreshMeta]);

  const onUnlocked = useCallback(async (key: CryptoKey, fresh: boolean) => {
    if (fresh) {
      await initStore(key, emptyDatabase());
    } else {
      await openStore(key);
    }
    setDek(key);
    setPhase('open');
    void requestPersistence();
  }, []);

  // Persist immediately when the app is backgrounded — Android can kill a
  // hidden tab without warning, and a debounced write would be lost.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  if (phase === 'loading') {
    // Shaped like the dashboard rather than a spinner, so the layout is already
    // settled when the real numbers arrive.
    return <DashboardSkeleton />;
  }

  if (phase === 'setup') {
    return <SetupScreen bioAvailable={bioAvailable} onReady={(key) => onUnlocked(key, true)} />;
  }

  if (phase === 'locked') {
    return (
      <LockScreen
        meta={meta}
        hasBio={hasBio}
        onUnlocked={(key) => onUnlocked(key, false)}
        onMetaChanged={refreshMeta}
      />
    );
  }

  return <Ctx.Provider value={{ dek, lock, refreshMeta, meta }}>{children}</Ctx.Provider>;
}

// ------------------------------------------------------------ first run ----

function SetupScreen({
  bioAvailable,
  onReady,
}: {
  bioAvailable: boolean;
  onReady: (key: CryptoKey) => void;
}) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const weak = /^(\d)\1{3,}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 4) return setError('Use at least 4 digits.');
    if (pin !== confirm) return setError('The two PINs do not match.');

    setBusy(true);
    try {
      onReady(await createVault(pin));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the vault.');
      setBusy(false);
    }
  }

  return (
    <main
      className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="mb-7 text-center">
        <div
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl
                        bg-fg"
        >
          <Icon name="trophy" size={28} className="text-ink" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Bluddian</h1>
        <p className="mt-1.5 text-sm text-muted">
          Everything lives on this phone. Set a recovery PIN to encrypt it.
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="pin">
            Recovery PIN
          </label>
          <input
            id="pin"
            className="input text-center text-2xl tracking-[0.4em] nums"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, '').slice(0, 12));
              setError('');
            }}
            inputMode="numeric"
            autoComplete="new-password"
            placeholder="••••••"
            required
          />
          {weak && pin.length >= 4 ? (
            <p className="mt-1.5 text-xs text-warn">That PIN is an obvious guess. Pick another.</p>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor="confirm">
            Confirm
          </label>
          <input
            id="confirm"
            className="input text-center text-2xl tracking-[0.4em] nums"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value.replace(/\D/g, '').slice(0, 12));
              setError('');
            }}
            inputMode="numeric"
            autoComplete="new-password"
            placeholder="••••••"
            required
          />
        </div>

        {error ? (
          <p className="flex items-start gap-2 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2.5 text-sm text-bad">
            <Icon name="x" size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Encrypting…' : 'Create my dashboard'}
        </button>
      </form>

      <div className="mt-5 space-y-3 px-1">
        {bioAvailable ? (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-faint">
            <Icon name="key" size={14} className="mt-0.5 shrink-0" />
            <span>
              You can turn on fingerprint unlock in Settings straight after this. The PIN stays as
              your backup.
            </span>
          </p>
        ) : null}
        <p className="flex items-start gap-2 text-xs leading-relaxed text-faint">
          <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong className="text-muted">Write this PIN down.</strong> Your data is encrypted with
            it and never leaves this device — there is no server and no password reset. If you
            forget it, the data is gone.
          </span>
        </p>
      </div>
    </main>
  );
}

// ----------------------------------------------------------- lock screen ---

function LockScreen({
  meta,
  hasBio,
  onUnlocked,
  onMetaChanged,
}: {
  meta: VaultMeta | null;
  hasBio: boolean;
  onUnlocked: (key: CryptoKey) => void;
  onMetaChanged: () => Promise<void>;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPinPad, setShowPinPad] = useState(!hasBio);
  const [remaining, setRemaining] = useState(() => lockRemaining(meta ?? undefined));
  const attempted = useRef(false);

  // Count the lockout down live rather than making the user guess.
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  const tryBiometric = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      onUnlocked(await unlockWithBiometric());
    } catch (err) {
      const message =
        err instanceof VaultError && err.code === 'cancelled'
          ? ''
          : err instanceof Error
            ? err.message
            : 'Could not unlock.';
      setError(message);
      setShowPinPad(true);
      setBusy(false);
    }
  }, [onUnlocked]);

  // Offer the fingerprint prompt immediately — that's the whole appeal.
  useEffect(() => {
    if (hasBio && !attempted.current && remaining <= 0) {
      attempted.current = true;
      void tryBiometric();
    }
  }, [hasBio, tryBiometric, remaining]);

  async function submitPin(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || remaining > 0) return;

    setBusy(true);
    setError('');
    try {
      onUnlocked(await unlockWithPin(pin));
    } catch (err) {
      setPin('');
      if (err instanceof VaultError) {
        setError(err.message);
        if (err.retryAfterMs > 0) setRemaining(err.retryAfterMs);
      } else {
        setError('Could not unlock.');
      }
      await onMetaChanged();
      setBusy(false);
      if (navigator.vibrate) navigator.vibrate([40]);
    }
  }

  const locked = remaining > 0;

  return (
    <main
      className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="mb-8 text-center">
        <div
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl
                        bg-fg"
        >
          <Icon name="lock" size={26} className="text-ink" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Locked</h1>
        <p className="mt-1.5 text-sm text-muted">
          {locked
            ? 'Too many wrong attempts.'
            : hasBio && !showPinPad
              ? 'Unlock with your fingerprint.'
              : 'Enter your PIN.'}
        </p>
      </div>

      {locked ? (
        <div className="card p-6 text-center">
          <p className="text-3xl font-bold text-warn nums">{formatDuration(remaining)}</p>
          <p className="mt-2 text-sm text-muted">Try again when the timer runs out.</p>
        </div>
      ) : (
        <>
          {hasBio ? (
            <button
              type="button"
              onClick={tryBiometric}
              disabled={busy}
              className="btn-primary mb-4 w-full"
            >
              <Icon name="key" size={17} />
              {busy ? 'Waiting…' : 'Unlock with fingerprint'}
            </button>
          ) : null}

          {showPinPad ? (
            <form onSubmit={submitPin} className="card space-y-4 p-5">
              <div>
                <label className="label" htmlFor="unlock-pin">
                  PIN
                </label>
                <input
                  id="unlock-pin"
                  className="input text-center text-2xl tracking-[0.4em] nums"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
                  inputMode="numeric"
                  autoComplete="current-password"
                  type="password"
                  placeholder="••••••"
                  autoFocus={!hasBio}
                />
              </div>

              {error ? (
                <p className="flex items-start gap-2 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2.5 text-sm text-bad">
                  <Icon name="x" size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </p>
              ) : null}

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={busy || pin.length < 4}
              >
                {busy ? 'Checking…' : 'Unlock'}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowPinPad(true)}
              className="w-full text-center text-sm font-semibold text-muted"
            >
              Use PIN instead
            </button>
          )}
        </>
      )}
    </main>
  );
}

function formatDuration(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

/** Auto-lock after inactivity. Mounted inside the gate, so it only runs when open. */
export function AutoLock({ minutes }: { minutes: number }) {
  const { lock } = useVault();
  const toast = useToast();

  useEffect(() => {
    if (minutes <= 0) return;

    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        toast.push({ kind: 'info', title: 'Locked', detail: 'Inactive for a while.' });
        lock();
      }, minutes * 60_000);
    };

    const events = ['pointerdown', 'keydown', 'visibilitychange'] as const;
    for (const e of events) document.addEventListener(e, reset);
    reset();

    return () => {
      clearTimeout(timer);
      for (const e of events) document.removeEventListener(e, reset);
    };
  }, [minutes, lock, toast]);

  return null;
}
