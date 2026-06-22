# Anti-Asteroids

![Anti-Asteroids gameplay screenshot](docs/screenshot.png)

A real-time multiplayer take on classic Asteroids, built with TypeScript. Fly a neon wedge ship through an asteroid field, shoot rocks for points, bounce off other players, and compete on a live leaderboard — all in a retro arcade UI with synthesized 8-bit audio.

## Features

- **Multiplayer** — Multiple players in the same arena over WebSockets
- **Authoritative server** — Physics, collisions, and scoring run on the server at 60 Hz
- **Retro presentation** — Canvas 2D rendering, CRT-style UI, procedural sound effects
- **Social** — Live chat and leaderboard sidebar
- **Mobile-friendly** — On-screen controls for touch devices
- **Chat commands** — Slash commands for shields, speed, color, and more

## Quick Start

```bash
npm install
npm run dev
```

Open the Vite dev server (typically `http://localhost:5173`) to play. The game server runs on port 3000.

For production:

```bash
npm run build
npm start
```

Then open `http://localhost:3000`.

## Tech Stack

- **Client** — Vite, Canvas 2D, Web Audio API
- **Server** — Node.js, Express, `ws`
- **Shared** — TypeScript types and constants used by both sides

## Documentation

See [docs/system.md](docs/system.md) for architecture, message flow, and implementation details.
