'use client';

import { useEffect, useRef, useState } from 'react';
import { Page, PageHeader, SectionTitle } from '@/components/Shell';
import { Sheet } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useVault } from '@/components/VaultGate';
import { Connections } from '@/components/Connections';
import { useDb } from '@/lib/local/useStore';
import { setSettings } from '@/lib/local/actions';
import { exportJson, flush, importJson } from '@/lib/local/store';
import { fmtNumber } from '@/lib/money';
import { storageEstimate, requestPersistence } from '@/lib/local/idb';
import {
  changePin,
  destroyVault,
  enrolBiometric,
  platformAuthenticatorAvailable,
  removeBiometric,
  VaultError,
} from '@/lib/local/vault';

export default function SettingsPage() {
  const db = useDb();
  const toast = useToast();
  const { lock, meta, refreshMeta, dek } = useVault();

  const [bioAvailable, setBioAvailable] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      setBioAvailable(await platformAuthenticatorAvailable());
      setStorage(await storageEstimate());
      if (navigator.storage?.persisted) setPersisted(await navigator.storage.persisted());
    })();
  }, []);

  const bioOn = Boolean(meta?.bio);

  async function toggleBiometric() {
    if (busy || !dek) return;
    setBusy(true);
    try {
      if (bioOn) {
        await removeBiometric();
        toast.success('Fingerprint unlock off', 'Your PIN still works.');
      } else {
        await enrolBiometric(dek);
        toast.success('Fingerprint unlock on');
      }
      await refreshMeta();
    } catch (err) {
      if (!(err instanceof VaultError && err.code === 'cancelled')) {
        toast.error('Could not change that', err instanceof Error ? err.message : undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  async function backup() {
    await flush();
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bluddian-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup saved', 'Keep it somewhere safe.');
  }

  async function restore(file: File) {
    try {
      const result = importJson(await file.text());
      toast.success('Restored', `${result.sales} sales, ${result.products} products`);
    } catch {
      toast.error('That file could not be read');
    }
  }

  return (
    <Page>
      <PageHeader title="Settings" subtitle="Everything here stays on this phone." />

      {/* --------------------------------------------------------- identity */}
      <SectionTitle>You</SectionTitle>
      <div className="card-pad space-y-3">
        <div>
          <label className="label" htmlFor="name">Display name</label>
          <input
            id="name"
            className="input"
            value={db.settings.displayName}
            onChange={(e) => setSettings({ displayName: e.target.value.slice(0, 60) })}
            maxLength={60}
          />
        </div>
      </div>

      {/* ------------------------------------------------------ connections */}
      <Connections />

      {/* --------------------------------------------------------- security */}
      <SectionTitle>Lock</SectionTitle>
      <div className="card divide-y divide-line/60">
        <button
          type="button"
          onClick={toggleBiometric}
          disabled={!bioAvailable || busy}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-raised/50 disabled:opacity-50"
        >
          <span className={bioOn ? 'text-good' : 'text-faint'}>
            <Icon name="key" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Fingerprint / face unlock</span>
            <span className="block text-xs text-faint">
              {!bioAvailable
                ? 'No screen lock set up on this device'
                : bioOn
                  ? 'On — your fingerprint decrypts the data'
                  : 'Off — unlock with PIN only'}
            </span>
          </span>
          <span
            className={`h-6 w-10 shrink-0 rounded-full border transition ${
              bioOn ? 'border-good bg-good/30' : 'border-line bg-raised'
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full transition-transform ${
                bioOn ? 'translate-x-4 bg-good' : 'translate-x-0.5 bg-faint'
              }`}
            />
          </span>
        </button>

        <button
          type="button"
          onClick={() => setPinOpen(true)}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-raised/50"
        >
          <span className="text-faint"><Icon name="lock" size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Change PIN</span>
            <span className="block text-xs text-faint">Your recovery key if biometrics fail</span>
          </span>
          <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
        </button>

        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="text-faint"><Icon name="clock" size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Auto-lock</span>
            <span className="block text-xs text-faint">Lock after inactivity</span>
          </span>
          <select
            className="shrink-0 rounded-lg border border-line bg-raised px-2 py-1.5 text-sm"
            value={db.settings.autoLockMinutes}
            onChange={(e) => setSettings({ autoLockMinutes: Number(e.target.value) })}
            aria-label="Auto-lock delay"
          >
            <option value={1}>1 min</option>
            <option value={5}>5 min</option>
            <option value={15}>15 min</option>
            <option value={60}>1 hour</option>
            <option value={0}>Never</option>
          </select>
        </div>

        <button
          type="button"
          onClick={lock}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-raised/50"
        >
          <span className="text-brand"><Icon name="logout" size={18} /></span>
          <span className="flex-1 text-sm font-medium text-brand">Lock now</span>
        </button>
      </div>

      {/* ------------------------------------------------------------ data */}
      <SectionTitle>Your data</SectionTitle>
      <div className="card divide-y divide-line/60">
        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Stored on this device</span>
            <span className="font-semibold nums">
              {fmtNumber(db.sales.length)} sales · {fmtNumber(db.products.length)} products
            </span>
          </div>
          {storage ? (
            <p className="mt-1 text-xs text-faint nums">
              {(storage.usage / 1024).toFixed(0)} KB used
              {storage.quota > 0 ? ` of ${(storage.quota / 1048576).toFixed(0)} MB available` : ''}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={backup}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-raised/50"
        >
          <span className="text-faint"><Icon name="package" size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Export backup</span>
            <span className="block text-xs text-faint">
              Unencrypted JSON, without API keys — store it somewhere safe
            </span>
          </span>
          <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
        </button>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void restore(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-raised/50"
        >
          <span className="text-faint"><Icon name="refresh" size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Restore from backup</span>
            <span className="block text-xs text-faint">Replaces everything currently here</span>
          </span>
          <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
        </button>
      </div>

      {persisted === false ? (
        <button
          type="button"
          onClick={async () => {
            const ok = await requestPersistence();
            setPersisted(ok);
            toast.push({
              kind: ok ? 'success' : 'info',
              title: ok ? 'Storage protected' : 'Android declined',
              detail: ok ? undefined : 'Install to your home screen and try again.',
            });
          }}
          className="card mt-3 flex w-full items-start gap-3 border-warn/40 bg-warn/5 p-4 text-left"
        >
          <span className="mt-0.5 text-warn"><Icon name="shield" size={18} /></span>
          <span>
            <span className="block text-sm font-semibold text-warn">Storage not protected yet</span>
            <span className="mt-1 block text-xs text-muted">
              Android may clear this app&apos;s data when space runs low. Tap to request permanent
              storage — it usually gets granted once the app is installed to your home screen.
            </span>
          </span>
        </button>
      ) : null}

      {/* --------------------------------------------------------- install */}
      <InstallHint />

      {/* ------------------------------------------------------------ wipe */}
      <SectionTitle>Danger zone</SectionTitle>
      <button
        type="button"
        onClick={() => setWipeOpen(true)}
        className="card flex w-full items-center gap-3 border-bad/30 p-4 text-left transition active:bg-bad/10"
      >
        <span className="text-bad"><Icon name="trash" size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-bad">Erase everything</span>
          <span className="block text-xs text-faint">Deletes the vault and all data on this phone</span>
        </span>
      </button>

      <p className="mt-6 px-1 text-center text-xs leading-relaxed text-faint">
        Bluddian runs entirely on this device. No account, no server, nothing uploaded.
      </p>

      <PinSheet open={pinOpen} onClose={() => setPinOpen(false)} />
      <WipeSheet open={wipeOpen} onClose={() => setWipeOpen(false)} />
    </Page>
  );
}

function PinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dek } = useVault();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 4) return toast.error('Use at least 4 digits.');
    if (pin !== confirm) return toast.error('The two PINs do not match.');
    if (!dek) return;

    setBusy(true);
    try {
      await changePin(dek, pin);
      toast.success('PIN changed');
      setPin('');
      setConfirm('');
      onClose();
    } catch (err) {
      toast.error('Could not change PIN', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Change PIN">
      <form onSubmit={submit} className="space-y-4 pb-2">
        <div>
          <label className="label" htmlFor="new-pin">New PIN</label>
          <input
            id="new-pin"
            className="input text-center text-2xl tracking-[0.4em] nums"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="new-pin-confirm">Confirm</label>
          <input
            id="new-pin-confirm"
            className="input text-center text-2xl tracking-[0.4em] nums"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 12))}
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>
        <p className="text-xs text-faint">
          Your data isn&apos;t re-encrypted — only the key that unlocks it is re-wrapped, so this is
          instant no matter how much history you have.
        </p>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Working…' : 'Change PIN'}
        </button>
      </form>
    </Sheet>
  );
}

function WipeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');

  return (
    <Sheet open={open} onClose={onClose} title="Erase everything">
      <div className="space-y-4 pb-2">
        <p className="rounded-xl border border-bad/40 bg-bad/10 p-3.5 text-sm text-bad">
          This deletes every sale, product, goal and stored key on this phone. There is no server
          copy and no undo. Export a backup first if you might want any of it later.
        </p>
        <div>
          <label className="label" htmlFor="wipe-confirm">Type ERASE to confirm</label>
          <input
            id="wipe-confirm"
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
          />
        </div>
        <button
          type="button"
          disabled={text !== 'ERASE'}
          onClick={async () => {
            await destroyVault();
            window.location.reload();
          }}
          className="btn-danger w-full"
        >
          Erase everything
        </button>
      </div>
    </Sheet>
  );
}

function InstallHint() {
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    setInstalled(window.matchMedia?.('(display-mode: standalone)').matches ?? false);
  }, []);

  if (installed) return null;

  return (
    <div className="card mt-6 border-brand/30 bg-brand/5 p-4">
      <div className="flex items-start gap-3">
        <span className="text-brand"><Icon name="home" size={18} /></span>
        <div>
          <p className="text-sm font-semibold">Put this on your home screen</p>
          <p className="mt-1 text-sm text-muted">
            In Chrome, tap ⋮ → <strong className="text-fg">Add to Home screen</strong>. It installs
            like a normal app, works offline, and Android stops evicting its storage.
          </p>
        </div>
      </div>
    </div>
  );
}
