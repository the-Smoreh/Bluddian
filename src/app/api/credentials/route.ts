import { z } from 'zod';
import { audit } from '@/lib/auth';
import { encryptionReady } from '@/lib/crypto';
import {
  configuredProviders,
  deleteCredential,
  listCredentials,
  PROVIDERS,
  setCredential,
  type ProviderId,
} from '@/lib/credentials';
import { fail, guard, handler, json, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROVIDER_IDS = Object.keys(PROVIDERS) as [ProviderId, ...ProviderId[]];

/**
 * Note what this endpoint does NOT have: a way to read a secret back. There is
 * no GET that returns plaintext, by design. Once a key is stored, the only
 * thing you can do through the API is replace it or delete it.
 */
export const GET = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  return json({
    credentials: listCredentials(),
    configured: configuredProviders(),
    encryptionReady: encryptionReady(),
  });
});

const PutBody = z.object({
  provider: z.enum(PROVIDER_IDS),
  name: z.string().min(1).max(60),
  value: z.string().min(1, 'Paste the value.').max(1000),
});

export const PUT = handler(async (req) => {
  const g = await guard(req, { bucket: 'credentials' });
  if (!g.ok) return g.response;

  if (!encryptionReady()) {
    return fail(
      503,
      'APP_ENCRYPTION_KEY is not set on the server, so credentials cannot be stored securely. Run `npm run keygen`.',
    );
  }

  const parsed = await readJson(req, PutBody);
  if (!parsed.ok) return parsed.response;
  const { provider, name, value } = parsed.data;

  // Only accept field names this provider actually declares, so the table
  // can't be used as arbitrary encrypted storage.
  const known = PROVIDERS[provider].fields.some((f) => f.name === name);
  if (!known) return fail(422, `Unknown field "${name}" for ${provider}.`);

  setCredential(provider, name, value);
  // Deliberately logs the field name only — never any part of the value.
  await audit('credential.set', `${provider}.${name}`);

  return json({ ok: true, credentials: listCredentials(), configured: configuredProviders() });
});

const DeleteBody = z.object({
  provider: z.enum(PROVIDER_IDS),
  name: z.string().min(1).max(60),
});

export const DELETE = handler(async (req) => {
  const g = await guard(req, { bucket: 'credentials' });
  if (!g.ok) return g.response;

  const parsed = await readJson(req, DeleteBody);
  if (!parsed.ok) return parsed.response;

  deleteCredential(parsed.data.provider, parsed.data.name);
  await audit('credential.deleted', `${parsed.data.provider}.${parsed.data.name}`);

  return json({ ok: true, credentials: listCredentials(), configured: configuredProviders() });
});
