'use client';

import {
  decryptJson,
  deriveKeyFromPin,
  deriveKeyFromPrf,
  encryptJson,
  fromB64,
  generateDek,
  randomBytes,
  toB64,
  unwrapDek,
  wrapDek,
  type WrappedKey,
} from '@/lib/local/crypto';
import { idbClear, idbGet, idbSet, requestPersistence } from '@/lib/local/idb';

/**
 * The vault: what holds the encryption key, and what it takes to open it.
 *
 * Unlocking with your fingerprint uses the WebAuthn **PRF extension**, which
 * makes the authenticator return a stable 32-byte secret derived from the
 * credential. That secret never leaves the device and cannot be extracted from
 * the phone's secure element — so "unlock with fingerprint" really is
 * decryption, not a screen that could be skipped past.
 *
 * PRF is not universally supported yet, so a recovery PIN is mandatory and
 * always set up first. It is also the only thing that can recover your data if
 * the biometric credential is destroyed (phone reset, screen-lock removed).
 */

const META_KEY = 'vault-meta';
const DATA_KEY = 'vault-data';
const RP_ID_KEY = 'vault-rp';

export type VaultMeta = {
  version: 1;
  createdAt: number;
  /** PIN-wrapped copy of the data key. Always present. */
  pin: WrappedKey;
  /** Biometric-wrapped copy, present once a fingerprint is enrolled. */
  bio?: WrappedKey & { credentialId: string };
  /** Failed unlock attempts since the last success. */
  failures: number;
  lockedUntil?: number;
};

export type UnlockMethod = 'pin' | 'biometric';

// ---------------------------------------------------------------- support --

export function webauthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  );
}

/** Is there a fingerprint/face/screen-lock authenticator on this device? */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  try {
    if (!webauthnSupported()) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function getMeta(): Promise<VaultMeta | undefined> {
  return idbGet<VaultMeta>(META_KEY);
}

export async function vaultExists(): Promise<boolean> {
  return (await getMeta()) !== undefined;
}

// ------------------------------------------------------------ lockout math --

/**
 * Escalating delay after repeated wrong PINs. This is the on-device stand-in
 * for server rate limiting: there is no network to throttle, so the cost has to
 * be imposed here. It does NOT stop an attacker who dumps IndexedDB and
 * attacks the blob offline — that is what PBKDF2's 600k rounds are for. This
 * just makes casual guessing on the handset useless.
 */
export function lockoutMs(failures: number): number {
  if (failures < 3) return 0;
  if (failures < 5) return 30_000;
  if (failures < 8) return 5 * 60_000;
  if (failures < 12) return 30 * 60_000;
  return 60 * 60_000;
}

export function lockRemaining(meta: VaultMeta | undefined): number {
  if (!meta?.lockedUntil) return 0;
  return Math.max(0, meta.lockedUntil - Date.now());
}

// ------------------------------------------------------------------ setup --

/** Create the vault. Called once, on first run. */
export async function createVault(pin: string): Promise<CryptoKey> {
  const dek = await generateDek();
  const salt = randomBytes(16);
  const kek = await deriveKeyFromPin(pin, salt);

  const meta: VaultMeta = {
    version: 1,
    createdAt: Date.now(),
    pin: await wrapDek(dek, kek, salt),
    failures: 0,
  };

  await idbSet(META_KEY, meta);
  // Ask for durable storage as soon as there's something worth keeping.
  void requestPersistence();

  return dek;
}

// ------------------------------------------------------------ pin unlock --

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code:
      'no-vault' | 'wrong-pin' | 'locked' | 'no-biometric' | 'cancelled' | 'unsupported',
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

export async function unlockWithPin(pin: string): Promise<CryptoKey> {
  const meta = await getMeta();
  if (!meta) throw new VaultError('No vault on this device.', 'no-vault');

  const remaining = lockRemaining(meta);
  if (remaining > 0) {
    throw new VaultError('Too many attempts.', 'locked', remaining);
  }

  const kek = await deriveKeyFromPin(pin, fromB64(meta.pin.salt!), meta.pin.rounds);

  try {
    const dek = await unwrapDek(meta.pin, kek);
    // Success clears the penalty.
    await idbSet(META_KEY, { ...meta, failures: 0, lockedUntil: undefined });
    return dek;
  } catch {
    const failures = meta.failures + 1;
    const penalty = lockoutMs(failures);
    await idbSet(META_KEY, {
      ...meta,
      failures,
      lockedUntil: penalty > 0 ? Date.now() + penalty : undefined,
    });
    throw new VaultError('Wrong PIN.', 'wrong-pin', penalty);
  }
}

// ------------------------------------------------------- biometric unlock --

/**
 * The relying-party ID is the origin's domain. It's stored at enrolment so a
 * credential created on one host isn't silently unusable after a move.
 */
function rpId(): string {
  return window.location.hostname;
}

/** Enrol the device authenticator. Requires an already-unlocked vault. */
export async function enrolBiometric(dek: CryptoKey): Promise<void> {
  const meta = await getMeta();
  if (!meta) throw new VaultError('No vault on this device.', 'no-vault');
  if (!(await platformAuthenticatorAvailable())) {
    throw new VaultError('This device has no fingerprint or screen lock set up.', 'no-biometric');
  }

  const prfSalt = randomBytes(32);
  const userId = randomBytes(16);

  let credential: PublicKeyCredential;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32) as BufferSource,
        rp: { id: rpId(), name: 'Bluddian' },
        user: { id: userId as BufferSource, name: 'owner', displayName: 'Bluddian owner' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          // Platform = the phone itself, not a roaming USB key.
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        timeout: 60_000,
        attestation: 'none',
        extensions: { prf: { eval: { first: prfSalt as BufferSource } } },
      },
    })) as PublicKeyCredential;
  } catch (err) {
    throw new VaultError(
      (err as Error).name === 'NotAllowedError' ? 'Cancelled.' : 'Could not register.',
      'cancelled',
    );
  }

  if (!credential) throw new VaultError('Could not register.', 'cancelled');

  const ext = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };

  if (!ext.prf?.enabled) {
    // The credential exists but can't derive a key, so it's useless to us.
    // Fail loudly rather than leaving a button that silently never works.
    throw new VaultError(
      "This device's authenticator can't derive an encryption key (no PRF support). Your PIN still works.",
      'unsupported',
    );
  }

  // Registration may not return the PRF output; a follow-up assertion always does.
  const prfOutput = ext.prf.results?.first ?? (await evaluatePrf(credential.rawId, prfSalt));

  const kek = await deriveKeyFromPrf(prfOutput);

  await idbSet(META_KEY, {
    ...meta,
    bio: {
      ...(await wrapDek(dek, kek)),
      credentialId: toB64(credential.rawId),
      salt: toB64(prfSalt),
    },
  } satisfies VaultMeta);

  await idbSet(RP_ID_KEY, rpId());
}

/** Run an assertion purely to obtain the PRF output for a known credential. */
async function evaluatePrf(credentialId: ArrayBuffer, prfSalt: Uint8Array): Promise<ArrayBuffer> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rpId: rpId(),
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt as BufferSource } } },
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new VaultError('Cancelled.', 'cancelled');

  const ext = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = ext.prf?.results?.first;
  if (!first) {
    throw new VaultError('Authenticator did not return a key.', 'unsupported');
  }
  return first;
}

export async function biometricEnrolled(): Promise<boolean> {
  const meta = await getMeta();
  return Boolean(meta?.bio);
}

export async function unlockWithBiometric(): Promise<CryptoKey> {
  const meta = await getMeta();
  if (!meta) throw new VaultError('No vault on this device.', 'no-vault');
  if (!meta.bio) throw new VaultError('Fingerprint unlock is not set up.', 'no-biometric');

  const prfOutput = await evaluatePrf(
    fromB64(meta.bio.credentialId).buffer as ArrayBuffer,
    fromB64(meta.bio.salt!),
  );

  const kek = await deriveKeyFromPrf(prfOutput);
  const dek = await unwrapDek(meta.bio, kek);

  await idbSet(META_KEY, { ...meta, failures: 0, lockedUntil: undefined });
  return dek;
}

export async function removeBiometric(): Promise<void> {
  const meta = await getMeta();
  if (!meta) return;
  const { bio, ...rest } = meta;
  void bio;
  await idbSet(META_KEY, rest as VaultMeta);
}

// -------------------------------------------------------------- pin change --

/**
 * Re-wrap the data key under a new PIN. The database itself is untouched,
 * because only the wrapping changes — which is exactly why the two-layer key
 * design is worth having.
 */
export async function changePin(dek: CryptoKey, newPin: string): Promise<void> {
  const meta = await getMeta();
  if (!meta) throw new VaultError('No vault on this device.', 'no-vault');

  const salt = randomBytes(16);
  const kek = await deriveKeyFromPin(newPin, salt);

  await idbSet(META_KEY, {
    ...meta,
    pin: await wrapDek(dek, kek, salt),
    failures: 0,
    lockedUntil: undefined,
  } satisfies VaultMeta);
}

// ------------------------------------------------------------ data payload --

export async function readVaultData<T>(dek: CryptoKey): Promise<T | null> {
  const payload = await idbGet<{ ct: string; iv: string }>(DATA_KEY);
  if (!payload) return null;
  return decryptJson<T>(dek, payload);
}

export async function writeVaultData(dek: CryptoKey, data: unknown): Promise<void> {
  await idbSet(DATA_KEY, await encryptJson(dek, data));
}

/** Nuke everything on this device. Irreversible. */
export async function destroyVault(): Promise<void> {
  await idbClear();
}
