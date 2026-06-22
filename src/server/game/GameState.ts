import {
  GAME_CONFIG,
  PlayerInput,
  GameStatePayload,
  GameRuntimeConfig,
  SnapshotPayload,
  DeltaPayload,
  SpawnPayload,
  CompactPlayerUpdate,
  CompactAsteroidCorrection,
  CompactAsteroidSpawn,
  CompactBulletSpawn,
  CompactPlayerSpawn,
} from '../../shared/types.js';
import { encodePlayerFlags } from '../../shared/physics.js';
import { Player, Asteroid, Bullet } from './Entities.js';

interface LastBroadcastPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  flags: number;
}

interface LastBroadcastAsteroid {
  x: number;
  y: number;
  angle: number;
}

export class GameState {
  private players: Map<string, Player> = new Map();
  private asteroids: Map<string, Asteroid> = new Map();
  private bullets: Map<string, Bullet> = new Map();

  private asteroidIdCounter = 0;
  private bulletIdCounter = 0;
  private currentTick = 0;
  private deltaBroadcastCount = 0;

  public runtimeConfig: GameRuntimeConfig = {
    asteroidMinCount: GAME_CONFIG.ASTEROID_MIN_COUNT,
    asteroidMaxCount: GAME_CONFIG.ASTEROID_MAX_COUNT,
    asteroidSplitEnabled: true,
  };

  private lastBroadcastPlayers: Map<string, LastBroadcastPlayer> = new Map();
  private lastBroadcastAsteroids: Map<string, LastBroadcastAsteroid> = new Map();
  private knownEntityIds: Set<string> = new Set();

  private pendingSpawns: SpawnPayload = {};
  private pendingDespawns: string[] = [];

  private bounceCooldowns: Map<string, number> = new Map();

  private onEffectCallback: (effectType: string, data: any) => void;

  constructor(onEffect: (effectType: string, data: any) => void) {
    this.onEffectCallback = onEffect;
    this.initAsteroids();
  }

  private initAsteroids(): void {
    for (let i = 0; i < this.runtimeConfig.asteroidMinCount; i++) {
      this.spawnNewLargeAsteroid(false);
    }
  }

  private queueSpawn(type: 'p' | 'a' | 'b', data: CompactPlayerSpawn | CompactAsteroidSpawn | CompactBulletSpawn): void {
    const key = type === 'p' ? 'p' : type === 'a' ? 'a' : 'b';
    if (!this.pendingSpawns[key]) {
      this.pendingSpawns[key] = [];
    }
    (this.pendingSpawns[key] as any[]).push(data);
    this.knownEntityIds.add(data[0] as string);
  }

  private queueDespawn(id: string): void {
    if (this.knownEntityIds.has(id)) {
      this.pendingDespawns.push(id);
      this.knownEntityIds.delete(id);
      this.lastBroadcastPlayers.delete(id);
      this.lastBroadcastAsteroids.delete(id);
    }
  }

  private emitBounce(x1: number, y1: number, x2: number, y2: number, keyA: string, keyB: string): void {
    const pairKey = [keyA, keyB].sort().join(':');
    const now = Date.now();
    const last = this.bounceCooldowns.get(pairKey) ?? 0;
    if (now - last < 500) return;
    this.bounceCooldowns.set(pairKey, now);
    this.onEffectCallback('bounce', { x1, y1, x2, y2 });
  }

  public spawnNewLargeAsteroid(emitSpawn = true): void {
    if (this.asteroids.size >= this.runtimeConfig.asteroidMaxCount) return;

    const id = `a_${this.asteroidIdCounter++}`;

    let x = 0;
    let y = 0;

    if (Math.random() < 0.5) {
      x = Math.random() < 0.5 ? 50 : GAME_CONFIG.FIELD_WIDTH - 50;
      y = Math.random() * GAME_CONFIG.FIELD_HEIGHT;
    } else {
      x = Math.random() * GAME_CONFIG.FIELD_WIDTH;
      y = Math.random() < 0.5 ? 50 : GAME_CONFIG.FIELD_HEIGHT - 50;
    }

    const asteroid = new Asteroid(id, x, y, 3);
    this.asteroids.set(id, asteroid);
    if (emitSpawn) {
      this.queueSpawn('a', asteroid.serializeCompactSpawn());
    }
  }

  public addPlayer(id: string, name: string): void {
    const player = new Player(id, name);
    this.players.set(id, player);
    this.queueSpawn('p', player.serializeCompactSpawn());
    this.onEffectCallback('player_join', { name: player.name, color: player.color });
  }

  public removePlayer(id: string): void {
    const player = this.players.get(id);
    if (player) {
      this.players.delete(id);
      this.queueDespawn(id);
      this.onEffectCallback('player_leave', { name: player.name });
    }
  }

  public updatePlayerInput(id: string, input: PlayerInput): void {
    const player = this.players.get(id);
    if (player) {
      player.inputs = input;
    }
  }

  public tick(): void {
    this.currentTick++;

    this.players.forEach((player) => {
      const wasAlive = player.isAlive;
      const fired = player.update();
      if (!wasAlive && player.isAlive) {
        this.queueSpawn('p', player.serializeCompactSpawn());
      }
      if (fired) {
        const bulletId = `b_${this.bulletIdCounter++}`;
        const bullet = new Bullet(
          bulletId,
          player.id,
          player.x,
          player.y,
          player.angle,
          player.vx,
          player.vy
        );
        this.bullets.set(bulletId, bullet);
        this.queueSpawn('b', bullet.serializeCompactSpawn());
        this.onEffectCallback('shoot', { x: player.x, y: player.y });
      }
    });

    const expiredBullets: string[] = [];
    this.bullets.forEach((bullet, id) => {
      const expired = bullet.update();
      if (expired) {
        expiredBullets.push(id);
      }
    });
    expiredBullets.forEach((id) => {
      this.bullets.delete(id);
      this.queueDespawn(id);
    });

    this.asteroids.forEach((asteroid) => {
      asteroid.update();
    });

    const largeAsteroidCount = Array.from(this.asteroids.values()).filter((a) => a.size === 3).length;
    if (largeAsteroidCount < this.runtimeConfig.asteroidMinCount) {
      this.spawnNewLargeAsteroid();
    }

    this.checkCollisions();
  }

  private checkCollisions(): void {
    const collides = (
      x1: number,
      y1: number,
      r1: number,
      x2: number,
      y2: number,
      r2: number
    ): boolean => {
      const dx = x1 - x2;
      const dy = y1 - y2;
      const distSq = dx * dx + dy * dy;
      const minDist = r1 + r2;
      return distSq <= minDist * minDist;
    };

    const bulletsToRemove = new Set<string>();
    const asteroidsToRemove = new Set<string>();

    this.bullets.forEach((bullet, bulletId) => {
      this.asteroids.forEach((asteroid, asteroidId) => {
        if (collides(bullet.x, bullet.y, bullet.radius, asteroid.x, asteroid.y, asteroid.radius)) {
          bulletsToRemove.add(bulletId);
          asteroidsToRemove.add(asteroidId);

          const shooter = this.players.get(bullet.ownerId);
          let scoreGained = 100;
          if (asteroid.size === 2) scoreGained = 200;
          if (asteroid.size === 1) scoreGained = 500;

          if (shooter && shooter.isAlive) {
            shooter.score += scoreGained;
          }

          this.destroyAsteroid(asteroid);
        }
      });
    });

    this.bullets.forEach((bullet, bulletId) => {
      this.players.forEach((player, playerId) => {
        if (bulletsToRemove.has(bulletId)) return;
        if (!player.isAlive || player.invulnerable) return;
        if (bullet.ownerId === playerId) return;

        if (collides(bullet.x, bullet.y, bullet.radius, player.x, player.y, player.radius)) {
          bulletsToRemove.add(bulletId);
          player.die();

          const shooter = this.players.get(bullet.ownerId);
          if (shooter && shooter.isAlive) {
            shooter.score += 1000;
          }

          this.onEffectCallback('player_explode', { x: player.x, y: player.y, color: player.color });
        }
      });
    });

    this.players.forEach((player) => {
      if (!player.isAlive || player.invulnerable) return;

      this.asteroids.forEach((asteroid, asteroidId) => {
        if (asteroidsToRemove.has(asteroidId)) return;

        if (collides(player.x, player.y, player.radius, asteroid.x, asteroid.y, asteroid.radius)) {
          const dx = asteroid.x - player.x;
          const dy = asteroid.y - player.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist === 0) dist = 0.001;

          const nx = dx / dist;
          const ny = dy / dist;

          const rvx = asteroid.vx - player.vx;
          const rvy = asteroid.vy - player.vy;
          const velAlongNormal = rvx * nx + rvy * ny;

          const restitution = 0.8;
          const m1 = player.radius * player.radius;
          const m2 = asteroid.radius * asteroid.radius;

          if (velAlongNormal < 0) {
            const impulse = -(1 + restitution) * velAlongNormal / (1 / m1 + 1 / m2);

            player.vx -= (impulse / m1) * nx;
            player.vy -= (impulse / m1) * ny;
            asteroid.vx += (impulse / m2) * nx;
            asteroid.vy += (impulse / m2) * ny;

            this.emitBounce(player.x, player.y, asteroid.x, asteroid.y, player.id, asteroidId);
          }

          const overlap = (player.radius + asteroid.radius) - dist;
          const totalMass = m1 + m2;
          player.x -= nx * overlap * (m2 / totalMass);
          player.y -= ny * overlap * (m2 / totalMass);
          asteroid.x += nx * overlap * (m1 / totalMass);
          asteroid.y += ny * overlap * (m1 / totalMass);
        }
      });
    });

    const playerIds = Array.from(this.players.keys());
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const p1 = this.players.get(playerIds[i])!;
        const p2 = this.players.get(playerIds[j])!;

        if (!p1.isAlive || !p2.isAlive) continue;

        if (collides(p1.x, p1.y, p1.radius, p2.x, p2.y, p2.radius)) {
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist === 0) dist = 0.001;

          const nx = dx / dist;
          const ny = dy / dist;

          const rvx = p2.vx - p1.vx;
          const rvy = p2.vy - p1.vy;
          const velAlongNormal = rvx * nx + rvy * ny;

          if (velAlongNormal < 0) {
            const restitution = 0.8;
            const impulse = -(1 + restitution) * velAlongNormal / 2;

            p1.vx -= impulse * nx;
            p1.vy -= impulse * ny;
            p2.vx += impulse * nx;
            p2.vy += impulse * ny;

            const overlap = (p1.radius + p2.radius) - dist;
            p1.x -= nx * overlap * 0.5;
            p1.y -= ny * overlap * 0.5;
            p2.x += nx * overlap * 0.5;
            p2.y += ny * overlap * 0.5;

            p1.score = Math.max(0, p1.score - 1);
            p2.score = Math.max(0, p2.score - 1);

            this.emitBounce(p1.x, p1.y, p2.x, p2.y, p1.id, p2.id);
          }
        }
      }
    }

    bulletsToRemove.forEach((id) => {
      this.bullets.delete(id);
      this.queueDespawn(id);
    });
    asteroidsToRemove.forEach((id) => {
      if (this.asteroids.has(id)) {
        this.asteroids.delete(id);
        this.queueDespawn(id);
      }
    });
  }

  private destroyAsteroid(asteroid: Asteroid): void {
    this.onEffectCallback('asteroid_explode', {
      x: asteroid.x,
      y: asteroid.y,
      size: asteroid.size,
    });

    this.asteroids.delete(asteroid.id);
    this.queueDespawn(asteroid.id);

    if (!this.runtimeConfig.asteroidSplitEnabled || asteroid.size <= 1) {
      return;
    }

    const newSize = asteroid.size - 1;
    const speed = Math.sqrt(asteroid.vx * asteroid.vx + asteroid.vy * asteroid.vy);
    const angle = Math.atan2(asteroid.vy, asteroid.vx);
    const angleOffset = Math.PI / 4 + Math.random() * (Math.PI / 6);
    const speedMultiplier = 1.4;

    const vx1 = Math.cos(angle + angleOffset) * speed * speedMultiplier;
    const vy1 = Math.sin(angle + angleOffset) * speed * speedMultiplier;
    const vx2 = Math.cos(angle - angleOffset) * speed * speedMultiplier;
    const vy2 = Math.sin(angle - angleOffset) * speed * speedMultiplier;

    const id1 = `a_${this.asteroidIdCounter++}`;
    const id2 = `a_${this.asteroidIdCounter++}`;

    const a1 = new Asteroid(id1, asteroid.x, asteroid.y, newSize, vx1, vy1);
    const a2 = new Asteroid(id2, asteroid.x, asteroid.y, newSize, vx2, vy2);
    this.asteroids.set(id1, a1);
    this.asteroids.set(id2, a2);
    this.queueSpawn('a', a1.serializeCompactSpawn());
    this.queueSpawn('a', a2.serializeCompactSpawn());
  }

  private playerChanged(player: Player, last: LastBroadcastPlayer | undefined, force: boolean): boolean {
    if (!last || force) return true;
    const flags = encodePlayerFlags(player.isThrusting, player.isAlive, player.invulnerable);
    const threshold = GAME_CONFIG.DELTA_POSITION_THRESHOLD;
    return (
      Math.abs(player.x - last.x) > threshold ||
      Math.abs(player.y - last.y) > threshold ||
      Math.abs(player.vx - last.vx) > 0.05 ||
      Math.abs(player.vy - last.vy) > 0.05 ||
      Math.abs(player.angle - last.angle) > 0.02 ||
      flags !== last.flags
    );
  }

  private asteroidNeedsCorrection(asteroid: Asteroid, last: LastBroadcastAsteroid | undefined, force: boolean): boolean {
    if (!last || force) return true;
    const threshold = GAME_CONFIG.DELTA_POSITION_THRESHOLD;
    return (
      Math.abs(asteroid.x - last.x) > threshold ||
      Math.abs(asteroid.y - last.y) > threshold ||
      Math.abs(asteroid.angle - last.angle) > 0.02
    );
  }

  public getFullSnapshot(): SnapshotPayload {
    this.rebuildKnownEntities();
    return {
      tick: this.currentTick,
      players: Array.from(this.players.values()).map((p) => p.serialize()),
      asteroids: Array.from(this.asteroids.values()).map((a) => a.serialize()),
      config: { ...this.runtimeConfig },
    };
  }

  private rebuildKnownEntities(): void {
    this.knownEntityIds.clear();
    this.players.forEach((p) => this.knownEntityIds.add(p.id));
    this.asteroids.forEach((a) => this.knownEntityIds.add(a.id));
    this.bullets.forEach((b) => this.knownEntityIds.add(b.id));
  }

  public resetBroadcastState(): void {
    this.lastBroadcastPlayers.clear();
    this.lastBroadcastAsteroids.clear();
    this.pendingSpawns = {};
    this.pendingDespawns = [];
    this.rebuildKnownEntities();
  }

  public collectDelta(): DeltaPayload | null {
    this.deltaBroadcastCount++;
    const forceHeartbeat =
      this.deltaBroadcastCount % GAME_CONFIG.PLAYER_HEARTBEAT_INTERVAL === 0;
    const forceAsteroidCorrection =
      this.deltaBroadcastCount % GAME_CONFIG.ASTEROID_CORRECTION_INTERVAL === 0;

    const playerUpdates: CompactPlayerUpdate[] = [];
    this.players.forEach((player) => {
      const last = this.lastBroadcastPlayers.get(player.id);
      if (this.playerChanged(player, last, forceHeartbeat)) {
        const update = player.serializeCompactUpdate();
        playerUpdates.push(update);
        this.lastBroadcastPlayers.set(player.id, {
          x: player.x,
          y: player.y,
          vx: player.vx,
          vy: player.vy,
          angle: player.angle,
          flags: update[6],
        });
      }
    });

    const asteroidCorrections: CompactAsteroidCorrection[] = [];
    this.asteroids.forEach((asteroid) => {
      const last = this.lastBroadcastAsteroids.get(asteroid.id);
      if (this.asteroidNeedsCorrection(asteroid, last, forceAsteroidCorrection)) {
        const correction = asteroid.serializeCompactCorrection();
        asteroidCorrections.push(correction);
        this.lastBroadcastAsteroids.set(asteroid.id, {
          x: asteroid.x,
          y: asteroid.y,
          angle: asteroid.angle,
        });
      }
    });

    const delta: DeltaPayload = { t: this.currentTick };

    if (playerUpdates.length > 0) delta.p = playerUpdates;
    if (asteroidCorrections.length > 0) delta.a = asteroidCorrections;

    const hasSpawns =
      (this.pendingSpawns.p?.length ?? 0) > 0 ||
      (this.pendingSpawns.a?.length ?? 0) > 0 ||
      (this.pendingSpawns.b?.length ?? 0) > 0;

    if (hasSpawns) {
      delta['s+'] = { ...this.pendingSpawns };
      this.pendingSpawns = {};
    }

    if (this.pendingDespawns.length > 0) {
      delta['s-'] = [...this.pendingDespawns];
      this.pendingDespawns = [];
    }

    const hasContent =
      delta.p || delta.a || delta['s+'] || delta['s-'];

    return hasContent ? delta : null;
  }

  public drainPendingEvents(): { spawns: SpawnPayload; despawns: string[] } {
    const spawns = { ...this.pendingSpawns };
    const despawns = [...this.pendingDespawns];
    this.pendingSpawns = {};
    this.pendingDespawns = [];
    return { spawns, despawns };
  }

  /** @deprecated Use getFullSnapshot for network; kept for chat name lookup */
  public getPayload(): GameStatePayload {
    return {
      players: Array.from(this.players.values()).map((p) => p.serialize()),
      asteroids: Array.from(this.asteroids.values()).map((a) => a.serialize()),
      bullets: Array.from(this.bullets.values()).map((b) => b.serialize()),
    };
  }

  public getLeaderboard(): { id: string; name: string; score: number; color: string }[] {
    return Array.from(this.players.values())
      .map((p) => ({ id: p.id, name: p.name, score: p.score, color: p.color }))
      .sort((a, b) => b.score - a.score);
  }

  public getPlayersMap(): Map<string, Player> {
    return this.players;
  }

  public getAsteroidsMap(): Map<string, Asteroid> {
    return this.asteroids;
  }

  public getRuntimeConfig(): GameRuntimeConfig {
    return this.runtimeConfig;
  }
}
