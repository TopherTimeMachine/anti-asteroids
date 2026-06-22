# Anti-Asteroids System Architecture

Multiplayer retro Asteroids built with TypeScript. The server is authoritative: it runs physics, collisions, and scoring. Clients render the world, collect input, and play synthesized audio. Communication happens over WebSockets with JSON messages.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                        │
│  index.html + style.css                                         │
│       │                                                         │
│       ▼                                                         │
│  main.ts ──► GameClient ──► WebSocket ◄──────────────────────┐  │
│       │           │                                           │  │
│       │           ├── ParticleSystem (local VFX)              │  │
│       │           └── AudioSynthesizer (Web Audio API)        │  │
│       ▼                                                       │  │
│  GameRenderer (Canvas 2D)                                     │  │
└───────────────────────────────────────────────────────────────┼─┘
                                                                │
┌───────────────────────────────────────────────────────────────┼─┐
│                    Node.js Server (Express + ws)              │  │
│  server.ts ◄──────────────────────────────────────────────────┘  │
│       │                                                         │
│       ├── GameState (60 Hz tick loop, collisions, scoring)      │
│       │       └── Entities (Player, Asteroid, Bullet)           │
│       └── CommandProcessor (slash commands via chat)            │
│                                                                 │
│  Serves static client from dist/client/                         │
└─────────────────────────────────────────────────────────────────┘

         src/shared/types.ts  ◄── shared by client and server
         src/shared/physics.ts ◄── wrap + extrapolation helpers
```

## Directory Layout

| Path | Role |
|------|------|
| `index.html` | Page shell: HUD, canvas, chat, join modal, mobile controls |
| `src/client/` | Browser-side code |
| `src/server/` | Authoritative game server |
| `src/shared/` | Types and constants used by both sides |
| `dist/client/` | Vite production build (served by Express) |
| `dist/server/` | Compiled server output (`npm start`) |
| `docs/` | Project documentation |

## Build & Run

| Script | What it does |
|--------|--------------|
| `npm run dev` | Runs Vite (client, port 5173) and server (`tsx watch`, port 3000) together |
| `npm run dev:client` | Vite dev server only |
| `npm run dev:server` | Server with hot reload via `tsx watch` |
| `npm run build` | Builds client (`dist/client`) and server (`dist/server`) |
| `npm start` | Runs compiled server; serves client from `dist/client` |

**TypeScript configs**

- `tsconfig.json` — base strict settings
- `tsconfig.client.json` — client + shared, no emit (Vite bundles)
- `tsconfig.server.json` — server + shared, emits to `dist/server/`

**Vite** (`vite.config.ts`) — bundles `index.html` and client TS into `dist/client/`.

In production, one process on port 3000 serves both the static client and WebSocket upgrades on the same host.

---

## Shared Layer

### `src/shared/types.ts`

Single source of truth for wire format and game constants.

**Data interfaces** — serialized shapes sent over the network:

- `PlayerInput` — thrust, left, right, shoot booleans
- `PlayerData`, `AsteroidData`, `BulletData` — full entity snapshots (used in `snapshot` only)
- Compact tuples — `CompactPlayerUpdate`, `CompactAsteroidSpawn`, etc. (hot-path deltas)
- `SnapshotPayload`, `DeltaPayload` — bandwidth-optimized sync payloads
- `ChatMessage` — chat line with sender metadata

**Message types**

- Server → client: `init`, `snapshot`, `delta`, `spawn`, `despawn`, `effect`, `leaderboard`, `chat`, `chatHistory`
- Client → server: `join`, `input`, `chat`

**`GAME_CONFIG`** — field size (1600×1200), tick rate (60 Hz), broadcast rate (15 Hz), resync interval, asteroid counts, respawn/invulnerability frames.

### `src/shared/physics.ts`

Shared wrap-around and dead-reckoning helpers used by client extrapolation:

- `wrapSimple()` / `wrapAsteroid()` — screen wrap matching server rules
- `extrapolateLinear()` / `extrapolateAngle()` — advance position/rotation using server tick velocity (pixels per 60 Hz tick)
- `encodePlayerFlags()` / `decodePlayerFlags()` — compact player state bitmask

Both client and server import from shared modules so physics bounds and message shapes stay aligned.

---

## Server

### `src/server/server.ts`

Entry point. Wires HTTP, WebSocket, and the game loop.

**Responsibilities**

1. **Express** — serves `dist/client/` static files; `GET *` returns `index.html`
2. **WebSocket** — upgrades HTTP connections; assigns each client a `playerId` (`p_0`, `p_1`, …)
3. **Connection lifecycle**
   - On connect: add player, send `init`, full `snapshot`, leaderboard, chat history
   - On message: route `join`, `input`, or `chat`
   - On close: remove player, update leaderboard
4. **Game loop** — `setInterval` at 60 Hz runs `gameState.tick()`; broadcasts compact `delta` at 15 Hz; full `snapshot` resync every ~15 s; leaderboard every 2 s
5. **Effects & chat** — `GameState` effect callback broadcasts `effect` messages (bounce rate-limited to 500 ms per entity pair); chat routes slash commands through `CommandProcessor` or broadcasts normal chat

### `src/server/game/GameState.ts`

Authoritative world simulation.

**State**

- `runtimeConfig` — mutable server settings (min/max asteroids, split toggle)
- `Map`s of `Player`, `Asteroid`, `Bullet`
- ID counters for new asteroids and bullets
- Delta diff state (`lastBroadcastPlayers`, `lastBroadcastAsteroids`)
- Pending spawn/despawn queues for compact wire events

**Per tick (`tick()`)**

1. Update all players (movement, shooting); spawn bullets when a player fires
2. Update bullets (movement, expiry)
3. Update asteroids (movement, rotation)
4. Maintain at least `runtimeConfig.asteroidMinCount` large asteroids (capped by `asteroidMaxCount`)
5. Run collision detection

**Collisions**

| Pair | Behavior |
|------|----------|
| Bullet ↔ Asteroid | Bullet removed; asteroid split; score by size (100 / 200 / 500) |
| Bullet ↔ Player | Friendly fire; victim dies; shooter +1000; `player_explode` effect |
| Player ↔ Asteroid | Elastic bounce (no death); mass-weighted separation; `bounce` effect |
| Player ↔ Player | Elastic bounce; both lose 1 point (min 0); `bounce` effect |

**Other**

- `destroyAsteroid()` — destroys asteroid; splits into two smaller ones if `asteroidSplitEnabled` and size > 1
- `getFullSnapshot()` — full world state for connect/resync (no bullets)
- `collectDelta()` — changed players, sparse asteroid corrections, spawn/despawn events
- `getLeaderboard()` — players sorted by score descending
- Effect callback — join/leave, shoot, explosions, bounces (client-side audio/VFX only)

### `src/server/game/Entities.ts`

Server-side entity classes with physics and serialization.

**`Player`**

- Spawn near center with random retro neon color
- Input-driven rotation, thrust, drag, screen wrap
- Shoot cooldown (15 frames ≈ 4 shots/sec)
- Death → respawn timer; invulnerability after spawn
- `update()` returns `true` when a shot should fire
- `serialize()` → `PlayerData`; `serializeCompactUpdate()` / `serializeCompactSpawn()` for deltas
- `isAdmin` — session flag for password-gated admin commands (not sent to clients)

**`Asteroid`**

- Sizes 3 (large), 2 (medium), 1 (small) with radius 45 / 25 / 12
- Procedural `shapeSeed` for consistent client rendering
- Random velocity and angular speed; wrap-around movement
- `serialize()` → `AsteroidData`; compact spawn/correction serializers for deltas

**`Bullet`**

- Spawns at ship nose; inherits partial owner velocity
- 90-frame lifespan; wraps; `serializeCompactSpawn()` sent once on fire — positions never re-sent

### `src/server/game/CommandProcessor.ts`

Parses chat messages starting with `/`. Returns `true` if handled (not broadcast as normal chat).

Admin mode requires `ADMIN_PASSWORD` environment variable. Use `/admin <password>` to unlock admin commands for your session.

| Command | Access | Effect |
|---------|--------|--------|
| `/help` | anyone | Lists commands (extended list when admin) |
| `/admin <password>` | anyone | Unlock admin mode |
| `/admin off` | admin | Deactivate admin mode |
| `/admin status` | admin | Show runtime server config |
| `/color <value>` | anyone | Change ship color |
| `/shields` | admin | Toggle invulnerability |
| `/speed <n>` | admin | Set thrust multiplier (0.1–5.0) |
| `/score <n>` | admin | Set score |
| `/spawn <n>` | admin | Spawn 1–10 large asteroids |
| `/maxasteroids <n>` | admin | Set minimum large asteroid count (0–50) |
| `/maxtotal <n>` | admin | Set max total asteroids (1–100) |
| `/split on\|off` | admin | Toggle asteroid splitting on destroy |

Exports singleton `commandProcessor`.

---

## Client

### `index.html`

DOM structure for the arcade UI:

- Canvas, HUD (score, status, sound toggle)
- Leaderboard and chat sidebar
- Join modal, death/respawn overlay
- Mobile virtual gamepad buttons
- CRT scanline overlay (styled in CSS)

Loads `/src/client/main.ts` as an ES module (Vite in dev, bundled in prod).

### `src/client/style.css`

Retro arcade styling: CRT effects, neon colors, glassmorphic panels, responsive layout, mobile control visibility.

### `src/client/main.ts`

Client bootstrap and glue code.

**Wires**

- DOM elements → `GameClient` callbacks (leaderboard, connection, score, death/respawn, chat)
- Mobile buttons → `GameClient` touch flags
- Join form → `client.join(name)`
- Chat form → `client.sendChatMessage()` (local `/clear` clears UI only)
- Sound toggle → `audioSynthesizer.toggleMute()`
- Resize → `GameRenderer.resize()`

**Render loop** — `requestAnimationFrame`:

1. `client.update()` — particles, thrust VFX, input polling
2. `client.getExtrapolatedState()` — dead-reckoned positions from last sync + velocity
3. `renderer.render(...)` — draw frame

### `src/client/game/GameClient.ts`

WebSocket client and local game state mirror.

**Connection**

- Connects to `ws://` or `wss://` same host as the page
- Auto-reconnect after 3 seconds on disconnect
- On `init`: stores `localPlayerId`

**Incoming messages**

| Type | Handler |
|------|---------|
| `init` | Save player ID and config |
| `snapshot` | Rebuild entity registry from full state |
| `delta` | Merge compact player/asteroid updates and spawn/despawn events |
| `leaderboard` | UI callback; sync local score |
| `effect` | Trigger audio + particles (shoot, explode, bounce) |
| `chat` | UI callback |

**Input**

- Keyboard: arrows/WASD thrust/turn, Space shoot
- Touch buttons via public flags set by `main.ts`
- Sends `input` only when keys/touch state changes (no heartbeat)

**Client-side extrapolation (dead reckoning)**

- Players, asteroids, bullets advance each frame: `position += velocity × dt`
- Asteroids also rotate via `angularSpeed`; bullets travel straight lines
- Server sends corrections at 15 Hz; full snapshot resync every ~15 s
- Wrap-aware using shared `physics.ts` helpers

### `src/client/game/GameRenderer.ts`

Canvas 2D rendering in game coordinates.

**Pipeline (each frame)**

1. Clear + letterbox background
2. Starfield (fixed procedural stars)
3. Cyan neon arena border
4. Particles
5. Bullets (colored by owner)
6. Asteroids (jagged outlines from cached LCG vertices keyed by id/size/seed)
7. Players (wedge ships, thrust flame, invulnerability ring, name tags)

**Viewport** — scales 1600×1200 field to fit window, letterboxed and centered.

### `src/client/game/ParticleSystem.ts`

Client-only visual effects (not synced over network).

- `spawnExplosion()` — radial burst for asteroid/player hits and bounces
- `spawnThrustTrail()` — exhaust behind local ship when thrusting
- `update()` / `draw()` — simple position + fade lifecycle

### `src/client/game/AudioSynthesizer.ts`

Procedural 8-bit sound via Web Audio API (no audio files).

- Initialized on first user interaction (join or sound toggle)
- Stereo panning from entity X position
- Sounds: shoot, asteroid/player explode, bounce, thrust tick, background heartbeat
- Heartbeat tempo speeds up as asteroid count drops (`updateBeatTempo`)
- Singleton `audioSynthesizer` with mute toggle

---

## Message Flow

### Join sequence

```
Client                          Server
  │ connect WS                      │
  │                                 │ addPlayer(default name)
  │◄──────── init { playerId } ─────│
  │◄──────── snapshot ──────────────│
  │◄──────── leaderboard ───────────│
  │◄──────── chatHistory ───────────│
  │ join { name } ─────────────────►│
  │                                 │ remove + addPlayer(name)
  │◄──────── delta (spawn) ─────────│
  │◄──────── leaderboard ───────────│
```

### Gameplay loop (60 Hz server physics, 15 Hz network sync)

```
Client                              Server
  │ input { thrust, left, ... } ───►│ updatePlayerInput (on change only)
  │                                 │ tick() @ 60 Hz → physics + collisions
  │◄──────── delta { p, a, s+, s- }─│ @ 15 Hz (changed entities only)
  │◄──────── snapshot ──────────────│ @ ~15 s resync
  │◄──────── effect (on events) ────│ shoot, explode, bounce
  │ extrapolate + render @ rAF      │
```

### Chat

```
Client                              Server
  │ chat { text: "/help" } ────────►│ CommandProcessor → private system chat
  │ chat { text: "hello" } ────────►│ broadcast chat to all
  │◄──────── chat ──────────────────│
```

---

## Scoring

| Event | Points |
|-------|--------|
| Destroy small asteroid (size 1) | +500 |
| Destroy medium asteroid (size 2) | +200 |
| Destroy large asteroid (size 3) | +100 |
| Destroy another player | +1000 |
| Bump another player | −1 each (floor 0) |

---

## Design Notes

**Authoritative server** — Clients never simulate collisions or scoring. They extrapolate positions visually from last-known velocity between sparse server updates.

**Bandwidth optimization** — Compact delta messages at 15 Hz instead of full JSON state at 60 Hz. Bullets sent once on spawn; client computes straight-line trajectories locally. Static player metadata (name, color) sent in snapshots only; scores via leaderboard.

**Effect messages** — One-shot events (sounds, particles) are separate from state so all clients hear/see them even if they miss a delta.

**Deterministic asteroid shapes** — Server assigns `shapeSeed`; client regenerates the same jagged polygon locally. No vertex data on the wire.

**Development vs production** — In dev, Vite (5173) and the server (3000) run separately; you typically open the Vite URL and may need a proxy for WebSockets unless configured. In production, `npm start` serves everything from one port.

**Friendly fire** — Players can kill each other with bullets. Asteroid contact only bounces.

**Respawn** — 2 seconds dead (`RESPAWN_DELAY_FRAMES`), 3 seconds invulnerable after spawn (`INVULNERABILITY_FRAMES`).
