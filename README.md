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

Start the local WebSocket Worker and the Next.js app in separate terminals.
The Worker runs locally; you do not need to deploy it or create a Cloudflare
account to test a room on this computer.

```bash
pnpm realtime:dev
```

```bash
pnpm dev
```

Then open [http://localhost:3000/screen](http://localhost:3000/screen) as the
host. Open a second browser tab at [http://localhost:3000](http://localhost:3000)
and join the room using the code shown on the host screen. Both tabs connect to
the local Worker at `ws://localhost:8787`.

In PowerShell, if `pnpm` is blocked by the script execution policy, run the
commands as `pnpm.cmd realtime:dev` and `pnpm.cmd dev`.

## Question banks

Choose the active bank with `NEXT_PUBLIC_QUESTION_BANK` in `.env.local`:
`internal` or `external`. The setting is read at build time, so set the same
variable in Vercel and redeploy to switch the hosted site. If unset or invalid,
the app uses the external bank. The internal bank is in `lib/game/questions.ts`;
external bank entries are defined in `lib/game/external-questions.ts`. Each
challenge has `id`, `language`, `number`, `label`, `source`, `memoriseText`, and
`segments`. Build each segment
with `makeQuestion(id, prompt, parts, instruction)`. In a prompt, `[1]`, `[2]`,
etc. refer to phrases in `parts` in the correct order. Give each challenge and
segment a unique ID.
Use a template literal for `memoriseText`; blank lines split it into separate
paragraphs on the host screen, and single line breaks are preserved.

For motion testing on a physical phone, use the deployed HTTPS frontend and
Worker. Mobile browsers generally require HTTPS to grant motion sensor access.

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
