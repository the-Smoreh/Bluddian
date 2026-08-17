import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * All secret material handling lives here so there is exactly one place to
 * audit. Nothing in this file may ever be imported by a client component.
 */

const KEY_ENV = 'APP_ENCRYPTION_KEY';

let cachedKey: Buffer | null = null;

/** 32-byte master key from env, used for AES-256-GCM of stored credentials. */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(
      `${KEY_ENV} is not set. Generate one with \`npm run keygen\` and put it in .env.local.`,
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `${KEY_ENV} must be exactly 32 bytes, base64-encoded (got ${key.length}). Run \`npm run keygen\`.`,
    );
  }
  cachedKey = key;
  return key;
}

/** True when the server is configured well enough to store credentials. */
export function encryptionReady(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * AES-256-GCM. Output is `v1.<iv>.<tag>.<ciphertext>`, all base64url.
 * The version prefix lets us rotate the scheme later without ambiguity.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', b64u(iv), b64u(tag), b64u(enc)].join('.');
}

export function decrypt(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Malformed ciphertext');
  }
  const [, ivS, tagS, dataS] = parts;
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), unb64u(ivS));
  decipher.setAuthTag(unb64u(tagS));
  // .final() throws if the tag does not verify, which is what we want: a
  // tampered or wrong-key blob must fail loudly rather than return garbage.
  return Buffer.concat([decipher.update(unb64u(dataS)), decipher.final()]).toString('utf8');
}

/** Decrypt without throwing — returns null if the blob is unreadable. */
export function tryDecrypt(payload: string): string | null {
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- passwords --

const SCRYPT_N = 1 << 15; // ~32 MiB of work per hash
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, SCRYPT_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: 128 * SCRYPT_N * SCRYPT_r * 2,
  });
  return ['scrypt', SCRYPT_N, SCRYPT_r, SCRYPT_p, b64u(salt), b64u(hash)].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, nS, rS, pS, saltS, hashS] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const N = Number(nS);
    const r = Number(rS);
    const p = Number(pS);
    const expected = unb64u(hashS);
    const actual = scryptSync(password.normalize('NFKC'), unb64u(saltS), expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// -------------------------------------------------------------- tokens ----

export function randomToken(bytes = 32): string {
  return b64u(randomBytes(bytes));
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Constant-time string compare that tolerates length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Hash first so differing lengths don't leak via an early return.
  const ah = createHash('sha256').update(ab).digest();
  const bh = createHash('sha256').update(bb).digest();
  return timingSafeEqual(ah, bh);
}

export function hmac(key: string | Buffer, data: string | Buffer, enc: 'hex' | 'base64' = 'hex') {
  return createHmac('sha256', key).update(data).digest(enc);
}

// ---------------------------------------------------------------- TOTP ----

/** RFC 4648 base32 (no padding) — the encoding authenticator apps expect. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function totpAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/**
 * Verify a 6-digit code, allowing +/- one 30s step for clock drift.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) return false;
  const counter = Math.floor(now / 30_000);
  for (let drift = -1; drift <= 1; drift++) {
    if (safeEqual(totpAt(secret, counter + drift), clean)) return true;
  }
  return false;
}

export function totpUri(secret: string, account: string, issuer = 'Bluddian'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --------------------------------------------------------------- helpers --

function b64u(buf: Buffer): string {
  return buf.toString('base64url');
}

function unb64u(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}
