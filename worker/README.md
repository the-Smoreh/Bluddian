# The relay — setup in 3 minutes

This makes Shopify and Whop sync **automatically** into Bluddian.

## Why it's needed

Shopify's and Whop's APIs are built for servers, not browsers. They deliberately
don't send the `Access-Control-Allow-Origin` header, so Chrome refuses to hand
their responses to a web app — the request is blocked before your code sees it.

This relay is the smallest thing that fixes it: it forwards one request and adds
that header. It stores nothing, logs nothing, and can only talk to Shopify and
Whop.

**Free forever.** Cloudflare's free plan allows 100,000 requests a day; syncing
every 30 minutes uses about 100 a month.

---

## Step 1 — make a Cloudflare account

Go to **https://dash.cloudflare.com/sign-up** and sign up. No card needed.

## Step 2 — create the Worker

1. In the left sidebar click **Compute (Workers)**
2. Click **Create**
3. Click **Start with Hello World!**
4. Name it `bluddian-relay`
5. Click **Deploy**

## Step 3 — paste the code

1. Click **Edit code** (top right)
2. Select everything in the editor and delete it
3. Open **`bluddian-relay.js`** (next to this file) and copy all of it
4. Paste it in
5. Click **Deploy** (top right)

## Step 4 — make your secret token

You need a long random password. Generate one however you like — or open a new
browser tab, press F12, and paste this into the Console:

```js
crypto.randomUUID() + crypto.randomUUID()
```

Copy the result. **This is your `RELAY_TOKEN`.** Keep it.

## Step 5 — add the token to the Worker

1. Go back to the Worker's page
2. Click **Settings** → **Variables and Secrets**
3. Under **Secrets**, click **Add**
4. Name: `RELAY_TOKEN` (exactly, capitals included)
5. Value: paste your token
6. Click **Deploy**

## Step 6 — get your Worker URL

On the Worker's overview page you'll see a URL like:

```
https://bluddian-relay.YOUR-NAME.workers.dev
```

Copy it.

## Step 7 — connect it in Bluddian

1. Open Bluddian on your phone
2. **⚙️ Settings** → **Auto-sync relay**
3. Paste the **Worker URL** and the **RELAY_TOKEN**
4. Tap **Test and save**

If it says "Relay is working", you're done. It refuses to save a relay that
doesn't work, so a green result means it genuinely connected.

---

## Then connect your platforms

**Settings → Platforms → Shopify**

- **Shop domain:** `yourstore.myshopify.com`
- **Admin API access token:** Shopify admin → Settings → Apps and sales channels
  → Develop apps → Create an app → Configure Admin API scopes → tick
  **`read_orders`** and **`read_products`** → Install → reveal the token
  (starts `shpat_`)

**Settings → Platforms → Whop**

- **API key:** Whop dashboard → Developer → API keys → create one (read access
  is enough)

Then tap **Sync now**. After that it syncs by itself — on open, and whenever you
come back to the app after 30 minutes.

---

## What this relay can and can't do

**Can't:** reach anything except `*.myshopify.com` and `api.whop.com`; be used
by anyone without your token; store or log your keys.

**Can:** see your API keys as they pass through, because forwarding them is its
entire job. It's your Worker on your account — the same trust you'd place in any
backend you ran yourself. If that's not a trade you want, skip the relay and use
**Money → Import** with CSV exports instead; everything else in the app works
identically.

## If something breaks

| Message | Cause |
|---|---|
| `Relay rejected the token` | `RELAY_TOKEN` in Cloudflare doesn't match what you pasted in the app |
| `Could not reach your relay` | Wrong URL, or the Worker isn't deployed |
| `Relay is missing its RELAY_TOKEN secret` | You skipped Step 5 |
| `Shopify rejected the token` | Token lacks `read_orders`, or isn't an Admin API token |
| `Host not allowed` | Shouldn't happen — means a request tried to reach somewhere unexpected |
