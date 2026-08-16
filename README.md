# AirMouse

AirMouse is a multiplayer drag-and-drop quiz. Players use their phone's
gyroscope and accelerometer to control cursors on a shared host screen.

## Architecture

- Next.js hosts the landing page, room controller and shared host screen.
- A Cloudflare Worker accepts the WebSocket upgrade.
- One Durable Object coordinates each room code.
- Player movement is sent only to the host; game state and results are sent
  only to the clients that need them.

## Local development

Install dependencies:

```bash
pnpm install
```

Add the following line to `.env.local`:

```dotenv
NEXT_PUBLIC_AIRMOUSE_WS_URL=ws://localhost:8787
```

Start the realtime service and the Next.js app in separate terminals:

```bash
pnpm realtime:dev
```

```bash
pnpm dev
```

Then open [http://localhost:3000/screen](http://localhost:3000/screen).

For motion testing on a physical phone, deploy the Worker and frontend first.
Mobile sensor permissions generally require an HTTPS page.

## Deployment

Follow [CLOUDFLARE_SETUP.md](./CLOUDFLARE_SETUP.md) for the first deployment,
Vercel environment variable and optional origin restriction.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm realtime:check
pnpm build
```
