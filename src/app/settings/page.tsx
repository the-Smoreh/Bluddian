import { requireAuth } from '@/lib/auth';
import { encryptionReady } from '@/lib/crypto';
import { listCredentials, configuredProviders, PROVIDERS } from '@/lib/credentials';
import { db } from '@/lib/db';
import { relativeTime } from '@/lib/money';
import { lastSyncFor } from '@/lib/queries';
import { BottomNav, Page, PageHeader, SectionTitle } from '@/components/Shell';
import { SettingsClient } from '@/components/SettingsClient';
import { Icon } from '@/components/Icon';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { user } = await requireAuth();

  const credentials = listCredentials();
  const configured = configuredProviders();
  const ready = encryptionReady();

  const syncs = {
    anthropic: lastSyncFor('anthropic'),
    whop: lastSyncFor('whop'),
    shopify: lastSyncFor('shopify'),
  };

  const audit = db
    .prepare('SELECT id, action, detail, created_at FROM audit_log ORDER BY created_at DESC LIMIT 10')
    .all() as { id: string; action: string; detail: string; created_at: number }[];

  const sessionCount = (
    db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?').get(Date.now()) as {
      n: number;
    }
  ).n;

  // Serialisable shape only — PROVIDERS is a const object with readonly arrays.
  const providerDefs = Object.entries(PROVIDERS).map(([id, def]) => ({
    id,
    label: def.label,
    blurb: def.blurb,
    fields: def.fields.map((f) => ({
      name: f.name,
      label: f.label,
      help: f.help,
      required: f.required,
      secret: f.secret,
    })),
  }));

  return (
    <>
      <Page>
        <PageHeader title="Settings" subtitle={user.email} />

        {!ready ? (
          <div className="card mb-4 border-bad/40 bg-bad/5 p-4">
            <div className="flex items-start gap-3">
              <span className="text-bad">
                <Icon name="key" size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold text-bad">Encryption key missing</p>
                <p className="mt-1 text-sm text-muted">
                  <code className="rounded bg-raised px-1 py-0.5 text-xs">APP_ENCRYPTION_KEY</code>{' '}
                  isn&apos;t set, so API keys can&apos;t be stored securely. Run{' '}
                  <code className="rounded bg-raised px-1 py-0.5 text-xs">npm run keygen</code> and
                  restart.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <SettingsClient
          providers={providerDefs}
          credentials={credentials}
          configured={configured}
          syncs={syncs}
          twoFactorEnabled={Boolean(user.totp_enabled)}
          encryptionReady={ready}
          sessionCount={sessionCount}
        />

        {audit.length > 0 ? (
          <>
            <SectionTitle>Security log</SectionTitle>
            <ul className="card divide-y divide-line/60">
              {audit.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs text-muted">{a.action}</span>
                    {a.detail ? (
                      <span className="block truncate text-xs text-faint">{a.detail}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-faint">{relativeTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 px-1 text-xs text-faint">
              Credential values are never logged — only which field changed.
            </p>
          </>
        ) : null}
      </Page>
      <BottomNav />
    </>
  );
}
