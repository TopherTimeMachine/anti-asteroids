import { GAME_CONFIG, PlayerInput, GameStatePayload } from '../../shared/types.js';
import { Player, Asteroid, Bullet } from './Entities.js';

export class GameState {
  private players: Map<string, Player> = new Map();
  private asteroids: Map<string, Asteroid> = new Map();
  private bullets: Map<string, Bullet> = new Map();
  
  private asteroidIdCounter = 0;
  private bulletIdCounter = 0;

  // Callback to emit visual/sound effects to players
  private onEffectCallback: (effectType: string, data: any) => void;

  constructor(onEffect: (effectType: string, data: any) => void) {
    this.onEffectCallback = onEffect;
    this.initAsteroids();
  }

  private initAsteroids(): void {
    // Spawn initial set of large asteroids
    for (let i = 0; i < GAME_CONFIG.ASTEROID_MIN_COUNT; i++) {
      this.spawnNewLargeAsteroid();
    }
  }

  public spawnNewLargeAsteroid(): void {
    const id = `a_${this.asteroidIdCounter++}`;
    
    // Position: spawn along the edges of the field, not in the center
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
  }

  public addPlayer(id: string, name: string): void {
    const player = new Player(id, name);
    this.players.set(id, player);
    
    // Broadcast notification of player joining
    this.onEffectCallback('player_join', { name: player.name, color: player.color });
  }

  public removePlayer(id: string): void {
    const player = this.players.get(id);
    if (player) {
      this.players.delete(id);
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
    // 1. Update Players
    this.players.forEach((player) => {
      const fired = player.update();
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
        
        // Notify players about bullet sound effect
        this.onEffectCallback('shoot', { x: player.x, y: player.y });
      }
    });

    // 2. Update Bullets
    this.bullets.forEach((bullet, id) => {
      const expired = bullet.update();
      if (expired) {
        this.bullets.delete(id);
      }
    });

    // 3. Update Asteroids
    this.asteroids.forEach((asteroid) => {
      asteroid.update();
    });

    // Maintain asteroid count
    const largeAsteroidCount = Array.from(this.asteroids.values()).filter(a => a.size === 3).length;
    if (largeAsteroidCount < GAME_CONFIG.ASTEROID_MIN_COUNT) {
      this.spawnNewLargeAsteroid();
    }

    // 4. Collision Detection & Resolution
    this.checkCollisions();
  }

  private checkCollisions(): void {
    // Helper to check circle overlap
    const collides = (
      x1: number, y1: number, r1: number,
      x2: number, y2: number, r2: number
    ): boolean => {
      const dx = x1 - x2;
      const dy = y1 - y2;
      const distSq = dx * dx + dy * dy;
      const minDist = r1 + r2;
      return distSq <= minDist * minDist;
    };

    // Keep track of elements to delete
    const bulletsToRemove = new Set<string>();
    const asteroidsToRemove = new Set<string>();

    // A. Bullets vs. Asteroids
    this.bullets.forEach((bullet, bulletId) => {
      this.asteroids.forEach((asteroid, asteroidId) => {
        if (collides(bullet.x, bullet.y, bullet.radius, asteroid.x, asteroid.y, asteroid.radius)) {
          bulletsToRemove.add(bulletId);
          asteroidsToRemove.add(asteroidId);

          // Award points to bullet owner
          const shooter = this.players.get(bullet.ownerId);
          let scoreGained = 100;
          if (asteroid.size === 2) scoreGained = 200;
          if (asteroid.size === 1) scoreGained = 500;
          
          if (shooter && shooter.isAlive) {
            shooter.score += scoreGained;
          }

          // Trigger split
          this.splitAsteroid(asteroid);
        }
      });
    });

    // B. Bullets vs. Players (Friendly fire)
    this.bullets.forEach((bullet, bulletId) => {
      this.players.forEach((player, playerId) => {
        if (bulletsToRemove.has(bulletId)) return;
        if (!player.isAlive || player.invulnerable) return;
        // Players cannot shoot themselves
        if (bullet.ownerId === playerId) return;

        if (collides(bullet.x, bullet.y, bullet.radius, player.x, player.y, player.radius)) {
          bulletsToRemove.add(bulletId);
          player.die();

          // Award major points to shooter
          const shooter = this.players.get(bullet.ownerId);
          if (shooter && shooter.isAlive) {
            shooter.score += 1000;
          }

          // Trigger player explosion event
          this.onEffectCallback('player_explode', { x: player.x, y: player.y, color: player.color });
        }
      });
    });

    // C. Players vs. Asteroids (Elastic bounce — no death)
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

            this.onEffectCallback('bounce', {
              x1: player.x,
              y1: player.y,
              x2: asteroid.x,
              y2: asteroid.y,
            });
          }

          // Always separate overlapping bodies (mass-weighted)
          const overlap = (player.radius + asteroid.radius) - dist;
          const totalMass = m1 + m2;
          player.x -= nx * overlap * (m2 / totalMass);
          player.y -= ny * overlap * (m2 / totalMass);
          asteroid.x += nx * overlap * (m1 / totalMass);
          asteroid.y += ny * overlap * (m1 / totalMass);
        }
      });
    });

    // D. Players vs. Players (Elastic bounce collision + score penalty)
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
          if (dist === 0) dist = 0.001; // Avoid divide by zero

          const nx = dx / dist;
          const ny = dy / dist;

          // Relative velocity
          const rvx = p2.vx - p1.vx;
          const rvy = p2.vy - p1.vy;

          // Velocity along normal
          const velAlongNormal = rvx * nx + rvy * ny;

          // Only bounce if they are moving towards each other
          if (velAlongNormal < 0) {
            const restitution = 0.8; // Bounciness factor
            const impulse = -(1 + restitution) * velAlongNormal / 2; // Equal mass = 1.0

            // Apply velocity changes
            p1.vx -= impulse * nx;
            p1.vy -= impulse * ny;
            p2.vx += impulse * nx;
            p2.vy += impulse * ny;

            // Resolve overlapping positions immediately to prevent sticking
            const overlap = (p1.radius + p2.radius) - dist;
            p1.x -= nx * overlap * 0.5;
            p1.y -= ny * overlap * 0.5;
            p2.x += nx * overlap * 0.5;
            p2.y += ny * overlap * 0.5;

            // Lose a point (clamp at 0)
            p1.score = Math.max(0, p1.score - 1);
            p2.score = Math.max(0, p2.score - 1);

            // Trigger bounce sound and visual sparks event
            this.onEffectCallback('bounce', {
              x1: p1.x,
              y1: p1.y,
              x2: p2.x,
              y2: p2.y,
            });
          }
        }
      }
    }

    // Resolve deletes
    bulletsToRemove.forEach(id => this.bullets.delete(id));
    asteroidsToRemove.forEach(id => this.asteroids.delete(id));
  }

  private splitAsteroid(asteroid: Asteroid): void {
    // Trigger explosion sound and particles at client
    this.onEffectCallback('asteroid_explode', {
      x: asteroid.x,
      y: asteroid.y,
      size: asteroid.size,
    });

    if (asteroid.size > 1) {
      const newSize = asteroid.size - 1;
      
      // Spawn two smaller asteroids moving in opposite directions perpendicular-ish to the parent speed
      const speed = Math.sqrt(asteroid.vx * asteroid.vx + asteroid.vy * asteroid.vy);
      const angle = Math.atan2(asteroid.vy, asteroid.vx);
      
      const angleOffset = Math.PI / 4 + Math.random() * (Math.PI / 6); // roughly 45 degrees
      const speedMultiplier = 1.4;

      const vx1 = Math.cos(angle + angleOffset) * speed * speedMultiplier;
      const vy1 = Math.sin(angle + angleOffset) * speed * speedMultiplier;
      
      const vx2 = Math.cos(angle - angleOffset) * speed * speedMultiplier;
      const vy2 = Math.sin(angle - angleOffset) * speed * speedMultiplier;

      const id1 = `a_${this.asteroidIdCounter++}`;
      const id2 = `a_${this.asteroidIdCounter++}`;

      this.asteroids.set(id1, new Asteroid(id1, asteroid.x, asteroid.y, newSize, vx1, vy1));
      this.asteroids.set(id2, new Asteroid(id2, asteroid.x, asteroid.y, newSize, vx2, vy2));
    }
  }

  public getPayload(): GameStatePayload {
    const playersList = Array.from(this.players.values()).map(p => p.serialize());
    const asteroidsList = Array.from(this.asteroids.values()).map(a => a.serialize());
    const bulletsList = Array.from(this.bullets.values()).map(b => b.serialize());

    return {
      players: playersList,
      asteroids: asteroidsList,
      bullets: bulletsList,
    };
  }

  public getLeaderboard(): { id: string; name: string; score: number; color: string }[] {
    return Array.from(this.players.values())
      .map(p => ({ id: p.id, name: p.name, score: p.score, color: p.color }))
      .sort((a, b) => b.score - a.score);
  }

  public getPlayersMap(): Map<string, Player> {
    return this.players;
  }

  public getAsteroidsMap(): Map<string, Asteroid> {
    return this.asteroids;
  }
}
