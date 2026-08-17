# Bluddian

A private founder dashboard that runs **entirely on your phone**. Tracks revenue
from Whop and Shopify, what Claude costs you, the products and courses you're
building, and the money goals you're chasing — with XP, levels, streaks and
quests on top, because a number you check every morning beats a spreadsheet you
open twice.

**There is no server and no account.** Your phone is the database. Nothing is
uploaded, nothing syncs to a cloud, and there is no login to be breached —
because there is nothing on the other end to log in to.

---

## How it works

The app is a static site — plain HTML, CSS and JavaScript. Install it to your
home screen from Chrome and it behaves like any other Android app: own icon,
full screen, works with the radio off.

All your data lives in your phone's IndexedDB storage as a **single
AES-256-GCM-encrypted blob**. The key that decrypts it is unlocked by your
fingerprint (or face, or the device PIN) using the WebAuthn PRF extension, so
your fingerprint genuinely performs the decryption rather than just hiding a
screen. A recovery PIN unlocks the same key as a backup.

```
your fingerprint ─┐
                  ├─→ unwraps the data key ─→ decrypts the database
your recovery PIN ┘
```

Either factor opens the vault, and changing one never re-encrypts your history.

## Quick start

```bash
npm install
npm run build     # produces ./out — a folder of static files
npm run serve     # http://localhost:3000
```

Open it, set a recovery PIN, and you're running. Turn on fingerprint unlock in
Settings.

## Getting it on your Pixel

You need to serve the `out/` folder over **HTTPS** — both service workers and
fingerprint unlock require a secure origin.

**Easiest:** drag `out/` onto [Cloudflare Pages](https://pages.dev) or
[Netlify Drop](https://app.netlify.com/drop). Free, instant, gives you an HTTPS
URL at a root domain.

**Or GitHub Pages:** enable Pages (Settings → Pages → Source: GitHub Actions).
The included workflow builds and deploys on every push to `main`, and sets the
sub-path automatically.

Then on your phone:

1. Open the URL in Chrome.
2. **⋮ → Add to Home screen** → Install.
3. Open it from the home screen, set your PIN, enable fingerprint unlock.

Do step 3 from the **installed** app rather than the browser tab — Android grants
permanent storage more readily to installed apps, which stops it clearing your
data when space runs low. Settings will warn you if that hasn't been granted.

> Publishing the site publicly is fine: it contains only the app's code. Your
> data never leaves your phone, so there is nothing on the server to expose. The
> repo itself is worth keeping private, since it reveals which platforms you
> sell on.

## Getting your numbers in

### Whop and Shopify — CSV import

Both platforms' order APIs are server-only: browsers are refused by CORS, by
design. With no server in this architecture, their **export files** are the way
in, and it's a fair trade — no API key to store, nothing to leak, works offline.

- **Shopify:** Admin → Orders → Export → plain CSV
- **Whop:** Dashboard → Payments → Export

Then **Money → Import**. Columns are matched by name across a list of known
aliases, so it survives their periodic renames. You get a preview with the row
count, the total and the matched columns before anything is written.

Re-importing the same file is safe — orders are keyed by their platform ID and
duplicates are skipped rather than doubling your revenue.

### Claude spend — manual

Anthropic's usage API needs an organisation admin key and also can't be called
from a browser. Check your console once a week and type the number in; it takes
ten seconds and keeps this app free of any credential worth stealing.

### Everything else — manual

Cash, invoices, Stripe links, coaching calls. The **+** button on Money. Plenty
of real income never touches a platform API, and a dashboard that could only see
APIs would under-report what you actually make.

## The game layer

XP comes from **real outcomes only** — shipping a product (+400), publishing a
lesson (+75 each), logging a sale (scaled by size, capped), completing a quest,
hitting a goal. Nothing rewards opening the app, because a dashboard that pays
you to check it is a slot machine.

Levels cost 25% more each time. Streaks count days with real activity. Undoing a
completed quest claws the XP back, so the counter can't be farmed.

## Backups

**Settings → Export backup** writes a JSON file. Do this occasionally.

Your data exists in exactly one place. If you lose the phone, reset it, or clear
the app's storage, it's gone — that's the flip side of nothing being uploaded.
The export deliberately excludes API keys and is **not encrypted**, so put it
somewhere you'd be comfortable putting a bank statement.

## Commands

```bash
npm run dev        # dev server with hot reload
npm run build      # static export to ./out
npm run serve      # serve ./out locally
npm run typecheck  # tsc --noEmit
npm run icons      # regenerate the PWA launcher icons
```

## What's inside

```
src/lib/local/     the whole engine — vault, crypto, store, selectors, CSV
src/components/    presentational UI + the unlock gate
src/app/           one client component per screen
```

No server code, no database driver, no ORM, no chart library, no state-management
library. Charts are hand-rolled SVG; state is a plain object with
`useSyncExternalStore`.

See [SECURITY.md](./SECURITY.md) for the threat model and exactly what protects
your data.
