# First-time Cloudflare setup

The Next.js frontend can remain on Vercel. Only the realtime WebSocket room
service is deployed to Cloudflare.

You do not need to create a Durable Object, SQLite database or Worker manually
in the Cloudflare dashboard. Wrangler creates them from
`cloudflare/wrangler.jsonc` during the first deployment.

## 1. Create and connect an account

Create a Cloudflare account at
[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up), then run:

```bash
pnpm exec wrangler login
```

A browser window opens. Approve Wrangler's access to your Cloudflare account.

## 2. Deploy the realtime Worker

From the repository root, run:

```bash
pnpm realtime:deploy
```

On the first deployment, Cloudflare may ask you to register a `workers.dev`
subdomain. Wrangler then prints a URL similar to:

```text
https://airmouse-realtime.your-subdomain.workers.dev
```

Verify it by opening:

```text
https://airmouse-realtime.your-subdomain.workers.dev/health
```

The response should contain `{"ok":true,"service":"airmouse-realtime"}`.

## 3. Connect the Next.js frontend

In the Vercel project, open **Settings → Environment Variables** and add:

```text
Name:  NEXT_PUBLIC_AIRMOUSE_WS_URL
Value: wss://airmouse-realtime.your-subdomain.workers.dev
```

Enable it for Production and Preview. Redeploy the Next.js application after
adding it: `NEXT_PUBLIC_` values are placed into the browser bundle at build
time.

For local Next.js development against the deployed Worker, put the same `wss`
URL in `.env.local` and restart `pnpm dev`.

## 4. Restrict which websites can connect (recommended after testing)

The Worker initially accepts connections from any website because you might be
using a Vercel preview URL. Once the production frontend URL is known, set an
origin allowlist:

```bash
pnpm exec wrangler secret put ALLOWED_ORIGINS --config cloudflare/wrangler.jsonc
```

When prompted, enter the exact frontend origins separated by commas, without a
trailing slash. For example:

```text
https://airmouse.example.com,https://airmouse.vercel.app
```

Then deploy again:

```bash
pnpm realtime:deploy
```

Do not add the Worker URL to this value. Add the URLs where the Next.js pages
are opened.

## 5. Test a room

1. Open the deployed `/screen` page on a laptop.
2. Scan its QR code with a phone.
3. Join, enable motion and move the cursor.
4. Turn Wi-Fi off on the phone briefly, then turn it back on.
5. The controller should show a reconnecting spinner and automatically return
   to the same player within the 15-second host grace period.

View live Worker logs with:

```bash
pnpm realtime:tail
```

## Free tier behavior

Durable Objects are available on the Workers Free plan using the SQLite-backed
namespace configured by this project. The free plan has daily limits; after a
limit is reached, further operations fail until the daily reset instead of
creating automatic overage charges. Current pricing and limits are listed in
the [Cloudflare Durable Objects pricing documentation](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## What is stored where

- Cursor movement is forwarded in memory and is never written to storage.
- The latest game-state snapshot is stored so a reconnecting phone can resume.
- Player connection metadata is attached to the hibernating WebSocket.
- Questions currently remain in `lib/game/questions.ts`.
