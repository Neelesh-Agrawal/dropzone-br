# Deploy Dropzone

The frontend is ready for Vercel. Multiplayer uses the persistent Node server in `server/index.ts`. Solo and Training Ground run entirely in the browser.

## Local and same-network play

```sh
npm install
npm start
```

Open the **Network** URL printed by Vite on each computer, using the same URL for everyone. Choose **Play with friends**, choose **Squad vs AI** or **Free-for-all**, select **Ashen Valley**, and create the room. Share its invitation link. The host starts after everyone joins. Use `127.0.0.1` instead of `localhost` if another local app occupies the IPv6 localhost address.

## Vercel frontend + persistent match server

1. Deploy this repository's server to a Node/container host. Build: `npm ci && npm run build`. Start: `npm run server`. The server respects `PORT` (default `8080`), serves `dist`, and exposes `/api/health` and `/ws`. A Dockerfile is included.
2. Enable HTTPS on that host and get the public WebSocket URL, such as `wss://your-match-host.example/ws`.
3. Import this repository into Vercel as a Vite project. `vercel.json` supplies build and output settings.
4. Set **VITE_GAME_SERVER_URL** to the public WebSocket URL in Vercel's environment variables. This is a public endpoint, not a secret. Redeploy after changing it.
5. Open the Vercel URL in two browsers, create a room in one and use the invitation link in the other. Confirm both names appear before starting.

Run exactly one server instance for this version: rooms live in its memory. Multiple independent instances cannot share room codes. Restarting the server ends its matches. No hosting account, public endpoint, or deployment has been created by this change.

## Why not just put the current server in a Vercel Function?

Vercel now documents WebSocket support in beta, but independent connections can land on different function instances, and connections close at the function duration limit. This game's 20 Hz simulation and room maps currently live in memory. Simply exporting it as a Function would make room joins unreliable. An all-Vercel backend requires shared room state and coordinated simulation ownership plus resumable sessions; that adapter is not implemented here.

Source: https://vercel.com/docs/functions/websockets (checked October 2, 2026).

## Verification

```sh
npm run build
npm run test:combat
npm run test:match
# With server running:
npm run test:smoke
```

The smoke test uses two real WebSocket clients to verify co-op immunity, free-for-all damage, bot filling, fire-rate limits, timed reloads, swaps, distant-loot rejection, latency echo, host migration and leave/rejoin flow.

## Current scope

Desktop keyboard/mouse browser game with procedural art. Rooms fill to 50 operators with bots and accept up to 100 humans; 100 simultaneous players have not been load-tested. Profiles are browser-local. Movement remains client-reported, so this is for private games with friends, not cheat-resistant ranked competition. Reconnecting after a server loss returns to the lobby; an active player session is not resumed. Revives and healing are immediate interactions. Bot navigation is basic. Voice chat, accounts and matchmaking are not included.

