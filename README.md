# Dropzone

Browser battle royale prototype built with Three.js, Vite, and a WebSocket game server.

## Run

```bash
npm install
npm start
```

Open the Vite URL printed in the terminal. The server listens on port 8080. Solo and Training Ground work without the server; squad rooms require it.

## Flow

First visit: loading screen → local operator profile → lobby. Returning visitors go to the lobby. Choose Solo or Squad room, select a map, then Play. Squad hosts share the displayed room code; friends join with that code, and the host starts the match.

Choose **Squad vs AI** to team up with every friend in the room, or **Free-for-all** to compete against one another. Rooms fill to 50 operators with AI; the HUD distinguishes humans from bots. Invitation links prefill the room code. All five starting weapons and all optics are available in Armory. Earn local XP through Solo and online matches. Training Ground lets you shoot targets without XP.

For Vercel and internet multiplayer, follow [DEPLOYMENT.md](DEPLOYMENT.md). The Vercel frontend uses `VITE_GAME_SERVER_URL` to connect to a persistent match server. The repository is prepared for deployment, but no public deployment is configured.

## Controls

- Drop: ride the transport, F (or E) to jump, W + look down to dive, Space to open the parachute early (auto-opens at 140 m)
- WASD: move; up/down arrows: look vertically
- Mouse: aim after pointer lock; drag on the canvas if pointer lock is unavailable
- Left click: fire; hold for automatic AR/SMG fire. B: toggle auto/single. F: fire (keyboard fallback)
- Right mouse / Ctrl: aim down sights (magnified optics switch to scope view in third person)
- Shift: sprint (firing interrupts it); C: toggle crouch; Space: jump
- R: reload (empty reloads include a charging-handle pull)
- E: pick up loot (weapons fill an empty slot, otherwise swap with the gun in hand; displaced attachments go to the backpack), use a vehicle, or revive a downed teammate
- Vehicles: W/S throttle, A/D steer, Shift brake. Hitting an enemy damages them based on speed
- H / J: medkit (6 s, full health) / bandage (3 s, +25 up to 75). You move slowly and cannot shoot while healing
- Tab or I: inventory — move attachments between weapons and the backpack (drag or buttons), swap weapon slots, drop a weapon, use meds
- M: tactical map (shows you and your squad only); hold P: live scoreboard
- 1 / 2 or mouse wheel: switch weapons
- V: switch first/third person
- Esc: release pointer lock
- Lobby button: leave the match

## Recording trailers

With `npm run dev` running, `node scripts/record.mjs --sequence trailer` renders `recordings/dropzone-trailer.mp4` (cinematic cuts with titles) and `--sequence gameplay` renders a HUD-on gameplay clip. The game is stepped frame by frame in Chrome and encoded with ffmpeg, so output is smooth at any machine speed. Add `--stills` for PNG stills of each shot, `--only shot1,shot2` to preview individual shots (see `src/client/dev/director.ts`). Dev-only tools; nothing here ships in builds.

## Verification

`npm run build` compiles the client and server TypeScript and builds the client. `npm run test:combat` verifies shared hitboxes. `npm run test:match` verifies zone progression, supply drops, bleed-out attribution, revive reset, and online/offline reload reconciliation. `npm run test:smoke` uses two WebSocket clients to check both room modes, friendly-fire protection, timed reloads, fire-rate enforcement, loot distance, weapon swaps and room lifecycle. Start the server before running the smoke test.

## Prototype boundaries

Operator profiles and XP use browser local storage. They are not authenticated accounts and do not sync across devices. Figures and world art are procedural. This is a desktop browser game for private sessions, with basic bot navigation and client-reported movement; it is not a cheat-resistant competitive service. See DEPLOYMENT.md for connection, hosting and scale limitations.

