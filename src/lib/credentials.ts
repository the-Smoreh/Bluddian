import 'server-only';
import { db, newId, now } from '@/lib/db';
import { decrypt, encrypt, encryptionReady } from '@/lib/crypto';

/**
 * Credential vault.
 *
 * Rules enforced here, not by convention:
 *  - Plaintext secrets exist only inside this module's return values, which are
 *    consumed by server-side integration code and never serialised to a client.
 *  - `listCredentials()` is the ONLY shape allowed to reach the browser, and it
 *    physically cannot contain a secret — it returns a 4-char hint.
 *  - `server-only` makes importing this from a client component a build error.
 */

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    blurb: 'Claude API spend and token usage.',
    fields: [
      {
        name: 'admin_api_key',
        label: 'Admin API key',
        help: 'Console → Settings → Admin keys. Starts with sk-ant-admin. Required for usage/cost reporting.',
        required: true,
        secret: true,
      },
    ],
  },
  whop: {
    label: 'Whop',
    blurb: 'Products, memberships, and payments.',
    fields: [
      {
        name: 'api_key',
        label: 'API key',
        help: 'Whop dashboard → Developer → API keys.',
        required: true,
        secret: true,
      },
      {
        name: 'company_id',
        label: 'Company ID',
        help: 'Optional. Scopes the sync to one company (biz_...).',
        required: false,
        secret: false,
      },
      {
        name: 'webhook_secret',
        label: 'Webhook secret',
        help: 'Optional. Set this to accept real-time payment webhooks.',
        required: false,
        secret: true,
      },
    ],
  },
  shopify: {
    label: 'Shopify',
    blurb: 'Orders and products from your store.',
    fields: [
      {
        name: 'shop_domain',
        label: 'Shop domain',
        help: 'yourstore.myshopify.com',
        required: true,
        secret: false,
      },
      {
        name: 'admin_token',
        label: 'Admin API access token',
        help: 'Custom app → Admin API access token (shpat_...). Needs read_orders and read_products.',
        required: true,
        secret: true,
      },
      {
        name: 'webhook_secret',
        label: 'Webhook signing secret',
        help: 'Optional. Required to accept order webhooks.',
        required: true,
        secret: true,
      },
    ],
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

export type CredentialSummary = {
  provider: ProviderId;
  name: string;
  hint: string;
  updated_at: number;
  source: 'db' | 'env';
};

/** Env fallback, so you can deploy with secrets injected instead of typed in. */
function envKey(provider: string, name: string): string {
  return `${provider}_${name}`.toUpperCase();
}

/**
 * Read a credential. Environment variables win over the database, so a
 * platform-injected secret can't be silently overridden through the UI.
 * Returns null when unset — callers must handle "not configured".
 */
export function getCredential(provider: ProviderId, name: string): string | null {
  const fromEnv = process.env[envKey(provider, name)];
  if (fromEnv) return fromEnv;

  if (!encryptionReady()) return null;

  const row = db
    .prepare('SELECT ciphertext FROM credentials WHERE provider = ? AND name = ?')
    .get(provider, name) as { ciphertext: string } | undefined;
  if (!row) return null;

  try {
    return decrypt(row.ciphertext);
  } catch {
    // Wrong APP_ENCRYPTION_KEY, or the row was tampered with. Treat as absent
    // rather than crashing the whole dashboard.
    console.error(`[credentials] could not decrypt ${provider}.${name} — key rotated?`);
    return null;
  }
}

export function setCredential(provider: ProviderId, name: string, value: string): void {
  if (!encryptionReady()) {
    throw new Error('APP_ENCRYPTION_KEY is not configured — cannot store credentials.');
  }
  const trimmed = value.trim();
  const hint = trimmed.length > 4 ? trimmed.slice(-4) : '••••';
  const t = now();

  db.prepare(
    `INSERT INTO credentials (id, provider, name, ciphertext, hint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, name) DO UPDATE SET
       ciphertext = excluded.ciphertext, hint = excluded.hint, updated_at = excluded.updated_at`,
  ).run(newId(), provider, name, encrypt(trimmed), hint, t, t);
}

export function deleteCredential(provider: ProviderId, name: string): void {
  db.prepare('DELETE FROM credentials WHERE provider = ? AND name = ?').run(provider, name);
}

/**
 * Client-safe listing. Contains hints only — by construction there is no code
 * path from here to a plaintext secret.
 */
export function listCredentials(): CredentialSummary[] {
  const out: CredentialSummary[] = [];

  const rows = encryptionReady()
    ? (db
        .prepare('SELECT provider, name, hint, updated_at FROM credentials')
        .all() as { provider: ProviderId; name: string; hint: string; updated_at: number }[])
    : [];
  const byKey = new Map(rows.map((r) => [`${r.provider}.${r.name}`, r]));

  for (const [provider, def] of Object.entries(PROVIDERS) as [ProviderId, (typeof PROVIDERS)[ProviderId]][]) {
    for (const field of def.fields) {
      const fromEnv = process.env[envKey(provider, field.name)];
      if (fromEnv) {
        out.push({
          provider,
          name: field.name,
          hint: fromEnv.length > 4 ? fromEnv.slice(-4) : '••••',
          updated_at: 0,
          source: 'env',
        });
        continue;
      }
      const row = byKey.get(`${provider}.${field.name}`);
      if (row) {
        out.push({ provider, name: field.name, hint: row.hint, updated_at: row.updated_at, source: 'db' });
      }
    }
  }
  return out;
}

/** Whether every required field for a provider is present. */
export function providerConfigured(provider: ProviderId): boolean {
  return PROVIDERS[provider].fields
    .filter((f) => f.required)
    .every((f) => Boolean(getCredential(provider, f.name)));
}

export function configuredProviders(): Record<ProviderId, boolean> {
  return {
    anthropic: providerConfigured('anthropic'),
    whop: providerConfigured('whop'),
    shopify: providerConfigured('shopify'),
  };
}
