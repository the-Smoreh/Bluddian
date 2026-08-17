'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { SectionTitle } from '@/components/Shell';
import { useToast } from '@/components/Toast';
import { useDb } from '@/lib/local/useStore';
import { deleteCredential, setCredential } from '@/lib/local/actions';
import {
  CONNECTORS,
  credKey,
  isConfigured,
  RELAY_TOKEN_KEY,
  RELAY_URL_KEY,
  relayConfigured,
  syncConnector,
  testConnector,
  type Connector,
} from '@/lib/local/connectors';
import { testRelay } from '@/lib/local/connectors/relay';
import { relativeTime } from '@/lib/money';

/**
 * Connections settings. The relay is presented first because every platform
 * depends on it — showing Shopify above a relay that isn't set up would just
 * produce confusing failures.
 */
export function Connections() {
  const db = useDb();
  const toast = useToast();
  const [relayOpen, setRelayOpen] = useState(false);
  const [editing, setEditing] = useState<Connector | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const hasRelay = relayConfigured(db.credentials);

  async function run(connectorId: string, action: 'test' | 'sync') {
    if (busy) return;
    setBusy(`${connectorId}:${action}`);
    try {
      if (action === 'test') {
        toast.success('Connected', await testConnector(connectorId));
      } else {
        const result = await syncConnector(connectorId);
        if (result.ok) toast.success('Synced', result.message);
        else toast.error('Sync failed', result.message);
      }
    } catch (err) {
      toast.error('Failed', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <SectionTitle>Auto-sync relay</SectionTitle>

      <button
        type="button"
        onClick={() => setRelayOpen(true)}
        className={`card flex w-full items-start gap-3 p-4 text-left ${
          hasRelay ? '' : 'border-brand/30 bg-brand/5'
        }`}
      >
        <span className={`mt-0.5 shrink-0 ${hasRelay ? 'text-good' : 'text-brand'}`}>
          <Icon name={hasRelay ? 'check' : 'link'} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {hasRelay ? 'Relay connected' : 'Set up the relay'}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted">
            {hasRelay
              ? 'Shopify and Whop can sync automatically.'
              : "Shopify and Whop block phone browsers from calling them directly. A free relay unblocks that — one-time setup, nothing stored on it."}
          </span>
        </span>
        <Icon name="chevronRight" size={16} className="mt-0.5 shrink-0 text-faint" />
      </button>

      <SectionTitle>Platforms</SectionTitle>
      <div className="space-y-3">
        {CONNECTORS.map((connector) => {
          const ready = isConfigured(connector.id);
          const sync = db.syncs[connector.id];

          return (
            <div key={connector.id} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => setEditing(connector)}
                className="flex w-full items-start gap-3 p-4 text-left"
              >
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                    ready ? 'border-good/40 bg-good/10 text-good' : 'border-line bg-raised/60 text-faint'
                  }`}
                >
                  <Icon name={ready ? 'check' : 'link'} size={16} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{connector.label}</span>
                    {ready ? (
                      <span className="chip border-good/40 text-good">ready</span>
                    ) : (
                      <span className="chip">not set up</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{connector.blurb}</span>
                  {sync ? (
                    <span className="mt-1 block text-xs text-faint">
                      {sync.status === 'error' ? (
                        <span className="text-bad">Failed {relativeTime(sync.at)} — {sync.message}</span>
                      ) : (
                        <>Synced {relativeTime(sync.at)} · {sync.message}</>
                      )}
                    </span>
                  ) : null}
                </span>

                <Icon name="chevronRight" size={16} className="mt-0.5 shrink-0 text-faint" />
              </button>

              {ready ? (
                <div className="grid grid-cols-2 gap-2 border-t border-line/60 p-3">
                  <button
                    type="button"
                    onClick={() => run(connector.id, 'test')}
                    disabled={busy !== null}
                    className="btn-ghost h-10 min-h-0 text-xs"
                  >
                    {busy === `${connector.id}:test` ? 'Testing…' : 'Test'}
                  </button>
                  <button
                    type="button"
                    onClick={() => run(connector.id, 'sync')}
                    disabled={busy !== null}
                    className="btn-primary h-10 min-h-0 text-xs"
                  >
                    <Icon
                      name="refresh"
                      size={14}
                      className={busy === `${connector.id}:sync` ? 'animate-spin' : ''}
                    />
                    {busy === `${connector.id}:sync` ? 'Syncing…' : 'Sync now'}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <RelaySheet open={relayOpen} onClose={() => setRelayOpen(false)} />
      {editing ? (
        <CredentialSheet connector={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function RelaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb();
  const toast = useToast();
  const [url, setUrl] = useState(db.credentials[RELAY_URL_KEY] ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const savedToken = db.credentials[RELAY_TOKEN_KEY];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const finalToken = token.trim() || savedToken;
    if (!url.trim() || !finalToken) {
      toast.error('Both the URL and the token are needed.');
      return;
    }

    setBusy(true);
    try {
      const message = await testRelay(url.trim(), finalToken);
      setCredential(RELAY_URL_KEY, url.trim());
      setCredential(RELAY_TOKEN_KEY, finalToken);
      toast.success('Relay connected', message);
      setToken('');
      onClose();
    } catch (err) {
      // Deliberately not saved on failure — a relay that doesn't work should
      // not look configured.
      toast.error('Relay test failed', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Auto-sync relay">
      <form onSubmit={save} className="space-y-4 pb-2">
        <div className="rounded-xl border border-line bg-raised/40 p-4">
          <p className="text-sm font-semibold">Why this is needed</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Shopify and Whop refuse to answer web browsers — their APIs are built for servers.
            The relay is a 50-line Cloudflare Worker that forwards one request. It stores nothing,
            logs nothing, and only talks to Shopify and Whop.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-faint">
            Setup instructions are in <span className="font-mono">worker/README.md</span> in your
            repo. Takes about three minutes, free forever.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="relay-url">Worker URL</label>
          <input
            id="relay-url"
            className="input font-mono text-sm"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://bluddian-relay.you.workers.dev"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div>
          <label className="label" htmlFor="relay-token">
            Relay token {savedToken ? '(leave blank to keep)' : ''}
          </label>
          <input
            id="relay-token"
            type="password"
            className="input font-mono text-sm"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={savedToken ? '••••••••' : 'The RELAY_TOKEN secret you set'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Testing…' : 'Test and save'}
        </button>

        {savedToken ? (
          <button
            type="button"
            onClick={() => {
              deleteCredential(RELAY_URL_KEY);
              deleteCredential(RELAY_TOKEN_KEY);
              toast.success('Relay removed');
              onClose();
            }}
            className="w-full text-center text-xs font-semibold text-faint"
          >
            Remove relay
          </button>
        ) : null}
      </form>
    </Sheet>
  );
}

function CredentialSheet({ connector, onClose }: { connector: Connector; onClose: () => void }) {
  const db = useDb();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);

    for (const field of connector.fields) {
      const entered = values[field.name];
      // Blank means "leave what's already stored", so a saved secret survives
      // an edit that only changes another field.
      if (entered !== undefined && entered.trim() !== '') {
        setCredential(credKey(connector.id, field.name), entered.trim());
      }
    }

    toast.success('Saved', connector.label);
    setBusy(false);
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={connector.label}>
      <form onSubmit={save} className="space-y-4 pb-2">
        {connector.fields.map((field) => {
          const existing = db.credentials[credKey(connector.id, field.name)];
          return (
            <div key={field.name}>
              <label className="label" htmlFor={`f-${field.name}`}>
                {field.label}
                {field.required ? <span className="text-bad"> *</span> : null}
              </label>
              <input
                id={`f-${field.name}`}
                className="input font-mono text-sm"
                type={field.secret ? 'password' : 'text'}
                value={values[field.name] ?? ''}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                placeholder={
                  existing
                    ? field.secret
                      ? '•••• saved — leave blank to keep'
                      : existing
                    : (field.placeholder ?? '')
                }
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{field.help}</p>
              {existing ? (
                <button
                  type="button"
                  onClick={() => {
                    deleteCredential(credKey(connector.id, field.name));
                    toast.success('Removed', field.label);
                  }}
                  className="mt-1.5 text-xs font-semibold text-faint"
                >
                  Remove
                </button>
              ) : null}
            </div>
          );
        })}

        <p className="flex items-start gap-2 rounded-xl border border-line bg-raised/40 px-3 py-2.5 text-xs text-muted">
          <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
          <span>
            Stored inside your encrypted database on this phone. Only your fingerprint or PIN can
            decrypt it.
          </span>
        </p>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          Save
        </button>
      </form>
    </Sheet>
  );
}
