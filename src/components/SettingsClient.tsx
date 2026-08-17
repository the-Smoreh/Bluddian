'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { SectionTitle } from '@/components/Shell';
import { useToast } from '@/components/Toast';
import { del, patch, post, put } from '@/lib/client';
import { relativeTime } from '@/lib/money';

type FieldDef = {
  name: string;
  label: string;
  help: string;
  required: boolean;
  secret: boolean;
};

type ProviderDef = { id: string; label: string; blurb: string; fields: FieldDef[] };

type CredentialSummary = {
  provider: string;
  name: string;
  hint: string;
  updated_at: number;
  source: 'db' | 'env';
};

type SyncInfo = { at: number | null; status: string | null; message: string };

export function SettingsClient({
  providers,
  credentials,
  configured,
  syncs,
  twoFactorEnabled,
  encryptionReady,
  sessionCount,
}: {
  providers: ProviderDef[];
  credentials: CredentialSummary[];
  configured: Record<string, boolean>;
  syncs: Record<string, SyncInfo>;
  twoFactorEnabled: boolean;
  encryptionReady: boolean;
  sessionCount: number;
}) {
  const [editing, setEditing] = useState<{ provider: ProviderDef; field: FieldDef } | null>(null);
  const [twoFa, setTwoFa] = useState(false);
  const [password, setPassword] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();

  const credFor = (provider: string, name: string) =>
    credentials.find((c) => c.provider === provider && c.name === name);

  async function runSync(provider: string, action: 'sync' | 'test') {
    if (busy) return;
    setBusy(`${provider}:${action}`);
    try {
      const res = await post<{ ok?: boolean; message: string }>(`/api/sync/${provider}`, { action });
      toast.success(action === 'test' ? 'Connection OK' : 'Synced', res.message);
      router.refresh();
    } catch (err) {
      toast.error(action === 'test' ? 'Test failed' : 'Sync failed', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  async function removeCredential(provider: string, name: string) {
    try {
      await del('/api/credentials', { provider, name });
      toast.success('Removed');
      router.refresh();
    } catch (err) {
      toast.error('Could not remove', err instanceof Error ? err.message : undefined);
    }
  }

  async function logout() {
    try {
      await post('/api/auth/logout');
      window.location.href = '/login';
    } catch {
      window.location.href = '/login';
    }
  }

  return (
    <>
      <SectionTitle>Connections</SectionTitle>
      <div className="space-y-3">
        {providers.map((p) => {
          const ok = configured[p.id];
          const sync = syncs[p.id];

          return (
            <div key={p.id} className="card overflow-hidden">
              <div className="flex items-start gap-3 p-4">
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                    ok ? 'border-good/40 bg-good/10 text-good' : 'border-line bg-raised/60 text-faint'
                  }`}
                >
                  <Icon name={ok ? 'check' : 'link'} size={16} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{p.label}</p>
                    {ok ? (
                      <span className="chip border-good/40 text-good">connected</span>
                    ) : (
                      <span className="chip">not set up</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{p.blurb}</p>
                  {sync?.at ? (
                    <p className="mt-1 text-xs text-faint">
                      Last sync {relativeTime(sync.at)}
                      {sync.status === 'error' ? (
                        <span className="text-bad"> — {sync.message.slice(0, 60)}</span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </div>

              <ul className="divide-y divide-line/60 border-t border-line/60">
                {p.fields.map((f) => {
                  const cred = credFor(p.id, f.name);
                  return (
                    <li key={f.name} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          {f.label}
                          {f.required ? <span className="text-bad"> *</span> : null}
                        </p>
                        <p className="truncate text-xs text-faint">
                          {cred
                            ? cred.source === 'env'
                              ? `Set via environment · ••••${cred.hint}`
                              : `••••${cred.hint}`
                            : 'Not set'}
                        </p>
                      </div>

                      {cred?.source === 'env' ? (
                        <span className="chip shrink-0">env</span>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditing({ provider: p, field: f })}
                            disabled={!encryptionReady}
                            className="rounded-lg p-2 text-muted transition hover:bg-raised hover:text-fg disabled:opacity-40"
                            aria-label={`Set ${f.label}`}
                          >
                            <Icon name="edit" size={15} />
                          </button>
                          {cred ? (
                            <button
                              type="button"
                              onClick={() => removeCredential(p.id, f.name)}
                              className="rounded-lg p-2 text-faint transition hover:bg-bad/10 hover:text-bad"
                              aria-label={`Remove ${f.label}`}
                            >
                              <Icon name="trash" size={15} />
                            </button>
                          ) : null}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {ok ? (
                <div className="grid grid-cols-2 gap-2 border-t border-line/60 p-3">
                  <button
                    type="button"
                    onClick={() => runSync(p.id, 'test')}
                    disabled={busy !== null}
                    className="btn-ghost h-10 min-h-0 text-xs"
                  >
                    {busy === `${p.id}:test` ? 'Testing…' : 'Test'}
                  </button>
                  <button
                    type="button"
                    onClick={() => runSync(p.id, 'sync')}
                    disabled={busy !== null}
                    className="btn-primary h-10 min-h-0 text-xs"
                  >
                    <Icon
                      name="refresh"
                      size={14}
                      className={busy === `${p.id}:sync` ? 'animate-spin' : ''}
                    />
                    {busy === `${p.id}:sync` ? 'Syncing…' : 'Sync'}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Webhook endpoints — real-time updates without polling. */}
      <SectionTitle>Webhooks</SectionTitle>
      <div className="card-pad space-y-3">
        <p className="text-xs text-muted">
          Point these at your store/company settings for instant updates instead of waiting for a
          sync. Both verify an HMAC signature and reject anything unsigned.
        </p>
        {[
          ['Shopify', '/api/webhooks/shopify'],
          ['Whop', '/api/webhooks/whop'],
        ].map(([label, path]) => (
          <div key={path}>
            <p className="label">{label}</p>
            <code className="block overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-raised/60 px-3 py-2 font-mono text-xs text-muted">
              {typeof window !== 'undefined' ? window.location.origin : ''}
              {path}
            </code>
          </div>
        ))}
      </div>

      {/* ---------------------------------------------------------- security */}
      <SectionTitle>Security</SectionTitle>
      <div className="card divide-y divide-line/60">
        <button
          type="button"
          onClick={() => setTwoFa(true)}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-raised/50"
        >
          <span className={twoFactorEnabled ? 'text-good' : 'text-faint'}>
            <Icon name="shield" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Two-factor authentication</span>
            <span className="block text-xs text-faint">
              {twoFactorEnabled ? 'On — codes required at sign-in' : 'Off — strongly recommended'}
            </span>
          </span>
          <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
        </button>

        <button
          type="button"
          onClick={() => setPassword(true)}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-raised/50"
        >
          <span className="text-faint">
            <Icon name="lock" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Change password</span>
            <span className="block text-xs text-faint">
              Signs out all {sessionCount} device{sessionCount === 1 ? '' : 's'}
            </span>
          </span>
          <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
        </button>

        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-bad transition active:bg-bad/10"
        >
          <Icon name="logout" size={18} />
          <span className="flex-1 text-sm font-medium">Sign out</span>
        </button>
      </div>

      <InstallHint />

      {editing ? (
        <CredentialSheet
          provider={editing.provider}
          field={editing.field}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      <TwoFactorSheet
        open={twoFa}
        enabled={twoFactorEnabled}
        onClose={() => setTwoFa(false)}
        onChanged={() => {
          setTwoFa(false);
          router.refresh();
        }}
      />

      <PasswordSheet open={password} onClose={() => setPassword(false)} />
    </>
  );
}

function CredentialSheet({
  provider,
  field,
  onClose,
  onSaved,
}: {
  provider: ProviderDef;
  field: FieldDef;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await put('/api/credentials', { provider: provider.id, name: field.name, value });
      setValue('');
      toast.success('Saved', `${provider.label} ${field.label}`);
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={`${provider.label} · ${field.label}`}>
      <form onSubmit={save} className="space-y-4 pb-2">
        <div>
          <label className="label" htmlFor="cred">{field.label}</label>
          <input
            id="cred"
            className="input font-mono text-sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            // type=password even for non-secrets keeps it out of screenshots
            // and off the keyboard's learned-words list.
            type={field.secret ? 'password' : 'text'}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            required
          />
          <p className="mt-2 text-xs text-muted">{field.help}</p>
        </div>

        <p className="flex items-start gap-2 rounded-xl border border-line bg-raised/40 px-3 py-2.5 text-xs text-muted">
          <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
          <span>
            Encrypted with AES-256-GCM before it touches disk. Once saved it can be replaced or
            deleted, but never read back — not even by this screen.
          </span>
        </p>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Sheet>
  );
}

function TwoFactorSheet({
  open,
  enabled,
  onClose,
  onChanged,
}: {
  open: boolean;
  enabled: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function begin() {
    setBusy(true);
    try {
      const res = await post<{ secret: string; uri: string }>('/api/auth/totp', { action: 'begin' });
      setSecret(res.secret);
      setUri(res.uri);
    } catch (err) {
      toast.error('Could not start', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      await post('/api/auth/totp', { action: 'confirm', secret, code });
      toast.success('Two-factor is on');
      setSecret('');
      setCode('');
      onChanged();
    } catch (err) {
      toast.error('Wrong code', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await post('/api/auth/totp', { action: 'disable', password });
      toast.success('Two-factor is off');
      setPassword('');
      onChanged();
    } catch (err) {
      toast.error('Could not disable', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Two-factor authentication">
      <div className="space-y-4 pb-2">
        {enabled ? (
          <>
            <p className="text-sm text-muted">
              Two-factor is on. Turning it off makes your revenue data reachable with a password
              alone.
            </p>
            <div>
              <label className="label" htmlFor="tf-pw">Confirm your password</label>
              <input
                id="tf-pw"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button type="button" onClick={disable} className="btn-danger w-full" disabled={busy || !password}>
              {busy ? 'Working…' : 'Turn off two-factor'}
            </button>
          </>
        ) : !secret ? (
          <>
            <p className="text-sm text-muted">
              Add a code from your authenticator app on top of your password. Takes about thirty
              seconds to set up.
            </p>
            <button type="button" onClick={begin} className="btn-primary w-full" disabled={busy}>
              {busy ? 'Working…' : 'Set it up'}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Add this key to your authenticator app, then enter the code it shows.
            </p>

            <div>
              <p className="label">Setup key</p>
              <code className="block break-all rounded-xl border border-line bg-raised/60 px-3 py-3 font-mono text-sm tracking-wider text-fg">
                {secret.match(/.{1,4}/g)?.join(' ')}
              </code>
            </div>

            <a href={uri} className="btn-ghost w-full">
              <Icon name="link" size={15} /> Open in authenticator
            </a>

            <div>
              <label className="label" htmlFor="tf-code">Code from the app</label>
              <input
                id="tf-code"
                className="input text-center text-2xl tracking-[0.4em] nums"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="000000"
                maxLength={6}
              />
            </div>

            <button
              type="button"
              onClick={confirm}
              className="btn-primary w-full"
              disabled={busy || code.length !== 6}
            >
              {busy ? 'Checking…' : 'Turn on two-factor'}
            </button>

            <p className="text-xs text-faint">
              Nothing is saved until the code checks out, so a mis-scanned key can&apos;t lock you
              out.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}

function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await patch('/api/auth/totp', { currentPassword: current, newPassword: next });
      toast.success('Password changed', 'Signing you out…');
      setTimeout(() => {
        window.location.href = '/login';
      }, 1200);
    } catch (err) {
      toast.error('Could not change', err instanceof Error ? err.message : undefined);
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Change password">
      <form onSubmit={save} className="space-y-4 pb-2">
        <div>
          <label className="label" htmlFor="pw-current">Current password</label>
          <input
            id="pw-current"
            type="password"
            className="input"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="pw-next">New password</label>
          <input
            id="pw-next"
            type="password"
            className="input"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            placeholder="At least 12 characters"
            required
            minLength={12}
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Working…' : 'Change password'}
        </button>
      </form>
    </Sheet>
  );
}

/** Nudges the Chrome install flow, which is how this gets onto the home screen. */
function InstallHint() {
  const [installed, setInstalled] = useState(false);

  if (typeof window !== 'undefined' && !installed) {
    // display-mode: standalone is true once it's running as an installed app.
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
    if (standalone) setInstalled(true);
  }

  if (installed) return null;

  return (
    <div className="card mt-6 border-brand/30 bg-brand/5 p-4">
      <div className="flex items-start gap-3">
        <span className="text-brand">
          <Icon name="home" size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold">Put this on your home screen</p>
          <p className="mt-1 text-sm text-muted">
            In Chrome, tap the ⋮ menu → <strong className="text-fg">Add to Home screen</strong>. It
            installs like a normal app: own icon, full screen, works offline.
          </p>
        </div>
      </div>
    </div>
  );
}
