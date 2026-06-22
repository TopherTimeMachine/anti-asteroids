import { GAME_CONFIG, PlayerData, AsteroidData, BulletData, PlayerInput } from '../../shared/types.js';

export class Player {
  public id: string;
  public name: string;
  public score: number = 0;
  
  public x: number = 0;
  public y: number = 0;
  public vx: number = 0;
  public vy: number = 0;
  public angle: number = -Math.PI / 2; // Pointing upwards initially
  
  public isThrusting: boolean = false;
  public isAlive: boolean = true;
  public color: string;
  
  public invulnerable: boolean = true;
  public invulnerableTimer: number = GAME_CONFIG.INVULNERABILITY_FRAMES;
  public respawnTimer: number = 0;
  public shootCooldown: number = 0;
  
  public inputs: PlayerInput = {
    thrust: false,
    left: false,
    right: false,
    shoot: false,
  };

  // Physics tuning
  private drag = 0.985;
  public thrustAcc = 0.15;
  private rotationSpeed = 0.07; // Radians per frame
  public radius = 15;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name.slice(0, 12) || 'Unnamed';
    this.color = this.generateRetroColor();
    this.spawn();
  }

  private generateRetroColor(): string {
    const retroColors = [
      '#39FF14', // Neon Green
      '#00FFFF', // Neon Cyan
      '#FF00FF', // Neon Magenta
      '#FFFF00', // Neon Yellow
      '#FF3131', // Neon Red
      '#FF5E00', // Neon Orange
      '#8A2BE2', // Neon Violet
    ];
    return retroColors[Math.floor(Math.random() * retroColors.length)];
  }

  public spawn(): void {
    // Spawn in random coordinates near the center
    this.x = GAME_CONFIG.FIELD_WIDTH / 2 + (Math.random() - 0.5) * 200;
    this.y = GAME_CONFIG.FIELD_HEIGHT / 2 + (Math.random() - 0.5) * 200;
    this.vx = 0;
    this.vy = 0;
    this.angle = -Math.PI / 2;
    this.isAlive = true;
    this.invulnerable = true;
    this.invulnerableTimer = GAME_CONFIG.INVULNERABILITY_FRAMES;
    this.respawnTimer = 0;
    this.shootCooldown = 0;
  }

  public die(): void {
    this.isAlive = false;
    this.respawnTimer = GAME_CONFIG.RESPAWN_DELAY_FRAMES;
    this.isThrusting = false;
  }

  public update(): boolean {
    // If dead, handle respawn timer
    if (!this.isAlive) {
      if (this.respawnTimer > 0) {
        this.respawnTimer--;
        if (this.respawnTimer === 0) {
          this.spawn();
        }
      }
      return false; // No bullet fired
    }

    // Handle invulnerability
    if (this.invulnerable) {
      this.invulnerableTimer--;
      if (this.invulnerableTimer <= 0) {
        this.invulnerable = false;
      }
    }

    // Cooldown ticks
    if (this.shootCooldown > 0) {
      this.shootCooldown--;
    }

    // Handle inputs
    if (this.inputs.left) {
      this.angle -= this.rotationSpeed;
    }
    if (this.inputs.right) {
      this.angle += this.rotationSpeed;
    }

    this.isThrusting = this.inputs.thrust;
    if (this.isThrusting) {
      // Add thrust acceleration
      this.vx += Math.cos(this.angle) * this.thrustAcc;
      this.vy += Math.sin(this.angle) * this.thrustAcc;
    }

    // Apply drag
    this.vx *= this.drag;
    this.vy *= this.drag;

    // Apply movement
    this.x += this.vx;
    this.y += this.vy;

    // Screen wrapping
    if (this.x < 0) this.x += GAME_CONFIG.FIELD_WIDTH;
    if (this.x > GAME_CONFIG.FIELD_WIDTH) this.x -= GAME_CONFIG.FIELD_WIDTH;
    if (this.y < 0) this.y += GAME_CONFIG.FIELD_HEIGHT;
    if (this.y > GAME_CONFIG.FIELD_HEIGHT) this.y -= GAME_CONFIG.FIELD_HEIGHT;

    // Handle shooting
    let fired = false;
    if (this.inputs.shoot && this.shootCooldown === 0) {
      this.shootCooldown = 15; // Fire rate: 4 bullets per second
      fired = true;
    }

    return fired;
  }

  public serialize(): PlayerData {
    return {
      id: this.id,
      name: this.name,
      score: this.score,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      angle: this.angle,
      isThrusting: this.isThrusting,
      isAlive: this.isAlive,
      color: this.color,
      invulnerable: this.invulnerable,
      invulnerableTimer: this.invulnerableTimer,
      respawnTimer: this.respawnTimer,
    };
  }
}

export class Asteroid {
  public id: string;
  public x: number;
  public y: number;
  public vx: number;
  public vy: number;
  public size: number; // 3 = Large, 2 = Medium, 1 = Small
  public angle: number = 0;
  public angularSpeed: number;
  public shapeSeed: number;
  public radius: number;

  constructor(id: string, x: number, y: number, size: number, vx?: number, vy?: number) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.size = size;

    // Radius based on size
    if (size === 3) this.radius = 45;
    else if (size === 2) this.radius = 25;
    else this.radius = 12;

    // Procedural shape seed
    this.shapeSeed = Math.floor(Math.random() * 10000);

    // Random angular rotation speed
    this.angularSpeed = (Math.random() - 0.5) * 0.03;

    // Velocity based on size (smaller = faster)
    if (vx !== undefined && vy !== undefined) {
      this.vx = vx;
      this.vy = vy;
    } else {
      const speedMultiplier = size === 3 ? 1.0 : size === 2 ? 1.8 : 2.5;
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.5 + Math.random() * 1.0) * speedMultiplier;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
    }
  }

  public update(): void {
    this.x += this.vx;
    this.y += this.vy;
    this.angle += this.angularSpeed;

    // Wrap-around coordinate system
    if (this.x < -this.radius) this.x += GAME_CONFIG.FIELD_WIDTH + this.radius * 2;
    if (this.x > GAME_CONFIG.FIELD_WIDTH + this.radius) this.x -= GAME_CONFIG.FIELD_WIDTH + this.radius * 2;
    if (this.y < -this.radius) this.y += GAME_CONFIG.FIELD_HEIGHT + this.radius * 2;
    if (this.y > GAME_CONFIG.FIELD_HEIGHT + this.radius) this.y -= GAME_CONFIG.FIELD_HEIGHT + this.radius * 2;
  }

  public serialize(): AsteroidData {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      size: this.size,
      angle: this.angle,
      angularSpeed: this.angularSpeed,
      shapeSeed: this.shapeSeed,
    };
  }
}

export class Bullet {
  public id: string;
  public x: number;
  public y: number;
  public vx: number;
  public vy: number;
  public ownerId: string;
  public lifespan: number = 90; // 1.5 seconds at 60fps
  public radius = 3;

  constructor(id: string, ownerId: string, x: number, y: number, angle: number, ownerVx: number, ownerVy: number) {
    this.id = id;
    this.ownerId = ownerId;
    
    // Bullet starts at the tip of the spaceship
    const tipDistance = 15;
    this.x = x + Math.cos(angle) * tipDistance;
    this.y = y + Math.sin(angle) * tipDistance;
    
    // Bullet speed added to player's current speed
    const bulletSpeed = 9;
    this.vx = Math.cos(angle) * bulletSpeed + ownerVx * 0.5;
    this.vy = Math.sin(angle) * bulletSpeed + ownerVy * 0.5;
  }

  public update(): boolean {
    this.x += this.vx;
    this.y += this.vy;
    
    // Bullets also wrap around
    if (this.x < 0) this.x += GAME_CONFIG.FIELD_WIDTH;
    if (this.x > GAME_CONFIG.FIELD_WIDTH) this.x -= GAME_CONFIG.FIELD_WIDTH;
    if (this.y < 0) this.y += GAME_CONFIG.FIELD_HEIGHT;
    if (this.y > GAME_CONFIG.FIELD_HEIGHT) this.y -= GAME_CONFIG.FIELD_HEIGHT;

    this.lifespan--;
    return this.lifespan <= 0; // Return true if expired
  }

  public serialize(): BulletData {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      ownerId: this.ownerId,
    };
  }
}
