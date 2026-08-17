'use client';

/**
 * On-device cryptography. Everything here runs in the browser against WebCrypto
 * — there is no server, so this is the only thing standing between someone
 * holding your unlocked phone and your revenue history.
 *
 * Key hierarchy:
 *
 *   DEK (random 256-bit)  ──encrypts──>  the whole database blob
 *    │
 *    ├── wrapped by  KEK_bio   (derived from a WebAuthn PRF secret)
 *    └── wrapped by  KEK_pin   (derived from your recovery PIN via PBKDF2)
 *
 * Two wrapped copies of the SAME data key means either factor opens the vault,
 * and adding or removing a factor never re-encrypts the database. It also means
 * a phone reset doesn't destroy your data, as long as you know the PIN.
 */

const AES = 'AES-GCM';
const IV_BYTES = 12;

/** PBKDF2 rounds for the recovery PIN. A 6-digit PIN has only 10^6 options, so
 *  the derivation has to be slow enough that offline guessing is impractical
 *  even with the encrypted blob in hand. ~600k rounds is roughly 0.5–1s on a
 *  modern phone, which is tolerable once per unlock and brutal at scale. */
const PBKDF2_ROUNDS = 600_000;

export type WrappedKey = {
  /** base64url of the AES-GCM ciphertext of the raw DEK */
  ct: string;
  iv: string;
  /** salt for PBKDF2 wraps; absent for PRF-derived wraps */
  salt?: string;
  rounds?: number;
};

// ------------------------------------------------------------------ base64 --

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

// --------------------------------------------------------------- data key --

/** Fresh random data-encryption key. Generated once, at first setup. */
export async function generateDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: AES, length: 256 }, true, ['encrypt', 'decrypt']);
}

async function importAesKey(raw: BufferSource, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, AES, extractable, ['encrypt', 'decrypt']);
}

// ---------------------------------------------------------- key derivation --

/** Derive a wrapping key from a PIN or passphrase. */
export async function deriveKeyFromPin(
  pin: string,
  salt: Uint8Array,
  rounds = PBKDF2_ROUNDS,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: rounds, hash: 'SHA-256' },
    base,
    { name: AES, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Derive a wrapping key from a WebAuthn PRF output. The PRF secret is already
 * 32 bytes of high-entropy material produced by the authenticator, so it needs
 * a fast KDF rather than a slow one — there is nothing to brute-force.
 */
export async function deriveKeyFromPrf(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('bluddian-vault-v1'),
    },
    base,
    { name: AES, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// -------------------------------------------------------------- wrap/unwrap --

/** Encrypt the DEK under a wrapping key so it can be stored at rest. */
export async function wrapDek(
  dek: CryptoKey,
  kek: CryptoKey,
  salt?: Uint8Array,
): Promise<WrappedKey> {
  const raw = await crypto.subtle.exportKey('raw', dek);
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt({ name: AES, iv: iv as BufferSource }, kek, raw);

  return {
    ct: toB64(ct),
    iv: toB64(iv),
    ...(salt ? { salt: toB64(salt), rounds: PBKDF2_ROUNDS } : {}),
  };
}

/**
 * Recover the DEK. Throws if the wrapping key is wrong — GCM authentication
 * means a bad PIN fails loudly rather than yielding a garbage key that would
 * corrupt the database on next write.
 */
export async function unwrapDek(wrapped: WrappedKey, kek: CryptoKey): Promise<CryptoKey> {
  const raw = await crypto.subtle.decrypt(
    { name: AES, iv: fromB64(wrapped.iv) as BufferSource },
    kek,
    fromB64(wrapped.ct) as BufferSource,
  );
  return importAesKey(raw, true);
}

// ------------------------------------------------------------ payload enc --

/** Encrypt an arbitrary JSON-serialisable value under the DEK. */
export async function encryptJson(
  dek: CryptoKey,
  value: unknown,
): Promise<{ ct: string; iv: string }> {
  const iv = randomBytes(IV_BYTES);
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt(
    { name: AES, iv: iv as BufferSource },
    dek,
    data as BufferSource,
  );
  return { ct: toB64(ct), iv: toB64(iv) };
}

export async function decryptJson<T>(
  dek: CryptoKey,
  payload: { ct: string; iv: string },
): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: AES, iv: fromB64(payload.iv) as BufferSource },
    dek,
    fromB64(payload.ct) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export const PBKDF2_DEFAULT_ROUNDS = PBKDF2_ROUNDS;
