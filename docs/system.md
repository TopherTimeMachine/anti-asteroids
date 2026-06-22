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
- `PlayerData`, `AsteroidData`, `BulletData` — entity snapshots
- `GameStatePayload` — full world state (players, asteroids, bullets)
- `ChatMessage` — chat line with sender metadata

**Message types**

- Server → client: `init`, `state`, `effect`, `leaderboard`, `chat`
- Client → server: `join`, `input`, `chat`

**`GAME_CONFIG`** — field size (1600×1200), tick rate (60 Hz), asteroid minimum count, respawn/invulnerability frame counts, max players.

Both client and server import from here so physics bounds and message shapes stay aligned.

---

## Server

### `src/server/server.ts`

Entry point. Wires HTTP, WebSocket, and the game loop.

**Responsibilities**

1. **Express** — serves `dist/client/` static files; `GET *` returns `index.html`
2. **WebSocket** — upgrades HTTP connections; assigns each client a `playerId` (`p_0`, `p_1`, …)
3. **Connection lifecycle**
   - On connect: send `init` (playerId + field dimensions), add placeholder player, broadcast leaderboard
   - On message: route `join`, `input`, or `chat`
   - On close: remove player, update leaderboard
4. **Game loop** — `setInterval` at 60 Hz calls `gameState.tick()` and broadcasts `state` every tick; leaderboard every 2 seconds
5. **Effects & chat** — `GameState` effect callback broadcasts `effect` messages; chat routes slash commands through `CommandProcessor` or broadcasts normal chat

### `src/server/game/GameState.ts`

Authoritative world simulation.

**State**

- `Map`s of `Player`, `Asteroid`, `Bullet`
- ID counters for new asteroids and bullets

**Per tick (`tick()`)**

1. Update all players (movement, shooting); spawn bullets when a player fires
2. Update bullets (movement, expiry)
3. Update asteroids (movement, rotation)
4. Maintain at least `ASTEROID_MIN_COUNT` large asteroids
5. Run collision detection

**Collisions**

| Pair | Behavior |
|------|----------|
| Bullet ↔ Asteroid | Bullet removed; asteroid split; score by size (100 / 200 / 500) |
| Bullet ↔ Player | Friendly fire; victim dies; shooter +1000; `player_explode` effect |
| Player ↔ Asteroid | Elastic bounce (no death); mass-weighted separation; `bounce` effect |
| Player ↔ Player | Elastic bounce; both lose 1 point (min 0); `bounce` effect |

**Other**

- `splitAsteroid()` — destroys asteroid, spawns two smaller ones if size > 1, emits `asteroid_explode`
- `getPayload()` — serializes all entities for broadcast
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
- `serialize()` → `PlayerData`

**`Asteroid`**

- Sizes 3 (large), 2 (medium), 1 (small) with radius 45 / 25 / 12
- Procedural `shapeSeed` for consistent client rendering
- Random velocity and angular speed; wrap-around movement
- `serialize()` → `AsteroidData`

**`Bullet`**

- Spawns at ship nose; inherits partial owner velocity
- 90-frame lifespan; wraps; `serialize()` → `BulletData`

### `src/server/game/CommandProcessor.ts`

Parses chat messages starting with `/`. Returns `true` if handled (not broadcast as normal chat).

| Command | Effect |
|---------|--------|
| `/help` | Lists commands (private) |
| `/shields` | Toggle invulnerability |
| `/speed <n>` | Set thrust multiplier (0.1–5.0) |
| `/score <n>` | Set score |
| `/color <value>` | Change ship color (name or hex) |
| `/spawn <n>` | Spawn 1–10 large asteroids |

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
2. `client.getInterpolatedState()` — smoothed positions
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
| `init` | Save player ID |
| `state` | Update entity arrays; track local player death/respawn/score; adjust beat tempo |
| `leaderboard` | UI callback |
| `effect` | Trigger audio + particles (shoot, explode, bounce) |
| `chat` | UI callback |

**Input**

- Keyboard: arrows/WASD thrust/turn, Space shoot
- Touch buttons via public flags set by `main.ts`
- Sends `input` on change + 10 Hz heartbeat so server always has current state

**Interpolation**

- Players and asteroids lerped toward server positions (factor 0.28)
- Wrap-aware: snaps if target is on opposite side of field
- Bullets drawn at raw server coordinates (short-lived, fast)

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
  │◄──────── init { playerId } ─────│
  │                                 │ addPlayer(default name)
  │◄──────── state ─────────────────│
  │◄──────── leaderboard ───────────│
  │ join { name } ─────────────────►│
  │                                 │ remove + addPlayer(name)
  │◄──────── leaderboard ───────────│
```

### Gameplay loop (every frame on server, every rAF on client)

```
Client                              Server
  │ input { thrust, left, ... } ───►│ updatePlayerInput
  │                                 │ tick() → physics + collisions
  │◄──────── state { players, ... }─│
  │◄──────── effect (on events) ────│ shoot, explode, bounce
  │ interpolate + render            │
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

**Authoritative server** — Clients never simulate collisions or scoring. They only predict visually via interpolation.

**Effect messages** — One-shot events (sounds, particles) are separate from state so all clients hear/see them even if they miss a frame of position data.

**Deterministic asteroid shapes** — Server assigns `shapeSeed`; client regenerates the same jagged polygon locally. No vertex data on the wire.

**Development vs production** — In dev, Vite (5173) and the server (3000) run separately; you typically open the Vite URL and may need a proxy for WebSockets unless configured. In production, `npm start` serves everything from one port.

**Friendly fire** — Players can kill each other with bullets. Asteroid contact only bounces.

**Respawn** — 2 seconds dead (`RESPAWN_DELAY_FRAMES`), 3 seconds invulnerable after spawn (`INVULNERABILITY_FRAMES`).
