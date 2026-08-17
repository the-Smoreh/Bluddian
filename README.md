# Bluddian

A private founder dashboard that installs on your phone. Tracks the money coming
in from **Whop** and **Shopify**, what **Claude** is costing you, the products and
courses you're building, and the goals you're chasing — with XP, levels, streaks
and quests layered on top, because a number you check every morning beats a
spreadsheet you open twice.

Built as an installable **PWA**: on a Pixel it lands on your home screen with its
own icon, runs full-screen, and works offline. No Play Store, no sideloading.

---

## Why a PWA and not a native app

The important reason is security. Your Anthropic, Whop and Shopify keys have to
live somewhere. In a native app they'd be shipped inside the APK on the device,
where anyone with the file can pull them out. Here they live on **your server**,
encrypted, and the phone only ever sees rendered numbers.

The convenience reasons are secondary but real: one codebase, instant updates
with no store review, and installation is two taps in Chrome.

---

## Quick start

```bash
npm install
npm run keygen      # generates .env.local with your encryption key + setup code
npm run icons       # generates the launcher icons (already committed)
npm run dev         # http://localhost:3000
```

Open the app, and the first screen asks you to create the one and only account.
It'll want the setup code that `keygen` printed.

Then go to **Settings → Connections** and add whichever platforms you use. None
are required — you can log sales by hand and the whole app still works.

## Getting it on your Pixel

1. Deploy somewhere with **HTTPS** (see below). A service worker won't install
   over plain HTTP, so the phone install flow needs a real certificate.
2. Open the site in Chrome on the phone.
3. **⋮ → Add to Home screen** → Install.

It now behaves like any other app: own icon, own task-switcher entry, full
screen, offline shell, and three long-press shortcuts (Log a sale, Goals, Claude).

## Deploying

The app is a standard Next.js server plus a SQLite file. It needs a **persistent
disk** — SQLite is a file, so anywhere ephemeral (like a plain serverless
platform) will silently lose your data on redeploy.

Good fits: Fly.io with a volume, Railway, Render, a $5 VPS with Caddy in front,
or a Raspberry Pi at home behind Tailscale.

Whatever you pick, set these:

| Variable | Why |
|---|---|
| `APP_ENCRYPTION_KEY` | **Required.** Encrypts your stored API keys. Losing it means re-entering them; changing it makes existing ones unreadable. |
| `SETUP_CODE` | Stops a stranger claiming the dashboard between deploy and your first login. Remove after signing up. |
| `DATABASE_PATH` | Point at your persistent volume, e.g. `/data/bluddian.db`. |
| `TRUST_PROXY=1` | Set **only** behind a proxy you control. See the note in `.env.example` — getting this wrong in either direction weakens rate limiting. |

Back up the database file. It holds every sale, goal, and encrypted key you have.

---

## Should this repo be private?

You asked, so: **yes, make it private** — but not for the reason you might think.

There are no secrets in this code. Keys live in `.env.local` and in the database,
both of which are gitignored, and the app is built so a plaintext key is never
returned by any endpoint. Publishing the source would not leak a credential.

Make it private anyway, because the repo tells people **which** platforms you
sell on, what your product pipeline looks like, and where your dashboard is
deployed. That's business intelligence about you, and it's free reconnaissance
for anyone who fancies a run at your accounts.

On GitHub: **Settings → General → Danger Zone → Change repository visibility**.

If the repo was ever public with a real key committed, rotating that key is the
only fix — deleting the commit does not remove it from forks or caches.

---

## How the tracking works

### Claude
Uses the Anthropic **Admin API** (`/v1/organizations/usage_report/messages` and
`/cost_report`) for token counts and authoritative dollar amounts. That needs an
admin key (`sk-ant-admin…`), which only an org owner can create — so if you can't
mint one, log spend manually and everything else still works. Manual entries are
stored separately from synced rows and are never overwritten by a sync.

### Whop
Pulls products and payments from the v5 REST API. Field names are read
defensively with fallbacks, because Whop's payload shape varies by account.

### Shopify
Uses the Admin **GraphQL** API for orders and products. Also accepts order
webhooks for real-time updates.

### Idempotency
Every synced row has a `UNIQUE(platform, external_id)`. Re-running a sync updates
rows rather than inserting them again — double-counted revenue would make the
whole dashboard lie, so this is enforced at the database level, not in code.

## The game layer

XP comes from **real outcomes only** — shipping a product (+400), publishing a
lesson (+75 each), logging a sale (scaled by size), completing a quest, hitting a
goal. Nothing rewards opening the app, because a dashboard that pays you to check
it is a slot machine.

Levels cost 25% more each time. Streaks count days with real activity, not
launches. Undoing a completed quest claws the XP back so the counter can't be
farmed.

## Commands

```bash
npm run dev        # dev server
npm run build      # production build
npm run start      # production server
npm run typecheck  # tsc --noEmit
npm run keygen     # generate .env.local (refuses to overwrite)
npm run icons      # regenerate PWA icons
npm run db:reset   # delete the database (asks first)
```

See [SECURITY.md](./SECURITY.md) for the threat model and what's actually
protecting your data.
