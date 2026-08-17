# Security

Bluddian has no server, no account, and no network calls that carry your data.
That removes whole categories of risk — and creates a different, smaller set.
This document is about both, including what is deliberately *not* protected.

## What changed by removing the server

The previous version of this app ran a backend, which meant it needed rate
limiting, CSRF tokens, session cookies, brute-force lockouts on a login
endpoint, HMAC-verified webhooks, and SSRF containment on outbound calls.

**None of that exists any more, because none of it is needed.** There is no
endpoint to flood, no session to steal, no cookie to forge, and no origin to
attack. A denial-of-service attack against this app is indistinguishable from
turning your own phone off.

What's left is the one thing that still matters: someone with physical access to
your unlocked phone, or to a copy of its storage.

## Threat model

**Defended against:**

- Someone picking up your phone and opening the app.
- Someone who extracts the app's raw IndexedDB contents (via a backup, a forensic
  tool, or malware with storage access) and tries to read your revenue history
  or API keys offline.
- Casual PIN guessing on the handset.

**Explicitly NOT defended against:**

- **A compromised or rooted device.** Malware with the ability to read process
  memory or hook the page can take the key while the app is unlocked. No
  browser-based app can defend against this.
- **Someone who knows your PIN**, if you haven't enabled fingerprint unlock.
- **Shoulder-surfing** your PIN entry.
- **Loss.** If you lose the phone and have no backup, the data is gone. This is
  a consequence of nothing being uploaded, not an oversight.

## How the encryption works

```
DEK  (random 256-bit AES-GCM key)  ──encrypts──>  the entire database
 │
 ├── wrapped by  KEK_bio   ← HKDF( WebAuthn PRF secret )
 └── wrapped by  KEK_pin   ← PBKDF2-SHA256( your PIN, 600,000 rounds )
```

Two independently wrapped copies of the **same** data key. Consequences worth
knowing:

- Either factor unlocks the vault.
- Adding or removing fingerprint unlock never re-encrypts your database — only
  a 32-byte key gets re-wrapped, so it's instant regardless of history size.
- Changing your PIN is likewise instant.
- **Losing both factors means losing the data**, permanently. There is no
  recovery path, because there is no server holding a spare.

### Fingerprint unlock is real decryption

It uses the **WebAuthn PRF extension**, which makes the authenticator derive a
stable secret from a credential held in the phone's secure element. That secret
cannot be extracted from the hardware, and it's what unwraps the data key. This
is materially different from apps that show a fingerprint prompt and then just
decide whether to render the screen — that kind of check can be bypassed by
anyone who can read the storage directly. This one cannot.

If your device doesn't support PRF, enrolment **fails loudly** rather than
leaving you with a button that silently protects nothing.

### Why PBKDF2 at 600,000 rounds

A 6-digit PIN is only a million possibilities. If someone dumps your IndexedDB
and attacks the blob on their own hardware, the on-device lockout is irrelevant
— they aren't using your phone. The only thing standing there is the cost per
guess, which is why the derivation is deliberately slow. Use a longer PIN if you
want more margin; the field accepts up to 12 digits.

### API keys

Any third-party credentials you enter are stored **inside** the encrypted
database blob, so they inherit the same protection automatically. There is no
separate keystore to get wrong. They are excluded from backup exports.

In practice this app needs very few keys, because the CSV-import design means
Whop and Shopify data arrives without any credential at all.

## Other protections

| Control | Detail |
|---|---|
| At-rest encryption | AES-256-GCM, authenticated — a wrong key or tampered blob fails loudly rather than yielding garbage |
| On-device lockout | Escalating delays after repeated wrong PINs: 30s → 5min → 30min → 1hr |
| Auto-lock | Configurable inactivity timeout, default 15 minutes; the key is dropped from memory |
| Lock on reload | The key is never persisted, so any refresh or app restart requires unlocking again |
| Background flush | Data is written encrypted when the app is hidden, since Android can kill a background tab without warning |
| Service worker | Caches app code only. Your data never traverses it — it isn't fetched over the network at all |
| No telemetry | The app makes no outbound requests of any kind |
| `noindex` | Marked against search indexing |

## Your responsibilities

1. **Turn on fingerprint unlock.** It's stronger than the PIN and faster to use.
2. **Write your recovery PIN down** somewhere physical. There is no reset.
3. **Export a backup periodically.** One device is one point of failure.
4. **Install to the home screen**, so Android grants persistent storage and stops
   evicting your data under pressure. Settings warns you if this is pending.
5. **Keep the recovery backup somewhere private** — it's unencrypted JSON.
6. **Keep your phone's own screen lock on.** It's the outer layer this all sits
   behind.

## Reporting

It's your app, running on your phone. If you find a problem in it, fix it or ask
Claude to.
